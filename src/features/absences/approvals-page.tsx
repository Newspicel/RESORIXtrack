/**
 * Approval inbox: the requests the signed-in person decides, with the vacation left after approving and
 * who else from the team is away. Approve is optimistic (no undo: the person is notified at once);
 * decline asks for an optional note. Several requests can be decided at once.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { Check, History, Inbox, X } from "lucide-react"
import { startTransition, useOptimistic, useState } from "react"
import { toast } from "sonner"
import { Page, PageHeader, Section } from "@/components/app/page"
import { AbsenceStatusBadge, ColorDot, StatusBadge } from "@/components/app/status-badge"
import { DataTable } from "@/components/data/data-table"
import { tableHelper } from "@/components/data/table-helper"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { approvalsQuery } from "@/features/team/api"
import { fmtDateTime, fmtDays } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useMe } from "@/lib/session"
import type { AbsenceDto } from "@/server/services/absences"
import type { PendingApproval } from "@/server/services/approvals"
import { AbsenceSheet, RejectDialog } from "./absence-sheet"
import { absenceOverviewQuery, decideAbsenceFn } from "./api"
import { useRefreshAbsences } from "./hooks"
import { formatSpan } from "./lib"
import { type RequestMode, RequestSheet } from "./request-sheet"

const col = tableHelper<PendingApproval>()

const upcomingCol = tableHelper<AbsenceDto>()

/** One at a time: stops at the first failure so the toast can say how many were decided. */
async function decideEach(ids: number[], approve: boolean, note: string): Promise<{ done: number; error: unknown }> {
  let done = 0
  try {
    for (const id of ids) {
      // sequential on purpose, see above
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await decideAbsenceFn({ data: { id, approve, note } }) // oxlint-disable-line eslint/no-await-in-loop
      done++
    }
    return { done, error: null }
  } catch (error) {
    return { done, error }
  }
}

/**
 * Decides requests optimistically: they leave the inbox at once (`hide`), the server decides them one by one,
 * and the inbox is refetched when the Action settles. On a failure the optimistic state falls back to the
 * refetched list, so undecided requests reappear.
 */
function useDecide(hide: (ids: number[]) => void) {
  const refresh = useRefreshAbsences()
  const { t, tError } = useI18n()
  return (ids: number[], approve: boolean, note = "") =>
    startTransition(async () => {
      hide(ids)
      const { done, error } = await decideEach(ids, approve, note)
      if (error) toast.error(tError(error))
      else if (ids.length > 1) toast.success(t("absences.approvals.decided_n", { count: done }))
      else toast.success(approve ? t("absences.approvals.approved_toast") : t("absences.approvals.rejected_toast"))
      await refresh()
    })
}

/** A period that may wrap, but only after the dash, never inside a date. */
function SpanText({ text }: { text: string }) {
  const [from, to] = text.split(" – ")
  if (!to) return <span className="whitespace-nowrap">{text}</span>
  return (
    <span>
      <span className="whitespace-nowrap">{from} –</span> <span className="whitespace-nowrap">{to}</span>
    </span>
  )
}

export function ApprovalsPage() {
  const i = useI18n()
  const { t, absenceLabel } = i
  const me = useMe()
  const { data } = useSuspenseQuery(approvalsQuery)
  const overview = useSuspenseQuery(absenceOverviewQuery()).data
  const [pending, hide] = useOptimistic(data.pending, (list, ids: number[]) => {
    const decided = new Set(ids)
    return list.filter((p) => !decided.has(p.id))
  })
  const decide = useDecide(hide)
  const [selected, setSelected] = useState<string[]>([])
  const [rejecting, setRejecting] = useState<number[] | null>(null)
  const [detail, setDetail] = useState<AbsenceDto | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [edit, setEdit] = useState<RequestMode | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const pendingIds = new Set(pending.map((p) => p.id))
  const chosen = selected.map(Number).filter((id) => pendingIds.has(id))

  const columns = [
    col.accessor((a) => a.user.name, {
      id: "person",
      header: () => t("absences.approvals.person"),
      meta: { primary: true },
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.getValue()}</span>
          <span className="text-xs font-normal whitespace-nowrap text-muted-foreground">
            {t("absences.approvals.requested_at", {
              when: fmtDateTime(c.row.original.createdAt, {
                intl: i.intl,
                tz: me.timezone,
                hour12: me.timeFormat === "12h",
              }),
            })}
          </span>
        </span>
      ),
    }),
    col.accessor((a) => absenceLabel(a.type), {
      id: "type",
      header: () => t("absences.type"),
      meta: { mobileLabel: t("absences.type") },
      cell: (c) => (
        <span className="flex items-center gap-2">
          <ColorDot color={c.row.original.type.color} />
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor("startDate", {
      header: () => t("absences.period"),
      meta: { mobileLabel: t("absences.period") },
      cell: (c) => {
        const a = c.row.original
        return (
          <span className="flex flex-col">
            <SpanText text={formatSpan(a, i, { today: overview.today })} />
            <span className="text-xs text-muted-foreground tabular">
              {t("absences.n_days", { count: a.days, n: fmtDays(a.days) })}
            </span>
            {a.note ? (
              <span className="max-w-72 truncate text-xs text-muted-foreground" title={a.note}>
                “{a.note}”
              </span>
            ) : null}
          </span>
        )
      },
    }),
    col.accessor("vacationAfter", {
      header: () => t("absences.approvals.vacation_left"),
      meta: { numeric: true, mobileLabel: t("absences.approvals.vacation_left") },
      cell: (c) => {
        const v = c.getValue()
        if (v == null) return <span className="text-muted-foreground">–</span>
        return v < 0 ? (
          <StatusBadge tone="negative" icon="warning">
            {fmtDays(v)} · {t("absences.approvals.exceeds")}
          </StatusBadge>
        ) : (
          fmtDays(v)
        )
      },
    }),
    col.accessor((a) => a.overlaps.length, {
      id: "overlaps",
      header: () => t("absences.approvals.overlaps"),
      meta: { mobileLabel: t("absences.approvals.overlaps") },
      cell: (c) => {
        const list = c.row.original.overlaps
        if (!list.length) return <span className="text-muted-foreground">{t("absences.approvals.no_overlap")}</span>
        return (
          <ul className="flex flex-col gap-0.5 text-xs whitespace-normal">
            {list.map((o, n) => (
              // overlaps carry no absence id; one person can overlap more than once
              // oxlint-disable-next-line react/no-array-index-key
              <li key={`${o.userId}-${n}`} className="flex items-center gap-1.5">
                <ColorDot color={o.color} className="size-2" />
                <span>
                  {o.name} ·{" "}
                  {o.typeKey === "absent"
                    ? t("absences.team.absent")
                    : absenceLabel({ key: o.typeKey, label: o.label })}{" "}
                  · <span className="tabular">{t("absences.n_days", { count: o.days, n: fmtDays(o.days) })}</span>
                  {o.status === "pending" ? (
                    <span className="text-muted-foreground"> ({t("absences.status.pending")})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )
      },
    }),
    col.display({
      id: "actions",
      header: () => <span className="sr-only">{t("common.actions")}</span>,
      meta: { numeric: true },
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" intent="positive" onClick={() => decide([c.row.original.id], true)}>
            <Check data-icon="inline-start" />
            {t("absences.approvals.approve")}
          </Button>
          <Button size="sm" variant="ghost" intent="negative" onClick={() => setRejecting([c.row.original.id])}>
            <X data-icon="inline-start" />
            {t("absences.approvals.reject")}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("absences.history")}
            title={t("absences.history")}
            onClick={() => {
              setDetail(c.row.original)
              setDetailOpen(true)
            }}
          >
            <History />
          </Button>
        </div>
      ),
    }),
  ]

  const upcomingColumns = [
    upcomingCol.accessor((a) => a.user.name, {
      id: "person",
      header: () => t("absences.approvals.person"),
      meta: { primary: true },
    }),
    upcomingCol.accessor((a) => absenceLabel(a.type), {
      id: "type",
      header: () => t("absences.type"),
      meta: { mobileLabel: t("absences.type") },
      cell: (c) => (
        <span className="flex items-center gap-2">
          <ColorDot color={c.row.original.type.color} />
          {c.getValue()}
        </span>
      ),
    }),
    upcomingCol.accessor("startDate", {
      header: () => t("absences.period"),
      meta: { mobileLabel: t("absences.period") },
      cell: (c) => (
        <span className="whitespace-normal md:whitespace-nowrap">
          {formatSpan(c.row.original, i, { today: overview.today })}
        </span>
      ),
    }),
    upcomingCol.accessor("days", {
      header: () => t("absences.days"),
      meta: { numeric: true, mobileLabel: t("absences.days") },
      cell: (c) => fmtDays(c.getValue()),
    }),
    upcomingCol.accessor("status", {
      header: () => t("common.status"),
      meta: { mobileLabel: t("common.status") },
      cell: (c) => <AbsenceStatusBadge status={c.getValue()} label={t(`absences.status.${c.getValue()}`)} />,
    }),
  ]

  return (
    <Page>
      <PageHeader title={t("absences.approvals.title")} />
      <Section>
        {pending.length ? (
          <DataTable
            data={pending}
            columns={columns}
            getRowId={(a) => String(a.id)}
            selectable
            onSelectionChange={setSelected}
            caption={t("absences.approvals.title")}
            toolbar={
              chosen.length ? (
                <>
                  <span className="text-sm text-muted-foreground tabular">{chosen.length}</span>
                  <Button variant="outline" intent="negative" onClick={() => setRejecting(chosen)}>
                    <X data-icon="inline-start" />
                    {t("absences.approvals.reject_n", { count: chosen.length })}
                  </Button>
                  <Button onClick={() => decide(chosen, true)}>
                    <Check data-icon="inline-start" />
                    {t("absences.approvals.approve_n", { count: chosen.length })}
                  </Button>
                </>
              ) : null
            }
          />
        ) : (
          <Empty className="rounded-xl border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle className="text-base font-medium">{t("absences.approvals.empty")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </Section>

      {me.isManager ? (
        <Section title={t("absences.approvals.upcoming")}>
          <DataTable
            data={data.upcoming}
            columns={upcomingColumns}
            getRowId={(a) => String(a.id)}
            search={data.upcoming.length > 10}
            pageSize={25}
            onRowClick={(a) => {
              setDetail(a)
              setDetailOpen(true)
            }}
            caption={t("absences.approvals.upcoming")}
            empty={t("absences.approvals.upcoming_empty")}
          />
        </Section>
      ) : null}

      <RejectDialog
        ids={rejecting}
        onClose={() => setRejecting(null)}
        onReject={(note) => {
          const ids = rejecting ?? []
          setRejecting(null)
          decide(ids, false, note)
        }}
      />
      <AbsenceSheet
        absence={detail}
        vacationLeftAfter={
          detail && "vacationAfter" in detail && typeof detail.vacationAfter === "number" ? detail.vacationAfter : null
        }
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={(a) => {
          setDetailOpen(false)
          setEdit({ kind: "edit", absence: a })
          setEditOpen(true)
        }}
      />
      {edit?.kind === "edit" ? (
        <RequestSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          mode={edit}
          ctx={{
            today: overview.today,
            sickBackdateDays: overview.sickBackdateDays,
            sickMaxDays: overview.sickMaxDays,
            userId: edit.absence.user.id,
            self: edit.absence.user.id === me.id,
          }}
        />
      ) : null}
    </Page>
  )
}
