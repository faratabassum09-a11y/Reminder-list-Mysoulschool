import mongoose from "mongoose";

const doerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    department: { type: String, required: true },
    // Multiple buddies supported (the sheet has "Buddy", "Buddy 2", etc.)
    buddyEmails: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Backward-compatible virtual: first buddy email, same shape as the old
// single `buddyEmail` field. Included in toJSON output so existing frontend
// code reading `doer.buddyEmail` keeps working.
doerSchema.virtual("buddyEmail").get(function () {
  return this.buddyEmails && this.buddyEmails.length ? this.buddyEmails[0] : undefined;
});
doerSchema.set("toJSON", { virtuals: true });

export default mongoose.model("Doer", doerSchema);
