import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import type { CalendarRow } from "@/server/services/holiday-calendars"
import { holidayCatalogQuery, importHolidaysFn } from "../api/holidays"
import { EditorSheet, useAction } from "../ui"

export function ImportSheet({
  cal,
  year: initialYear,
  onClose,
}: {
  cal: CalendarRow
  year: number
  onClose: () => void
}) {
  const impRegionId = useId()
  const impReplaceId = useId()
  const impYearId = useId()
  const { t, locale } = useI18n()
  const { data: catalog } = useQuery(holidayCatalogQuery(locale))
  const presets = catalog?.presets ?? []
  // the calendar's own preset is preselected
  const [preset, setPreset] = useState<string | null>(cal.regionCode || null)
  const [year, setYear] = useState(initialYear)
  const [replace, setReplace] = useState(false)
  const run = useAction(() => importHolidaysFn({ data: { calendarId: cal.id, preset: preset ?? "", year, replace } }), {
    success: (r) => t("admin.holidays.imported", { added: r.added, skipped: r.skipped }),
    onSuccess: onClose,
  })
  return (
    <EditorSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("admin.holidays.import_title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => run.mutate(undefined)} disabled={run.isPending || !catalog || !preset}>
            {run.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("admin.holidays.import")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor={impRegionId}>{t("admin.holidays.canton")}</FieldLabel>
          <Combobox
            id={impRegionId}
            value={presets.some((p) => p.key === preset) ? preset : null}
            onChange={setPreset}
            options={presets.map((p) => ({
              value: p.key,
              label: p.label,
              hint: p.key.startsWith("CH-") ? p.key : undefined,
            }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={impYearId}>{t("common.year")}</FieldLabel>
          <Input
            id={impYearId}
            type="number"
            min={1990}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || initialYear)}
            className="w-32 tabular"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Switch id={impReplaceId} checked={replace} onCheckedChange={setReplace} />
          <Label htmlFor={impReplaceId}>{t("admin.holidays.replace_year", { year })}</Label>
        </div>
      </div>
    </EditorSheet>
  )
}
