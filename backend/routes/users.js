import express from "express";
import User from "../models/User.js";
import { hashPassword } from "../utils/auth.js";

const router = express.Router();
// Every route here is mounted behind requireAuth + requireAdmin in
// server.js — nothing in this file is reachable by a non-admin.

router.get("/", async (req, res) => {
  const users = await User.find().select("-passwordHash").sort({ name: 1 }).lean();
  res.json(users);
});

router.post("/", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role === "admin" ? "admin" : "member",
    });
    const { passwordHash: _, ...safe } = user.toObject();
    res.status(201).json(safe);
  } catch (err) {
    res.status(400).json({ error: err.code === 11000 ? "That email is already registered" : err.message });
  }
});

// Update role/active/name — and optionally reset the password (admin
// recovery for a teammate who's locked out), via an optional `password`
// field.
router.put("/:id", async (req, res) => {
  try {
    const { name, role, active, password } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role === "admin" ? "admin" : "member";
    if (active !== undefined) updates.active = active;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      updates.passwordHash = await hashPassword(password);
    }

    // Guard: don't let the last active admin demote/deactivate themselves
    // (or be demoted) and lock everyone out of admin-only pages entirely.
    if (updates.role === "member" || updates.active === false) {
      const target = await User.findById(req.params.id);
      if (target?.role === "admin") {
        const otherActiveAdmins = await User.countDocuments({
          _id: { $ne: target._id },
          role: "admin",
          active: { $ne: false },
        });
        if (otherActiveAdmins === 0) {
          return res.status(400).json({ error: "Can't remove the last active admin" });
        }
      }
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (String(target._id) === String(req.user._id)) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  if (target.role === "admin") {
    const otherActiveAdmins = await User.countDocuments({
      _id: { $ne: target._id },
      role: "admin",
      active: { $ne: false },
    });
    if (otherActiveAdmins === 0) return res.status(400).json({ error: "Can't delete the last admin" });
  }
  await User.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
