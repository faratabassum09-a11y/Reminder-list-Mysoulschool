import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";

// Shrinks a picked screenshot to <=1280px JPEG so the proof stays small.
function resizeImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = URL.createObjectURL(file);
  });
}

// Doer marks their own task done — completes it immediately (no admin
// approval step, see backend/routes/master.js submit-done). Proof
// (note/link/screenshot) is optional and kept for the record only.
export default function ProofModal({ row, onClose, onChanged }) {
  const toast = useToast();
  const [form, setForm] = useState({ note: "", link: "", image: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const image = await resizeImage(f); setForm((v) => ({ ...v, image })); }
    catch (err) { setError(err.message); }
  };

  const run = async (fn, okMsg) => {
    setBusy(true); setError("");
    try { await fn(); toast(okMsg, "good"); onChanged(); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>Mark task as done</h3>
            <p className="modal-sub">{row.task?.taskName} · {row.doer?.name}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); run(() => api.submitDone(row._id, form), "Marked as done"); }}>
          <label className="modal-field">Message (optional)
            <textarea rows={3} maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything worth noting…" />
          </label>
          <label className="modal-field">Proof link (optional)
            <input type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" />
          </label>
          <label className="modal-field">Proof screenshot (optional)
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} />
          </label>
          {form.image && <img className="proof-img" src={form.image} alt="Proof preview" />}
          <p className="form-hint">Everything here is optional. Marking as done completes the task right away and notifies the admin — no approval needed.</p>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy}>{busy ? "Sending…" : "✔ Mark as done"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}