import React, { useId } from "react";

// Reminder List mark — one family with the Workshop PMS mark: same rounded
// tile, same white glyph, same MySoulSchool-orange accent dot. Here the glyph
// is a bell carrying a check ("reminded, and done"); the orange dot is the
// live notification. Pure SVG, crisp at any size.
export default function Logo({ size = 34, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Reminder List">
      <defs>
        <linearGradient id={`rl-bg-${uid}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6d5bf0" />
          <stop offset="1" stopColor="#2a5fd6" />
        </linearGradient>
        <linearGradient id={`rl-shine-${uid}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#rl-bg-${uid})`} />
      <rect width="48" height="48" rx="14" fill={`url(#rl-shine-${uid})`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1.5" />
      {/* bell */}
      <path d="M24 9.5c-1.3 0-2.3 1-2.3 2.2v.6c-4.500 1-7.400 4.800-7.400 9.500v5.600l-2.500 3.900c-.6 1 .1 2.200 1.300 2.200h21.800c1.200 0 1.900-1.200 1.300-2.200l-2.500-3.900v-5.600c0-4.700-2.900-8.500-7.400-9.500v-.6c0-1.200-1-2.200-2.300-2.200Z" fill="#fff" />
      <path d="M20.300 35.500a3.700 3.700 0 0 0 7.400 0" fill="none" stroke="#fff" strokeWidth="2.400" strokeLinecap="round" />
      {/* check */}
      <path d="m19.600 22.400 3.200 3.200 5.800-6" fill="none" stroke="#4a45d6" strokeWidth="2.800" strokeLinecap="round" strokeLinejoin="round" />
      {/* live dot — MySoulSchool orange */}
      <circle cx="37" cy="11" r="5.200" fill="#e8722e" stroke="#3a4fd0" strokeWidth="2" />
    </svg>
  );
}
