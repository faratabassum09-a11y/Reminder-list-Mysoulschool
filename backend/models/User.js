import mongoose from "mongoose";

// Two roles:
// - "admin": everything — delete data, manage the Doer/Task catalog,
//   Settings, and other user accounts.
// - "member": can view all data (Dashboard, Master, Doers, Tasks,
//   Consolidated, Submissions — needed for team-wide visibility in a buddy
//   system), and can mark complete / edit only Master task-instance rows
//   assigned to their own Doer record (matched by email). Cannot add/edit
//   Doers or Tasks (that's catalog/setup data), cannot delete anything,
//   and cannot reach Settings or Users.
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
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
