/**
 * Email (nodemailer). Templates per kind and locale (en/de/fr) live in `server/mail/`; branded HTML + plain
 * text, no remote resources (logo as CID attachment).
 * `queueMail` never throws and never blocks the request: call it AFTER the transaction committed (or pass
 * `opts.when`, re-checked right before sending). Delivery runs in-process with retries.
 * Kinds and their vars: see `MAIL_KINDS` in server/mail/render.ts.
 */
import { createTransport, type Transporter } from "nodemailer"
import { describeError, isOneOf } from "@/lib/guards"
import type { JsonObject } from "@/lib/json"
import { env, isTest } from "../env"
import { AppError } from "../errors"
import { emailLogo, MAIL_KINDS, type MailKind, type RenderedMail, renderMail } from "../mail/render"
import { getAllSettings } from "./settings"

export interface MailRecipient {
  email: string
  name: string
  locale: string
}

export interface OutgoingMail extends RenderedMail {
  to: string
  kind: MailKind
  logo: Buffer | null
}

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000]
const DEFAULT_ACCENT = "#35a1cc"

interface Job {
  mail: OutgoingMail
  attempt: number
  when?: () => boolean
}

interface MailState {
  queue: Job[]
  running: boolean
  outbox: OutgoingMail[]
  transport: Transporter | null
}

declare global {
  // survives dev-server module reloads, so queued mail and the SMTP connection are not lost
  var __rtMail: MailState | undefined
}
globalThis.__rtMail ??= { queue: [], running: false, outbox: [], transport: null }
const state = globalThis.__rtMail

/** `an***@example.com`: enough to correlate, without writing full addresses into logs. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  return `${(local ?? "").slice(0, 2)}***${domain ? `@${domain}` : ""}`
}

export function mailConfigured(): boolean {
  return Boolean(env.smtp.host)
}

export function buildMail(to: MailRecipient, kind: MailKind, vars: JsonObject = {}): OutgoingMail {
  const s = getAllSettings()
  const logo = emailLogo()
  const rendered = renderMail(kind, to.locale, to.name, vars, {
    company: s.company_name,
    accent: /^#[0-9a-f]{6}$/i.test(s.brand_accent) ? s.brand_accent : DEFAULT_ACCENT,
    baseUrl: env.baseUrl,
    hasLogo: logo != null,
  })
  return { ...rendered, to: to.email, kind, logo }
}

function transport(): Transporter {
  if (state.transport) return state.transport
  const { host, port, user, password, security, allowPlaintextAuth, timeoutSeconds } = env.smtp
  if (user && security === "none" && !allowPlaintextAuth)
    throw new Error(
      "Refusing to send the SMTP password over an unencrypted connection (set SMTP_SECURITY=starttls|ssl or SMTP_ALLOW_PLAINTEXT_AUTH=true)",
    )
  state.transport = createTransport({
    host,
    port,
    secure: security === "ssl",
    requireTLS: security === "starttls",
    ignoreTLS: security === "none",
    auth: user ? { user, pass: password } : undefined,
    connectionTimeout: timeoutSeconds * 1000,
    greetingTimeout: timeoutSeconds * 1000,
    socketTimeout: timeoutSeconds * 1000,
  })
  return state.transport
}

async function deliver(mail: OutgoingMail): Promise<void> {
  await transport().sendMail({
    from: env.smtp.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.logo ? [{ filename: "logo.png", content: mail.logo, contentType: "image/png", cid: "logo" }] : [],
  })
}

function safeCheck(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return false
  }
}

function nextJob(): Job | undefined {
  let job = state.queue.shift()
  while (job?.when && !safeCheck(job.when)) job = state.queue.shift()
  return job
}

async function attempt(job: Job): Promise<void> {
  try {
    await deliver(job.mail)
  } catch (err) {
    const delay = RETRY_DELAYS_MS[job.attempt]
    console.error(
      `[mail] ${job.mail.kind} to ${maskEmail(job.mail.to)} failed (attempt ${job.attempt + 1}): ${describeError(err)}`,
    )
    if (delay != null) {
      const retry = { ...job, attempt: job.attempt + 1 }
      setTimeout(() => {
        state.queue.push(retry)
        void drain()
      }, delay).unref()
    }
  }
}

/** Deliver queued mail one at a time, in queue order, over the single SMTP connection. */
async function drain(): Promise<void> {
  if (state.running) return
  const job = nextJob()
  if (!job) return
  state.running = true
  try {
    await attempt(job)
  } finally {
    state.running = false
  }
  await drain()
}

/**
 * Queue an email. Never throws. `opts.when` is evaluated right before sending (e.g. "the invite token still
 * exists"), so a mail queued inside a transaction that later rolled back is dropped.
 */
export function queueMail(
  to: MailRecipient,
  kind: string,
  vars: JsonObject = {},
  opts: { when?: () => boolean } = {},
): void {
  try {
    if (!isOneOf(MAIL_KINDS, kind)) throw new Error(`unknown mail kind ${kind}`)
    if (!to.email) return
    const mail = buildMail(to, kind, vars)
    if (isTest) {
      state.outbox.push(mail)
      return
    }
    if (!mailConfigured()) {
      console.warn(`[mail] SMTP_HOST not configured; dropping ${kind} to ${maskEmail(to.email)}`)
      return
    }
    state.queue.push({ mail, attempt: 0, when: opts.when })
    setImmediate(() => void drain())
  } catch (err) {
    console.error(`[mail] could not queue ${kind} to ${maskEmail(to.email)}: ${describeError(err)}`)
  }
}

/** Send a test email now (admin SMTP test). Throws `smtp_not_configured` / `smtp_failed` with the server's reason. */
export async function sendTestMail(to: MailRecipient | string): Promise<void> {
  const recipient = typeof to === "string" ? { email: to, name: to, locale: getAllSettings().default_locale } : to
  const mail = buildMail(recipient, "test")
  if (isTest) {
    state.outbox.push(mail)
    return
  }
  if (!mailConfigured()) throw new AppError("SMTP is not configured", { code: "smtp_not_configured", status: 409 })
  try {
    await deliver(mail)
  } catch (err) {
    state.transport = null
    throw new AppError(`Sending failed: ${describeError(err)}`, { code: "smtp_failed", status: 502 })
  }
}

/** Wait until every queued mail had its first delivery attempt (CLI commands exit right afterwards). */
export async function flushMail(timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs
  // polling: each wait must finish before the queue is checked again
  // oxlint-disable-next-line eslint/no-await-in-loop
  while ((state.queue.length || state.running) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
}

/** Tests: mails "sent" so far (no SMTP in tests). */
export function mailOutbox(): OutgoingMail[] {
  return state.outbox
}

export function clearMailOutbox(): void {
  state.outbox.length = 0
}
