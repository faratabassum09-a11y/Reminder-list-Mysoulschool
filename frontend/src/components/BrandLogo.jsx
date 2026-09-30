import React, { useId } from "react";

// MySoulSchool Ops — the website mark. Two interlocking rings (violet =
// Reminder List, amber = Workshop PMS) on a deep night tile; where they
// overlap is lit white — one platform, two apps, working together.
// Same tile construction as Logo / WorkshopLogo.
export function BrandMark({ size = 34, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={"logo logo-brand " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="MySoulSchool Ops">
      <defs>
        <linearGradient id={id + "bg"} x1="6" y1="2" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a2350" />
          <stop offset="1" stopColor="#0f0d22" />
        </linearGradient>
        <linearGradient id={id + "v"} x1="8" y1="14" x2="28" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a58bff" />
          <stop offset="1" stopColor="#5b7cf0" />
        </linearGradient>
        <linearGradient id={id + "a"} x1="20" y1="14" x2="40" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffc15a" />
          <stop offset="1" stopColor="#ff6a3d" />
        </linearGradient>
        <linearGradient id={id + "gl"} x1="0" y1="0" x2="0" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id + "c"}>
          <circle cx="18.5" cy="24" r="10.5" />
        </clipPath>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id}bg)`} />
      <rect width="48" height="48" rx="13" fill={`url(#${id}gl)`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="12.25" fill="none" stroke="#fff" strokeOpacity=".16" strokeWidth="1.5" />
      <circle cx="18.5" cy="24" r="10.5" fill="none" stroke={`url(#${id}v)`} strokeWidth="3.6" />
      <circle cx="29.5" cy="24" r="10.5" fill="none" stroke={`url(#${id}a)`} strokeWidth="3.6" />
      {/* lit overlap */}
      <circle cx="29.5" cy="24" r="10.5" fill="#fff" clipPath={`url(#${id}c)`} opacity=".95" />
    </svg>
  );
}

// Mark + wordmark, for the top of the site.
export default function BrandLogo({ size = 30, showText = true, className = "" }) {
  return (
    <span className={"brandlogo " + className}>
      <BrandMark size={size} />
      {showText && (
        <span className="brandlogo-text">
          <span className="brandlogo-name">MySoulSchool</span>
          <span className="brandlogo-sub">OPS</span>
        </span>
      )}
    </span>
  );
}
