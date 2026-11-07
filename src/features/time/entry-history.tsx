/**
 * Change history of one entry: who changed what, when and why. Changes by someone else are marked; the
 * owner can dispute them (the person who made the change is notified).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, MessageSquareWarning } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { ResponsiveDialog } from "@/components/app/responsive-dialog"
import { StatusBadge } from "@/components/app/status-badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { fmtDateTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import { cn } from "@/lib/utils"
import { disputeEntryFn, entryHistoryQuery } from "./api"
import type { Entry } from "./entry-dialog"

const FIELDS = ["kind", "start_at", "end_at", "note", "is_deleted"] as const
const HIDDEN_REASONS = new Set(["clock", "clock (offline sync: earlier time)"])

export function EntryHistoryDialog({
  open,
  onOpenChange,
  entry,
  tz,
  self,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: Entry | null
  tz: string
  self: boolean
}) {
  const disputeMessageId = useId()
  const { t, tError, intl } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const q = useQuery({ ...entryHistoryQuery(entry?.id ?? 0), enabled: open && entry != null })
  const [message, setMessage] = useState("")
  const [disputing, setDisputing] = useState(false)
  const hour12 = me.timeFormat === "12h"
  const fmt = (k: string, v: unknown) => {
    if (v == null || v === "") return "–"
    if (k === "is_deleted") return v ? t("common.yes") : t("common.no")
    const s = typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v)
    if (k === "start_at" || k === "end_at") return fmtDateTime(s, { intl, tz, hour12 })
    if (k === "kind") return t(`time.kind.${s}`)
    return s
  }
  const rows = q.data ?? []
  const ownerId = entry?.userId
  const byOther = rows.some((r) => r.actor && r.actor.id !== ownerId && r.action !== "dispute")

  const dispute = useMutation({
    mutationFn: (vars: { id: number; message: string }) => disputeEntryFn({ data: vars }),
    onSuccess: async (_, vars) => {
      toast.success(t("time.dispute_sent"))
      setMessage("")
      setDisputing(false)
      await qc.invalidateQueries({ queryKey: entryHistoryQuery(vars.id).queryKey })
    },
    onError: (err) => toast.error(tError(err)),
  })
  const busy = dispute.isPending

  const send = () => {
    if (!entry) return
    if (!message.trim()) {
      document.getElementById("dispute-message")?.focus()
      return
    }
    dispute.mutate({ id: entry.id, message: message.trim() })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setDisputing(false)
        onOpenChange(o)
      }}
      title={t("time.history_title")}
      footer={
        self && byOther && !disputing ? (
          <Button
            variant="outline"
            onClick={() => {
              setDisputing(true)
              requestAnimationFrame(() => document.getElementById("dispute-message")?.focus())
            }}
          >
            <MessageSquareWarning data-icon="inline-start" />
            {t("time.dispute")}
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("time.no_history")}</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r, i) => {
            const other = r.actor != null && r.actor.id !== ownerId
            const changed = r.action === "create" ? [] : FIELDS.filter((k) => r.changed.includes(k))
            return (
              <li key={r.id} className="relative flex gap-3 pb-5 last:pb-0">
                <span
                  className={cn(
                    "relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full",
                    r.action === "delete" ? "bg-destructive" : other ? "bg-warning" : "bg-work",
                  )}
                  aria-hidden
                />
                {i < rows.length - 1 ? (
                  <span className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border" aria-hidden />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{t(`time.action.${r.action}`)}</span>
                    {other ? <StatusBadge tone="warning">{t("time.by_other")}</StatusBadge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.actor?.name ?? t("common.unknown")} · {fmtDateTime(r.at, { intl, tz, hour12 })} ·{" "}
                    {t(`time.source.${r.source}`)}
                  </p>
                  {r.action === "create" && r.after ? (
                    <p className="tabular">
                      {fmt("kind", r.after.kind)} {fmt("start_at", r.after.start_at)}{" "}
                      <ArrowRight className="inline size-3.5 text-muted-foreground" aria-label="–" />{" "}
                      {fmt("end_at", r.after.end_at)}
                    </p>
                  ) : null}
                  {changed.map((k) => (
                    <p key={k} className="flex flex-wrap items-center gap-x-1.5 tabular">
                      <span className="text-muted-foreground">{t(`time.field.${k}`)}</span>
                      <del className="text-muted-foreground">{fmt(k, r.before?.[k])}</del>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-label="→" />
                      <ins className="no-underline">{fmt(k, r.after?.[k])}</ins>
                    </p>
                  ))}
                  {r.reason && !HIDDEN_REASONS.has(r.reason) ? <p className="text-pretty">“{r.reason}”</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {disputing ? (
        <form
          className="mt-5 flex flex-col gap-3 border-t pt-5"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <Field>
            <FieldLabel htmlFor={disputeMessageId}>{t("time.dispute")}</FieldLabel>
            <Textarea
              id={disputeMessageId}
              rows={3}
              maxLength={500}
              value={message}
              placeholder={t("time.dispute_placeholder")}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDisputing(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {t("time.send_dispute")}
            </Button>
          </div>
        </form>
      ) : null}
    </ResponsiveDialog>
  )
}
