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

// The equivalent of the original script's sendReminder(): for every active
// doer, find their tasks planned for tomorrow that don't have an Actual
// time yet, and — if there are any — send one email listing them all.
export async function sendDailyReminders() {
  const tomorrow = startOfDay(addDays(new Date(), 1));
  const dayAfter = addDays(tomorrow, 1);

  const doers = await Doer.find({ active: { $ne: false } }).lean();
  let emailed = 0;

  for (const doer of doers) {
    const pending = await TaskInstance.find({
      doer: doer._id,
      planned: { $gte: tomorrow, $lt: dayAfter },
      actual: null,
    })
      .populate("task")
      .lean();

    if (pending.length === 0) continue;

    const taskLines = pending.map((p) => `Task : ${p.task?.taskName || "Untitled task"}`).join("\n");
    const body =
      `Hello ${doer.name},\n\nYou have planned tasks pending for tomorrow.\n\n` +
      `${taskLines}\n\nPlease ignore this message if you have already completed the tasks.`;

    const sent = await sendMail({
      to: doer.email,
      subject: "You have a Pending Tasks for tomorrow",
      text: body,
    });
    if (sent) emailed++;
  }

  return { doersChecked: doers.length, emailed };
}
