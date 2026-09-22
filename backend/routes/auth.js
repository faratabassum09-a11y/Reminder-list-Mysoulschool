import express from "express";
import User from "../models/User.js";
import { hashPassword, comparePassword, signToken } from "../utils/auth.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Public — no requireAuth. Checks email + password, returns a token good
// for 30 days. There's no self-registration here on purpose: accounts are
// created by an admin (Users page), not signed up for.
router.post("/login", async (req, res) => {
  try {
    const email = (req.body?.email || "").toLowerCase().trim();
    const password = req.body?.password || "";
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email });
    if (!user || user.active === false) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, slackId: user.slackId, createdAt: user.createdAt },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restores a session on page reload — the frontend calls this once on
// load if it has a stored token, to confirm it's still valid and fetch
// the current user's name/role.
router.get("/me", requireAuth, (req, res) => {
  const { _id, name, email, role, slackId, createdAt } = req.user;
  res.json({ user: { id: _id, name, email, role, slackId, createdAt } });
});

// Self-service profile edit — name and Slack ID only (not email, role, or
// active status; those stay admin-only via the Users page).
router.put("/me", requireAuth, async (req, res) => {
  try {
    const { name, slackId } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Name can't be empty" });
      updates.name = name.trim();
    }
    if (slackId !== undefined) updates.slackId = slackId.trim();
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select("-passwordHash");
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role, slackId: user.slackId } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Self-service password change — available to every signed-in user for
// their own account, admin or not.
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    const user = await User.findById(req.user._id);
    const ok = await comparePassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
