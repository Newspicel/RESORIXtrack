import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { qrMatrix, qrPath } from "./qr"

// reference digests produced with the Python `qrcode` library (same input, ECC level and mask)
const OTP =
  "otpauth://totp/RESORIXtrack:anna.meier%40example.nomail?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=RESORIXtrack&digits=6&period=30"
const CASES = [
  {
    text: "hello",
    ecl: "M",
    mask: 0,
    size: 21,
    digest: "52a7aa67e7296ede539d6be86579c7180e3b6d417445712ae8bd314c1818458a",
  },
  {
    text: OTP,
    ecl: "M",
    mask: 3,
    size: 49,
    digest: "b12b47fb6011a1c57f7cac1211145ced7ac75cbaee9181ecfaceac5d8eb2b6ff",
  },
  {
    text: "x".repeat(300),
    ecl: "Q",
    mask: 5,
    size: 81,
    digest: "fb19c1aca24c3dba33e947cfddc5aa412008d83774796a133ee6e5a76945fb63",
  },
  {
    text: "b".repeat(2000),
    ecl: "L",
    mask: 7,
    size: 149,
    digest: "8b1ef367fcec301cd475b49217a1166093739c96a45f78248f5f4a92be77600d",
  },
] as const

const digest = (m: boolean[][]) =>
  createHash("sha256")
    .update(m.map((row) => row.map((b) => (b ? "1" : "0")).join("")).join("\n"))
    .digest("hex")

describe("qr encoder", () => {
  for (const c of CASES) {
    it(`matches the reference for ${c.text.slice(0, 12)} (${c.ecl}, mask ${c.mask})`, () => {
      const m = qrMatrix(c.text, { ecl: c.ecl, mask: c.mask })
      expect(m.length).toBe(c.size)
      expect(digest(m)).toBe(c.digest)
    })
  }

  it("picks a mask automatically and renders a path with quiet zone", () => {
    const m = qrMatrix(OTP)
    const { d, size } = qrPath(m)
    expect(size).toBe(m.length + 8)
    expect(d.startsWith("M4 4h7")).toBe(true)
  })

  it("rejects data that does not fit", () => {
    expect(() => qrMatrix("x".repeat(4000), { ecl: "H" })).toThrow()
  })
})
