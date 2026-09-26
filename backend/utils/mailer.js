import nodemailer from "nodemailer";

// Gmail App Password only, over SMTP. A pooled connection is reused across
// emails instead of redoing DNS + TLS + login for every single one (that
// handshake is most of the per-email wait) — this is what made the daily
// reminder run and the per-doer "Email Tasks" button slow before.
//
// Required env vars (see .env.example):
//   SMTP_USER = the Gmail address sending mail
//   SMTP_PASS = a 16-character Gmail App Password (NOT the normal password —
//               Google requires 2-Step Verification turned on first, then
//               an App Password generated at myaccount.google.com/apppasswords)
//   SMTP_FROM = optional, defaults to SMTP_USER

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    service: "gmail", // = host smtp.gmail.com, port 465, secure — no need to set these separately
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Reuse a few open, logged-in connections across calls instead of
    // reconnecting per email.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Fail in seconds, not nodemailer's 2-minute default, if Gmail can't
    // be reached at all (network/firewall issue) — a wrong App Password
    // still comes back almost instantly as its own clear error either way.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

const NETWORK_CODES = new Set(["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED", "ENOTFOUND", "EDNS"]);

export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP not configured (set SMTP_USER/SMTP_PASS) — would have emailed ${to}: "${subject}"`);
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await t.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (err) {
    if (NETWORK_CODES.has(err.code)) {
      throw new Error("Couldn't reach Gmail's SMTP server (timed out) — check your network/firewall allows outbound port 465.");
    }
    if (err.responseCode === 535 || /invalid login|username and password not accepted/i.test(err.message || "")) {
      throw new Error(
        "Gmail rejected the login. SMTP_PASS must be a 16-character App Password " +
          "(myaccount.google.com/apppasswords), not your regular Gmail password — and 2-Step Verification must be on."
      );
    }
    throw err;
  }
}

export function isMailerConfigured() {
  return !!getTransporter();
}
