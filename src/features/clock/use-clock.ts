/**
 * Clock state shared by the top bar, the mobile bar and the dashboard card.
 *
 * - Actions are optimistic: the state flips at once, the server answer replaces it.
 * - Offline (or a network error): the action is stored in IndexedDB with its click time and a client id,
 *   shown as pending, and replayed with `syncOfflineFn` when the connection returns. While anything is
 *   pending, later actions queue behind it so their order is kept.
 * - A rejected action (not a network problem) rolls back and shows the reason.
 */
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { clockActionFn, fetchClock, syncOfflineFn } from "@/features/time/api"
import { useI18n } from "@/lib/i18n"
import type { I18n } from "@/lib/i18n-core"
import { useBootstrap, useMe } from "@/lib/session"
import type { ClockAction, ClockStateName } from "@/server/services/clock"
import { enqueue, isNetworkError, onQueueChange, type QueuedAction, queued, remove } from "./offline-queue"

export type LiveClock = Awaited<ReturnType<typeof fetchClock>> & { receivedAt: number }

export const liveClockQuery = () =>
  queryOptions({
    queryKey: ["clock", "live"],
    queryFn: async (): Promise<LiveClock> => ({ ...(await fetchClock()), receivedAt: Date.now() }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })

const NEXT: Record<ClockAction, ClockStateName> = {
  start: "working",
  resume: "working",
  break: "on_break",
  stop: "idle",
}

/** The primary action for a state: clock in, clock out, or end the break. */
export function primaryAction(state: ClockStateName): ClockAction {
  return state === "idle" ? "start" : state === "working" ? "stop" : "resume"
}

/** `now` 0 (SSR, hydration) means "as received": the figures the server rendered. */
const atTime = (c: LiveClock, now: number) => (now > 0 ? now : c.receivedAt)

/** Server time estimate: the server clock at `receivedAt` plus elapsed local time. */
const serverNow = (c: LiveClock, now: number) => Date.parse(c.serverTime) + (atTime(c, now) - c.receivedAt)

/** Minutes worked today, ticking while working. */
export function liveWorkedMin(c: LiveClock, now: number): number {
  return c.todayWorkedMin + (c.state === "working" ? Math.max(0, atTime(c, now) - c.receivedAt) / 60000 : 0)
}

export function liveBreakMin(c: LiveClock, now: number): number {
  return c.todayBreakMin + (c.state === "on_break" ? Math.max(0, atTime(c, now) - c.receivedAt) / 60000 : 0)
}

/** Seconds since the current state started (0 when idle). */
export function liveSinceSec(c: LiveClock, now: number): number {
  return c.since ? Math.max(0, (serverNow(c, now) - Date.parse(c.since)) / 1000) : 0
}

/** Clock state after the queued actions, applied on top of the last server state. */
function withPending(c: LiveClock, pending: QueuedAction[]): LiveClock {
  if (!pending.length) return c
  let out = c
  for (const p of pending) out = advance(out, p.action, p.at, Date.parse(p.at))
  return out
}

function advance(c: LiveClock, action: ClockAction, at: string, now: number): LiveClock {
  const state = NEXT[action]
  const t = Math.min(now, c.receivedAt + 24 * 3600_000)
  return {
    ...c,
    state,
    since: state === "idle" ? null : at,
    entry: null,
    todayWorkedMin: liveWorkedMin(c, t),
    todayBreakMin: liveBreakMin(c, t),
    serverTime: new Date(serverNow(c, t)).toISOString(),
    receivedAt: t,
  }
}

// ------------------------------------------------------------------ pending queue (shared)

let pendingSnapshot: QueuedAction[] = []
let pendingUser = 0
const pendingSubs = new Set<() => void>()
async function refreshPending() {
  pendingSnapshot = pendingUser ? await queued(pendingUser) : []
  for (const s of pendingSubs) s()
}
function subscribePending(cb: () => void) {
  pendingSubs.add(cb)
  const off = onQueueChange(() => void refreshPending())
  return () => {
    pendingSubs.delete(cb)
    off()
  }
}
const EMPTY: QueuedAction[] = []

function usePending(userId: number): QueuedAction[] {
  useEffect(() => {
    if (pendingUser !== userId) {
      pendingUser = userId
      void refreshPending()
    }
  }, [userId])
  return useSyncExternalStore(
    subscribePending,
    () => (pendingUser === userId ? pendingSnapshot : EMPTY),
    () => EMPTY,
  )
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb)
      window.addEventListener("offline", cb)
      return () => {
        window.removeEventListener("online", cb)
        window.removeEventListener("offline", cb)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}

let busy = false
let syncing: Promise<void> | null = null

interface ClockDeps {
  userId: number
  worklogMode: string
  qc: QueryClient
  t: I18n["t"]
  tError: I18n["tError"]
  navigate: ReturnType<typeof useNavigate>
}

function refreshTimeData(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["time"] })
  void qc.invalidateQueries({ queryKey: ["account"] })
  void qc.invalidateQueries({ queryKey: ["compliance"] })
}

function setServer(qc: QueryClient, state: Awaited<ReturnType<typeof fetchClock>>) {
  qc.setQueryData<LiveClock>(liveClockQuery().queryKey, { ...state, receivedAt: Date.now() })
}

async function replayQueue({ userId, qc, t, tError }: ClockDeps) {
  try {
    const items = await queued(userId)
    if (!items.length || !navigator.onLine) return
    const res = await syncOfflineFn({ data: { actions: items.map(({ id, action, at }) => ({ id, action, at })) } })
    await remove(res.results.map((r) => r.id))
    setServer(qc, res.clock)
    const rejected = res.results.filter((r) => r.status === "rejected").length
    if (rejected) toast.warning(t("clock.rejected", { count: rejected }))
    else toast.success(t("clock.synced"))
    refreshTimeData(qc)
  } catch (err) {
    if (!isNetworkError(err)) toast.error(tError(err))
  }
}

/** Replay queued actions; safe to call any time (one run at a time). */
function sync(deps: ClockDeps): Promise<void> {
  syncing ??= replayQueue(deps).finally(() => {
    syncing = null
  })
  return syncing
}

async function runAction(
  deps: ClockDeps,
  action: ClockAction,
  opts: { at?: string; custom?: boolean },
  setActing: (acting: boolean) => void,
) {
  const { userId, qc, t, tError } = deps
  const current = qc.getQueryData<LiveClock>(liveClockQuery().queryKey)
  if (busy || !current) return
  busy = true
  setActing(true)
  const clickAt = opts.at ?? new Date().toISOString()
  const queue = async () => {
    await enqueue({ userId, action, at: clickAt })
    toast.info(t("clock.queued_offline"))
  }
  try {
    if ((await queued(userId)).length || !navigator.onLine) {
      await queue()
      void sync(deps)
      return
    }
    qc.setQueryData<LiveClock>(liveClockQuery().queryKey, advance(current, action, clickAt, Date.now()))
    try {
      setServer(qc, await clockActionFn({ data: { action, at: opts.at ?? null, custom: Boolean(opts.custom) } }))
      refreshTimeData(qc)
      // clocking out is the moment to describe the day when the company requires a work log
      if (action === "stop" && deps.worklogMode === "required") {
        toast.info(t("worklog.clock_out_prompt"), {
          duration: 8000,
          action: {
            label: t("dashboard.worklog_add"),
            onClick: () => void deps.navigate({ to: "/time", hash: "worklog" }),
          },
        })
      }
    } catch (err) {
      qc.setQueryData(liveClockQuery().queryKey, current)
      if (isNetworkError(err)) {
        await queue()
      } else {
        toast.error(tError(err))
        void qc.invalidateQueries({ queryKey: liveClockQuery().queryKey })
      }
    }
  } finally {
    busy = false
    setActing(false)
  }
}

export function useClock() {
  const me = useMe()
  const worklogMode = useBootstrap().company.worklogMode
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { t, tError } = useI18n()
  const query = useQuery(liveClockQuery())
  const pending = usePending(me.id)
  const online = useOnline()
  const [acting, setActing] = useState(false)

  const data = query.data ? withPending(query.data, pending) : undefined
  const deps: ClockDeps = { userId: me.id, worklogMode, qc, t, tError, navigate }

  // replay on start and whenever the connection comes back
  const replay = useEffectEvent(() => void sync(deps))
  useEffect(() => {
    if (online && pending.length) replay()
  }, [online, pending.length])

  const act = (action: ClockAction, opts: { at?: string; custom?: boolean } = {}) =>
    runAction(deps, action, opts, setActing)

  return { data, pending: pending.length, online, acting, act, isLoading: query.isLoading }
}
