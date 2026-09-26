import React from "react";

// Reminder List mark: a bell whose clapper is a check — "reminded, and done".
// Pure SVG so it stays crisp at any size and needs no image file.
export default function Logo({ size = 34, className = "" }) {
  const id = "rl-grad-" + size;
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Reminder List">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c5cd6" />
          <stop offset="1" stopColor="#2c7fd0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id})`} />
      <path d="M24 10.5c-5.2 0-8.7 3.9-8.7 9v5.2l-2.6 4.2c-.5.8.1 1.8 1 1.8h20.6c.9 0 1.5-1 1-1.8l-2.6-4.2v-5.2c0-5.1-3.5-9-8.7-9Z" fill="#fff" />
      <path d="M20.5 33.5a3.5 3.5 0 0 0 7 0" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="m20.4 21.6 2.7 2.7 5-5.2" fill="none" stroke="#5a49c2" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
