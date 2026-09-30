import React, { useState } from "react";

// Pinned note: who to contact when something on the website is broken.
export const SUPPORT_NAME = "Fara";
export const SUPPORT_EMAIL = "faraha.mysoulschool@gmail.com";

export default function SupportPin({ variant = "sidebar", collapsed = false }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the mailto link still works */
    }
  };
  const subject = encodeURIComponent("Website issue — MySoulSchool Ops");

  if (variant === "sidebar" && collapsed) {
    return (
      <a className="support-pin support-pin-mini" href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`}
        title={`Any issue with the website? Contact ${SUPPORT_NAME} — ${SUPPORT_EMAIL}`} aria-label={`Contact ${SUPPORT_NAME} about website issues`}>
        <span aria-hidden="true">📌</span>
      </a>
    );
  }

  return (
    <div className={"support-pin support-pin-" + variant}>
      <div className="support-pin-head">
        <span className="support-pin-icon" aria-hidden="true">📌</span>
        <span className="support-pin-title">Website issue? Contact {SUPPORT_NAME}</span>
      </div>
      <div className="support-pin-row">
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`} className="support-pin-mail">{SUPPORT_EMAIL}</a>
        <button type="button" className="support-pin-copy" onClick={copy} title="Copy email">{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
