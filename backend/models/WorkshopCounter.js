import mongoose from "mongoose";

// Simple atomic counters. Keys look like "ws:UTW" (last used Workshop ID
// number for that prefix) and "wts" (last used number in the global
// "<WorkshopID>-WTS-<n>" task id sequence — the same global counter the
// original Apps Script kept).
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

const WorkshopCounter = mongoose.model("WorkshopCounter", counterSchema);
export default WorkshopCounter;

// Reserves `n` consecutive numbers and returns the FIRST of them.
export async function reserveSeq(key, n = 1) {
  const doc = await WorkshopCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: n } },
    { new: true, upsert: true }
  );
  return doc.seq - n + 1;
}
