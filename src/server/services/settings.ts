/** Company-wide settings stored as key/value JSON with typed defaults (port of v1 services/settings.py). */
import { eq } from "drizzle-orm"
import { isOneOf } from "@/lib/guards"
import type { Json } from "@/lib/json"
import { db } from "../db"
import { settings as settingsTable } from "../db/schema"
import { Validation } from "../errors"

export { DEFAULTS, RETIRED_SETTINGS, type SettingKey, type Settings, settingsSchema } from "./settings.schemas"

import { DEFAULTS, RETIRED_SETTINGS, type SettingKey, type Settings, settingsSchema } from "./settings.schemas"

/** Settings anyone (even signed out) may read. */
export const PUBLIC_KEYS = [
  "company_name",
  "default_timezone",
  "default_locale",
  "setup_complete",
  "brand_accent",
] as const

const SETTING_KEYS = settingsSchema.keyof().options
const partialSettings = settingsSchema.partial()

/** Stored rows over the defaults; a value that no longer validates (e.g. edited by hand) keeps the default. */
function withDefaults(rows: { key: string; value: unknown }[]): Settings {
  const values: Settings = { ...DEFAULTS }
  for (const row of rows) {
    const parsed = partialSettings.safeParse({ [row.key]: row.value })
    if (parsed.success) Object.assign(values, parsed.data)
  }
  return values
}

export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  const row = db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
  return withDefaults(row ? [row] : [])[key]
}

export function getAllSettings(): Settings {
  return withDefaults(db.select().from(settingsTable).all())
}

export function updateSettings(input: Partial<Record<string, unknown>>): Settings {
  const errors: Record<string, string> = {}
  const changes: [string, Json][] = []
  for (const [key, value] of Object.entries(input)) {
    if (RETIRED_SETTINGS.includes(key)) continue
    if (!isOneOf(SETTING_KEYS, key)) {
      errors[key] = "Unknown setting"
      continue
    }
    const parsed = settingsSchema.shape[key].safeParse(value)
    if (parsed.success) changes.push([key, parsed.data])
    else errors[key] = "Invalid value"
  }
  if (Object.keys(errors).length) throw new Validation("Invalid settings", { fields: errors })
  for (const [key, value] of changes) {
    db.insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
      .run()
  }
  return getAllSettings()
}
