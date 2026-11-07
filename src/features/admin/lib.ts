/** "42:00" ⇄ 2520 minutes for hour fields. */
export function minutesToHhmm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`
}

export function hhmmToMinutes(v: string): number | null {
  const m = v.trim().match(/^(\d{1,3})(?::([0-5]\d))?$/)
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null
}

/** Days are compared as strings; today in the browser's zone for defaults only. */
export function currentYear(): number {
  return new Date().getFullYear()
}

export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA")
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
