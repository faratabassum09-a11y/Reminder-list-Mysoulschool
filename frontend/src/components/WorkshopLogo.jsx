import React from "react";

// Workshop PMS mark: a rounded tile with a "flag on a timeline" — a launch
// milestone. Pure SVG, same footprint as the Reminder List logo.
export default function WorkshopLogo({ size = 34, className = "" }) {
  const id = "ws-grad-" + size;
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Workshop PMS">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e0912b" />
          <stop offset="1" stopColor="#c1392f" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id})`} />
      <path d="M14 36V12" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M14 13h19l-4.5 6 4.5 6H14z" fill="#fff" />
      <circle cx="14" cy="36" r="2.4" fill="#fff" />
      <path d="M20 36h14" stroke="#fff" strokeOpacity=".7" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="1 5" />
    </svg>
  );
}
