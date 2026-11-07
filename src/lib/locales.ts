/** Supported languages (client-safe, no dictionaries). Adding one: see lib/i18n.tsx. */
import { z } from "zod"

export const LOCALE_CODES = ["en", "de", "fr", "it"] as const
export type Locale = (typeof LOCALE_CODES)[number]
export const LOCALES: readonly { code: Locale; label: string; intl: string }[] = [
  { code: "en", label: "English", intl: "en-GB" },
  { code: "de", label: "Deutsch", intl: "de-CH" },
  { code: "fr", label: "Français", intl: "fr-CH" },
  { code: "it", label: "Italiano", intl: "it-CH" },
]
export const DEFAULT_LOCALE: Locale = "en"
export const localeSchema = z.enum(LOCALE_CODES)

export function isSupportedLocale(v: unknown): v is Locale {
  return LOCALE_CODES.some((code) => code === v)
}

export function intlLocale(locale: string): string {
  return LOCALES.find((l) => l.code === locale)?.intl ?? "en-GB"
}
