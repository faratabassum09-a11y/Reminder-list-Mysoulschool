import mongoose from "mongoose";

// The "Workshop Tasks" sheet: one row per fixed task of one workshop.
const workshopTaskSchema = new mongoose.Schema(
  {
    workshop: { type: mongoose.Schema.Types.ObjectId, ref: "Workshop", required: true, index: true },
    workshopId: { type: String, required: true, index: true },
    workshopType: { type: String, required: true },
    workshopDate: { type: Date, required: true },
    taskId: { type: String, required: true, unique: true }, // UTW-3-WTS-45
    task: { type: String, required: true },
    templateTaskId: { type: String, default: "" }, // the task-list row it came from, e.g. UTW-TS-4
    description: { type: String, default: "" }, // Description column of the task list
    timeline: { type: String, default: "T" }, // as written in the template, e.g. T-7
    offsetDays: { type: Number, default: 0 },
    time: { type: String, default: "" }, // "HH:mm" the task is due that day

    doer: { type: mongoose.Schema.Types.ObjectId, ref: "Doer" },
    owner: { type: String, default: "" },
    ownerEmail: { type: String, default: "", lowercase: true, trim: true, index: true },
    department: { type: String, default: "" },
    buddyEmail: { type: String, default: "", lowercase: true, trim: true }, // backup person (Owner List)

    score: { type: Number, default: 0 },
    planned: { type: Date, required: true, index: true },

    actual: { type: Date, default: null },
    outcome: { type: String, enum: ["On Time", "Delayed", null], default: null },
    ownerScore: { type: Number, default: null }, // task score if done on time, else 0
    workshopScore: { type: Number, default: null }, // task score counted for the workshop once done
    completedByName: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

workshopTaskSchema.index({ planned: 1, _id: 1 });
workshopTaskSchema.index({ ownerEmail: 1, actual: 1, planned: 1 });
workshopTaskSchema.index({ workshopType: 1, planned: 1 });

export default mongoose.model("WorkshopTask", workshopTaskSchema);
