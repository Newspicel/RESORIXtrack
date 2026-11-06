// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Inline SVG icons (Lucide-style, 24px grid, stroke = currentColor). */
import type { JSX } from "preact";
import { branding } from "../lib/branding";

type P = JSX.SVGAttributes<SVGSVGElement>;

function Svg({ children, ...p }: P & { children: any }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}

export const Icon = {
  dashboard: (p: P) => <Svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>,
  clock: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>,
  calendar: (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 3v3M16 3v3" /></Svg>,
  palm: (p: P) => <Svg {...p}><path d="M12 21V11" /><path d="M12 11c-1-4-5-6-9-5 3 0 6 2 7 5" /><path d="M12 11c1-4 5-6 9-5-3 0-6 2-7 5" /><path d="M12 11c0-3-2-6-5-7 2 1 4 4 5 7z" /><path d="M8 21h8" /></Svg>,
  wallet: (p: P) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h12v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M16 13.5h2" /></Svg>,
  users: (p: P) => <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2" /></Svg>,
  inbox: (p: P) => <Svg {...p}><path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 13h5l1 3h6l1-3h5" /></Svg>,
  chart: (p: P) => <Svg {...p}><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" rx=".5" /><rect x="12" y="7" width="3" height="10" rx=".5" /><rect x="17" y="13" width="3" height="4" rx=".5" /></Svg>,
  settings: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>,
  team: (p: P) => <Svg {...p}><circle cx="12" cy="7" r="3" /><circle cx="5" cy="10" r="2.2" /><circle cx="19" cy="10" r="2.2" /><path d="M7 20c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5M1.5 19c.3-2.3 1.7-3.8 3.5-4.2M22.5 19c-.3-2.3-1.7-3.8-3.5-4.2" /></Svg>,
  flag: (p: P) => <Svg {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Svg>,
  database: (p: P) => <Svg {...p}><ellipse cx="12" cy="5.5" rx="8" ry="2.5" /><path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" /></Svg>,
  user: (p: P) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5" /></Svg>,
  logout: (p: P) => <Svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" /></Svg>,
  bell: (p: P) => <Svg {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></Svg>,
  sun: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  moon: (p: P) => <Svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>,
  menu: (p: P) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>,
  play: (p: P) => <Svg {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></Svg>,
  pause: (p: P) => <Svg {...p}><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></Svg>,
  stop: (p: P) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></Svg>,
  coffee: (p: P) => <Svg {...p}><path d="M17 8h1a3 3 0 0 1 0 6h-1M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM7 2v3M11 2v3" /></Svg>,
  thermo: (p: P) => <Svg {...p}><path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z" /></Svg>,
  plus: (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  x: (p: P) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>,
  check: (p: P) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>,
  edit: (p: P) => <Svg {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>,
  trash: (p: P) => <Svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Svg>,
  history: (p: P) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></Svg>,
  chevronLeft: (p: P) => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>,
  chevronRight: (p: P) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>,
  download: (p: P) => <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></Svg>,
  upload: (p: P) => <Svg {...p}><path d="M12 21V9M7 14l5-5 5 5M4 3h16" /></Svg>,
  paperclip: (p: P) => <Svg {...p}><path d="m21.4 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" /></Svg>,
  file: (p: P) => <Svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></Svg>,
  alert: (p: P) => <Svg {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></Svg>,
  info: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></Svg>,
  lock: (p: P) => <Svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>,
  key: (p: P) => <Svg {...p}><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" /></Svg>,
  shield: (p: P) => <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Svg>,
  monitor: (p: P) => <Svg {...p}><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></Svg>,
  globe: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>,
  mail: (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>,
  sparkle: (p: P) => <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></Svg>,
  refresh: (p: P) => <Svg {...p}><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5" /></Svg>,
  search: (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>,
};

/** Company logo that follows the active theme (artwork for dark vs. light backgrounds).
 *  Served by the API: the administrator's upload, or the built-in default. */
export function Logo({ height = 30, alt, variant }: { height?: number; alt?: string; variant?: "dark" | "light" }) {
  const b = branding.value;
  const a = alt ?? b?.company_name ?? "";
  const dark = b?.logos.dark.url || "/api/v1/branding/logo/dark";
  const light = b?.logos.light.url || "/api/v1/branding/logo/light";
  if (variant) return <img src={variant === "dark" ? dark : light} alt={a} style={{ height: `${height}px`, width: "auto", display: "block" }} />;
  return (
    <span class="logo-pair" style={{ height: `${height}px` }}>
      <img class="logo-on-dark" src={dark} alt={a} style={{ height: `${height}px` }} />
      <img class="logo-on-light" src={light} alt={a} style={{ height: `${height}px` }} />
    </span>
  );
}
