import mongoose from "mongoose";

// Explicit non-working dates within the schedule horizon — the practical
// stand-in for hand-removing rows from "Working Day Calendar". Combined
// with Settings.skipSundays, this is what "is a working day" checks against.
const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, unique: true },
    label: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Holiday", holidaySchema);
