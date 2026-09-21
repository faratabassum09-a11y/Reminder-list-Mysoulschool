import cron from "node-cron";
import Task from "../models/Task.js";
import { generateInstancesForTask, defaultHorizon } from "../utils/recurrence.js";

export async function topUpAllTasks() {
  const horizon = defaultHorizon();
  const tasks = await Task.find({
    active: { $ne: false },
    defaultAssignee: { $ne: null },
  });

  let totalCreated = 0;
  let tasksTouched = 0;
  for (const task of tasks) {
    const { created } = await generateInstancesForTask(task, horizon);
    if (created > 0) {
      totalCreated += created;
      tasksTouched += 1;
    }
  }

  if (totalCreated > 0) {
    console.log(
      `[recurring] generated ${totalCreated} new Master row(s) across ${tasksTouched} task(s), horizon ${horizon.toDateString()}.`
    );
  }
  return { totalCreated, tasksTouched };
}

export function startRecurringScheduler() {
  topUpAllTasks().catch((err) => console.error("[recurring] startup top-up failed:", err));

  cron.schedule(
    "30 0 * * *",
    () => {
      topUpAllTasks().catch((err) => console.error("[recurring] scheduled top-up failed:", err));
    },
    { timezone: "Asia/Kolkata" }
  );
}