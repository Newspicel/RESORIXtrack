/** Inputs and constants of clock (client-safe: referenced by server-function validators). */

export const CLOCK_ACTIONS = ["start", "stop", "unschedule"] as const

/** Actions a device may queue while offline and replay later. */
export const OFFLINE_ACTIONS = ["start", "stop"] as const
