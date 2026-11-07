import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Skeleton } from "@/components/ui/skeleton"
import { acceptInvitation, fetchInviteInfo } from "@/features/auth/api"
import { AuthCard } from "@/features/auth/components"
import { setLocaleCookie } from "@/features/auth/lib"
import { newPasswordValidator, passwordsDiffer, useFragmentToken } from "@/features/auth/password-fields"
import { failure } from "@/lib/attempt"
import { errorCode } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { LOCALES } from "@/lib/i18n-core"
import { InvalidLink } from "./reset"

export const Route = createFileRoute("/_auth/invite")({ component: Invite })

type Info = Awaited<ReturnType<typeof fetchInviteInfo>>

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich"
  } catch {
    return "Europe/Zurich"
  }
}

function Invite() {
  const { t, locale, tError } = useI18n()
  const router = useRouter()
  const qc = useQueryClient()
  const token = useFragmentToken()
  const [info, setInfo] = useState<Info | null>(null)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (token) fetchInviteInfo({ data: { token } }).then(setInfo, () => setInvalid(true))
  }, [token])

  const form = useAppForm({
    defaultValues: { locale, password: "", confirm: "" },
    onSubmit: async ({ value, formApi }) => {
      const failed = await failure(
        acceptInvitation({
          data: { token: token ?? "", password: value.password, locale: value.locale, timezone: browserTz() },
        }),
      )
      if (failed) {
        if (errorCode(failed.error) === "invalid_token") return setInvalid(true)
        const message = tError(failed.error)
        formApi.setFieldMeta("password", (m) => ({
          ...m,
          isBlurred: true,
          errorMap: { ...m.errorMap, onServer: message },
        }))
        return
      }
      await qc.invalidateQueries({ queryKey: ["bootstrap"] })
      await router.navigate({ to: "/" })
    },
  })

  if (invalid || token === "") return <InvalidLink />
  if (!info) return <Skeleton className="h-80 rounded-xl" />
  return (
    <AuthCard title={t("auth.invite_title", { name: info.name.split(" ")[0] })} description={info.email}>
      <form.AppForm>
        <FormRoot form={form}>
          <form.AppField
            name="locale"
            listeners={{
              onChange: ({ value }) => {
                setLocaleCookie(value)
                void qc.invalidateQueries({ queryKey: ["bootstrap"] })
              },
            }}
          >
            {(f) => (
              <f.SelectField
                label={t("profile.language")}
                options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
              />
            )}
          </form.AppField>
          <form.AppField name="password" validators={{ onBlur: newPasswordValidator }}>
            {(f) => (
              <f.TextField
                label={t("auth.new_password")}
                description={t("auth.password_rules")}
                type="password"
                autoComplete="new-password"
              />
            )}
          </form.AppField>
          <form.AppField
            name="confirm"
            validators={{
              onChangeListenTo: ["password"],
              onBlur: ({ value, fieldApi }) => passwordsDiffer(value, fieldApi.form.getFieldValue("password")),
            }}
          >
            {(f) => <f.TextField label={t("auth.confirm_password")} type="password" autoComplete="new-password" />}
          </form.AppField>
          <form.SubmitButton size="lg">{t("auth.activate")}</form.SubmitButton>
        </FormRoot>
      </form.AppForm>
    </AuthCard>
  )
}
