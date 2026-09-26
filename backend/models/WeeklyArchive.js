import mongoose from "mongoose";

// A logged snapshot of the Dashboard's summary numbers at a point in time —
// the equivalent of the original's archive(), which copied that week's
// on-time/delayed counts into an Archive sheet. Unlike the original, this
// never clears/resets the live numbers afterward: Master here is one
// continuous dataset, not a sheet that gets wiped weekly, so "archiving"
// is a non-destructive log entry rather than a reset.
const weeklyArchiveSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    snapshotDate: { type: Date, default: Date.now },
    total: { type: Number, required: true },
    onTime: { type: Number, required: true },
    delayed: { type: Number, required: true },
    pending: { type: Number, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("WeeklyArchive", weeklyArchiveSchema);
