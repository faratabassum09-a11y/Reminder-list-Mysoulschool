import Redis from "ioredis";

// Two-layer cache used to keep the app fast with many people hitting it.
//
//   L1 — in-process memory (this file). Zero network hops, so a hit costs
//        microseconds. This is what makes the app feel instant: a Redis
//        round-trip to a hosted instance (Upstash/Render) is often SLOWER
//        than the indexed Mongo query it was meant to save, so reads are
//        answered from memory first and Redis is only a shared fallback.
//   L2 — Redis (optional, REDIS_URL). Shared between server instances.
//
// Everything is fail-safe: with no REDIS_URL, or a Redis that's down, the
// app simply runs on L1 + the database — a caching problem can never turn
// into an outage or a slow request.

// ---------------------------------------------------------------- L1 ----

const L1_MAX_ENTRIES = 1500;
const L1_MAX_TTL_MS = 60_000; // cap so a second server instance can't drift for long
const l1 = new Map(); // key -> { v, exp }

function l1Get(key) {
  const hit = l1.get(key);
  if (!hit) return undefined;
  if (hit.exp <= Date.now()) {
    l1.delete(key);
    return undefined;
  }
  return hit.v;
}

function l1Set(key, v, ttlMs) {
  if (l1.size >= L1_MAX_ENTRIES) l1Prune();
  l1.set(key, { v, exp: Date.now() + Math.min(ttlMs, L1_MAX_TTL_MS) });
}

function l1Prune() {
  const now = Date.now();
  for (const [k, e] of l1) if (e.exp <= now) l1.delete(k);
  // still full → drop the oldest quarter
  if (l1.size >= L1_MAX_ENTRIES) {
    let n = Math.ceil(l1.size / 4);
    for (const k of l1.keys()) {
      if (n-- <= 0) break;
      l1.delete(k);
    }
  }
}

function l1DeleteMatching(pattern) {
  if (!pattern.includes("*")) {
    l1.delete(pattern);
    return;
  }
  const prefix = pattern.slice(0, pattern.indexOf("*"));
  for (const k of l1.keys()) if (k.startsWith(prefix)) l1.delete(k);
}

// Data version — bumped whenever the Master collection (or the doers/tasks
// it joins against) changes. Cached list/rollup responses include it in
// their key, so one bump instantly retires every stale entry.
let dataVersion = 0;
export const getDataVersion = () => dataVersion;
export function bumpData() {
  dataVersion++;
}

// Caches the *promise* of an async computation in memory for `ttlMs`.
// Concurrent callers share one in-flight computation (so e.g. the
// Dashboard's summary + per-person calls hit the database once, not
// twice) and a failure is never cached.
export function memo(key, ttlMs, fn) {
  const hit = l1Get(key);
  if (hit !== undefined) return hit;
  const p = Promise.resolve()
    .then(fn)
    .catch((err) => {
      l1.delete(key);
      throw err;
    });
  l1Set(key, p, ttlMs);
  return p;
}

// ---------------------------------------------------------------- L2 ----

let lastErrorLoggedAt = 0;
function logErrorThrottled(err) {
  const now = Date.now();
  if (now - lastErrorLoggedAt < 60_000) return;
  lastErrorLoggedAt = now;
  console.error("[cache] Redis unavailable, continuing without it:", err.message);
}

const REDIS_TIMEOUT_MS = 800;

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
    commandTimeout: REDIS_TIMEOUT_MS,
    // Fail immediately while disconnected instead of queueing commands —
    // a bad/unreachable REDIS_URL must skip the cache, never stall requests.
    enableOfflineQueue: false,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  client.on("error", logErrorThrottled);
  client.on("connect", () => console.log("[cache] Redis connected"));
  return client;
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// ------------------------------------------------------------- public ----

export async function cacheGet(key) {
  const mem = l1Get(key);
  if (mem !== undefined) return mem;

  const c = getClient();
  if (!c) return null;
  try {
    const v = await withTimeout(c.get(key), REDIS_TIMEOUT_MS, null);
    if (!v) return null;
    const parsed = JSON.parse(v);
    l1Set(key, parsed, 30_000); // warm L1 so the next read skips the network
    return parsed;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  l1Set(key, value, ttlSeconds * 1000);
  const c = getClient();
  if (!c) return;
  try {
    await withTimeout(c.set(key, JSON.stringify(value), "EX", ttlSeconds), REDIS_TIMEOUT_MS, null);
  } catch {
    // best-effort
  }
}

// Deletes one exact key, or every key matching a "prefix:*" pattern.
export async function cacheDel(pattern) {
  l1DeleteMatching(pattern);
  // Doers/Tasks feed the in-memory lookup tables used to join Master rows,
  // and every Master list/rollup that embeds them.
  if (/^(doers|tasks):/.test(pattern)) {
    l1DeleteMatching("lookup:*");
    bumpData();
  }

  const c = getClient();
  if (!c) return;
  try {
    if (!pattern.includes("*")) {
      await withTimeout(c.del(pattern), REDIS_TIMEOUT_MS, null);
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
// runs `loader()`, caches the result, and returns it.
export function cached(key, ttlSeconds, loader) {
  return async (req, res) => {
    const hit = await cacheGet(key);
    if (hit !== null) return res.json(hit);
    const data = await loader(req);
    cacheSet(key, data, ttlSeconds); // fire-and-forget
    res.json(data);
  };
}

// Cooldown: returns true the first time a key is claimed within
// `ttlSeconds`, false afterwards until the TTL expires. Tracked in memory
// (so it works with NO Redis at all — previously, without Redis, the
// "generate upcoming" job re-ran in full on every single Master visit) and
// also in Redis when available so multiple instances share the cooldown.
const cooldowns = new Map();
export async function claimCooldown(key, ttlSeconds) {
  const now = Date.now();
  const until = cooldowns.get(key);
  if (until && until > now) return false;
  cooldowns.set(key, now + ttlSeconds * 1000);

  const c = getClient();
  if (!c) return true;
  try {
    const res = await withTimeout(c.set(key, "1", "NX", "EX", ttlSeconds), REDIS_TIMEOUT_MS, "OK");
    return res === "OK";
  } catch {
    return true;
  }
}
