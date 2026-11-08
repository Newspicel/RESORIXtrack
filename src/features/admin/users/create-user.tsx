import { useStore } from "@tanstack/react-form"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { FormRoot } from "@/components/form/form"
import { applyServerErrors } from "@/components/form/server-errors"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { isSupportedLocale } from "@/lib/locales"
import { createUserFn, userRefsQuery } from "../api/users"
import { todayLocal } from "../lib"
import { EditorSheet, SheetSubmit, useAction } from "../ui"
import { ContractFields, FormGroup, PersonFields, RegionFields, useUserForm } from "./user-fields"
import { toPayload, type UserFormValues, weeklyMaxValue } from "./user-form"

export function CreateUserSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const { data: refs } = useSuspenseQuery(userRefsQuery)
  const create = useAction(
    (v: UserFormValues) =>
      createUserFn({ data: { ...toPayload(v), pensumPercent: v.pensumPercent, sendInvite: v.sendInvite } }),
    {
      silentError: true,
      onSuccess: (r, v) => {
        if (v.sendInvite && r.invite.sent) toast.success(t("admin.users.invited", { email: v.email.trim() }))
        else if (v.sendInvite) toast.warning(t("admin.users.invite_failed"))
        else toast.success(t("admin.users.added"))
        onOpenChange(false)
        form.reset()
        void navigate({ to: "/admin/users/$userId", params: { userId: r.id } })
      },
    },
  )
  const { tError } = useI18n()
  const defaults: UserFormValues = {
    name: "",
    email: "",
    role: "employee",
    hr: false,
    projects: false,
    teamId: "0",
    holidayCalendarId: "0",
    timezone: refs.defaults.timezone,
    locale: isSupportedLocale(refs.defaults.locale) ? refs.defaults.locale : locale,
    employmentStart: todayLocal(),
    employmentEnd: "",
    birthDate: "",
    vacationDaysPerYear: refs.defaults.vacationDays,
    legalWeeklyMaxHours: weeklyMaxValue(refs.defaults.weeklyMaxHours),
    argExempt: false,
    regularNightWork: false,
    recordingMode: "full",
    pensumPercent: 100,
    termsFrom: "",
    sendInvite: true,
  }
  const form = useUserForm(defaults, async (v, formApi) => {
    try {
      await create.mutateAsync(v)
    } catch (err) {
      if (!applyServerErrors(formApi, err)) toast.error(tError(err))
    }
  })
  const invite = useStore(form.store, (s) => s.values.sendInvite)
  return (
    <EditorSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.users.add_title")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <SheetSubmit form={form}>{invite ? t("admin.users.invite") : t("common.create")}</SheetSubmit>
        </>
      }
    >
      <form.AppForm>
        <FormRoot form={form} className="flex flex-col gap-8">
          <PersonFields form={form} refs={refs} />
          <FormGroup title={t("admin.users.contract")}>
            <ContractFields form={form} create />
          </FormGroup>
          <FormGroup title={t("admin.users.region")}>
            <RegionFields form={form} refs={refs} />
          </FormGroup>
          <form.AppField name="sendInvite">
            {(f) => <f.SwitchField label={t("admin.users.send_invite")} />}
          </form.AppField>
        </FormRoot>
      </form.AppForm>
    </EditorSheet>
  )
}
