import mongoose from "mongoose";

// One collection covers both features:
// - Private DM: sender + recipient set, conversationKey = the two user
//   ids sorted and joined ("<lower>_<higher>") so both people land on the
//   same thread regardless of who sent the first message.
// - Broadcast (Doer List announcement): recipient is null, isBroadcast is
//   true, conversationKey is the constant "broadcast" so every announcement
//   lives in one shared timeline everyone reads from.
//
// readBy is how unread counts work for both: for a DM, only the recipient
// ever needs to appear in it; for a broadcast, it fills up with everyone
// who's opened the announcements panel.
const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    conversationKey: { type: String, required: true },
    isBroadcast: { type: Boolean, default: false },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Per-user "clear chat" / delete-for-me — a user id in here means this
    // message is hidden from that person's view only; everyone else (and
    // the raw document) is untouched.
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Sender-initiated "delete for everyone" — text is wiped and every
    // client renders a placeholder instead, same as WhatsApp/Slack.
    deletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Loading one thread (sorted by time) and computing unread badges are the
// two hot paths — both are covered by one of these.
messageSchema.index({ conversationKey: 1, createdAt: 1 });
messageSchema.index({ recipient: 1, readBy: 1 });
messageSchema.index({ isBroadcast: 1, readBy: 1 });

// Deterministic key for a two-person thread — same value no matter which
// of the two people sent the message, so `Message.find({ conversationKey })`
// always returns the full back-and-forth.
export function dmKey(idA, idB) {
  return [String(idA), String(idB)].sort().join("_");
}

export default mongoose.model("Message", messageSchema);
