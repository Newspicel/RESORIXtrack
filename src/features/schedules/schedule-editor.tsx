/**
 * Work schedule versions of one person, shared by the admin person page and the team member page. HR (and
 * leads of the person's team when `lead_can_edit_schedules` is on) add versions and edit or delete future
 * ones; the service enforces the same rules, sign-off locks and a reason for changes before today.
 */
import type { QueryKey } from "@tanstack/react-query"
import { Lock, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConfirmDialog } from "@/components/app/confirm"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { Duration } from "@/components/data/duration"
import { tableHelper } from "@/components/data/table-helper"
import { FormRoot, useAppForm } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { deleteScheduleFn, saveScheduleFn } from "@/features/admin/api/users"
import { hhmmToMinutes, minutesToHhmm } from "@/features/admin/lib"
import { EditorSheet, SheetSubmit, useAction } from "@/features/admin/ui"
import { fmtDay } from "@/lib/format"
import { errorCode } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
type DayKey = (typeof DAYS)[number]

export interface ScheduleVersion {
  id: number
  validFrom: string
  pensumPercent: number
  minutes: Record<DayKey, number>
}

export interface ScheduleEditorData {
  schedules: ScheduleVersion[]
  canEdit: boolean
  fulltimeWeeklyMinutes: number
  /** the person's today: versions after it are planned and editable, earlier changes need a reason */
  today: string
}

type Row = ScheduleVersion & { state: "current" | "planned" | "past"; weekly: number }

function perDay<T>(f: (d: DayKey) => T): Record<DayKey, T> {
  return { mon: f("mon"), tue: f("tue"), wed: f("wed"), thu: f("thu"), fri: f("fri"), sat: f("sat"), sun: f("sun") }
}
const weekly = (m: Record<DayKey, number>) => DAYS.reduce((sum, d) => sum + m[d], 0)
const col = tableHelper<Row>()

/** Queries that depend on a person's schedule (targets, balances, team views, the admin person page). */
function affected(userId: number): QueryKey[] {
  return [["admin", "user", userId], ["team"], ["time"], ["account"], ["reports"]]
}

export function ScheduleEditor({ userId, data }: { userId: number; data: ScheduleEditorData }) {
  const { t, intl } = useI18n()
  const [editing, setEditing] = useState<ScheduleVersion | "new" | null>(null)
  const sorted = [...data.schedules].sort((a, b) => b.validFrom.localeCompare(a.validFrom))
  const current = sorted.find((s) => s.validFrom <= data.today)?.id
  const rows: Row[] = sorted.map((s) => ({
    id: s.id,
    validFrom: s.validFrom,
    pensumPercent: s.pensumPercent,
    minutes: s.minutes,
    state: s.id === current ? "current" : s.validFrom > data.today ? "planned" : "past",
    weekly: weekly(s.minutes),
  }))
  const columns = [
    col.accessor("validFrom", {
      header: () => t("admin.schedule.valid_from"),
      meta: { primary: true },
      cell: (c) => (
        <span className="grid grid-cols-[7rem_auto] items-center gap-2 whitespace-nowrap">
          <span className="tabular">
            {fmtDay(c.getValue(), intl, { day: "numeric", month: "short", year: "numeric" })}
          </span>
          {c.row.original.state === "current" ? (
            <StatusBadge tone="brand" className="h-5 justify-self-start">
              {t("admin.schedule.current")}
            </StatusBadge>
          ) : c.row.original.state === "planned" ? (
            <StatusBadge className="h-5 justify-self-start">{t("admin.schedule.planned")}</StatusBadge>
          ) : null}
        </span>
      ),
    }),
    col.accessor("pensumPercent", {
      header: () => t("admin.schedule.pensum"),
      meta: { numeric: true, mobileLabel: t("admin.schedule.pensum") },
      cell: (c) => `${c.getValue()} %`,
    }),
    ...DAYS.map((d) =>
      col.accessor((r) => r.minutes[d], {
        id: d,
        header: () => t(`admin.schedule.days.${d}`),
        enableSorting: false,
        meta: { numeric: true, hideOnMobile: true },
        cell: (c) =>
          c.getValue() ? <Duration minutes={c.getValue()} /> : <span className="text-muted-foreground">–</span>,
      }),
    ),
    col.accessor("weekly", {
      header: () => t("admin.schedule.week"),
      meta: { numeric: true, mobileLabel: t("admin.schedule.week") },
      cell: (c) => <Duration minutes={c.getValue()} className="font-medium" />,
    }),
  ]
  return (
    <Section
      title={t("admin.schedule.title")}
      actions={
        data.canEdit ? (
          <Button variant="outline" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            {t("admin.schedule.add")}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="flex items-center gap-1.5 text-sm text-muted-foreground" />}>
              <Lock className="size-4" />
              {t("admin.schedule.read_only")}
            </TooltipTrigger>
            <TooltipContent>{t("admin.schedule.read_only_help")}</TooltipContent>
          </Tooltip>
        )
      }
    >
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => String(r.id)}
        onRowClick={data.canEdit ? (r) => r.state === "planned" && setEditing(r) : undefined}
        empty={t("admin.schedule.empty")}
      />
      {editing ? (
        <ScheduleSheet
          userId={userId}
          data={data}
          schedule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  )
}

const hhmm = z.string().refine((v) => v.trim() === "" || (hhmmToMinutes(v) ?? 9999) <= 1440, "errors.fields.invalid")

/** First day of next month: the usual start of a new version. */
function nextMonthStart(today: string): string {
  const [y, m] = today.split("-").map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
}

function ScheduleSheet({
  userId,
  data,
  schedule,
  onClose,
}: {
  userId: number
  data: ScheduleEditorData
  schedule: ScheduleVersion | null
  onClose: () => void
}) {
  const { t, tError } = useI18n()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = useAction(
    (v: { validFrom: string; pensumPercent: number; reason: string } & Record<DayKey, string>) =>
      saveScheduleFn({
        data: {
          userId,
          scheduleId: schedule?.id ?? null,
          reason: v.reason.trim(),
          input: {
            validFrom: v.validFrom,
            pensumPercent: v.pensumPercent,
            minutes: perDay((d) => hhmmToMinutes(v[d]) ?? 0),
          },
        },
      }),
    { success: t("common.saved"), onSuccess: onClose, invalidate: affected(userId), silentError: true },
  )
  const remove = useAction(() => deleteScheduleFn({ data: { scheduleId: schedule?.id ?? 0, reason: "" } }), {
    success: t("admin.schedule.deleted"),
    onSuccess: onClose,
    invalidate: affected(userId),
  })
  const latest = [...data.schedules].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
  const base = schedule ?? latest
  const form = useAppForm({
    defaultValues: {
      validFrom: schedule?.validFrom ?? nextMonthStart(data.today),
      pensumPercent: base?.pensumPercent ?? 100,
      reason: "",
      ...perDay((d) => (base ? minutesToHhmm(base.minutes[d]) : "0:00")),
    },
    validators: {
      onChange: z
        .object({
          validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.fields.required"),
          pensumPercent: z
            .number({ error: "errors.fields.required" })
            .min(1, "errors.fields.invalid")
            .max(100, "errors.fields.invalid"),
          reason: z.string().max(500),
          mon: hhmm,
          tue: hhmm,
          wed: hhmm,
          thu: hhmm,
          fri: hhmm,
          sat: hhmm,
          sun: hhmm,
        })
        .refine((v) => v.validFrom >= data.today || v.reason.trim() !== "", {
          path: ["reason"],
          message: "errors.fields.required",
        }),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value)
      } catch (err) {
        // a signed-off month is a problem of the chosen date: show it there
        if (errorCode(err) === "period_signed_off") applyServerErrors(formApi, { fields: { validFrom: tError(err) } })
        else if (!applyServerErrors(formApi, err)) toast.error(tError(err))
      }
    },
  })
  const fillStandard = () => {
    const pensum = form.getFieldValue("pensumPercent") || 100
    const daily = Math.round(((data.fulltimeWeeklyMinutes / 5) * pensum) / 100)
    for (const [i, d] of DAYS.entries()) form.setFieldValue(d, minutesToHhmm(i < 5 ? daily : 0))
  }
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={schedule ? t("admin.schedule.edit") : t("admin.schedule.new_title")}
      footer={
        <>
          {schedule && data.schedules.length > 1 ? (
            <Button
              intent="negative"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              {t("common.delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{t("common.save")}</SheetSubmit>
        </>
      }
    >
      <form.AppForm>
        <FormRoot form={form} className="flex flex-col gap-6">
          <div className="grid grid-cols-[1fr_8rem] gap-4">
            <form.AppField name="validFrom">
              {(f) => <f.DateField label={t("admin.schedule.valid_from")} />}
            </form.AppField>
            <form.AppField name="pensumPercent">
              {(f) => (
                <f.TextField
                  label={t("admin.schedule.pensum_pct")}
                  type="number"
                  min={1}
                  max={100}
                  inputMode="numeric"
                  className="text-right tabular"
                />
              )}
            </form.AppField>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("admin.schedule.hours_per_day")}</span>
              <Button type="button" variant="outline" onClick={fillStandard}>
                {t("admin.schedule.fill_standard")}
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
              {DAYS.map((d) => (
                <form.AppField key={d} name={d}>
                  {(f) => (
                    <f.TextField
                      label={t(`admin.schedule.days.${d}`)}
                      inputMode="numeric"
                      placeholder="0:00"
                      className="text-right tabular"
                    />
                  )}
                </form.AppField>
              ))}
            </div>
            <form.Subscribe selector={(s) => DAYS.reduce((sum, d) => sum + (hhmmToMinutes(s.values[d]) ?? 0), 0)}>
              {(total) => (
                <p className="flex items-baseline justify-between text-sm text-muted-foreground">
                  {t("admin.schedule.week")}
                  <Duration minutes={total} className="font-semibold text-foreground" />
                </p>
              )}
            </form.Subscribe>
          </div>
          <form.Subscribe selector={(s) => s.values.validFrom < data.today}>
            {(past) =>
              past ? (
                <form.AppField name="reason">
                  {(f) => (
                    <f.TextareaField
                      label={t("admin.schedule.reason_required")}
                      placeholder={t("admin.schedule.reason_placeholder")}
                      maxLength={500}
                    />
                  )}
                </form.AppField>
              ) : null
            }
          </form.Subscribe>
        </FormRoot>
      </form.AppForm>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("admin.schedule.delete_title")}
        confirmLabel={t("common.delete")}
        onConfirm={() => remove.mutateAsync(undefined)}
      />
    </EditorSheet>
  )
}
