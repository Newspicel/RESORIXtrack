/** Tabs of the member page, shared by the route (search validation) and the view. */
export const MEMBER_TABS = ["time", "absences", "account", "schedule", "compliance", "history"] as const
export type MemberTab = (typeof MEMBER_TABS)[number]

/** Period of the member's time tab: `month` (YYYY-MM) shows a month, otherwise the week of `week` or today. */
export function memberPeriodParams(userId: number, search: { week?: string; month?: string }, today: string) {
  return search.month ? { userId, month: search.month } : { userId, week: search.week ?? today }
}
