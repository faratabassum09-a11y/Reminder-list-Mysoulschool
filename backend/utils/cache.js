import Redis from "ioredis";

// Thin cache-aside layer used to keep the app fast with many people hitting
// it at once. Entirely optional: with no REDIS_URL set, every function
// below is a safe no-op and the app behaves exactly as it did before —
// same for a Redis that's down or unreachable, so a caching problem can
// never turn into an outage.
//
// Set REDIS_URL to enable it (see .env.example) — e.g. a free Redis on
// Upstash/Render both work fine for this.

// Throttles the "Redis error" console line to once every 60s instead of
// once per failed command — a misconfigured/unreachable REDIS_URL used to
// print one line per request, which is what showed up as a wall of
// "Redis cache error" noise even though the app kept working fine.
let lastErrorLoggedAt = 0;
function logErrorThrottled(err) {
  const now = Date.now();
  if (now - lastErrorLoggedAt < 60_000) return;
  lastErrorLoggedAt = now;
  console.error("[cache] Redis unavailable, continuing without cache:", err.message);
}

let client;
function getClient() {
  if (client !== undefined) return client;
  if (!process.env.REDIS_URL) {
    client = null;
    return client;
  }
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    commandTimeout: 1500,
    // Without this, a command issued while disconnected sits in an
    // in-memory queue waiting for a (re)connect that may never succeed
    // instead of failing right away — that queueing is what turned a bad
    // REDIS_URL into requests hanging for seconds at a time rather than
    // just skipping the cache. Failing fast keeps a cache problem from
    // ever becoming a request-latency problem.
    enableOfflineQueue: false,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  client.on("error", logErrorThrottled);
  client.on("connect", () => console.log("[cache] Redis connected"));
  return client;
}

// Every exported function below already fails safe on a Redis error, but
// "fails safe" only helps if it fails *fast* — wraps any call in a hard
// timeout so a hung connection can never make a request wait longer than
// this, regardless of what the client's own timeouts are doing.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function cacheGet(key) {
  const c = getClient();
  if (!c) return null;
  try {
    const v = await withTimeout(c.get(key), 1500, null);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  const c = getClient();
  if (!c) return;
  try {
    await withTimeout(c.set(key, JSON.stringify(value), "EX", ttlSeconds), 1500, null);
  } catch {
    // caching is best-effort — a write failure here should never break the request
  }
}

// Deletes one exact key, or every key matching a "prefix:*" pattern.
export async function cacheDel(pattern) {
  const c = getClient();
  if (!c) return;
  try {
    if (!pattern.includes("*")) {
      await c.del(pattern);
      return;
    }
    const keys = [];
    const stream = c.scanStream({ match: pattern, count: 200 });
    for await (const batch of stream) keys.push(...batch);
    if (keys.length) await c.del(keys);
  } catch {
    // best-effort
  }
}

// Wraps an Express GET handler: serves from cache when present, otherwise
// runs `loader()`, caches the result, and returns it. Usage:
//   router.get("/", cached("doers:all", 300, async () => {
//     return Doer.find().sort(...).lean();
//   }));
export function cached(key, ttlSeconds, loader) {
  return async (req, res) => {
    const hit = await cacheGet(key);
    if (hit !== null) return res.json(hit);
    const data = await loader(req);
    cacheSet(key, data, ttlSeconds); // fire-and-forget
    res.json(data);
  };
}

// Simple distributed cooldown: returns true the first time a given key is
// claimed within `ttlSeconds`, false on every call after that until the
// TTL expires. With Redis unavailable, always returns true (unlimited —
// matches the pre-Redis behavior of running every time).
export async function claimCooldown(key, ttlSeconds) {
  const c = getClient();
  if (!c) return true;
  try {
    const res = await withTimeout(c.set(key, "1", "NX", "EX", ttlSeconds), 1500, "OK");
    return res === "OK";
  } catch {
    return true;
  }
}
