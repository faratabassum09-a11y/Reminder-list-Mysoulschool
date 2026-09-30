import mongoose from "mongoose";

// The fixed task list for one workshop type (the "UTW Task List", "ICP Task
// List", ... sheets). Approving a workshop copies these into WorkshopTask.
const templateTaskSchema = new mongoose.Schema({
  taskId: { type: String, default: "", trim: true, uppercase: true }, // UTW-TS-4
  description: { type: String, default: "", trim: true },
  task: { type: String, required: true, trim: true },
  timeline: { type: String, default: "T", trim: true }, // T-7, T, T+2 ...
  time: { type: String, default: "", trim: true }, // "HH:mm"
  doer: { type: mongoose.Schema.Types.ObjectId, ref: "Doer" },
  ownerName: { type: String, default: "", trim: true }, // used when no Doer matches
  score: { type: Number, default: 0 },
});

const templateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true }, // UTW
    name: { type: String, required: true }, // UTW Workshop
    defaultDays: { type: Number, default: 1 },
    defaultTime: { type: String, default: "10:00" },
    tasks: { type: [templateTaskSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("WorkshopTemplate", templateSchema);
