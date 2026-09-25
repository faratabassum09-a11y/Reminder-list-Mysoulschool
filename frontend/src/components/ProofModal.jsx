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

// mode "submit": doer sends "my task is done" + proof.
// mode "review": admin looks at the proof, then Mark Complete or Reject.
export default function ProofModal({ mode, row, onClose, onChanged }) {
  const toast = useToast();
  const [form, setForm] = useState({ note: "", link: "", image: "" });
  const [proof, setProof] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode === "review") api.getProof(row._id).then(setProof).catch((e) => setError(e.message));
  }, [mode, row._id]);

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
            <h3>{mode === "submit" ? "Mark task as done" : "Check submission"}</h3>
            <p className="modal-sub">{row.task?.taskName} · {row.doer?.name}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {mode === "submit" ? (
          <form onSubmit={(e) => { e.preventDefault(); run(() => api.submitDone(row._id, form), "Marked as done — the admin will check it"); }}>
            {row.submission?.state === "rejected" && (
              <p className="modal-alert">Sent back by admin{row.submission.rejectReason ? `: ${row.submission.rejectReason}` : "."} Fix it and mark it as done again.</p>
            )}
            <label className="modal-field">Message (optional)
              <textarea rows={3} maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything the admin should know…" />
            </label>
            <label className="modal-field">Proof link (optional)
              <input type="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://…" />
            </label>
            <label className="modal-field">Proof screenshot (optional)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} />
            </label>
            {form.image && <img className="proof-img" src={form.image} alt="Proof preview" />}
            <p className="form-hint">Everything here is optional, but proof makes approval faster. The task stays pending until an admin approves it.</p>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={busy}>{busy ? "Sending…" : "✔ Mark as done"}</button>
            </div>
          </form>
        ) : (
          <div>
            {!proof && !error && <p className="form-hint">Loading proof…</p>}
            {proof && (
              <>
                <div className="check-banner"><strong>{proof.by || row.doer?.name}</strong> marked this as done{proof.at ? ` on ${new Date(proof.at).toLocaleString()}` : ""}. It's your turn to check.</div>
                {proof.note && <div className="proof-note">{proof.note}</div>}
                {proof.link && <p><a href={proof.link} target="_blank" rel="noreferrer noopener">{proof.link}</a></p>}
                {proof.image && <a href={proof.image} target="_blank" rel="noreferrer"><img className="proof-img" src={proof.image} alt="Proof screenshot" /></a>}
                {!proof.note && !proof.link && !proof.image && <p className="form-hint">No message or proof was attached — they only marked it as done.</p>}
              </>
            )}
            <label className="modal-field">Reason (only needed if you reject)
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. screenshot is unclear" />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost danger" disabled={busy} onClick={() => run(() => api.rejectMaster(row._id, reason), "Rejected — sent back to the doer")}>✖ Reject</button>
              <button type="button" disabled={busy} onClick={() => run(() => api.completeMaster(row._id), "Approved — task marked complete")}>✔ Approve</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
