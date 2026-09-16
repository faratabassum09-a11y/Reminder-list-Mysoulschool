import express from "express";
import Doer from "../models/Doer.js";

const router = express.Router();

// GET all doers (Doer List sheet)
router.get("/", async (req, res) => {
  const doers = await Doer.find().sort({ department: 1, name: 1 }).lean();
  res.json(doers);
});

// CREATE doer
router.post("/", async (req, res) => {
  try {
    const doer = await Doer.create(req.body);
    res.status(201).json(doer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE doer
router.put("/:id", async (req, res) => {
  try {
    const doer = await Doer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    res.json(doer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE (permanent) doer
router.delete("/:id", async (req, res) => {
  const deleted = await Doer.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Doer not found" });
  res.json({ ok: true });
});

export default router;
