import mongoose from "mongoose";

// This is the "Master" sheet: one row per occurrence of a task for a doer,
// with Planned vs Actual completion time and computed Status.
const taskInstanceSchema = new mongoose.Schema(
  {
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "Doer", required: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    planned: { type: Date, required: true },
    actual: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Pending", "On Time", "Delayed"],
      default: "Pending",
    },
  },
  { timestamps: true }
);

// Auto-compute status whenever "actual" changes
taskInstanceSchema.pre("save", function (next) {
  if (this.actual) {
    this.status = this.actual <= this.planned ? "On Time" : "Delayed";
  } else {
    this.status = new Date() > this.planned ? "Delayed" : "Pending";
  }
  next();
});

// Indexes for the Master log: it's the largest collection (~59k+ rows), and
// every list view sorts by "planned" and often filters by doer/status, so
// without these indexes Mongo falls back to a full collection scan on every
// page load — that's the "slow like Google Sheets" feeling we're fixing.
taskInstanceSchema.index({ planned: -1 });
taskInstanceSchema.index({ doer: 1, planned: -1 });
taskInstanceSchema.index({ status: 1, planned: -1 });

export default mongoose.model("TaskInstance", taskInstanceSchema);
