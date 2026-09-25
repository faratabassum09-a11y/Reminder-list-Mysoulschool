import Redis from "ioredis";

// Thin cache-aside layer used to keep the app fast with many people hitting
// it at once. Prefers Redis when REDIS_URL is set (shared across every
// server instance, needed once you're running more than one). Without it,
// every function below now falls back to a small in-process Map instead of
// doing nothing — a single server instance still only pays for the
// expensive queries (Doers, Tasks, Settings, the Master
// "generate-upcoming" scan) once per TTL, no matter how many of the
// hundreds of people using the app hit it in the same window. A Redis
// that's down or unreachable falls back the same way, so a caching problem
// can never turn into an outage.
//
// Set REDIS_URL to upgrade to the shared version (see .env.example) — e.g.
// a free Redis on Upstash/Render both work fine for this. Nothing else in
// the app needs to change either way.

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

// ---------------------------------------------------------------------
// In-process fallback store — used whenever Redis isn't configured (or
// errors out). Same TTL semantics as Redis (EX seconds), just local to
// this one server process instead of shared. The app only ever caches a
// handful of distinct keys (doers:all, tasks:all, settings:*, the
// generate-upcoming cooldown), so this never grows large enough to need
// its own eviction beyond "expired entries get skipped on read".
// ---------------------------------------------------------------------
const memoryStore = new Map(); // key -> { value, expiresAt }

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return undefined;
  }
  return entry.value;
}
function memorySet(key, value, ttlSeconds) {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
function memoryDel(pattern) {
  if (!pattern.includes("*")) {
    memoryStore.delete(pattern);
    return;
  }
  const prefix = pattern.slice(0, pattern.indexOf("*"));
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) memoryStore.delete(key);
  }
}

export async function cacheGet(key) {
  const c = getClient();
  if (!c) return memoryGet(key) ?? null;
  try {
    const v = await c.get(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  const c = getClient();
  if (!c) return memorySet(key, value, ttlSeconds);
  try {
    await c.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // caching is best-effort — a write failure here should never break the request
  }
}

// Deletes one exact key, or every key matching a "prefix:*" pattern.
export async function cacheDel(pattern) {
  const c = getClient();
  if (!c) return memoryDel(pattern);
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

// Simple cooldown: returns true the first time a given key is claimed
// within `ttlSeconds`, false on every call after that until the TTL
// expires. Shared across every server instance via Redis when configured;
// falls back to the in-process store otherwise (see memoryStore above) —
// either way, hundreds of people loading Master at the same moment only
// trigger one real "generate upcoming" scan per cooldown window instead of
// one each.
export async function claimCooldown(key, ttlSeconds) {
  const c = getClient();
  if (!c) {
    if (memoryGet(key) !== undefined) return false;
    memorySet(key, "1", ttlSeconds);
    return true;
  }
  try {
    const res = await c.set(key, "1", "NX", "EX", ttlSeconds);
    return res === "OK";
  } catch {
    return true;
  }
}