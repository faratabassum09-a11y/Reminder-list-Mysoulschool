import React, { useId } from "react";

// Help Tickets mark — a ticket stub with a notch on each side and a check.
// Teal tile, matching the Help Tickets accent colour inside the app. Pure SVG.
export default function TicketsLogo({ size = 34, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Help Tickets">
      <defs>
        <linearGradient id={`tk-bg-${uid}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#35c4cf" />
          <stop offset="1" stopColor="#0b7f8c" />
        </linearGradient>
        <linearGradient id={`tk-shine-${uid}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#tk-bg-${uid})`} />
      <rect width="48" height="48" rx="14" fill={`url(#tk-shine-${uid})`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
      {/* ticket body with side notches */}
      <path d="M10 15a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v4a3.500 3.500 0 0 0 0 7v4a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3v-4a3.500 3.500 0 0 0 0-7v-4Z" transform="translate(0 3)" fill="#fff" fillOpacity=".92" />
      <path d="M17 26l4.500 4.500L31 21" transform="translate(0 0)" fill="none" stroke="#0b7f8c" strokeWidth="3.200" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
