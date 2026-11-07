/**
 * The project the next clock-in books on, remembered per person in this browser (a convenience; the server
 * keeps nothing).
 */
import { useSyncExternalStore } from "react"

const key = (userId: number) => `rt.clock.project.${userId}`
const subs = new Set<() => void>()
// used when storage is blocked: the choice then lasts until the page reloads
const memory = new Map<number, number | null>()

export function readNextProject(userId: number): number | null {
  if (memory.has(userId)) return memory.get(userId) ?? null
  try {
    const v = Number(localStorage.getItem(key(userId)))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export function writeNextProject(userId: number, projectId: number | null): void {
  try {
    if (projectId == null) localStorage.removeItem(key(userId))
    else localStorage.setItem(key(userId), String(projectId))
    memory.delete(userId)
  } catch {
    memory.set(userId, projectId)
  }
  for (const s of subs) s()
}

function subscribe(cb: () => void) {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useNextProject(userId: number): [number | null, (projectId: number | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readNextProject(userId),
    () => null,
  )
  return [value, (projectId) => writeNextProject(userId, projectId)]
}
