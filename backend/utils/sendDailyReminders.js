import Doer from "../models/Doer.js";
import TaskInstance from "../models/TaskInstance.js";
import { sendMail } from "./mailer.js";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Run `worker` over `items` with at most `limit` in flight at once.
async function runPool(items, worker, limit) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

// The equivalent of the original script's sendReminder(): for every active
// doer, find their tasks planned for tomorrow that don't have an Actual
// time yet, and — if there are any — send one email listing them all.
//
// One query for all doers (was one query per doer), and emails go out a few
// at a time instead of strictly one after another. One failed email no
// longer aborts the whole run — it's counted in `failed` and logged.
export async function sendDailyReminders() {
  const tomorrow = startOfDay(addDays(new Date(), 1));
  const dayAfter = addDays(tomorrow, 1);

  const doers = await Doer.find({ active: { $ne: false } }).select("name email").lean();
  if (doers.length === 0) return { doersChecked: 0, emailed: 0, failed: 0 };

  const pending = await TaskInstance.find({
    doer: { $in: doers.map((d) => d._id) },
    planned: { $gte: tomorrow, $lt: dayAfter },
    actual: null,
  })
    .select("doer task")
    .populate({ path: "task", select: "taskName" })
    .lean();

  const byDoer = new Map();
  for (const p of pending) {
    const key = String(p.doer);
    if (!byDoer.has(key)) byDoer.set(key, []);
    byDoer.get(key).push(p);
  }

  const jobs = doers.filter((d) => byDoer.has(String(d._id)));
  let emailed = 0;
  let failed = 0;

  await runPool(
    jobs,
    async (doer) => {
      const taskLines = byDoer
        .get(String(doer._id))
        .map((p) => `Task : ${p.task?.taskName || "Untitled task"}`)
        .join("\n");
      const body =
        `Hello ${doer.name},\n\nYou have planned tasks pending for tomorrow.\n\n` +
        `${taskLines}\n\nPlease ignore this message if you have already completed the tasks.`;
      try {
        const sent = await sendMail({
          to: doer.email,
          subject: "You have a Pending Tasks for tomorrow",
          text: body,
        });
        if (sent) emailed++;
      } catch (err) {
        failed++;
        console.error(`[reminders] Failed to email ${doer.email}: ${err.message}`);
      }
    },
    4
  );

  return { doersChecked: doers.length, emailed, failed };
}
