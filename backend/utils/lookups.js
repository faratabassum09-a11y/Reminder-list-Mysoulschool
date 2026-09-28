import Doer from "../models/Doer.js";
import Task from "../models/Task.js";
import { memo } from "./cache.js";

// Doers (~20 rows) and Tasks (~500 rows) are tiny and change rarely, but
// nearly every request needs them — to scope a member to their own rows,
// or to attach names to Master rows. Instead of asking Mongo to populate()
// them on every request, they're held in memory as Maps. The cache layer
// clears these automatically whenever the doers/tasks caches are
// invalidated (see cacheDel in utils/cache.js), and they expire after 60s
// regardless.

export function getDoerMaps() {
  return memo("lookup:doers", 60_000, async () => {
    const docs = await Doer.find().lean();
    return {
      byId: new Map(docs.map((d) => [String(d._id), d])),
      byEmail: new Map(docs.map((d) => [String(d.email || "").toLowerCase(), d])),
    };
  });
}

export function getTaskMap() {
  return memo("lookup:tasks", 60_000, async () => {
    const docs = await Task.find().lean();
    return new Map(docs.map((t) => [String(t._id), t]));
  });
}
