import React, { useId } from "react";

// Workshop PMS mark — a planning board: three columns of cards (plan ·
// approve · launch) with the last card lifting off as an upward arrow.
// Amber-to-orange tile, matching the Workshop PMS accent colours inside the app.
// Pure SVG.
export default function WorkshopLogo({ size = 34, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Workshop PMS">
      <defs>
        <linearGradient id={`ws-bg-${uid}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f4b35e" />
          <stop offset="1" stopColor="#d4691f" />
        </linearGradient>
        <linearGradient id={`ws-shine-${uid}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#ws-bg-${uid})`} />
      <rect width="48" height="48" rx="14" fill={`url(#ws-shine-${uid})`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
      {/* board columns */}
      <rect x="9" y="26" width="8" height="4" rx="1.6" fill="#fff" fillOpacity=".55" />
      <rect x="9" y="32" width="8" height="4" rx="1.6" fill="#fff" fillOpacity=".55" />
      <rect x="20" y="20" width="8" height="4" rx="1.6" fill="#fff" fillOpacity=".8" />
      <rect x="20" y="26" width="8" height="4" rx="1.6" fill="#fff" fillOpacity=".8" />
      <rect x="20" y="32" width="8" height="4" rx="1.6" fill="#fff" fillOpacity=".8" />
      <rect x="31" y="32" width="8" height="4" rx="1.6" fill="#fff" />
      {/* launch: last card lifts off */}
      <path d="M35 27V12M29.500 17.500 35 12l5.500 5.500" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="40" cy="10" r="2.600" fill="#fff4dc" />
    </svg>
  );
}
