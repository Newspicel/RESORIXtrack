import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  BackupCryptoError,
  buildHeader,
  decryptBuffer,
  decryptFileToBuffer,
  encryptBuffer,
  MAGIC,
} from "./backup-crypto"

const PW = "correct horse battery staple"

describe("RTBK1 backup encryption", () => {
  it.each([0, 1, 1000, 4096, 4097, 10_000])("round-trips %i bytes (4 KiB chunks)", async (size) => {
    const plain = Buffer.alloc(size, 7)
    for (let i = 0; i < size; i++) plain[i] = (i * 31) % 251
    const enc = await encryptBuffer(plain, PW, 4096)
    expect(enc.subarray(0, 5).equals(MAGIC)).toBe(true)
    expect((await decryptBuffer(enc, PW)).equals(plain)).toBe(true)
  })

  it("writes the v1 header byte for byte", () => {
    const salt = Buffer.alloc(16, 1)
    expect(buildHeader(salt).toString()).toBe(
      '{"v":1,"kdf":"argon2id","t":3,"m":65536,"p":1,"salt":"AQEBAQEBAQEBAQEBAQEBAQ==","cipher":"chacha20poly1305","chunk":1048576}',
    )
  })

  it("rejects a wrong password", async () => {
    const enc = await encryptBuffer(Buffer.from("secret data"), PW)
    await expect(decryptBuffer(enc, "wrong password!!")).rejects.toThrow(/Wrong backup password/)
  })

  it("detects tampering", async () => {
    const enc = await encryptBuffer(Buffer.alloc(10_000, 3), PW, 4096)
    const bad = Buffer.from(enc)
    bad[bad.length - 100] ^= 1
    await expect(decryptBuffer(bad, PW)).rejects.toBeInstanceOf(BackupCryptoError)
    const badHeader = Buffer.from(enc)
    badHeader[20] ^= 1 // inside the header JSON (associated data / salt)
    await expect(decryptBuffer(badHeader, PW)).rejects.toBeInstanceOf(BackupCryptoError)
  })

  it("detects truncation at a chunk boundary", async () => {
    const enc = await encryptBuffer(Buffer.alloc(10_000, 5), PW, 4096)
    const headerLen = 5 + 2 + enc.readUInt16BE(5)
    const cut = enc.subarray(0, headerLen + 2 * (4096 + 16))
    await expect(decryptBuffer(cut, PW)).rejects.toThrow(/damaged or truncated/)
    await expect(decryptBuffer(enc.subarray(0, headerLen), PW)).rejects.toBeInstanceOf(BackupCryptoError)
  })

  it("rejects files that are not backups", async () => {
    await expect(decryptBuffer(Buffer.from("PK\x03\x04 plain zip"), PW)).rejects.toThrow(/RTBK/)
  })

  const python = process.env.RT_V1_PYTHON ?? "python3"
  const hasV1Libs = spawnSync(python, ["-c", "import argon2, cryptography"], { stdio: "ignore" }).status === 0
  it.skipIf(!hasV1Libs)(
    "decrypts a file written by the v1 Python implementation and vice versa",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "rtbk-"))
      try {
        const v1 = path.resolve(import.meta.dirname, "../../../../RESORIXtrack/backend")
        const plain = Buffer.alloc(3 * 1024 * 1024 + 17, 9)
        writeFileSync(path.join(dir, "plain.bin"), plain)
        const script = `
import sys; sys.path.insert(0, sys.argv[1])
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location("bc", pathlib.Path(sys.argv[1]) / "resorixtrack/services/backup_crypto.py")
bc = importlib.util.module_from_spec(spec); spec.loader.exec_module(bc)
d = pathlib.Path(sys.argv[2])
bc.encrypt_file(d / "plain.bin", d / "v1.enc", sys.argv[3])
bc.decrypt_file(d / "v2.enc", d / "v2.out", sys.argv[3])
`
        writeFileSync(path.join(dir, "v2.enc"), await encryptBuffer(plain, PW))
        execFileSync(python, ["-c", script, v1, dir, PW])
        expect(readFileSync(path.join(dir, "v2.out")).equals(plain)).toBe(true)
        expect((await decryptFileToBuffer(path.join(dir, "v1.enc"), PW)).data.equals(plain)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
