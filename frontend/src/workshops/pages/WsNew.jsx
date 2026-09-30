import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useToast } from "../../components/Toast.jsx";
import { TypeChip } from "../ui.jsx";
import { dayNameFromYmd, fmtTime12 } from "../../utils/wsFormat.js";

const GOAL_MAX = 500;
const TYPE_BLURB = {
  UTW: "Multi-day flagship workshop",
  ICP: "Single-day workshop",
  R12: "Single-day workshop",
  THW: "Single-day workshop",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "T-7" -> -7, "T" -> 0, "T+2" -> 2
const offsetOf = (tl) => {
  const n = Number.parseInt(String(tl ?? "").replace(/t/i, "").replace("+", "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
};
// ymd + offset days -> "12 Sep" (pure calendar maths, no timezone shift)
function shiftLabel(ymd, offset) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + offset));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function Field({ n, label, hint, children, wide }) {
  return (
    <label className={"wsf-field" + (wide ? " wsf-wide" : "")}>
      <span className="wsf-label"><i>{n}</i>{label}</span>
      {children}
      {hint && <span className="wsf-hint">{hint}</span>}
    </label>
  );
}

export default function WsNew({ onSaved }) {
  const { isAdmin, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [type, setType] = useState("");
  const [workshopId, setWorkshopId] = useState("");
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState(1);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Brand-new workshop type (not one of the existing task lists)
  const [isNew, setIsNew] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newTypeName, setNewTypeName] = useState("");

  useEffect(() => {
    api.wsMeta().then(setMeta).catch((e) => setError(e.message));
    api.wsTemplates().then(setTemplates).catch(() => {});
  }, []);

  const chosen = useMemo(() => meta?.types.find((t) => t.code === type), [meta, type]);
  const tpl = useMemo(() => templates.find((t) => t.code === type), [templates, type]);

  const codeOk = /^[A-Z][A-Z0-9]{1,7}$/.test(newCode);
  const codeTaken = isNew && Boolean(meta?.types.some((t) => t.code === newCode));

  const pickNew = () => {
    setIsNew(true);
    setType("");
    setWorkshopId("");
    setDays(1);
    setStartTime("10:00");
    if (!nameTouched) setName("");
  };
  const onNewCode = (v) => {
    const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    setNewCode(c);
    setType(/^[A-Z][A-Z0-9]{1,7}$/.test(c) && !meta?.types.some((t) => t.code === c) ? c : "");
    setWorkshopId("");
    if (/^[A-Z][A-Z0-9]{1,7}$/.test(c)) {
      api.wsNextId(c).then((r) => setWorkshopId(r.workshopId)).catch(() => setWorkshopId(`${c}-1`));
      if (!nameTouched && !newTypeName) setName(`${c} Workshop`);
    }
  };

  const pick = (t) => {
    setIsNew(false);
    setNewCode("");
    setNewTypeName("");
    setType(t.code);
    setDays(t.defaultDays);
    setStartTime(t.defaultTime);
    if (!nameTouched) setName(t.name);
    setWorkshopId("");
    api.wsNextId(t.code).then((r) => setWorkshopId(r.workshopId)).catch(() => setWorkshopId(`${t.code}-?`));
  };

  const startDay = dayNameFromYmd(startDate);
  const goalLeft = GOAL_MAX - goal.length;
  const ready = type && (!isNew || (codeOk && !codeTaken)) && goal.trim() && name.trim() && startDate && startTime && Number(days) >= 1;

  // Preview of the fixed tasks that will be created on approval.
  const preview = useMemo(
    () => (tpl?.tasks || []).map((t) => ({ ...t, off: offsetOf(t.timeline) })).sort((a, b) => a.off - b.off),
    [tpl]
  );

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!type) return setError(isNew ? "Enter a short code for the new workshop type (e.g. XYZ)" : "Choose a workshop type first");
    setBusy(true);
    try {
      const w = await api.wsCreate({
        type, goal: goal.trim(), name: name.trim(), days: Number(days), startDate, startTime,
        ...(isNew ? { newType: true, typeName: newTypeName.trim() || name.trim() } : {}),
      });
      toast(`${w.workshopId} submitted — waiting for admin approval`, "good");
      onSaved?.();
      navigate("/workshops/responses?tab=new");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="New workshop" subtitle="Fill in the form and submit. An admin approves it, and the fixed task list for that workshop type is created and assigned automatically." />

      <form className="wsf-layout" onSubmit={submit}>
        <div className="wsf-main">
          {/* Step 1 — type */}
          <section className="ws-panel wsf-card">
            <h2 className="ws-step"><span>1</span> Select Workshop</h2>
            {!meta ? (
              <div className="skeleton-bar" style={{ height: 110 }} />
            ) : (
              <div className="wsf-types" role="radiogroup" aria-label="Workshop type">
                {meta.types.map((t) => (
                  <button
                    type="button"
                    key={t.code}
                    role="radio"
                    aria-checked={type === t.code}
                    className={`wsf-type wsf-type-${t.code}` + (type === t.code ? " selected" : "")}
                    onClick={() => pick(t)}
                  >
                    <span className="wsf-type-check" aria-hidden="true">✓</span>
                    <TypeChip code={t.code} />
                    <strong>{t.name}</strong>
                    <span className="muted">{TYPE_BLURB[t.code]}</span>
                    <span className="wsf-type-meta">{t.defaultDays} day{t.defaultDays > 1 ? "s" : ""} · {t.taskCount} task{t.taskCount === 1 ? "" : "s"}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isNew}
                  className={"wsf-type wsf-type-new" + (isNew ? " selected" : "")}
                  onClick={pickNew}
                >
                  <span className="wsf-type-check" aria-hidden="true">✓</span>
                  <span className="wsf-plus" aria-hidden="true">＋</span>
                  <strong>New workshop</strong>
                  <span className="muted">A brand-new type with its own task list</span>
                </button>
              </div>
            )}

            {isNew && (
              <div className="wsf-newtype">
                <Field n="A" label="Type code" hint={codeTaken ? <span className="wsf-warnc">{newCode} already exists — pick it from the cards above</span> : "2–8 letters/numbers, e.g. XYZ. Becomes the ID prefix (XYZ-1, XYZ-2…)"}>
                  <input value={newCode} maxLength={8} placeholder="e.g. XYZ" onChange={(e) => onNewCode(e.target.value)} autoFocus />
                </Field>
                <Field n="B" label="Type name" hint="Shown on the cards, e.g. “XYZ Workshop”">
                  <input value={newTypeName} maxLength={120} placeholder="e.g. XYZ Workshop" onChange={(e) => setNewTypeName(e.target.value)} />
                </Field>
                <p className="wsf-newnote">Its task list starts empty. An admin adds the tasks under <strong>Task Lists</strong>; once the workshop is approved they are created and assigned automatically.</p>
              </div>
            )}
          </section>

          {/* Step 2 — the form (same fields, same order as the old Google Form) */}
          <section className={"ws-panel wsf-card" + (type ? "" : " wsf-locked")}>
            <h2 className="ws-step"><span>2</span> Workshop details</h2>
            {!type && <p className="wsf-lock-note">{isNew ? "Enter a type code above to unlock the form." : "Pick a workshop type above (or “New workshop”) to unlock the form."}</p>}
            <fieldset disabled={!type} className="wsf-fieldset">
              <div className="wsf-grid">
                <Field n="✉" label="Email address" wide hint="Filled from your account — this is who submitted the form">
                  <div className="wsf-idbox">
                    <span className="wsf-lock" aria-hidden="true">🔒</span>
                    <input readOnly tabIndex={-1} value={user?.email || ""} />
                  </div>
                </Field>
                <Field n="1" label="Workshop ID" hint="Assigned automatically — continues the old numbering">
                  <div className="wsf-idbox">
                    <span className="wsf-lock" aria-hidden="true">🔒</span>
                    <input readOnly tabIndex={-1} value={workshopId || (type ? "…" : isNew ? "Enter a code" : "Select a type")} />
                  </div>
                </Field>
                <Field n="4" label="Workshop Name">
                  <input required maxLength={120} value={name} placeholder="e.g. UTW Workshop" onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
                </Field>

                <Field n="2" label="Workshop Goal" wide hint={<span className={goalLeft < 40 ? "wsf-warnc" : ""}>{goalLeft} characters left</span>}>
                  <textarea required rows={3} maxLength={GOAL_MAX} value={goal} placeholder="What should participants walk away with?" onChange={(e) => setGoal(e.target.value)} />
                </Field>

                <Field n="3" label="Workshop Days">
                  <div className="wsf-stepper">
                    <button type="button" aria-label="Fewer days" onClick={() => setDays((d) => Math.max(1, Number(d) - 1))}>−</button>
                    <input type="number" min={1} max={30} required value={days} onChange={(e) => setDays(e.target.value)} />
                    <button type="button" aria-label="More days" onClick={() => setDays((d) => Math.min(30, Number(d) + 1))}>+</button>
                  </div>
                </Field>
                <Field n="5" label="Start Date">
                  <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field n="6" label="Start Time" hint="India time (IST)">
                  <input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </Field>
                <Field n="7" label="Start Day" hint="Filled from the start date">
                  <div className={"wsf-day" + (startDay ? " on" : "")}>{startDay || "—"}</div>
                </Field>
              </div>
            </fieldset>
          </section>

          {/* Task preview */}
          {type && !isNew && (
            <section className="ws-panel wsf-card">
              <div className="wsf-prev-head">
                <h2>{type} Task List <span className="muted">— created on approval</span></h2>
                {isAdmin && <Link to="/workshops/templates" className="link-btn">Edit list</Link>}
              </div>
              {preview.length === 0 ? (
                <p className="ws-warn">{isAdmin ? "This task list is empty — add its tasks before approving, or nothing will be created." : "This task list is empty — an admin needs to add its tasks."}</p>
              ) : (
                <ol className="wsf-tasks">
                  {preview.map((t, i) => (
                    <li key={i}>
                      <span className="wsf-tl">{t.timeline || "T"}</span>
                      <span className="wsf-task">{t.task}</span>
                      <span className="wsf-when">{startDate ? shiftLabel(startDate, t.off) : ""}{t.time ? ` · ${fmtTime12(t.time)}` : ""}</span>
                      <span className="wsf-owner">{t.ownerName || "—"}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>

        {/* Live form-response preview */}
        <aside className="ws-panel ws-summary wsf-side">
          <h2>Your response</h2>
          <div className="wsf-sum-top">
            {type ? <TypeChip code={type} /> : <span className="wsf-dot" />}
            <strong>{workshopId || "—"}</strong>
          </div>
          <dl>
            <dt>Submitted by</dt><dd>{user?.email || "—"}</dd>
            <dt>Workshop Name</dt><dd>{name || "—"}</dd>
            <dt>Goal</dt><dd className="wsf-goal-sum">{goal || "—"}</dd>
            <dt>Days</dt><dd>{type ? `${days} day${Number(days) > 1 ? "s" : ""}` : "—"}</dd>
            <dt>Starts</dt><dd>{startDate ? `${startDate.split("-").reverse().join("/")} · ${fmtTime12(startTime)}` : "—"}</dd>
            <dt>Start Day</dt><dd>{startDay || "—"}</dd>
            <dt>Tasks</dt><dd>{chosen ? `${chosen.taskCount} auto-created on approval` : isNew && type ? "New list — admin adds tasks" : "—"}</dd>
          </dl>

          {error && <p className="error">{error}</p>}
          <button type="submit" className="ws-primary" disabled={busy || !meta || !ready}>{busy ? "Submitting…" : "Submit form"}</button>
          <ol className="wsf-flow">
            <li className="on">Submit the form</li>
            <li>Admin approves</li>
            <li>Tasks are created &amp; assigned</li>
          </ol>
        </aside>
      </form>
    </div>
  );
}
