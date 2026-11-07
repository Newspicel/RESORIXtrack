import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Download } from "lucide-react"
import { Page, PageHeader } from "@/components/app/page"
import { ButtonLink } from "@/components/ui/button"
import {
  apiKeysQuery,
  loginHistoryQuery,
  passkeysQuery,
  profileQuery,
  securityQuery,
  sessionsQuery,
} from "@/features/profile/api"
import { ApiKeysSection } from "@/features/profile/api-keys-section"
import { LoginHistorySection, ProvidersSection, SessionsSection } from "@/features/profile/devices-section"
import { MfaSection } from "@/features/profile/mfa-section"
import { PasskeysSection } from "@/features/profile/passkeys-section"
import { PasswordSection, PersonalSection } from "@/features/profile/personal-section"
import { useT } from "@/lib/i18n"

export const Route = createFileRoute("/_app/profile")({
  staticData: { titleKey: "profile.title" },
  loader: async ({ context: { queryClient: qc } }) => {
    const [profile] = await Promise.all([
      qc.ensureQueryData(profileQuery),
      qc.ensureQueryData(securityQuery),
      qc.ensureQueryData(sessionsQuery),
      qc.ensureQueryData(loginHistoryQuery),
      qc.ensureQueryData(passkeysQuery),
    ])
    if (profile.apiKeysEnabled) await qc.ensureQueryData(apiKeysQuery)
  },
  component: ProfilePage,
})

function ProfilePage() {
  const t = useT()
  const { data } = useSuspenseQuery(profileQuery)
  const { data: sec } = useSuspenseQuery(securityQuery)
  return (
    <Page>
      <PageHeader
        title={t("profile.title")}
        actions={
          <ButtonLink variant="outline" href="/api/me/export" download>
            <Download data-icon="inline-start" />
            {t("profile.export_data")}
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2 xl:items-start">
        <div className="flex flex-col gap-6">
          <PersonalSection />
          {sec.hasPassword && !data.oidcOnly ? <PasswordSection /> : null}
        </div>
        <div className="flex flex-col gap-6">
          <div id="mfa" className="scroll-mt-20">
            <MfaSection />
          </div>
          <PasskeysSection />
          <ProvidersSection />
        </div>
      </div>
      <SessionsSection />
      {data.apiKeysEnabled ? (
        <div id="tokens" className="scroll-mt-20">
          <ApiKeysSection />
        </div>
      ) : null}
      <LoginHistorySection />
    </Page>
  )
}
