// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Company branding (logo URLs, accent colour) from the public /branding endpoint. */
import { signal } from "@preact/signals";
import { api } from "./api";

export interface LogoInfo { custom: boolean; type: string; url: string }
export interface Branding { company_name: string; accent: string | null; logos: { dark: LogoInfo; light: LogoInfo } }

export const branding = signal<Branding | null>(null);
const ACCENT_KEY = "rt.accent";
let pending: Promise<Branding> | null = null;

export function loadBranding(force = false): Promise<Branding> {
  if (pending && !force) return pending;
  pending = api.get<Branding>("/branding", undefined, { noRedirect: true }).then((b) => {
    branding.value = b;
    applyAccent(b.accent);
    return b;
  });
  pending.catch(() => (pending = null));
  return pending;
}

export function logoUrl(variant: "dark" | "light"): string {
  return branding.value?.logos[variant].url || `/api/v1/branding/logo/${variant}`;
}

/** Derive the lighter / darker accent shades and set them on :root (mirrors public/boot.js). */
export function applyAccent(hex: string | null) {
  const root = document.documentElement.style;
  try {
    if (hex) localStorage.setItem(ACCENT_KEY, hex);
    else localStorage.removeItem(ACCENT_KEY);
  } catch { /* ignore */ }
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    for (const p of ["--color-brand", "--color-brand-bright", "--color-brand-ink"]) root.removeProperty(p);
    return;
  }
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const mix = (k: number, w: number) => `rgb(${Math.round(r + (k - r) * w)},${Math.round(g + (k - g) * w)},${Math.round(b + (k - b) * w)})`;
  root.setProperty("--color-brand", hex);
  root.setProperty("--color-brand-bright", mix(255, 0.28));
  root.setProperty("--color-brand-ink", mix(0, 0.22));
}
