import { useQueryClient } from "@tanstack/react-query"
import { RotateCcw, Trash2, Upload } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { Button } from "@/components/ui/button"
import { ColorPicker } from "@/components/ui/color-picker"
import { Spinner } from "@/components/ui/spinner"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { brandingInfo } from "@/server/services/admin-settings"
import { deleteLogoFn, setAccentFn, uploadLogoFn } from "../api/settings"
import { useAction } from "../ui"

type Branding = ReturnType<typeof brandingInfo>
const MAX_BYTES = 1024 * 1024

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.addEventListener("load", () => resolve(typeof r.result === "string" ? (r.result.split(",")[1] ?? "") : ""))
    r.addEventListener("error", () => reject(r.error))
    r.readAsDataURL(file)
  })
}

export function BrandingSection({ branding }: { branding: Branding }) {
  const { t } = useI18n()
  return (
    <>
      <Section title={t("admin.branding.logos")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <LogoTile variant="dark" info={branding.logos.dark} />
          <LogoTile variant="light" info={branding.logos.light} />
        </div>
      </Section>
      <AccentPicker accent={branding.accent} fallback={branding.defaultAccent} />
    </>
  )
}

function LogoTile({ variant, info }: { variant: "dark" | "light"; info: { custom: boolean; url: string } }) {
  const { t, tError } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const upload = useAction(
    async (file: File) => uploadLogoFn({ data: { variant, dataBase64: await toBase64(file) } }),
    {
      success: t("admin.branding.uploaded"),
      silentError: true,
      invalidate: [["admin", "settings"]],
    },
  )
  const remove = useAction(() => deleteLogoFn({ data: { variant } }), {
    success: t("admin.branding.removed"),
    invalidate: [["admin", "settings"]],
  })
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div
        className={cn("flex h-28 items-center justify-center p-6", variant === "dark" ? "bg-neutral-950" : "bg-white")}
      >
        <img src={info.url} alt={t(`admin.branding.logo_${variant}`)} className="max-h-14 max-w-full object-contain" />
      </div>
      <div className="flex items-center gap-2 border-t px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t(`admin.branding.logo_${variant}`)}</p>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <StatusBadge className="mt-1">
              {info.custom ? t("admin.branding.custom") : t("admin.branding.default")}
            </StatusBadge>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          // the Upload button is the accessible control; the native picker stays out of the a11y tree
          aria-hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (!file) return
            if (file.size > MAX_BYTES) return setError(t("admin.branding.too_large"))
            setError("")
            await upload.mutateAsync(file).catch((err: unknown) => setError(tError(err)))
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
          {t("admin.branding.upload")}
        </Button>
        {info.custom ? (
          <Button
            intent="negative"
            variant="ghost"
            size="icon"
            onClick={() => remove.mutate(undefined)}
            aria-label={t("admin.branding.remove")}
            title={t("admin.branding.remove")}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Live preview: the page's --brand follows the picker until saved or left. */
function AccentPicker({ accent, fallback }: { accent: string; fallback: string }) {
  const accentLabelId = useId()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [value, setValue] = useState(accent || fallback)
  const save = useAction((v: string) => setAccentFn({ data: { accent: v } }), {
    success: t("admin.branding.saved"),
    invalidate: [["admin", "settings"], ["bootstrap"]],
  })
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--brand", value)
    return () => {
      root.style.removeProperty("--brand")
    }
  }, [value])
  const dirty = value.toLowerCase() !== (accent || fallback).toLowerCase()
  return (
    <Section title={<span id={accentLabelId}>{t("admin.branding.accent")}</span>}>
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:flex-row lg:items-center">
        <ColorPicker value={value} onChange={setValue} aria-labelledby={accentLabelId} />
        <div className="flex flex-1 flex-wrap items-center gap-3" aria-hidden>
          <span className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
            {t("admin.branding.sample_button")}
          </span>
          <span className="text-sm font-medium text-primary underline underline-offset-4">
            {t("admin.branding.sample_link")}
          </span>
          <StatusBadge tone="brand">{t("admin.branding.sample_badge")}</StatusBadge>
        </div>
        <div className="flex gap-2">
          {accent ? (
            <Button
              variant="ghost"
              onClick={() => {
                setValue(fallback)
                save.mutate("")
              }}
            >
              <RotateCcw data-icon="inline-start" />
              {t("admin.branding.reset")}
            </Button>
          ) : null}
          <Button
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || !/^#[0-9a-f]{6}$/.test(value) || save.isPending}
            onClick={() =>
              save.mutate(value === fallback ? "" : value, {
                onSuccess: () => qc.invalidateQueries({ queryKey: ["bootstrap"] }),
              })
            }
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Section>
  )
}
