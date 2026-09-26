import mongoose from "mongoose";

// This is the "Task List" sheet: the catalog of recurring task definitions
const taskSchema = new mongoose.Schema(
  {
    taskId: { type: Number, required: true, unique: true },
    taskName: { type: String, required: true },
    department: { type: String, required: true },
    frequency: {
      type: String,
      // Matches the original Google Sheet's frequency codes exactly:
      // D=Daily, W=Weekly, M=Monthly, Q=Quarterly, Y=Yearly, F=Fortnightly,
      // E1st/E2nd/E3rd/E4th/ELast = "the Nth (or last) occurrence of the
      // task's weekday each month" (e.g. first Monday of the month).
      enum: ["D", "W", "M", "Q", "Y", "F", "E1st", "E2nd", "E3rd", "E4th", "ELast"],
      required: true,
    },
    // The date the recurring schedule begins. Combined with `frequency` and
    // `defaultAssignee`, this drives automatic generation of Master
    // (TaskInstance) rows — see utils/generateOccurrences.js. Optional: a
    // task with no startDate just stays a catalog entry, added to Master
    // manually as before.
    startDate: { type: Date },
    // Internal bookkeeping for the recurrence engine — the next
    // (pre-working-day-shift) anchor date to resume generating from. Reset
    // to null whenever startDate changes, so a new schedule starts clean.
    nextAnchor: { type: Date },
    // Advisory lock so two concurrent generation calls for this task can't
    // race each other and double-insert the same Master rows.
    generating: { type: Boolean, default: false },
    defaultAssignee: { type: mongoose.Schema.Types.ObjectId, ref: "Doer" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);
