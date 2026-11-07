import { useDeferredValue } from "react"

/**
 * Query parameters that may lag behind the URL: after a filter change the old result stays on screen
 * (`stale` is true) while the suspending query for the new parameters renders in the background.
 * Parameters derived from search params are new objects on every render, so staleness compares by value.
 */
export function useDeferredParams<T>(params: T): { params: T; stale: boolean } {
  const deferred = useDeferredValue(params)
  return { params: deferred, stale: deferred !== params && JSON.stringify(deferred) !== JSON.stringify(params) }
}
