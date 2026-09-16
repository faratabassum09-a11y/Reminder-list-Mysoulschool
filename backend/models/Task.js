import mongoose from "mongoose";

// This is the "Task List" sheet: the catalog of recurring task definitions
const taskSchema = new mongoose.Schema(
  {
    taskId: { type: Number, required: true, unique: true },
    taskName: { type: String, required: true },
    department: { type: String, required: true },
    frequency: {
      type: String,
      // Daily / Weekly / Monthly / Quarterly / Yearly, plus the sheet's
      // "Every Nth of the month" shorthand (E1st = every 1st, E3rd = every 3rd, etc.)
      enum: ["D", "W", "M", "Q", "Y", "E1st", "E2nd", "E3rd", "E4th"],
      required: true,
    },
    defaultAssignee: { type: mongoose.Schema.Types.ObjectId, ref: "Doer" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);
