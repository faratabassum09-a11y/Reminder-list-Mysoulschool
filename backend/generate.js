import mongoose from "mongoose";
import dotenv from "dotenv";
import { topUpAllTasks } from "./jobs/recurringJob.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected. Generating upcoming Master rows for all active tasks...");
  const { totalCreated, tasksTouched } = await topUpAllTasks();
  console.log(`Done — created ${totalCreated} row(s) across ${tasksTouched} task(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});