import { beforeEach, describe, expect, it } from "vitest"
import { LOCALE_CODES } from "@/lib/locales"
import { MAIL_KINDS } from "../mail/render"
import { de, en, fr, it as itStrings } from "../mail/strings"
import { buildMail, clearMailOutbox, mailOutbox, maskEmail, queueMail } from "./mail"

const VARS = {
  url: "http://localhost:3210/invite#token=abc",
  days: 3,
  minutes: 120,
  actorName: "Lea Lead",
  requesterName: "Max Muster",
  newEmail: "new@example.nomail",
  action: "update",
  date: "2026-11-02",
  start: "2026-11-02",
  end: "2026-11-04",
  typeKey: "vacation",
  note: "Bitte <b>prüfen</b>",
  reason: "Forgot to clock out",
  message: "That was correct",
  since: "2026-11-06T06:30:00.000000Z",
  hours: 10,
  month: "2026-10",
  allowsAttachments: true,
}

beforeEach(() => clearMailOutbox())

const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()

describe("mail templates", () => {
  for (const locale of LOCALE_CODES) {
    for (const kind of MAIL_KINDS) {
      it(`renders ${kind} in ${locale}`, () => {
        const m = buildMail({ email: "anna@example.nomail", name: "Anna", locale }, kind, VARS)
        expect(m.subject.length).toBeGreaterThan(3)
        expect(m.subject).not.toMatch(/\{\w+\}/)
        expect(m.text).toContain("Anna")
        expect(m.text).not.toMatch(/\{\w+\}/)
        expect(m.html).toContain(`lang="${locale}"`)
        // no remote resources: images only from the CID attachment, no stylesheets or scripts
        expect(m.html).not.toMatch(/<(img|script|link|iframe)[^>]+(src|href)="https?:/i)
        expect(m.html).not.toMatch(/url\(/i)
        expect(m.html).not.toContain("<b>")
        expect(m.logo).not.toBeNull()
      })
    }
  }

  it("has the same keys and placeholders in every locale", () => {
    for (const other of [de, fr, itStrings]) {
      expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort())
      for (const k of Object.keys(en) as (keyof typeof en)[]) expect([k, ph(other[k])]).toEqual([k, ph(en[k])])
    }
  })

  it("translates absence types and formats dates per locale", () => {
    const m = buildMail({ email: "a@example.nomail", name: "A", locale: "de" }, "absence_approved", VARS)
    expect(m.subject).toBe("Ferien bewilligt")
    expect(m.text).toContain("2. November 2026")
    expect(m.text).toContain("3 Arbeitstage")
  })

  it("writes Italian mails with Swiss Italian dates", () => {
    const m = buildMail({ email: "a@example.nomail", name: "A", locale: "it" }, "absence_approved", VARS)
    expect(m.subject).toContain("approvat")
    expect(m.text).toContain("Ciao A")
    expect(m.text).toContain("novembre 2026")
  })

  it("queues into the test outbox and never throws on bad input", () => {
    queueMail({ email: "a@example.nomail", name: "A", locale: "en" }, "test")
    queueMail({ email: "a@example.nomail", name: "A", locale: "en" }, "no_such_kind")
    expect(mailOutbox().map((m) => m.kind)).toEqual(["test"])
  })

  it("masks addresses for logs", () => {
    expect(maskEmail("anna.meier@example.com")).toBe("an***@example.com")
  })
})
