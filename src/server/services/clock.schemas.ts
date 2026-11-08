/** Inputs and constants of clock (client-safe: referenced by server-function validators). */

/**
 * `switch`: carry on working on another project (the running entry ends, the next starts at the same time).
 * `pause`: clock out for a break; the next clock-in ends it and continues the same project.
 */
export const CLOCK_ACTIONS = ["start", "stop", "pause", "unschedule", "switch"] as const

/** Actions a device may queue while offline and replay later. */
export const OFFLINE_ACTIONS = ["start", "stop", "pause", "switch"] as const
