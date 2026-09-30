import mongoose from "mongoose";

// One row per workshop request — the "New Workshop Response" + "Plan" sheets
// merged into one record with a status:
//   pending  -> submitted, waiting for an admin (Nitin sir) to review
//   approved -> approved; its fixed task list has been generated
//   rejected -> declined (kept for the record, no tasks)
const workshopSchema = new mongoose.Schema(
  {
    workshopId: { type: String, required: true, unique: true }, // e.g. UTW-13
    type: { type: String, required: true, uppercase: true, trim: true }, // UTW / ICP / R12 / THW
    typeName: { type: String, required: true }, // "UTW Workshop"
    // Form fields: Workshop ID (workshopId), Goal, Days, Name, Start Date/Time/Day.
    name: { type: String, default: "", trim: true }, // "Workshop Name" as typed on the form
    goal: { type: String, default: "", trim: true }, // "Workshop Goal"
    days: { type: Number, required: true, min: 1, max: 30 },
    // Calendar date stored as UTC-midnight of that date, so it never shifts
    // with the server's timezone.
    startDate: { type: Date, required: true },
    startTime: { type: String, required: true }, // "19:00"
    startDay: { type: String, required: true }, // "Monday"

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    requestedByName: { type: String, default: "" },
    requestedByEmail: { type: String, default: "" },
    // When the New Workshop form was submitted (the "Timestamp" of the form response).
    submittedAt: { type: Date, default: Date.now },
    reviewedByName: { type: String, default: "" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: "" },

    tasksGenerated: { type: Number, default: 0 },

    // Hand-off to the Launch Verification app (Apps Script webhook).
    launchSync: {
      status: { type: String, enum: ["not_sent", "sent", "failed", "skipped", "internal"], default: "not_sent" },
      at: { type: Date },
      error: { type: String, default: "" },
    },
    // Built-in Launch Verification: an admin ticks a launch as checked.
    launchVerified: {
      at: { type: Date, default: null },
      byName: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

workshopSchema.index({ startDate: 1 });

export default mongoose.model("Workshop", workshopSchema);
