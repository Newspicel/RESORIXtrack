import { useSuspenseQuery } from "@tanstack/react-query"
import { ScheduleEditor } from "@/features/schedules/schedule-editor"
import { todayIn } from "@/features/time/lib"
import type { UserDetail } from "@/server/services/users"
import { userRefsQuery } from "../api/users"

/** The person's schedule versions; editable here by HR (admins without HR set only the first one on create). */
export function SchedulePanel({ user }: { user: UserDetail }) {
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  return (
    <ScheduleEditor
      userId={user.id}
      data={{
        schedules: user.schedules,
        canEdit: user.canEditSchedules,
        fulltimeWeeklyMinutes: refs.defaults.fulltimeWeeklyMinutes,
        today: todayIn(user.timezone),
      }}
    />
  )
}
