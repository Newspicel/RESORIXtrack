/**
 * i18n core (no React, also used on the server): JSON dictionaries per locale and namespace in
 * src/i18n/<locale>/<ns>.json. Keys are "<ns>.<path>", e.g. t("time.add_entry"). Placeholders: {name}.
 * Plurals: key_one / key_other. Adding a language: copy src/i18n/en to src/i18n/<code>, translate, add it to
 * LOCALES in lib/locales.ts. The React provider and hooks live in lib/i18n.tsx.
 */
import { errorCode, errorMessage, isRecord } from "./guards"
import { intlLocale, type Locale } from "./locales"

type Dict = Record<string, unknown>
const modules = import.meta.glob<Dict>("../i18n/*/*.json", { eager: true, import: "default" })

const dictionaries: Record<string, Dict> = {}
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/i18n\/([^/]+)\/([^/]+)\.json$/)
  if (!m) continue
  const [, loc, ns] = m
  dictionaries[loc] ??= {}
  dictionaries[loc][ns] = mod
}

export { intlLocale, LOCALES, type Locale } from "./locales"
export const LOCALE_COOKIE = "rt_locale"

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && v in dictionaries
}

export function pickLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const c of candidates) {
    if (!c) continue
    for (const part of c.split(",")) {
      const code = part.trim().slice(0, 2).toLowerCase()
      if (isLocale(code)) return code
    }
  }
  return "en"
}

function lookup(dict: Dict | undefined, key: string): unknown {
  let cur: unknown = dict
  for (const part of key.split(".")) {
    if (isRecord(cur) && part in cur) cur = cur[part]
    else return undefined
  }
  return cur
}

export type Vars = Record<string, string | number | null | undefined>

export function translate(locale: string, key: string, vars: Vars = {}): string {
  let k = key
  if (typeof vars.count === "number") {
    const plural = new Intl.PluralRules(intlLocale(locale)).select(vars.count)
    const cand = `${key}_${plural}`
    if (typeof lookup(dictionaries[locale], cand) === "string" || typeof lookup(dictionaries.en, cand) === "string")
      k = cand
  }
  let s = lookup(dictionaries[locale], k)
  if (typeof s !== "string") s = lookup(dictionaries.en, k)
  if (typeof s !== "string") return key
  return s.replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? `{${v}}`))
}

export function hasKey(locale: string, key: string): boolean {
  return typeof lookup(dictionaries[locale], key) === "string" || typeof lookup(dictionaries.en, key) === "string"
}

export interface I18n {
  locale: Locale
  intl: string
  t: (key: string, vars?: Vars) => string
  has: (key: string) => boolean
  /** Translate an error (server function / API) by code, falling back to its message. */
  tError: (err: unknown) => string
  absenceLabel: (type: { key?: string; label?: string } | string | null | undefined) => string
  holidayName: (name: string | null | undefined) => string
}

export function makeI18n(locale: Locale): I18n {
  const t = (key: string, vars?: Vars) => translate(locale, key, vars)
  const has = (key: string) => hasKey(locale, key)
  return {
    locale,
    intl: intlLocale(locale),
    t,
    has,
    tError: (err) => {
      const code = errorCode(err)
      if (code && has(`errors.${code}`)) return t(`errors.${code}`)
      if (err instanceof TypeError || code === "network") return t("errors.network")
      const message = errorMessage(err)
      return message && message !== "Internal server error" ? message : t("errors.generic")
    },
    absenceLabel: (type) => {
      if (!type) return ""
      const key = typeof type === "string" ? type : type.key
      if (key && has(`absence_types.${key}`)) return t(`absence_types.${key}`)
      return typeof type === "string" ? type : (type.label ?? key ?? "")
    },
    holidayName: (name) => {
      if (!name) return ""
      const d = dictionaries[locale]?.holidays
      const text = isRecord(d) ? d[name] : undefined
      return typeof text === "string" ? text : name
    },
  }
}

export const _dictionaries = dictionaries
