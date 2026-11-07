import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { zipSync } from "fflate"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeAdmin, makeUser } from "@/test/factories"
import { openSqlite, runMigrations, setDatabase } from "../db"
import { env } from "../env"
import { encryptBuffer } from "./backup-crypto"
import {
  createBackup,
  deleteBackup,
  listBackups,
  openBackup,
  restoreBackup,
  rotateBackups,
  V1BackupError,
} from "./backups"
import { loadActor } from "./permissions"

let dir: string
const saved = { ...env }

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rt-backups-"))
  Object.assign(env, {
    dataDir: dir,
    backupsDir: path.join(dir, "backups"),
    attachmentsDir: path.join(dir, "attachments"),
    brandingDir: path.join(dir, "branding"),
    backupPassword: "test-backup-password",
  })
})
afterEach(() => {
  Object.assign(env, saved)
  rmSync(dir, { recursive: true, force: true })
})

describe("backups", () => {
  it("creates an encrypted backup that restores into a fresh database", async () => {
    makeUser({ name: "Anna Muster" })
    mkdirSync(env.brandingDir, { recursive: true })
    writeFileSync(path.join(env.brandingDir, "logo-dark.svg"), "<svg/>")
    const info = await createBackup({ label: "manual" })
    expect(info.name).toMatch(/^resorixtrack-\d{8}-\d{6}-manual\.zip\.enc$/)
    const file = path.join(env.backupsDir, info.name)
    expect(readFileSync(file).subarray(0, 4).toString()).toBe("RTBK")
    expect(readFileSync(file).includes(Buffer.from("Anna Muster"))).toBe(false)

    const opened = await openBackup(file, env.backupPassword)
    expect(opened.manifest.format).toBe(3)
    expect(Object.keys(opened.manifest.files)).toContain("branding/logo-dark.svg")

    const target = path.join(dir, "restore", "resorixtrack.db")
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, "")
    new Database(target).close()
    const r = restoreBackup(opened, { databasePath: target, dataDir: path.join(dir, "restore") })
    expect(r.safetyCopy).toBeTruthy()
    const restored = new Database(target, { readonly: true })
    expect(restored.prepare("SELECT name FROM users").all()).toEqual([{ name: "Anna Muster" }])
    restored.close()
    expect(existsSync(path.join(dir, "restore", "branding", "logo-dark.svg"))).toBe(true)
  })

  it("restores a backup taken from a file database in WAL mode", async () => {
    const sqlite = openSqlite(path.join(dir, "live.db"))
    runMigrations(setDatabase(sqlite))
    makeUser({ name: "Walter Wal" })
    const info = await createBackup()
    const opened = await openBackup(path.join(env.backupsDir, info.name), env.backupPassword)
    const target = path.join(dir, "restored", "resorixtrack.db")
    restoreBackup(opened, { databasePath: target, dataDir: path.join(dir, "restored") })
    const restored = new Database(target, { readonly: true })
    expect(restored.prepare("SELECT name FROM users").all()).toEqual([{ name: "Walter Wal" }])
    restored.close()
    sqlite.close()
  })

  it("refuses a wrong password", async () => {
    const info = await createBackup()
    await expect(openBackup(path.join(env.backupsDir, info.name), "another-password")).rejects.toThrow(
      /Wrong backup password/,
    )
  })

  it("detects a v1 backup and extracts it for import-v1", async () => {
    const v1zip = zipSync({
      "resorixtrack.db": Buffer.from("sqlite"),
      "manifest.json": Buffer.from(
        JSON.stringify({ app: "resorixtrack", version: "1.0.0", format: 2, encrypted: "RTBK1" }),
      ),
      "attachments/0123456789abcdef0123456789abcdef": Buffer.from("pdf"),
    })
    const file = path.join(dir, "resorixtrack-20260101-020000-auto.zip.enc")
    writeFileSync(file, await encryptBuffer(v1zip, env.backupPassword))
    const err = await openBackup(file, env.backupPassword).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(V1BackupError)
    const out = (err as V1BackupError).extractedTo
    expect(readFileSync(path.join(out, "resorixtrack.db"), "utf8")).toBe("sqlite")
    expect(existsSync(path.join(out, "attachments", "0123456789abcdef0123456789abcdef"))).toBe(true)
    rmSync(out, { recursive: true, force: true })
  })

  it("lists, rotates and deletes (administrators only)", async () => {
    const admin = loadActor(makeAdmin().id)
    const emp = loadActor(makeUser().id)
    mkdirSync(env.backupsDir, { recursive: true })
    for (const d of ["20260101", "20260102", "20260103"]) {
      const f = path.join(env.backupsDir, `resorixtrack-${d}-020000-auto.zip.enc`)
      writeFileSync(f, "x")
      utimesSync(f, new Date(), new Date())
    }
    writeFileSync(path.join(env.backupsDir, "resorixtrack-20251231-120000.zip.enc"), "x")
    writeFileSync(path.join(env.backupsDir, "evil.txt"), "x")
    expect(() => listBackups(emp)).toThrow(/Administrators only/)
    expect(listBackups(admin).map((b) => b.name)).toHaveLength(4)
    expect(rotateBackups(2)).toBe(1)
    expect(listBackups(admin).map((b) => b.kind)).toEqual(["auto", "auto", "manual"])
    expect(() => deleteBackup(admin, "../evil.txt")).toThrow(/not found/)
    deleteBackup(admin, "resorixtrack-20251231-120000.zip.enc")
    expect(listBackups(admin)).toHaveLength(2)
  })
})
