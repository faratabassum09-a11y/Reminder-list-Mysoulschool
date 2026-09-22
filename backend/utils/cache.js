import Redis from "ioredis";

// Thin cache-aside layer used to keep the app fast with many people hitting
// it at once. Entirely optional: with no REDIS_URL set, every function
// below is a safe no-op and the app behaves exactly as it did before —
// same for a Redis that's down or unreachable, so a caching problem can
// never turn into an outage.
//
// Set REDIS_URL to enable it (see .env.example) — e.g. a free Redis on
// Upstash/Render both work fine for this.

let client;
function getClient() {
  if (client !== undefined) return client;
  if (!process.env.REDIS_URL) {
    client = null;
    return client;
  }
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  client.on("error", (err) => console.error("[cache] Redis error (continuing without cache):", err.message));
  client.on("connect", () => console.log("[cache] Redis connected"));
  return client;
}

export async function cacheGet(key) {
  const c = getClient();
  if (!c) return null;
  try {
    const v = await c.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(value), "EX", ttlSeconds);
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
    const res = await c.set(key, "1", "NX", "EX", ttlSeconds);
    return res === "OK";
  } catch {
    return true;
  }
}
