import mongoose from "mongoose";

// Two roles:
// - "admin": everything — delete data, manage the Doer/Task catalog,
//   Settings, and other user accounts.
// - "member": can view Dashboard, Doers, Tasks, Consolidated and
//   Submissions team-wide, but Master (the reminder occurrence list) is
//   scoped to just their own Doer record's rows (matched by email) — a
//   member never sees another member's task instances there. They can
//   mark complete / edit only Master rows assigned to their own Doer
//   record. Cannot add/edit Doers or Tasks (that's catalog/setup data),
//   cannot delete anything, and cannot reach Settings or Users.
// Enforced in the route middleware, not just hidden in the UI — see
// middleware/auth.js and the per-route checks in routes/master.js,
// routes/doers.js, routes/tasks.js.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    active: { type: Boolean, default: true },
    // Optional — lets people @-mention or DM this user from Slack-integrated
    // tooling (e.g. a future "notify on Slack" reminder). Just a plain
    // member ID/handle string, not validated against Slack's API.
    slackId: { type: String, trim: true, default: "" },
    // When this admin last dismissed the "recently completed" banner on
    // Master — only completions after this point count toward their badge
    // going forward, so it doesn't just refill with the same tasks they
    // already looked at.
    lastSeenCompletionsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);