/**
 * Scheduled jobs (cron in the company timezone). Each job is a plain function: idempotent, safe to run again,
 * and testable without the scheduler.
 */
import { and, eq, gte, isNotNull, isNull, like, lt, lte, or, sql } from "drizzle-orm"
import { db, rawSqlite } from "@/server/db"
import {
  apikey,
  appState,
  authTokens,
  loginAttempts,
  monthSignoffs,
  notifications,
  session,
  timeEntries,
  users,
  verification,
} from "@/server/db/schema"
import { env } from "@/server/env"
import { createBackup, rotateBackups } from "@/server/services/backups"
import { closeDueScheduled } from "@/server/services/clock"
import { topUpHolidays } from "@/server/services/holiday-calendars"
import { notify } from "@/server/services/notifications"
import { deferMail, withOutbox } from "@/server/services/outbox"
import { hrUsers } from "@/server/services/permissions"
import { getSetting } from "@/server/services/settings"
import { expectedGuards, installedGuards, verifyUser } from "@/server/services/signoffs"
import { fmtInstant, iso, nowInstant } from "@/server/time"

export interface Job {
  name: string
  schedule: string
  run: () => unknown
  /** also run once when the worker starts */
  atStart?: boolean
}

const DAY_MS = 86_400_000
const instantAgo = (ms: number) => fmtInstant(nowInstant().subtract({ milliseconds: ms }))
const tx = <T>(fn: () => T): T => rawSqlite().transaction(fn)()

/** Nightly encrypted backup (database, attachments, branding), keeping the newest BACKUP_KEEP automatic ones. */
export async function nightlyBackup(): Promise<{ name: string; removed: number }> {
  const info = await createBackup({ includeAttachments: true, label: "auto" })
  return { name: info.name, removed: rotateBackups(env.backupKeep) }
}

/**
 * Remind people whose entry has been running longer than `clock_reminder_hours` (0 = off): one in-app
 * notification and one email per running entry.
 */
export function sendClockReminders(): number {
  const hours = getSetting("clock_reminder_hours")
  if (hours <= 0) return 0
  const running = db
    .select({ e: timeEntries, u: users })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(
      and(
        isNull(timeEntries.endAt),
        eq(timeEntries.isDeleted, false),
        lte(timeEntries.startAt, instantAgo(hours * 3_600_000)),
        eq(users.isActive, true),
      ),
    )
    .all()
  let sent = 0
  for (const { e, u } of running) {
    const already = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, u.id),
          gte(notifications.createdAt, e.startAt),
          eq(notifications.kind, "clock_reminder"),
          sql`json_extract(${notifications.payload}, '$.entry_id') = ${e.id}`,
        ),
      )
      .limit(1)
      .get()
    if (already) continue
    const since = iso(e.startAt)
    withOutbox(() =>
      tx(() => {
        notify(u.id, "clock_reminder", { entry_id: e.id, since, hours })
        deferMail({ email: u.email, name: u.name, locale: u.locale }, "clock_reminder", {
          since,
          hours,
          tz: u.timezone,
        })
      }),
    )
    sent++
  }
  return sent
}

/** Delete what is no longer needed (data minimisation, revDSG Art. 6). Time data is never touched here. */
export function retentionCleanup(): Record<string, number> {
  const now = new Date(nowInstant().epochMilliseconds)
  const keepLogins = getSetting("login_log_retention_days")
  return tx(() => ({
    loginAttempts: db
      .delete(loginAttempts)
      .where(lt(loginAttempts.at, instantAgo(keepLogins * DAY_MS)))
      .run().changes,
    notifications: db
      .delete(notifications)
      .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, instantAgo(180 * DAY_MS))))
      .run().changes,
    sessions: db.delete(session).where(lt(session.expiresAt, now)).run().changes,
    verifications: db.delete(verification).where(lt(verification.expiresAt, now)).run().changes,
    authTokens: db
      .delete(authTokens)
      .where(
        and(
          or(isNotNull(authTokens.usedAt), lt(authTokens.expiresAt, instantAgo(0))),
          lt(authTokens.createdAt, instantAgo(7 * DAY_MS)),
        ),
      )
      .run().changes,
    apiKeys: db
      .delete(apikey)
      .where(lt(apikey.expiresAt, new Date(now.getTime() - 90 * DAY_MS)))
      .run().changes,
    offlineActions: db
      .delete(appState)
      .where(and(like(appState.key, "offline:%"), lt(appState.updatedAt, instantAgo(30 * DAY_MS))))
      .run().changes,
  }))
}

export interface IntegrityResult {
  checked: number
  problems: { id: number; status: string }[]
  missingGuards: string[]
}

/**
 * Weekly integrity check: every person's sign-off seal chain and signed figures, plus the database guards.
 * Problems are logged and reported in-app to HR and administrators.
 */
export function integrityCheck(): IntegrityResult {
  const userIds = db
    .selectDistinct({ id: monthSignoffs.userId })
    .from(monthSignoffs)
    .all()
    .map((r) => r.id)
  let checked = 0
  const problems: IntegrityResult["problems"] = []
  for (const uid of userIds) {
    for (const [id, status] of verifyUser(uid)) {
      checked++
      if (status !== "intact") problems.push({ id, status })
    }
  }
  const present = installedGuards()
  const missingGuards = expectedGuards().filter((n) => !present.has(n))
  if (problems.length || missingGuards.length) {
    console.error(
      `[worker] integrity check failed: sign-offs ${JSON.stringify(problems)}, missing guards: ${missingGuards.join(", ") || "none"}`,
    )
    const admins = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
      .all()
    const recipients = new Set([...hrUsers().map((u) => u.id), ...admins.map((u) => u.id)])
    tx(() => {
      for (const id of recipients) notify(id, "integrity_problem", { count: problems.length + missingGuards.length })
    })
  }
  return { checked, problems, missingGuards }
}

/** Yearly top-up of preset holiday calendars (only inserts missing dates outside signed-off periods). */
export function holidayTopUp() {
  return tx(() => topUpHolidays())
}

export const JOBS: Job[] = [
  { name: "backup", schedule: "0 2 * * *", run: nightlyBackup },
  // "clock out later": closes entries at their scheduled time (every clock request catches up as well)
  { name: "scheduled-clock-outs", schedule: "* * * * *", run: () => closeDueScheduled(), atStart: true },
  { name: "clock-reminders", schedule: "*/5 * * * *", run: sendClockReminders },
  { name: "cleanup", schedule: "30 3 * * *", run: retentionCleanup },
  { name: "integrity", schedule: "0 4 * * 0", run: integrityCheck },
  // 1 October: next year's holidays; 1 November: warn about calendars without a preset
  { name: "holiday-top-up", schedule: "0 5 1 10,11 *", run: holidayTopUp, atStart: true },
]
