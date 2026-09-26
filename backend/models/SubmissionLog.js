import mongoose from "mongoose";

// This is the "Consolidated" sheet: the raw, unprocessed form-submission log
// (one row per time someone submitted a "task done" form), before it gets
// matched up into the Master sheet's Planned/Actual/Status rows. Many rows
// have a blank Name/Task because the lookup in the source sheet didn't
// resolve — we keep those as-is rather than dropping them, since "ADD ALL
// DATA" means every row, not just the clean ones.
const submissionLogSchema = new mongoose.Schema(
  {
    taskId: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    name: { type: String, default: "" }, // Doer name as typed in the form; may be blank
    task: { type: String, default: "" }, // Task text as typed in the form; may be blank
  },
  { timestamps: false }
);

submissionLogSchema.index({ timestamp: -1 });
submissionLogSchema.index({ name: 1 });

export default mongoose.model("SubmissionLog", submissionLogSchema);
