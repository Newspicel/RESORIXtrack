/**
 * Column mapping v1 → v2, table by table, in insert order. Ids are kept. A v1 column that does not exist
 * in the source (older Alembic revision) is left out, so the v2 column default applies.
 *
 * Order matters: holidays and all time data go in before `month_signoffs`, because the v2 guard triggers
 * reject writes into signed-off periods.
 */
import { DEFAULTS } from "../services/settings"
import { text, v1Bool, v1Clock, v1EpochMs, v1Instant, v1InstantRequired, v1JsonOrNull } from "./convert"

export type V1Row = Record<string, unknown>
export interface ImportContext {
  /** v1 user id → when the person was anonymised (from the change log). */
  anonymizedAt: Map<number, string>
}

export interface Col {
  to: string
  /** v1 column; the column is skipped when the source lacks it. */
  from?: string
  convert?: (value: unknown, row: V1Row, ctx: ImportContext) => unknown
}
export interface TableSpec {
  table: string
  from: string
  cols: Col[]
  filter?: (row: V1Row) => boolean
}

const same = (name: string): Col => ({ to: name, from: name })
const instant = (name: string): Col => ({ to: name, from: name, convert: v1Instant })
const instantReq = (name: string): Col => ({ to: name, from: name, convert: v1InstantRequired })
const bool = (name: string): Col => ({ to: name, from: name, convert: v1Bool })
const clock = (name: string): Col => ({ to: name, from: name, convert: v1Clock })
const json = (name: string): Col => ({ to: name, from: name, convert: v1JsonOrNull })
const fixed = (to: string, value: unknown): Col => ({ to, convert: () => value })
const plain = (...names: string[]) => names.map(same)

const ANON_EMAIL = /^anonymised-\d+@invalid\.local$/

export const TABLES: TableSpec[] = [
  {
    table: "holiday_calendars",
    from: "holiday_calendars",
    cols: [...plain("id", "name", "region_code", "description"), bool("is_default"), instantReq("created_at")],
  },
  { table: "holidays", from: "holidays", cols: plain("id", "calendar_id", "date", "name", "fraction") },
  {
    table: "teams",
    from: "teams",
    cols: [...plain("id", "name", "color", "holiday_calendar_id"), instantReq("created_at")],
  },
  {
    table: "users",
    from: "users",
    cols: [
      ...plain("id", "email", "name", "role", "team_id", "holiday_calendar_id", "timezone", "locale"),
      same("time_format"), // Alembic 0002
      ...plain("employment_start", "employment_end", "vacation_days_per_year"),
      instant("password_changed_at"),
      bool("is_active"),
      bool("notify_email_on_correction"),
      { to: "capabilities", from: "capabilities", convert: (v) => v1JsonOrNull(v) ?? "[]" },
      instant("last_login_at"),
      { to: "created_at", from: "created_at", convert: v1EpochMs },
      { to: "updated_at", from: "created_at", convert: v1EpochMs },
      fixed("email_verified", 1),
      fixed("two_factor_enabled", 0),
      { to: "mfa_reenrol_required", from: "totp_enabled_at", convert: (v) => (v ? 1 : 0) },
      fixed("arg_exempt", 0), // v1 had no senior-executive flag (ArG Art. 3 lit. d)
      fixed("regular_night_work", 0), // nor regular night work (ArG Art. 17b para. 2)
      {
        to: "anonymized_at",
        from: "email",
        convert: (v, row, ctx) =>
          ANON_EMAIL.test(text(v)) ? (ctx.anonymizedAt.get(Number(row.id)) ?? v1Instant(row.created_at)) : null,
      },
    ],
  },
  {
    table: "team_leads",
    from: "team_leads",
    cols: [
      ...plain("id", "team_id", "user_id", "role", "valid_from", "valid_to", "created_by_id"),
      instantReq("created_at"),
    ],
  },
  {
    table: "work_schedules",
    from: "work_schedules",
    cols: [
      ...plain("id", "user_id", "valid_from", "pensum_percent"),
      ...plain("minutes_mon", "minutes_tue", "minutes_wed", "minutes_thu", "minutes_fri", "minutes_sat", "minutes_sun"),
      instantReq("created_at"),
    ],
  },
  {
    table: "absence_types",
    from: "absence_types",
    cols: [
      ...plain("id", "key", "label", "color", "category"),
      bool("credits_time"),
      bool("deducts_vacation"),
      bool("requires_approval"),
      bool("allows_attachments"),
      bool("employee_can_request"),
      bool("is_active"),
      same("sort"),
    ],
  },
  {
    table: "projects",
    from: "projects",
    cols: [
      ...plain("id", "name", "code", "color", "description", "team_id"),
      bool("is_active"),
      same("created_by_id"),
      instantReq("created_at"),
      instantReq("updated_at"),
    ],
  },
  {
    table: "time_entries",
    from: "time_entries",
    cols: [
      ...plain("id", "user_id", "kind"),
      instantReq("start_at"),
      instant("end_at"),
      instant("scheduled_end_at"), // Alembic 0003
      ...plain("tz", "note", "source"),
      bool("is_deleted"),
      same("created_by_id"),
      instantReq("created_at"),
      instantReq("updated_at"),
    ],
  },
  {
    table: "absences",
    from: "absences",
    cols: [
      ...plain("id", "user_id", "type_id", "start_date", "end_date", "start_half", "end_half", "note", "status"),
      ...plain("requested_by_id", "decided_by_id"),
      instant("decided_at"),
      ...plain("decision_note", "cancelled_by_id"),
      instant("cancelled_at"),
      same("cancel_reason"),
      instantReq("created_at"),
      instantReq("updated_at"),
    ],
  },
  {
    table: "attachments",
    from: "attachments",
    cols: [
      ...plain("id", "absence_id", "filename", "content_type", "size", "sha256", "storage_name", "uploaded_by_id"),
      bool("is_deleted"),
      instantReq("created_at"),
    ],
  },
  {
    table: "vacation_entitlements",
    from: "vacation_entitlements",
    cols: plain("id", "user_id", "year", "days", "note"),
  },
  {
    table: "balance_adjustments",
    from: "balance_adjustments",
    cols: [
      ...plain("id", "user_id", "account", "amount", "effective_date", "kind", "reason"),
      bool("is_deleted"),
      same("created_by_id"),
      instantReq("created_at"),
    ],
  },
  {
    table: "work_logs",
    from: "work_logs",
    cols: [
      ...plain("id", "user_id", "date", "project_id", "minutes"),
      clock("start_time"),
      clock("end_time"),
      ...plain("customer_ref", "note", "created_by_id"),
      bool("is_deleted"),
      instantReq("created_at"),
      instantReq("updated_at"),
    ],
  },
  {
    table: "notifications",
    from: "notifications",
    cols: [
      ...plain("id", "user_id", "kind"),
      { to: "payload", from: "payload", convert: (v) => v1JsonOrNull(v) ?? "{}" },
      instant("read_at"),
      instantReq("created_at"),
    ],
  },
  {
    table: "revisions",
    from: "revisions",
    cols: [
      ...plain("id", "entity", "entity_id", "subject_user_id", "actor_id", "action"),
      json("before"),
      json("after"),
      ...plain("reason", "source"),
      instantReq("at"),
    ],
  },
  {
    table: "settings",
    from: "settings",
    cols: [same("key"), { to: "value", from: "value", convert: text }],
    filter: (row) => text(row.key) in DEFAULTS,
  },
  {
    table: "login_attempts",
    from: "login_attempts",
    cols: [...plain("id", "email", "user_id", "ip", "user_agent"), bool("success"), same("reason"), instantReq("at")],
  },
  // last: from here on the guard triggers protect the signed-off periods
  {
    table: "month_signoffs",
    from: "month_signoffs",
    cols: [
      ...plain("id", "user_id", "month", "period_start_date", "period_end_date"),
      instantReq("period_start_utc"),
      instantReq("period_end_utc"),
      same("signed_by_id"),
      instantReq("signed_at"),
      same("note"),
      { to: "snapshot", from: "snapshot", convert: text }, // byte-exact: the v1 seal covers its canonical form
      ...plain("digest", "prev_seal", "seal"),
      fixed("seal_version", 1),
      instant("reopened_at"),
      ...plain("reopened_by_id", "reopen_reason"),
    ],
  },
]

/** v1 tables that are not imported, with the reason shown in the report. */
export const SKIPPED: Record<string, string> = {
  user_sessions: "sign in again",
  api_tokens: "API redesigned: create new API keys",
  auth_tokens: "links expire: send invitations again",
  alembic_version: "v1 schema version",
}
