/**
 * Dated terms on the person's profile: which fields are dated, the earlier terms and employment periods
 * (read-only), and rehiring a former employee.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { toast } from "sonner"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { SettingRow, SettingsGroup } from "@/components/app/settings"
import { PendingButton } from "@/components/form/pending-button"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { fmtDay } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import type { UserDetail } from "@/server/services/users"
import { rehireFn } from "../api/users"
import type { UserFormValues } from "./user-form"

const TERM_FIELDS = [
  "teamId",
  "holidayCalendarId",
  "timezone",
  "vacationDaysPerYear",
  "legalWeeklyMaxHours",
  "recordingMode",
  "argExempt",
  "regularNightWork",
] as const satisfies readonly (keyof UserFormValues)[]

/** A dated term differs from the saved value, so the save asks from which day it applies. */
export function termsChanged(v: UserFormValues, saved: UserFormValues): boolean {
  return TERM_FIELDS.some((k) => v[k] !== saved[k])
}

/** Earlier terms and employment periods, and rehiring once the employment has an end. */
export function EarlierTerms({ user }: { user: UserDetail }) {
  const { t, intl } = useI18n()
  const date = (d: string) => fmtDay(d, intl, { day: "numeric", month: "short", year: "numeric" })
  const [rehiring, setRehiring] = useState(false)
  const canRehire = user.employmentEnd != null && user.anonymizedAt == null && !user.isSelf
  if (!user.earlierTerms.length && !user.earlierPeriods.length && !canRehire) return null
  return (
    <SettingsGroup title={t("admin.users.earlier")}>
      {user.termsFrom ? (
        <SettingRow label={t("admin.users.current_terms_from", { date: date(user.termsFrom) })} control={null} />
      ) : null}
      {user.earlierTerms.map((e) => (
        <SettingRow
          key={e.validUntil}
          label={t("admin.users.earlier_terms", { date: date(e.validUntil) })}
          hint={[
            e.timezone.replace(/_/g, " "),
            `${e.vacationDaysPerYear} ${t("admin.users.vacation_days")}`,
            e.argExempt ? t("admin.weekly_max.exempt") : t(`admin.weekly_max.${e.legalWeeklyMaxHours}`),
            t(`admin.users.recording_${e.recordingMode}_short`),
            ...(e.regularNightWork ? [t("admin.users.regular_night_work")] : []),
          ].join(" · ")}
          control={null}
        />
      ))}
      {user.earlierPeriods.map((p) => (
        <SettingRow
          key={p.start ?? "start"}
          label={t("admin.users.earlier_period", {
            start: p.start ? date(p.start) : "?",
            end: p.end ? date(p.end) : "?",
          })}
          control={null}
        />
      ))}
      {canRehire ? (
        <SettingRow
          label={t("admin.users.rehire")}
          hint={t("admin.users.rehire_help")}
          control={
            <Button type="button" variant="outline" onClick={() => setRehiring(true)}>
              {t("admin.users.rehire")}
            </Button>
          }
        />
      ) : null}
      {rehiring ? <RehireDialog user={user} onClose={() => setRehiring(false)} /> : null}
    </SettingsGroup>
  )
}

function RehireDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const { t, tError } = useI18n()
  const qc = useQueryClient()
  const id = useId()
  const [start, setStart] = useState("")
  const submit = async () => {
    if (!start) {
      document.getElementById(id)?.focus()
      return
    }
    try {
      await rehireFn({ data: { id: user.id, start } })
      toast.success(t("admin.users.rehired"))
      await qc.invalidateQueries({ queryKey: ["admin"] })
      onClose()
    } catch (err) {
      toast.error(tError(err))
    }
  }
  return (
    <ResponsiveDialog
      open
      variant="dialog"
      onOpenChange={(o) => !o && onClose()}
      title={t("admin.users.rehire_title", { name: user.name })}
      description={t("admin.users.rehire_help")}
      action={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <PendingButton>{t("admin.users.rehire")}</PendingButton>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor={id}>{t("admin.users.rehire_start")}</FieldLabel>
        <DatePicker id={id} value={start} onChange={setStart} min={user.employmentEnd ?? undefined} far />
        <FieldDescription>{t("errors.fields.before_end")}</FieldDescription>
      </Field>
    </ResponsiveDialog>
  )
}
