import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import SearchInput from "../../components/SearchInput.jsx";
import { useToast } from "../../components/Toast.jsx";
import { parseSheetPaste } from "../../utils/wsPaste.js";
import { avatarStyleFromString, initials } from "../../utils/colorFromString.js";
import { fmtTime12, timelineWords } from "../../utils/wsFormat.js";
import { Empty, Modal, TypeChip } from "../ui.jsx";

const newKey = () => Math.random().toString(36).slice(2);
const toRows = (tpl) =>
  (tpl?.tasks || []).map((t) => ({ key: newKey(), taskId: t.taskId || "", description: t.description || "", task: t.task, timeline: t.timeline, time: t.time || "", doer: t.doer || "", ownerName: t.ownerName || "", score: t.score }));

const offsetOf = (tl) => {
  const n = Number.parseInt(String(tl ?? "").replace(/t/i, "").replace("+", "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
};
const timelineOf = (mode, n) => (mode === "on" || !n ? "T" : mode === "before" ? `T-${n}` : `T+${n}`);
const TIME_CHIPS = ["10:00", "16:00", "18:00", "19:00", "21:00", "23:59"];
const SCORE_CHIPS = [1, 2, 3, 5];

// ---------------------------------------------------------------------
// Add / edit one task — every column of the task-list sheet, one clear form.
// ---------------------------------------------------------------------
function TaskModal({ code, initial, doers, takenIds, nextId, onClose, onSave }) {
  const editing = Boolean(initial);
  const off = offsetOf(initial?.timeline);
  const [taskId, setTaskId] = useState(initial?.taskId || nextId);
  const [task, setTask] = useState(initial?.task || "");
  const [mode, setMode] = useState(initial ? (off < 0 ? "before" : off > 0 ? "after" : "on") : "before");
  const [days, setDays] = useState(initial ? Math.abs(off) : 7);
  const [time, setTime] = useState(initial?.time ?? "18:00");
  const [doer, setDoer] = useState(initial?.doer || "");
  const [ownerName, setOwnerName] = useState(initial?.ownerName || "");
  const [score, setScore] = useState(initial?.score ?? 1);
  const [description, setDescription] = useState(initial?.description || "");
  const [error, setError] = useState("");

  const timeline = timelineOf(mode, Number(days));
  const person = doers.find((d) => d._id === doer);
  const buddy = person?.buddyEmails?.[0] || person?.buddyEmail || "";

  const build = () => ({ key: initial?.key || newKey(), taskId: taskId.trim().toUpperCase(), task: task.trim(), description: description.trim(), timeline, time, doer, ownerName: doer ? "" : ownerName, score: Number(score) || 0 });
  const submit = (again) => (e) => {
    e.preventDefault();
    const row = build();
    if (!row.task) return setError("Enter the task");
    if (!row.taskId) return setError("Enter a Task ID");
    if (takenIds.has(row.taskId) && row.taskId !== initial?.taskId) return setError(`${row.taskId} is already used in this list`);
    onSave(row, again);
    if (again) {
      setTask(""); setDescription(""); setError("");
      setTaskId(row.taskId.replace(/(\d+)$/, (n) => String(Number(n) + 1)));
    } else onClose();
  };

  return (
    <Modal wide title={editing ? `Edit ${initial.taskId}` : `Add task to ${code} Task List`} sub="Every workshop of this type gets this task automatically once it is approved." onClose={onClose}>
      <form onSubmit={submit(false)} className="wst-form">
        <div className="wst-row wst-row-id">
          <label className="modal-field">Task ID
            <input value={taskId} onChange={(e) => setTaskId(e.target.value)} className="ws-mono" required />
          </label>
          <label className="modal-field wst-grow">Task
            <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="e.g. Update Zoom Webinar - Day 1 - WA Link" autoFocus required />
          </label>
        </div>

        <div className="wst-block">
          <span className="wst-cap">Timeline <em>when it is due, relative to the workshop start day</em></span>
          <div className="wst-seg" role="radiogroup" aria-label="Timeline">
            {[["before", "Days before"], ["on", "On the day"], ["after", "Days after"]].map(([k, l]) => (
              <button type="button" key={k} role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>
          {mode !== "on" && (
            <div className="wst-stepper">
              <button type="button" aria-label="One day less" onClick={() => setDays((d) => Math.max(1, Number(d) - 1))}>−</button>
              <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
              <button type="button" aria-label="One day more" onClick={() => setDays((d) => Math.min(60, Number(d) + 1))}>+</button>
              <span className="muted">day{Number(days) === 1 ? "" : "s"} {mode === "before" ? "before" : "after"}</span>
            </div>
          )}
          <div className="wst-preview"><span className="wsf-tl">{timeline}</span> Due {timelineWords(timeline)}{time ? ` at ${fmtTime12(time)} IST` : " by 11:59 PM IST"}</div>
        </div>

        <div className="wst-row">
          <div className="wst-block">
            <span className="wst-cap">Task time <em>IST</em></span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <div className="wst-chips">
              {TIME_CHIPS.map((t) => <button type="button" key={t} className={time === t ? "on" : ""} onClick={() => setTime(t)}>{fmtTime12(t)}</button>)}
              <button type="button" className={!time ? "on" : ""} onClick={() => setTime("")}>End of day</button>
            </div>
          </div>
          <div className="wst-block">
            <span className="wst-cap">Task score</span>
            <div className="wst-stepper">
              <button type="button" aria-label="Lower score" onClick={() => setScore((s) => Math.max(0, Number(s) - 1))}>−</button>
              <input type="number" min={0} value={score} onChange={(e) => setScore(e.target.value)} />
              <button type="button" aria-label="Higher score" onClick={() => setScore((s) => Number(s) + 1)}>+</button>
            </div>
            <div className="wst-chips">{SCORE_CHIPS.map((n) => <button type="button" key={n} className={Number(score) === n ? "on" : ""} onClick={() => setScore(n)}>{n} pt{n > 1 ? "s" : ""}</button>)}</div>
          </div>
        </div>

        <div className="wst-block">
          <span className="wst-cap">Task owner</span>
          <select value={doer || (ownerName ? "__name" : "")} onChange={(e) => (e.target.value === "__name" ? null : (setDoer(e.target.value), setOwnerName("")))}>
            <option value="">Unassigned</option>
            {ownerName && !doer && <option value="__name">⚠ {ownerName} (not on Doer List)</option>}
            {doers.map((d) => <option key={d._id} value={d._id}>{d.name} — {d.department}</option>)}
          </select>
          {person && (
            <div className="wst-person">
              <span className="avatar ws-avatar" style={avatarStyleFromString(person.name)}>{initials(person.name)}</span>
              <div><strong>{person.name}</strong><div className="muted">{person.email}</div></div>
              <div className="wst-buddy"><span className="muted">Buddy</span><div>{buddy || "—"}</div></div>
            </div>
          )}
        </div>

        <label className="modal-field">Description <span className="muted">(optional — links, checklist, contact numbers)</span>
          <textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown to the owner along with the task" />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          {!editing && <button type="button" className="btn-ghost" onClick={submit(true)}>Add &amp; add another</button>}
          <button type="submit">{editing ? "Save task" : "Add task"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PasteModal({ doers, onClose, onApply }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("replace");
  const parsed = useMemo(() => parseSheetPaste(text, doers), [text, doers]);
  return (
    <Modal wide title="Paste from Google Sheets" sub="Copy columns B:F of the task-list sheet (Task · Timeline · Time · Owner · Score) and paste below." onClose={onClose}>
      <textarea className="ws-paste" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Send invitation\tT-7\t10:00\tPriya\t5\nConfirm venue\tT-3\t18:00\tRahul\t10"} autoFocus />
      <div className="ws-paste-foot">
        <span className="muted">{parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} recognised</span>
        <label className="ws-inline-check"><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace current list</label>
        <label className="ws-inline-check"><input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /> Add to the end</label>
      </div>
      {parsed.unmatched.length > 0 && (
        <p className="ws-warn">No matching person on the Doer List for: <strong>{parsed.unmatched.join(", ")}</strong>. They'll be kept as plain names (no email), so those tasks can't be completed by them — fix the spelling or add them to the Doer List.</p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" disabled={!parsed.rows.length} onClick={() => { onApply(parsed.rows, mode); onClose(); }}>Use {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}</button>
      </div>
    </Modal>
  );
}

function Counters() {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.wsCounters().then(setC).catch(() => {}); }, []);
  if (!c) return null;
  const save = async () => {
    setBusy(true);
    try { await api.wsSaveCounters(c); toast("ID counters saved", "good"); } catch (err) { toast(err.message, "bad"); } finally { setBusy(false); }
  };
  return (
    <section className="ws-panel ws-counters">
      <h2>ID numbering</h2>
      <p className="muted">The <strong>last number already used</strong> for each series — new IDs continue from there. Use this to carry on from the old Google Sheet (e.g. if UTW-16 was the last, enter 16 and the next is UTW-17).</p>
      <div className="ws-counter-grid">
        {Object.keys(c).map((k) => (
          <label key={k} className="modal-field">{k === "tasks" ? "Task IDs (…-WTS-n)" : `${k} workshops`}
            <input type="number" min={0} value={c[k]} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <button type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save numbering"}</button>
    </section>
  );
}

export default function WsTemplates() {
  const toast = useToast();
  const [templates, setTemplates] = useState(null);
  const [doers, setDoers] = useState([]);
  const [code, setCode] = useState("");
  const [rows, setRows] = useState([]);
  const [defaults, setDefaults] = useState({ days: 1, time: "10:00" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [modal, setModal] = useState(null); // { row? }
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.wsTemplates(), api.getDoers()])
      .then(([t, d]) => { setTemplates(t); setDoers(d.filter((x) => x.active !== false)); setCode(new URLSearchParams(window.location.search).get("type") || t[0]?.code || ""); })
      .catch((e) => setError(e.message));
  }, []);

  const current = templates?.find((t) => t.code === code);
  useEffect(() => {
    if (!current) return;
    setRows(toRows(current));
    setDefaults({ days: current.defaultDays, time: current.defaultTime });
    setDirty(false);
    setQ("");
  }, [code, templates]);

  const switchTab = (c) => {
    if (dirty && !window.confirm("Discard unsaved changes to this task list?")) return;
    setCode(c);
  };
  const remove = (key) => { setRows((r) => r.filter((x) => x.key !== key)); setDirty(true); };
  const move = (key, d) => {
    setRows((r) => {
      const i = r.findIndex((x) => x.key === key);
      const j = i + d;
      if (i < 0 || j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setDirty(true);
  };
  const sortByTimeline = () => {
    setRows((r) => [...r].sort((a, b) => offsetOf(a.timeline) - offsetOf(b.timeline) || (a.time || "23:59").localeCompare(b.time || "23:59")));
    setDirty(true);
  };
  const apply = (parsed, mode) => { setRows((r) => (mode === "append" ? [...r, ...parsed] : parsed)); setDirty(true); };
  const saveRow = (row, again) => {
    setRows((r) => (r.some((x) => x.key === row.key) ? r.map((x) => (x.key === row.key ? row : x)) : [...r, row]));
    setDirty(true);
    if (!again) toast(`${row.taskId} ${modal?.row ? "updated" : "added"} — press “Save changes” to publish the list`, "default");
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await api.wsSaveTemplate(code, {
        defaultDays: Number(defaults.days),
        defaultTime: defaults.time,
        tasks: rows.filter((r) => r.task.trim()).map(({ key, ...r }) => r),
      });
      setTemplates((ts) => ts.map((t) => (t.code === code ? saved : t)));
      setDirty(false);
      toast(saved.generatedFor ? `${code} Task List saved — tasks created for ${saved.generatedFor} approved workshop${saved.generatedFor === 1 ? "" : "s"} that had none` : `${code} Task List saved — applies to workshops approved from now on`, "good");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const prefix = `${code}-TS-`;
  const nextId = useMemo(() => {
    const max = rows.reduce((m, r) => { const n = Number((/(\d+)$/.exec(r.taskId || "") || [])[1]); return Number.isFinite(n) ? Math.max(m, n) : m; }, 1);
    return `${prefix}${max + 1}`;
  }, [rows, prefix]);
  const takenIds = useMemo(() => new Set(rows.map((r) => r.taskId).filter(Boolean)), [rows]);
  const doerById = useMemo(() => new Map(doers.map((d) => [d._id, d])), [doers]);
  const total = rows.reduce((s, r) => s + (Number(r.score) || 0), 0);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || [r.taskId, r.task, r.timeline, r.ownerName, doerById.get(r.doer)?.name, r.description].join(" ").toLowerCase().includes(needle));

  return (
    <div className="page">
      <PageHeader title="Task lists" subtitle="One fixed list per workshop type (UTW, ICP, R12, THW and any new type added from the New Workshop form). Every approved workshop gets a copy of its type's list, assigned automatically." />
      {error && <p className="error">{error}</p>}
      {!templates ? (
        <div className="skeleton-bar" style={{ height: 240 }} />
      ) : (
        <>
          <div className="wst-tabs" role="tablist">
            {templates.map((t) => (
              <button key={t.code} type="button" role="tab" aria-selected={code === t.code} className={`wst-tab wst-tab-${t.code}` + (code === t.code ? " active" : "")} onClick={() => switchTab(t.code)}>
                <TypeChip code={t.code} />
                <span className="wst-tab-name">{t.code} Task List</span>
                <span className="ws-tab-count">{(code === t.code ? rows : t.tasks).length}</span>
              </button>
            ))}
          </div>

          <div className="ws-panel wst-panel">
            <div className="wst-head">
              <div>
                <h2>{code} Task List</h2>
                <p className="muted">{rows.length} task{rows.length === 1 ? "" : "s"} · {total} points · Task ID prefix <code>{prefix}</code></p>
              </div>
              <div className="wst-head-actions">
                <SearchInput value={q} onChange={setQ} placeholder="Search this list…" />
                <button type="button" className="btn-ghost" onClick={sortByTimeline} disabled={rows.length < 2} title="Order by timeline, earliest first">Sort by timeline</button>
                <button type="button" className="btn-ghost" onClick={() => setPasting(true)}>Paste from Sheets</button>
                <button type="button" className="ws-primary" onClick={() => setModal({})}>+ Add task</button>
              </div>
            </div>

            <div className="wst-defaults">
              <label>Usual workshop days<input type="number" min={1} max={30} value={defaults.days} onChange={(e) => { setDefaults({ ...defaults, days: e.target.value }); setDirty(true); }} /></label>
              <label>Usual start time (IST)<input type="time" value={defaults.time} onChange={(e) => { setDefaults({ ...defaults, time: e.target.value }); setDirty(true); }} /></label>
            </div>

            {rows.length === 0 ? (
              <Empty icon="📝" title="This list is empty">Add the first task, or paste the whole list straight from your Google Sheet.</Empty>
            ) : shown.length === 0 ? (
              <Empty icon="🔎" title="No task matches">Try a different search.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table ws-table wst-table">
                  <thead>
                    <tr><th>Task ID</th><th>Task</th><th>Timeline</th><th>Task Time</th><th>Task Owner</th><th className="ws-num">Task Score</th><th /></tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => {
                      const d = doerById.get(r.doer);
                      const ownerLabel = d?.name || r.ownerName;
                      const head = i === 0 || shown[i - 1].timeline !== r.timeline;
                      return (
                        <React.Fragment key={r.key}>
                          {head && (
                            <tr className="wst-group"><td colSpan={7}><span className="wsf-tl">{r.timeline}</span> {timelineWords(r.timeline)} the workshop</td></tr>
                          )}
                          <tr>
                            <td className="ws-mono wst-id">{r.taskId || <span className="muted">auto</span>}</td>
                            <td>
                              <div className="ws-cell-stack">
                                <span className="ws-task-name">{r.task}</span>
                                {r.description && <span className="muted wst-desc" title={r.description}>{r.description}</span>}
                              </div>
                            </td>
                            <td><span className="ws-timeline">{r.timeline}</span></td>
                            <td className="ws-nowrap">{r.time ? fmtTime12(r.time) : <span className="muted">11:59 PM</span>}</td>
                            <td>
                              {ownerLabel ? (
                                <span className="ws-owner">
                                  <span className="avatar ws-avatar" style={avatarStyleFromString(ownerLabel)}>{initials(ownerLabel)}</span>
                                  <span>{ownerLabel}{!d && <em className="ws-you" title="Not on the Doer List"> ⚠</em>}</span>
                                </span>
                              ) : <span className="muted">Unassigned</span>}
                            </td>
                            <td className="ws-num"><strong>{r.score}</strong></td>
                            <td className="ws-actions">
                              <button type="button" className="link-btn" onClick={() => move(r.key, -1)} aria-label="Move up" disabled={!!needle}>↑</button>
                              <button type="button" className="link-btn" onClick={() => move(r.key, 1)} aria-label="Move down" disabled={!!needle}>↓</button>
                              <button type="button" className="link-btn" onClick={() => setModal({ row: r })}>Edit</button>
                              <button type="button" className="link-btn danger" onClick={() => remove(r.key)}>Remove</button>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted ws-tpl-foot"><strong>Timeline</strong>: <code>T</code> = start day, <code>T-7</code> = a week before, <code>T+2</code> = two days after. A task with no time is due by 11:59 PM that day.</p>
          </div>

          <Counters />
        </>
      )}

      {dirty && (
        <div className="wst-savebar" role="status">
          <span>You have unsaved changes to the {code} Task List.</span>
          <button type="button" className="btn-ghost" onClick={() => { setRows(toRows(current)); setDefaults({ days: current.defaultDays, time: current.defaultTime }); setDirty(false); }}>Discard</button>
          <button type="button" className="ws-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      )}

      {pasting && <PasteModal doers={doers} onClose={() => setPasting(false)} onApply={apply} />}
      {modal && (
        <TaskModal
          code={code}
          initial={modal.row}
          doers={doers}
          takenIds={takenIds}
          nextId={nextId}
          onClose={() => setModal(null)}
          onSave={saveRow}
        />
      )}
    </div>
  );
}
