import mongoose from "mongoose";

// The "Responses" sheet: one row each time someone submits the task-done
// form (Workshop Task ID + when it was actually done). The matching
// WorkshopTask is updated from this, exactly like onFormSubmit did in the
// Apps Script: On Time -> owner gets the task score, otherwise 0.
const workshopResponseSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: "WorkshopTask", required: true, index: true },
    taskId: { type: String, required: true, index: true }, // UTW-3-WTS-45
    workshopId: { type: String, required: true, index: true },
    workshopType: { type: String, default: "" },
    taskName: { type: String, default: "" },
    owner: { type: String, default: "" },
    ownerEmail: { type: String, default: "", lowercase: true },
    planned: { type: Date },
    actual: { type: Date, required: true },
    outcome: { type: String, enum: ["On Time", "Delayed"], required: true },
    score: { type: Number, default: 0 },
    ownerScore: { type: Number, default: 0 },
    submittedByName: { type: String, default: "" },
    submittedByEmail: { type: String, default: "", lowercase: true },
    note: { type: String, default: "" },
  },
  { timestamps: true } // createdAt = the form's "Timestamp" column
);
workshopResponseSchema.index({ createdAt: -1 });

export default mongoose.model("WorkshopResponse", workshopResponseSchema);
