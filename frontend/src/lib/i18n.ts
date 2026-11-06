// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/**
 * Minimal i18n: JSON dictionaries per locale and namespace in src/i18n/<locale>/<ns>.json.
 * Keys are "<ns>.<path>", e.g. t("time.add_entry"). Placeholders: {name}. Plurals: key_one / key_other.
 * Adding a language: copy src/i18n/en to src/i18n/<code>, translate, and add it to LOCALES below.
 */
import { signal } from "@preact/signals";

type Dict = Record<string, unknown>;

const modules = import.meta.glob("../i18n/*/*.json", { eager: true }) as Record<string, { default: Dict }>;

const dictionaries: Record<string, Dict> = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/i18n\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, locale, ns] = m;
  (dictionaries[locale] ||= {})[ns] = mod.default;
}

export const LOCALES: { code: string; label: string; intl: string }[] = [
  { code: "en", label: "English", intl: "en-GB" },
  { code: "de", label: "Deutsch", intl: "de-CH" },
  { code: "fr", label: "Français", intl: "fr-CH" },
];

const STORAGE_KEY = "rt.locale";

function initialLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && dictionaries[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2);
  return dictionaries[nav] ? nav : "en";
}

export const locale = signal<string>(typeof window === "undefined" ? "en" : initialLocale());

export function setLocale(code: string) {
  if (!dictionaries[code]) return;
  locale.value = code;
  document.documentElement.lang = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
}

export function intlLocale(): string {
  return LOCALES.find((l) => l.code === locale.value)?.intl || "en-GB";
}

function lookup(dict: Dict | undefined, key: string): unknown {
  if (!dict) return undefined;
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Dict)) cur = (cur as Dict)[part];
    else return undefined;
  }
  return cur;
}

export function has(key: string): boolean {
  return typeof lookup(dictionaries[locale.value], key) === "string" || typeof lookup(dictionaries.en, key) === "string";
}

export function t(key: string, vars: Record<string, string | number | null | undefined> = {}): string {
  const loc = locale.value; // subscribing components re-render on change
  let k = key;
  if (typeof vars.count === "number") {
    const plural = new Intl.PluralRules(intlLocale()).select(vars.count);
    const candidate = `${key}_${plural}`;
    if (typeof lookup(dictionaries[loc], candidate) === "string" || typeof lookup(dictionaries.en, candidate) === "string") k = candidate;
  }
  let s = lookup(dictionaries[loc], k);
  if (typeof s !== "string") s = lookup(dictionaries.en, k);
  if (typeof s !== "string") return key;
  return (s as string).replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? `{${v}}`) as string);
}

/** Translate an API error code (falls back to the server message). */
export function tError(err: { code?: string; message?: string; fields?: Record<string, unknown> } | unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code && has(`errors.${e.code}`)) return t(`errors.${e.code}`);
  if (e?.code === "network") return t("errors.network");
  return e?.message || t("errors.generic");
}

export function absenceLabel(type: { key?: string; label?: string } | string | null | undefined): string {
  if (!type) return "";
  const key = typeof type === "string" ? type : type.key;
  if (key && has(`absence_types.${key}`)) return t(`absence_types.${key}`);
  return typeof type === "string" ? type : type.label || key || "";
}

/** Holiday names are stored as data (English); translate common ones. */
export function holidayName(name: string | null | undefined): string {
  if (!name) return "";
  const d = dictionaries[locale.value]?.holidays as Record<string, string> | undefined;
  return d?.[name] || name;
}

export const _dictionaries = dictionaries;
