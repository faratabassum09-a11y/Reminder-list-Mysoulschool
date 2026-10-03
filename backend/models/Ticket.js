import mongoose from "mongoose";

// Help Ticket — one doer raising a problem to another doer (mirrors the
// "Help Ticket" Google Form: Raised By, PC Accountable, Issue, Problem
// Assigned To, Planned Date/Time Of Resolution).
//
// Visibility (enforced in routes/tickets.js, not just hidden in the UI):
//   - the doer it's assigned to sees it in their Inbox
//   - the doer who raised it sees it under "Raised by me"
//   - admins see everything on the "Tickets Raised" page
// Nobody else can list or open it.
//
// Names are denormalized so a ticket still reads correctly if a doer is
// later renamed or deleted.
const ticketSchema = new mongoose.Schema(
  {
    ticketNo: { type: Number, required: true, unique: true },

    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doer", required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Doer", required: true },
    pcAccountable: { type: mongoose.Schema.Types.ObjectId, ref: "Doer", default: null },

    raisedByName: { type: String, default: "" },
    assignedToName: { type: String, default: "" },
    pcAccountableName: { type: String, default: "" },

    // The signed-in account that actually submitted it (an admin can raise
    // on behalf of a doer).
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    issue: { type: String, required: true, trim: true, maxlength: 4000 },
    plannedResolution: { type: Date, default: null },

    status: { type: String, enum: ["Open", "In Progress", "Resolved"], default: "Open" },
    resolutionNote: { type: String, trim: true, maxlength: 2000, default: "" },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
ticketSchema.index({ raisedBy: 1, createdAt: -1 });
ticketSchema.index({ createdAt: -1 });

export default mongoose.model("Ticket", ticketSchema);
