// Adds the tasks in data/task-list-2026-10.json to the Task List, starting on
// the given date (default 2 Oct 2026), and creates their Master rows up to the
// Schedule Horizon set in Settings.
//   npm run import:tasks -- --dry-run     (preview only)
//   npm run import:tasks                  (do it)
//   npm run import:tasks -- --reset       (delete the earlier import's leftovers, then re-add cleanly)
//   npm run import:tasks -- --start=2026-10-02
import mongoose from "mongoose";
import dotenv from "dotenv";
import { importTaskList } from "./utils/importTaskList.js";

dotenv.config();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepWeekdays = args.includes("--keep-weekdays"); // repeated tasks keep their own weekday/day of month
const reset = args.includes("--reset"); // delete what an earlier import left, then re-add cleanly
const startArg = args.find((a) => a.startsWith("--start="));

await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list");
const summary = await importTaskList({ startDate: startArg ? startArg.slice(8) : "2026-10-02", dryRun, reset, keepWeekdays });
console.log(summary);
if (summary.horizonMissing) console.log("Schedule Horizon isn't set yet (Settings page) — set it, then open Master; the rows are created automatically.");
await mongoose.disconnect();
