import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "@/server/env"
import type { AppError } from "@/server/errors"
import { loadActor, makeOrg } from "@/test/factories"
import { absenceHistory, createAbsence, getAbsenceDto } from "./absences"
import { addAttachment, deleteAttachment, getAttachmentFile, safeFilename, sniffType } from "./attachments"
import { listNotifications } from "./notifications"

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 64 }, () => 0)])
const dir = mkdtempSync(path.join(tmpdir(), "rt-attachments-"))
const original = { dir: env.attachmentsDir, max: env.attachmentMaxMb }

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error("expected an error")
}

let org: ReturnType<typeof makeOrg>
let sickId: number
beforeEach(() => {
  env.attachmentsDir = dir
  env.attachmentMaxMb = original.max
  org = makeOrg()
  sickId = createAbsence(loadActor(org.anna.id), { type: "sick", startDate: "2026-11-05" }).id
})
afterAll(() => {
  env.attachmentsDir = original.dir
  rmSync(dir, { recursive: true, force: true })
})

const enc = (s: string) => new TextEncoder().encode(s)

describe("attachments", () => {
  it("stores the file under a random name and lets only the person, leads and HR read it", () => {
    const att = addAttachment(loadActor(org.anna.id), sickId, { filename: "arztzeugnis.pdf", data: PDF })
    expect(att.contentType).toBe("application/pdf")
    expect(att.filename).toBe("arztzeugnis.pdf")
    expect(att.storageName).toMatch(/^[0-9a-f]{32}$/)
    expect(readdirSync(dir)).toContain(att.storageName)
    const { file } = getAttachmentFile(loadActor(org.anna.id), att.id)
    expect(new Uint8Array(readFileSync(file))).toEqual(PDF)
    expect(getAttachmentFile(loadActor(org.lead.id), att.id).attachment.id).toBe(att.id)
    expect(getAttachmentFile(loadActor(org.hr!.id), att.id).attachment.id).toBe(att.id)
    expect(err(() => getAttachmentFile(loadActor(org.ben.id), att.id)).code).toBe("not_found")
    expect(err(() => getAttachmentFile(loadActor(org.admin.id), att.id)).code).toBe("not_found")
    expect(err(() => addAttachment(loadActor(org.ben.id), sickId, { filename: "x.pdf", data: PDF })).code).toBe(
      "not_found",
    )
  })

  it("a lead adds a scan, the person is notified; deletes are soft and logged", () => {
    const own = addAttachment(loadActor(org.anna.id), sickId, { filename: "a.pdf", data: PDF })
    const scan = addAttachment(loadActor(org.lead.id), sickId, { filename: "scan.png", data: PNG })
    expect(scan.contentType).toBe("image/png")
    expect(listNotifications(org.anna.id).map((n) => n.kind)).toContain("attachment_added")
    expect(getAbsenceDto(loadActor(org.anna.id), sickId).attachments).toHaveLength(2)
    expect(err(() => deleteAttachment(loadActor(org.ben.id), own.id)).code).toBe("not_found")
    deleteAttachment(loadActor(org.anna.id), own.id)
    expect(getAbsenceDto(loadActor(org.anna.id), sickId).attachments.map((a) => a.id)).toEqual([scan.id])
    expect(err(() => getAttachmentFile(loadActor(org.anna.id), own.id)).code).toBe("not_found")
    expect(readdirSync(dir)).toContain(own.storageName)
    const hist = absenceHistory(loadActor(org.anna.id), sickId).map((h) => `${h.entity}:${h.action}`)
    expect(hist).toEqual(["absence:create", "attachment:create", "attachment:create", "attachment:delete"])
  })

  it("rejects wrong content, empty and oversized files and types without documents", () => {
    const anna = loadActor(org.anna.id)
    const evil = new TextEncoder().encode("MZ\x90\x00evil")
    expect(err(() => addAttachment(anna, sickId, { filename: "note.pdf", data: evil })).fields).toEqual({
      file: "type",
    })
    expect(err(() => addAttachment(anna, sickId, { filename: "empty.pdf", data: new Uint8Array() })).fields).toEqual({
      file: "empty",
    })
    env.attachmentMaxMb = 1
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(PDF)
    expect(err(() => addAttachment(anna, sickId, { filename: "big.pdf", data: big })).fields).toEqual({
      file: "too_large",
    })
    const v = createAbsence(anna, { type: "vacation", startDate: "2026-12-14" })
    expect(err(() => addAttachment(anna, v.id, { filename: "x.pdf", data: PDF })).fields).toEqual({
      file: "not_allowed",
    })
  })

  it("sanitises file names", () => {
    const att = addAttachment(loadActor(org.anna.id), sickId, { filename: "../../etc/passwd.pdf", data: PDF })
    expect(att.filename).not.toContain("/")
    expect(att.filename).not.toContain("..")
    expect(safeFilename("Arztzeugnis Müller (1).pdf")).toBe("Arztzeugnis_Muller_1.pdf")
    expect(safeFilename("...")).toBe("")
    expect(addAttachment(loadActor(org.anna.id), sickId, { filename: "😀", data: PDF }).filename).toBe("attachment.pdf")
  })

  it("sniffs WebP and HEIC", () => {
    expect(sniffType(enc("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(sniffType(enc("RIFF\0\0\0\0WAVEfmt "))).toBeNull()
    expect(sniffType(enc("\0\0\0\x18ftypheic\0\0"))).toBe("image/heic")
    expect(sniffType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  })
})
