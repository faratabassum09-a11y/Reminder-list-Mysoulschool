// Loads ALL FOUR "Reminder List" sheets — Doer List, Task List,
// Consolidated, and Master — into MongoDB.
//
//   - data/doers.json       -> Doer List tab       (22 doers, each with a
//                              full list of buddy emails, not just one)
//   - data/tasks.json       -> unique recurring task definitions, deduped by
//                              (taskName, department, frequency) across the
//                              Task List and Master tabs (491 tasks)
//   - data/instances.json   -> Master tab occurrences, plus any Task List
//                              rows not already present in Master (58,777
//                              instances total, each with its real
//                              Planned/Actual timestamps where an Actual was
//                              recorded)
//   - data/submissions.json -> Consolidated tab, the raw, unprocessed
//                              form-submission log (52,981 rows, kept as-is
//                              including rows with a blank name/task where
//                              the sheet's own lookup didn't resolve)
//
// Source data lives in backend/data/*.json — regenerate those from a fresh
// sheet export any time and re-run this script.
//
// Usage:
//   cd backend
//   npm run seed:real

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Doer from "./models/Doer.js";
import Task from "./models/Task.js";
import TaskInstance from "./models/TaskInstance.js";
import SubmissionLog from "./models/SubmissionLog.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

function loadJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf-8"));
}

async function seedReal() {
  const doersData = loadJSON("doers.json");
  const tasksData = loadJSON("tasks.json");
  const instancesData = loadJSON("instances.json");
  const submissionsData = loadJSON("submissions.json");

  await mongoose.connect(MONGO_URI);
  console.log("Connected. Clearing old data...");

  await Promise.all([
    Doer.deleteMany({}),
    Task.deleteMany({}),
    TaskInstance.deleteMany({}),
    SubmissionLog.deleteMany({}),
  ]);

  // 1. Doers
  const createdDoers = await Doer.insertMany(
    doersData.map((d) => ({
      name: d.name,
      email: d.email,
      department: d.department,
      buddyEmails: d.buddyEmails || [],
    }))
  );
  const doerByName = new Map(createdDoers.map((d) => [d.name, d]));
  console.log(`Inserted ${createdDoers.length} doers.`);

  // 2. Tasks (catalog) — defaultAssignee is whoever most commonly did that
  // task in the source data. A task with a startDate gets an active
  // recurring schedule (see utils/generateOccurrences.js) — for every task
  // that already has real historic Master rows (from step 3), nextAnchor is
  // seeded to just after its last real occurrence, so live generation
  // picks up where the real history ends instead of regenerating/
  // duplicating everything from startDate forward.
  const createdTasks = await Task.insertMany(
    tasksData.map((t) => ({
      taskId: t.taskId,
      taskName: t.taskName,
      department: t.department,
      frequency: t.frequency,
      defaultAssignee: doerByName.get(t.defaultAssigneeName)?._id,
      startDate: t.startDate ? new Date(t.startDate) : undefined,
      nextAnchor: t.nextAnchor ? new Date(t.nextAnchor) : undefined,
    }))
  );
  const taskById = new Map(createdTasks.map((t) => [t.taskId, t]));
  console.log(`Inserted ${createdTasks.length} tasks.`);
  const scheduledTasks = createdTasks.filter((t) => t.startDate);
  console.log(
    `  -> ${scheduledTasks.length} of them have an active startDate (auto-generating): ` +
      (scheduledTasks.length
        ? scheduledTasks.map((t) => `#${t.taskId} "${t.taskName}"`).join(", ")
        : "(none)")
  );

  // 3. Task instances (real Master-sheet rows, each with a genuine
  // Planned vs. Actual completion time where one was recorded).
  const now = new Date();
  const instanceDocs = instancesData
    .map((i) => {
      const doer = doerByName.get(i.doerName);
      const task = taskById.get(i.taskId);
      if (!doer || !task) return null;
      const planned = new Date(i.planned);
      const actual = i.actual ? new Date(i.actual) : null;
      // insertMany skips the schema's pre-save hook, so compute status here
      // using the exact same rule: actual <= planned => On Time, else
      // Delayed; with no actual yet, Delayed if planned has passed else
      // Pending.
      const status = actual
        ? actual <= planned
          ? "On Time"
          : "Delayed"
        : now > planned
        ? "Delayed"
        : "Pending";
      return {
        doer: doer._id,
        task: task._id,
        planned,
        actual,
        status,
      };
    })
    .filter(Boolean);

  // insertMany batches automatically for large arrays (~58k+ docs here).
  await TaskInstance.insertMany(instanceDocs);
  console.log(`Inserted ${instanceDocs.length} task instances.`);

  // 4. Submission log (raw Consolidated sheet — every form submission,
  // including rows where the name/task lookup didn't resolve).
  const submissionDocs = submissionsData.map((s) => ({
    taskId: s.taskId,
    timestamp: new Date(s.timestamp),
    name: s.name || "",
    task: s.task || "",
  }));
  await SubmissionLog.insertMany(submissionDocs);
  console.log(`Inserted ${submissionDocs.length} submission log rows.`);

  console.log("Real-data seed complete.");
  process.exit(0);
}

seedReal().catch((err) => {
  console.error(err);
  process.exit(1);
});
