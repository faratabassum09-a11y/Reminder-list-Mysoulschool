import React from "react";

// MySoulSchool mark: a lotus (three petals) with a small "soul" light rising
// above it, on a rounded gradient tile. Pure SVG — crisp at any size.
// To use your official logo file instead, put it in /public (e.g. logo.png)
// and replace the <svg> below with: <img src="/logo.png" width={size} height={size} alt="MySoulSchool" />
export default function MarkMySoulSchool({ size = 34, className = "", from = "#7c5cd6", to = "#2c7fd0", idPrefix = "mss", label = "MySoulSchool" }) {
  const id = `${idPrefix}-grad-${size}`;
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id})`} />
      {/* soul light */}
      <circle cx="24" cy="12.5" r="3.2" fill="#fff" />
      <path d="M24 17.2v2.6" stroke="#fff" strokeOpacity=".75" strokeWidth="1.6" strokeLinecap="round" />
      {/* side petals */}
      <path d="M24 37C15.5 36.5 9.5 31 8.5 23.5c6.5-.4 12.2 2.6 15.5 13.5Z" fill="#fff" fillOpacity=".78" />
      <path d="M24 37c8.5-.5 14.5-6 15.5-13.5-6.5-.4-12.2 2.6-15.5 13.5Z" fill="#fff" fillOpacity=".78" />
      {/* centre petal */}
      <path d="M24 37c-5-4.2-7.2-9-7.2-13.2 0-3 1.5-5.3 3.6-6.6.8-.5 2.4-.5 3.2 0 2.1 1.3 3.6 3.6 3.6 6.6 0 4.2-2.2 9-7.2 13.2Z" fill="#fff" />
      {/* ground line */}
      <path d="M14 41.2h20" stroke="#fff" strokeOpacity=".55" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
