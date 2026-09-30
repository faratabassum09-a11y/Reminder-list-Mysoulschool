import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api.js";
import PageHeader from "../../components/PageHeader.jsx";
import { useToast } from "../../components/Toast.jsx";
import { Empty, StatCard, SyncBadge, TypeChip } from "../ui.jsx";
import { fmtDate, fmtDateTimeYear, fmtTime12, daysUntil } from "../../utils/wsFormat.js";

// The hand-off to the Launch Verification app. Approving a workshop POSTs it
// to that app's Apps Script webhook; this page shows what was sent, what the
// remote feed actually holds, and lets an admin re-send anything that's
// missing or failed.
export default function WsLaunches() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [remote, setRemote] = useState(null);
  const [remoteError, setRemoteError] = useState("");
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(null);
  const [checking, setChecking] = useState(false);
  const internal = meta ? !meta.webhookConfigured : false; // built-in launch list, no Apps Script

  const loadRemote = () => {
    setChecking(true);
    setRemoteError("");
    api.wsRemoteLaunches().then(setRemote).catch((e) => { setRemote(null); setRemoteError(e.message); }).finally(() => setChecking(false));
  };
  const loadRows = () => api.wsList("?status=approved").then(setRows).catch((e) => toast(e.message, "bad"));
  useEffect(() => { loadRows(); loadRemote(); api.wsMeta().then(setMeta).catch(() => {}); }, []);

  const remoteIds = useMemo(() => new Set((remote?.launches || []).map((l) => l.id)), [remote]);
  const upcoming = (rows || []).filter((w) => daysUntil(w.startDate) >= 0).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const missing = remote ? upcoming.filter((w) => !remoteIds.has(w.workshopId)) : [];

  const resend = async (w) => {
    setBusy(w._id);
    try {
      const res = await api.wsResendLaunch(w._id);
      toast(res.launchSync.status === "sent" ? `${w.workshopId} sent` : `Not sent: ${res.launchSync.error}`, res.launchSync.status === "sent" ? "good" : "bad");
      await loadRows();
      loadRemote();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const verify = async (w, on) => {
    setBusy(w._id);
    try {
      await api.wsVerifyLaunch(w._id, on);
      await loadRows();
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const resendMissing = async () => {
    for (const w of missing) await resend(w);
  };

  return (
    <div className="page">
      <PageHeader
        title="Launch Verification"
        subtitle={internal ? "Every approved workshop is listed here automatically. Tick a launch once you've checked it (landing page, WhatsApp, Zoom, emails)." : "Approved workshops are handed to the Launch Verification app automatically. This checks that it really received them."}
        meta={<button type="button" className="btn-ghost" onClick={loadRemote} disabled={checking}>{checking ? "Checking…" : "Re-check feed"}</button>}
      />

      {internal && (
        <p className="ws-note">Launch Verification runs inside this website — nothing to set up. Approved workshops appear below automatically. (To also push them to an external Apps Script app, set <code>LAUNCH_WEBHOOK_URL</code> in the backend and restart.)</p>
      )}

      <div className="cards">
        <StatCard label="Upcoming approved" value={rows ? upcoming.length : "…"} tone="accent" />
        {internal ? (
          <>
            <StatCard label="Verified" value={rows ? upcoming.filter((w) => w.launchVerified?.at).length : "…"} tone="good" />
            <StatCard label="Still to verify" value={rows ? upcoming.filter((w) => !w.launchVerified?.at).length : "…"} tone={rows && upcoming.some((w) => !w.launchVerified?.at) ? "bad" : "good"} />
          </>
        ) : (
          <>
            <StatCard label="In Launch feed" value={remote ? remote.launches.length : remoteError ? "!" : "…"} tone={remoteError ? "bad" : "good"} hint={remote?.updatedAt ? `updated ${fmtDateTimeYear(remote.updatedAt)}` : ""} />
            <StatCard label="Missing from feed" value={remote ? missing.length : "—"} tone={missing.length ? "bad" : "good"} />
          </>
        )}
      </div>

      {remoteError && !internal && <p className="error">{remoteError}</p>}
      {missing.length > 0 && (
        <div className="check-banner ws-banner-row">
          <span><strong>{missing.length}</strong> upcoming workshop{missing.length === 1 ? " isn't" : "s aren't"} in the Launch feed yet.</span>
          <button type="button" className="btn-pill btn-pill-review" onClick={resendMissing}>Send missing</button>
        </div>
      )}

      {!rows ? (
        <div className="skeleton-bar" style={{ height: 200 }} />
      ) : upcoming.length === 0 ? (
        <Empty icon="🚀" title="No upcoming launches">Approve a workshop and it will appear here.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table ws-table">
            <thead><tr><th>Workshop</th><th>Starts</th>{internal ? <><th>Verified</th><th /></> : <><th>Last hand-off</th><th>Sent</th><th>In feed</th><th /></>}</tr></thead>
            <tbody>
              {upcoming.map((w) => (
                <tr key={w._id}>
                  <td><span><TypeChip code={w.type} /> <strong>{w.workshopId}</strong></span></td>
                  <td className="ws-nowrap">{w.startDay}, {fmtDate(w.startDate)}<div className="muted">{fmtTime12(w.startTime)} · {w.days}d</div></td>
                  {internal ? (
                    <>
                      <td>{w.launchVerified?.at ? <span><span className="ws-badge ws-b-good">Verified</span><div className="muted">{fmtDateTimeYear(w.launchVerified.at)}{w.launchVerified.byName ? ` · ${w.launchVerified.byName}` : ""}</div></span> : <span className="ws-badge ws-b-pending">To verify</span>}</td>
                      <td className="ws-actions">
                        {w.launchVerified?.at
                          ? <button type="button" className="link-btn" disabled={busy === w._id} onClick={() => verify(w, false)}>Undo</button>
                          : <button type="button" className="btn-pill" disabled={busy === w._id} onClick={() => verify(w, true)}>Mark verified</button>}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="muted">{w.launchSync?.at ? fmtDateTimeYear(w.launchSync.at) : "—"}{w.launchSync?.error && <div className="ws-reason">{w.launchSync.error}</div>}</td>
                      <td><SyncBadge sync={w.launchSync} /></td>
                      <td>{!remote ? <span className="muted">—</span> : remoteIds.has(w.workshopId) ? <span className="ws-badge ws-b-good">Yes</span> : <span className="ws-badge ws-b-overdue">No</span>}</td>
                      <td className="ws-actions"><button type="button" className="link-btn" disabled={busy === w._id} onClick={() => resend(w)}>{busy === w._id ? "Sending…" : "Resend"}</button></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
