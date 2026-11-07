import { beforeEach, describe, expect, it } from "vitest"
import { db, rawSqlite } from "@/server/db"
import * as s from "@/server/db/schema"
import { freeze } from "@/server/time"
import { loadActor, lockMonth, makeEntry, makeSchedule, makeUser } from "@/test/factories"
import { listEntries } from "../services/entries"
import { saveProject } from "../services/projects"
import { reopen } from "../services/signoffs"
import { allocate, LEGACY_WORKLOG_REASON, mergeLegacyWorklogs } from "./legacy-worklogs"

const TZ = "Europe/Zurich"
const ms = (d: string, hm: string) => Temporal.PlainDateTime.from(`${d}T${hm}`).toZonedDateTime(TZ).epochMilliseconds
const DAY = "2026-11-03"

beforeEach(() => freeze("2026-11-05T14:00:00Z"))

describe("allocate", () => {
  it("items with times first, then durations from the morning on; joins equal neighbours", () => {
    const entries = [
      { id: 1, a: ms(DAY, "08:00"), b: ms(DAY, "12:00") },
      { id: 2, a: ms(DAY, "13:00"), b: ms(DAY, "17:00") },
    ]
    const item = { note: "", customer_ref: "" }
    const out = allocate(
      entries,
      [
        { ...item, project_id: 2, minutes: 150, start_time: null, end_time: null },
        { ...item, project_id: 1, minutes: 60, start_time: "10:00", end_time: "11:00" },
        { ...item, project_id: 2, minutes: 120, start_time: null, end_time: null },
      ],
      DAY,
      TZ,
    )
    const view = (id: number) =>
      out.get(id)!.map((p) => [new Date(p.a).toISOString().slice(11, 16), p.label?.projectId ?? null])
    // 08:00-10:00 and 11:00-11:30 take the first duration; the second fills 11:30-12:00 and 13:00-14:30
    expect(view(1)).toEqual([
      ["07:00", 2],
      ["09:00", 1],
      ["10:00", 2],
    ])
    expect(view(2)).toEqual([
      ["12:00", 2],
      ["13:30", null],
    ])
  })
})

describe("mergeLegacyWorklogs", () => {
  it("moves open days onto the entries, logs every change, leaves signed-off months alone", () => {
    const u = makeUser({ name: "Anna" })
    makeSchedule(u.id)
    const pm = makeUser({ capabilities: ["projects"] })
    const a = saveProject(loadActor(pm.id), { name: "Alpha" })
    const b = saveProject(loadActor(pm.id), { name: "Beta" })
    makeEntry(u.id, `${DAY}T07:00:00.000000Z`, `${DAY}T11:00:00.000000Z`, { note: "Office" })
    makeEntry(u.id, "2026-10-05T07:00:00.000000Z", "2026-10-05T11:00:00.000000Z")
    const log = (date: string, v: Partial<typeof s.workLogs.$inferInsert>) =>
      db
        .insert(s.workLogs)
        .values({ userId: u.id, date, minutes: 60, ...v })
        .returning()
        .get()
    log(DAY, { projectId: a.id, startTime: "08:00", endTime: "10:00", minutes: 120, note: "Specs" })
    log(DAY, { customerRef: "C-1", minutes: 90 })
    const signed = log("2026-10-05", { projectId: b.id, minutes: 240 })
    const signoff = lockMonth(u.id, "2026-10")

    expect(mergeLegacyWorklogs(rawSqlite())).toBe(2)
    const A = loadActor(u.id)
    expect(
      listEntries(A, u.id, DAY, DAY).map((e) => [
        e.startAt.slice(11, 16),
        e.endAt?.slice(11, 16),
        e.project?.name ?? null,
        e.note,
      ]),
    ).toEqual([
      ["07:00", "09:00", "Alpha", "Office · Specs"],
      // entries carry no customer reference: it joins the note
      ["09:00", "10:30", null, "Office · C-1"],
      ["10:30", "11:00", null, "Office"],
    ])
    const revs = rawSqlite()
      .prepare<[], { entity: string; action: string }>(
        `SELECT entity, action FROM revisions WHERE reason = '${LEGACY_WORKLOG_REASON}' ORDER BY id`,
      )
      .all()
    expect(revs.map((r) => `${r.entity}:${r.action}`)).toEqual([
      "time_entry:update",
      "time_entry:create",
      "time_entry:create",
      "work_log:delete",
      "work_log:delete",
    ])
    // the signed-off month keeps its legacy row; a second run changes nothing
    expect(
      db
        .select()
        .from(s.workLogs)
        .all()
        .filter((w) => !w.isDeleted)
        .map((w) => w.id),
    ).toEqual([signed.id])
    expect(mergeLegacyWorklogs(rawSqlite())).toBe(0)

    // once HR reopens the month, its rows move too
    const hr = makeUser({ capabilities: ["hr"] })
    reopen(loadActor(hr.id), signoff.id, "correction")
    expect(listEntries(A, u.id, "2026-10-05", "2026-10-05").map((e) => e.project?.name)).toEqual(["Beta"])
  })
})
