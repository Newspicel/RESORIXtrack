/** Tabs and filters of the administration pages, shared by the routes (search validation) and the views. */
export const LOG_TABS = ["backups", "audit", "logins", "keys"] as const
export type LogTab = (typeof LOG_TABS)[number]

export const SETTINGS_TABS = ["company", "time", "law", "security", "privacy", "types", "email"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const USER_TABS = ["profile", "schedule", "vacation", "access", "history"] as const
export type UserTab = (typeof USER_TABS)[number]

export const USER_STATUS_FILTERS = ["active", "inactive", "all"] as const

export const USER_ROLE_FILTERS = ["admin", "hr", "lead", "projects"] as const
