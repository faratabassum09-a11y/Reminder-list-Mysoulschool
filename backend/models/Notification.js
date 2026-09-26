import mongoose from "mongoose";

// A lightweight admin inbox. There's a single shared "admin" role in this
// app (not per-admin-user notification targeting), so every notification
// is simply for "whoever is signed in as admin" — read state is shared
// across admins the same way the review queue used to be.
const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["task_done"], default: "task_done" },
    taskInstance: { type: mongoose.Schema.Types.ObjectId, ref: "TaskInstance", required: true },
    doer: { type: mongoose.Schema.Types.ObjectId, ref: "Doer" },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    doerName: { type: String, default: "" },
    taskName: { type: String, default: "" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ read: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
