/**
 * Mail after commit. Services call `deferMail` inside the transaction; `withOutbox(() => tx(...))` sends the
 * collected mails only when the transaction committed and drops them when it threw. Outside `withOutbox`
 * (worker, CLI) mails are queued right away.
 */
import type { JsonObject } from "@/lib/json"
import { type MailRecipient, queueMail } from "./mail"

type Pending = { to: MailRecipient; kind: string; vars: JsonObject }
let pending: Pending[] | null = null

export function deferMail(to: MailRecipient, kind: string, vars: JsonObject = {}): void {
  if (pending) pending.push({ to, kind, vars })
  else queueMail(to, kind, vars)
}

export function withOutbox<T>(fn: () => T): T {
  const outer = pending
  const mine: Pending[] = []
  pending = mine
  try {
    const result = fn()
    pending = outer
    if (outer) outer.push(...mine)
    else for (const m of mine) queueMail(m.to, m.kind, m.vars)
    return result
  } catch (err) {
    pending = outer
    throw err
  }
}
