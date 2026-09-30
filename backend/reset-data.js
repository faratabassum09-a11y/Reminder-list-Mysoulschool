// Wipes the Reminder List data so you can start adding everything fresh.
//
//   npm run reset            -> shows what WOULD be deleted (dry run, deletes nothing)
//   npm run reset -- --yes   -> actually deletes it
//
// Cleared:  Doers, Tasks (Task List), Master rows, Submission Log,
//           Notifications, Chat messages, Weekly archive
// KEPT:     Login accounts (Users), Settings (horizon, Skip Sundays, email),
//           Holidays, and all Workshop data
//
// Add --all to ALSO clear Holidays and Workshop data.
// Add --settings (with --all) to reset Settings to defaults too.
// Logins are never touched — you won't be locked out.
import mongoose from "mongoose";
import dotenv from "dotenv";
import Doer from "./models/Doer.js";
import Task from "./models/Task.js";
import TaskInstance from "./models/TaskInstance.js";
import SubmissionLog from "./models/SubmissionLog.js";
import Notification from "./models/Notification.js";
import Message from "./models/Message.js";
import WeeklyArchive from "./models/WeeklyArchive.js";
import Holiday from "./models/Holiday.js";
import Workshop from "./models/Workshop.js";
import WorkshopTask from "./models/WorkshopTask.js";
import WorkshopTemplate from "./models/WorkshopTemplate.js";
import WorkshopCounter from "./models/WorkshopCounter.js";
import Settings from "./models/Settings.js";
import { cacheDel } from "./utils/cache.js";

dotenv.config();
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";
const args = new Set(process.argv.slice(2));
const confirm = args.has("--yes");
const all = args.has("--all");

const targets = [
  ["Master rows", TaskInstance],
  ["Tasks (Task List)", Task],
  ["Doers", Doer],
  ["Submission Log", SubmissionLog],
  ["Notifications", Notification],
  ["Chat messages", Message],
  ["Weekly archive", WeeklyArchive],
];
if (all) {
  targets.push(
    ["Holidays", Holiday],
    ["Workshops", Workshop],
    ["Workshop tasks", WorkshopTask],
    ["Workshop templates", WorkshopTemplate],
    ["Workshop counters", WorkshopCounter]
  );
  if (args.has("--settings")) targets.push(["Settings", Settings]);
}

await mongoose.connect(MONGO_URI);
console.log(`Connected to ${MONGO_URI}\n`);

for (const [label, Model] of targets) {
  const n = await Model.countDocuments();
  if (confirm) {
    await Model.deleteMany({});
    console.log(`  deleted ${String(n).padStart(6)}  ${label}`);
  } else {
    console.log(`  would delete ${String(n).padStart(6)}  ${label}`);
  }
}

if (confirm) {
  await cacheDel("*"); // clear Redis/in-memory caches so old rows don't linger
  console.log("\nDone. Restart the backend, hard-refresh the browser, then add your doers and tasks fresh.");
} else {
  console.log("\nDry run only — nothing was deleted. Run again with --yes to delete.");
}
await mongoose.disconnect();
process.exit(0);
