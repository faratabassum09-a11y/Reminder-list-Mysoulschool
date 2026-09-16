// Seeds a small realistic dataset shaped like the actual "Reminder List" sheet
// (Name, Email, Department, Task ID, Freq, Task, Planned, Actual, Status, Buddy Email)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Doer from "./models/Doer.js";
import Task from "./models/Task.js";
import TaskInstance from "./models/TaskInstance.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected. Clearing old data...");

  await Promise.all([
    Doer.deleteMany({}),
    Task.deleteMany({}),
    TaskInstance.deleteMany({}),
  ]);

  const doer = await Doer.create({
    name: "Aravind",
    email: "aravind@mysoulschool.in",
    department: "Operations",
    buddyEmails: ["ruchimysoulschool@gmail.com"],
  });

  const task = await Task.create({
    taskId: 1,
    taskName: "UTW - Update & Create Groups, Meetings & Links for Next Launch",
    department: "Operations",
    frequency: "W",
    defaultAssignee: doer._id,
  });

  const task2 = await Task.create({
    taskId: 841,
    taskName: "UTW - Check Flow of Lead + Submit Daily End Report",
    department: "Operations",
    frequency: "D",
    defaultAssignee: doer._id,
  });

  await TaskInstance.create([
    {
      doer: doer._id,
      task: task._id,
      planned: new Date("2024-12-14T22:00:00"),
      actual: new Date("2025-01-08T22:35:46"),
    },
    {
      doer: doer._id,
      task: task2._id,
      planned: new Date("2024-12-14T22:00:00"),
      actual: new Date("2025-01-08T22:37:10"),
    },
    {
      doer: doer._id,
      task: task2._id,
      planned: new Date("2099-01-01T22:00:00"), // future -> Pending
      actual: null,
    },
  ]);

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
