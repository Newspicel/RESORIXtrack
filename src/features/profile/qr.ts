/**
 * Minimal QR code encoder (ISO/IEC 18004, byte mode, versions 1-40) for the two-factor enrolment QR.
 * Small enough to avoid a dependency; structure follows Project Nayuki's reference implementation (MIT).
 */

export type Ecl = "L" | "M" | "Q" | "H"
const ECL_INDEX: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 }
const ECL_FORMAT: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 }

// biome-ignore format: tables
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]
// biome-ignore format: tables
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

function dataCodewords(ver: number, ecl: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver]
}

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor)
    })
  }
  return result
}

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < n; pos -= step) result.splice(1, 0, pos)
  return result
}

class Builder {
  readonly size: number
  readonly modules: boolean[][]
  readonly isFunction: boolean[][]
  constructor(
    readonly ver: number,
    readonly ecl: Ecl,
  ) {
    this.size = ver * 4 + 17
    this.modules = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => false))
    this.isFunction = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => false))
  }

  set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark
    this.isFunction[y][x] = true
  }

  drawFunctionPatterns() {
    const s = this.size
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0)
      this.set(i, 6, i % 2 === 0)
    }
    for (const [cx, cy] of [
      [3, 3],
      [s - 4, 3],
      [3, s - 4],
    ]) {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy))
          const x = cx + dx
          const y = cy + dy
          if (x >= 0 && x < s && y >= 0 && y < s) this.set(x, y, d !== 2 && d !== 4)
        }
    }
    const pos = alignmentPositions(this.ver, s)
    const last = pos.length - 1
    for (let i = 0; i <= last; i++)
      for (let j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            this.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    this.drawFormat(0)
    this.drawVersion()
  }

  drawFormat(mask: number) {
    const data = (ECL_FORMAT[this.ecl] << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    const s = this.size
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i))
    this.set(8, 7, bit(bits, 6))
    this.set(8, 8, bit(bits, 7))
    this.set(7, 8, bit(bits, 8))
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i))
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(bits, i))
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(bits, i))
    this.set(8, s - 8, true)
  }

  drawVersion() {
    if (this.ver < 7) return
    let rem = this.ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (this.ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i)
      const a = this.size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      this.set(a, c, b)
      this.set(c, a, b)
    }
  }

  drawCodewords(data: number[]) {
    const s = this.size
    let i = 0
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < s; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const upward = ((right + 1) & 2) === 0
          const y = upward ? s - 1 - vert : vert
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7))
            i++
          }
        }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue
        let invert: boolean
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0
            break
          case 1:
            invert = y % 2 === 0
            break
          case 2:
            invert = x % 3 === 0
            break
          case 3:
            invert = (x + y) % 3 === 0
            break
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
            break
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0
            break
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
            break
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
        }
        if (invert) this.modules[y][x] = !this.modules[y][x]
      }
  }

  /** Penalty score of the current symbol (lower is better). */
  penalty(): number {
    const s = this.size
    const m = this.modules
    let score = 0
    const line = (get: (i: number) => boolean) => {
      let run = 1
      for (let i = 1; i <= s; i++) {
        if (i < s && get(i) === get(i - 1)) run++
        else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      const pat = [true, false, true, true, true, false, true]
      for (let i = 0; i + 7 <= s; i++) {
        if (!pat.every((p, k) => get(i + k) === p)) continue
        const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !get(i - k))
        const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= s || !get(i + 7 + k))
        if (lightBefore || lightAfter) score += 40
      }
    }
    for (let y = 0; y < s; y++) line((x) => m[y][x])
    for (let x = 0; x < s; x++) line((y) => m[y][x])
    for (let y = 0; y < s - 1; y++)
      for (let x = 0; x < s - 1; x++) {
        const c = m[y][x]
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
      }
    let dark = 0
    for (const row of m) for (const c of row) if (c) dark++
    const total = s * s
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
    return score + Math.max(0, k) * 10
  }
}

function encodeData(bytes: Uint8Array, ecl: Ecl): { ver: number; codewords: number[] } {
  const e = ECL_INDEX[ecl]
  for (let ver = 1; ver <= 40; ver++) {
    const capacityBits = dataCodewords(ver, e) * 8
    const ccBits = ver <= 9 ? 8 : 16
    const used = 4 + ccBits + bytes.length * 8
    if (used > capacityBits) continue
    const bits: number[] = []
    const push = (val: number, len: number) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
    }
    push(0b0100, 4)
    push(bytes.length, ccBits)
    for (const b of bytes) push(b, 8)
    push(0, Math.min(4, capacityBits - bits.length))
    push(0, (8 - (bits.length % 8)) % 8)
    for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8)
    const codewords: number[] = []
    for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
    return { ver, codewords }
  }
  throw new Error("QR: data too long")
}

function addEccAndInterleave(data: number[], ver: number, ecl: Ecl): number[] {
  const e = ECL_INDEX[ecl]
  const numBlocks = NUM_BLOCKS[e][ver]
  const eccLen = ECC_PER_BLOCK[e][ver]
  const raw = Math.floor(rawDataModules(ver) / 8)
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i])
    })
  return result
}

/** Module matrix (`true` = dark), `[y][x]`, without quiet zone. `mask` forces a mask (tests). */
export function qrMatrix(text: string, opts: { ecl?: Ecl; mask?: number } = {}): boolean[][] {
  const ecl = opts.ecl ?? "M"
  const { ver, codewords } = encodeData(new TextEncoder().encode(text), ecl)
  const all = addEccAndInterleave(codewords, ver, ecl)
  const masks = opts.mask != null ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7]
  let best: Builder | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const mask of masks) {
    const b = new Builder(ver, ecl)
    b.drawFunctionPatterns()
    b.drawCodewords(all)
    b.applyMask(mask)
    b.drawFormat(mask)
    const score = masks.length === 1 ? 0 : b.penalty()
    if (score < bestScore) {
      best = b
      bestScore = score
    }
  }
  if (!best) throw new Error("QR: no mask evaluated")
  return best.modules
}

/** SVG path data (one unit per module, `border` modules of quiet zone) and the viewBox size. */
export function qrPath(matrix: boolean[][], border = 4): { d: string; size: number } {
  const parts: string[] = []
  matrix.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      let run = 1
      while (x + run < row.length && row[x + run]) run++
      parts.push(`M${x + border} ${y + border}h${run}v1h-${run}z`)
      x += run
    }
  })
  return { d: parts.join(""), size: matrix.length + border * 2 }
}
