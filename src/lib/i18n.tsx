/**
 * i18n for React: the locale is resolved on the server (user profile → `rt_locale` cookie → Accept-Language)
 * and passed down through <I18nProvider>, so SSR and hydration render the same text. Dictionaries and
 * translation live in lib/i18n-core.ts.
 */
import { createContext, type ReactNode, use } from "react"
import { type I18n, type Locale, makeI18n } from "./i18n-core"

const I18nContext = createContext<I18n>(makeI18n("en"))

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext value={makeI18n(locale)}>{children}</I18nContext>
}

export function useI18n(): I18n {
  return use(I18nContext)
}

/** Shorthand: `const t = useT()`. */
export function useT(): I18n["t"] {
  return use(I18nContext).t
}
