import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Copy, KeyRound, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { Section } from "@/components/app/page"
import { RelativeTime } from "@/components/app/relative-time"
import { StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { FormRoot, useAppForm } from "@/components/form/form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { fmtDay } from "@/lib/format"
import { errorFields } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { API_KEY_DAYS, apiKeysQuery, createApiKey, deleteApiKey, type fetchApiKeys, securityQuery } from "./api"

type KeyRow = Awaited<ReturnType<typeof fetchApiKeys>>["keys"][number]
const col = tableHelper<KeyRow>()

function CreateKeyForm({
  scopes,
  needsPassword,
  onCreated,
}: {
  scopes: string[]
  needsPassword: boolean
  onCreated: (key: string) => void
}) {
  const { t, tError } = useI18n()
  const form = useAppForm({
    defaultValues: { name: "", scopes: ["time:read"] as string[], days: "90", password: "" },
    onSubmit: async ({ value, formApi }) => {
      const days = API_KEY_DAYS.find((d) => String(d) === value.days) ?? 90
      await createApiKey({ data: { name: value.name, scopes: value.scopes, days, password: value.password } }).then(
        (res) => onCreated(res.key),
        (err: unknown) => {
          const field = errorFields(err)?.password ? "password" : "name"
          formApi.setFieldMeta(field, (m) => ({
            ...m,
            isBlurred: true,
            errorMap: { ...m.errorMap, onServer: tError(err) },
          }))
        },
      )
    },
  })
  return (
    <form.AppForm>
      <FormRoot form={form}>
        <form.AppField name="name" validators={{ onBlur: z.string().trim().min(1, "common.required") }}>
          {(f) => <f.TextField label={t("common.name")} description={t("profile.key_name_help")} />}
        </form.AppField>
        <form.AppField name="scopes" validators={{ onChange: z.array(z.string()).min(1, "profile.scopes_required") }}>
          {(f) => (
            <FieldSet>
              <FieldLegend variant="label">{t("profile.scopes")}</FieldLegend>
              <div className="grid gap-2 sm:grid-cols-2">
                {scopes.map((s) => (
                  <Field key={s} orientation="horizontal">
                    <Checkbox
                      id={`scope-${s}`}
                      checked={f.state.value.includes(s)}
                      onCheckedChange={(on) =>
                        f.handleChange(on ? [...f.state.value, s] : f.state.value.filter((x) => x !== s))
                      }
                    />
                    <FieldLabel htmlFor={`scope-${s}`} className="font-normal">
                      {t(`profile.scope.${s.replace(":", "_")}`)}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              {f.state.meta.errors.length ? <FieldError>{t("profile.scopes_required")}</FieldError> : null}
            </FieldSet>
          )}
        </form.AppField>
        <form.AppField name="days">
          {(f) => (
            <f.SelectField
              label={t("profile.expiry")}
              options={API_KEY_DAYS.map((d) => ({
                value: String(d),
                label: t("profile.days", { count: d }),
              }))}
            />
          )}
        </form.AppField>
        {needsPassword ? (
          <form.AppField name="password" validators={{ onBlur: z.string().min(1, "common.required") }}>
            {(f) => <f.TextField label={t("common.your_password")} type="password" autoComplete="current-password" />}
          </form.AppField>
        ) : null}
        <DialogFooter>
          <form.SubmitButton>{t("profile.create_key")}</form.SubmitButton>
        </DialogFooter>
      </FormRoot>
    </form.AppForm>
  )
}

export function ApiKeysSection() {
  const { t, intl, tError } = useI18n()
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(apiKeysQuery)
  const { data: sec } = useSuspenseQuery(securityQuery)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", "api-keys"] })
  const columns = [
    col.accessor("name", {
      header: () => t("common.name"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.getValue()}</span>
          <span className="font-mono text-xs text-muted-foreground">{c.row.original.start}…</span>
        </span>
      ),
    }),
    col.accessor((r) => r.scopes.join(" "), {
      id: "scopes",
      header: () => t("profile.scopes"),
      enableSorting: false,
      meta: { mobileLabel: t("profile.scopes") },
      cell: (c) => (
        <span className="text-sm">
          {c.row.original.scopes.map((s) => t(`profile.scope.${s.replace(":", "_")}`)).join(", ")}
        </span>
      ),
    }),
    col.accessor((r) => r.lastUsedAt ?? "", {
      id: "used",
      header: () => t("profile.last_used"),
      meta: { mobileLabel: t("profile.last_used"), className: "text-muted-foreground whitespace-nowrap" },
      cell: (c) =>
        c.row.original.lastUsedAt ? <RelativeTime at={c.row.original.lastUsedAt} /> : t("profile.never_used"),
    }),
    col.accessor((r) => r.expiresAt ?? "", {
      id: "expires",
      header: () => t("profile.expires"),
      meta: { mobileLabel: t("profile.expires"), className: "whitespace-nowrap" },
      cell: (c) =>
        c.row.original.expired ? (
          <StatusBadge tone="neutral">{t("profile.expired")}</StatusBadge>
        ) : c.row.original.expiresAt ? (
          fmtDay(c.row.original.expiresAt.slice(0, 10), intl, { day: "numeric", month: "short", year: "numeric" })
        ) : (
          "–"
        ),
    }),
    col.display({
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      cell: (c) => (
        <Button
          variant="ghost"
          size="sm"
          intent="negative"
          onClick={async () => {
            try {
              await deleteApiKey({ data: { id: c.row.original.id } })
              toast.success(t("profile.key_revoked"))
            } catch (err) {
              toast.error(tError(err))
            }
            await refresh()
          }}
        >
          {t("profile.revoke")}
        </Button>
      ),
    }),
  ]
  return (
    <Section
      title={t("profile.api_keys")}
      actions={
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" />
          {t("profile.new_key")}
        </Button>
      }
    >
      <DataTable
        data={data.keys}
        columns={columns}
        getRowId={(r) => String(r.id)}
        caption={t("profile.api_keys")}
        empty={t("profile.no_keys")}
      />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setCreated(null)
            void refresh()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? t("profile.key_created") : t("profile.new_key")}</DialogTitle>
            {created ? <DialogDescription>{t("profile.key_once")}</DialogDescription> : null}
          </DialogHeader>
          {created ? (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <code className="min-w-0 flex-1 font-mono text-sm break-all select-all">{created}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.copy")}
                  onClick={async () => {
                    await navigator.clipboard.writeText(created)
                    toast.success(t("common.copied"))
                  }}
                >
                  <Copy />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>{t("common.close")}</Button>
              </DialogFooter>
            </>
          ) : (
            <CreateKeyForm scopes={data.scopes} needsPassword={sec.hasPassword} onCreated={setCreated} />
          )}
        </DialogContent>
      </Dialog>
    </Section>
  )
}
