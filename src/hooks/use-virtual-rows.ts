/**
 * Row virtualisation for long lists (TanStack Virtual core), shaped for the React Compiler: the virtualizer
 * instance never changes, so every read goes through `readRows` together with a version that bumps on each
 * virtualizer change, and the compiler re-reads exactly when something moved. (`useVirtualizer` itself is a
 * compiler-incompatible hook: it returns the same mutable object on every render.) The version is an external
 * store, so a scroll re-renders synchronously before the next paint (no blank frames, no flushSync).
 *
 * Rows are rendered in normal flow with spacers for the skipped ranges (`gap` before a row, `after` at the
 * end), so table semantics, sticky headers and column widths keep working.
 */
import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type Range,
  type VirtualItem,
  Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/react-virtual"
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react"

const useIsoLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect

type Opts = VirtualizerOptions<HTMLElement, Element>

export interface VirtualRowsOptions {
  count: number
  /** estimated row height in px until a row is measured */
  estimateSize: number
  getItemKey: (index: number) => string | number
  overscan?: number
}

export interface VirtualRow {
  item: VirtualItem
  /** unrendered space before this row, in px */
  gap: number
}

export interface VirtualRows {
  rows: VirtualRow[]
  /** unrendered space after the last rendered row, in px */
  after: number
  /** index of the last row in view (-1 before the first measurement) */
  lastVisible: number
  /** ref callback for the scrolling container */
  scroller: (el: HTMLElement | null) => void
  /** ref callback for each rendered row (needs `data-index`); measures its real height */
  measure: (el: Element | null) => void
  scrollToIndex: (index: number) => void
}

const serverVersion = () => 0

// rows rendered on the server and in the first client render, before the container is measured
const INITIAL_RECT = { width: 0, height: 900 }

/** Keeps the row holding focus rendered while it is scrolled away, so focus never drops to the page. */
function keepFocused(holder: { el: HTMLElement | null }) {
  return (range: Range) => {
    const indexes = defaultRangeExtractor(range)
    const focused = holder.el?.querySelector("[data-index]:focus-within")
    const index = focused ? Number(focused.getAttribute("data-index")) : Number.NaN
    if (!Number.isInteger(index) || index >= range.count || indexes.includes(index)) return indexes
    return [...indexes, index].sort((a, b) => a - b)
  }
}

function createVirtualizer(options: VirtualRowsOptions) {
  let version = 0
  const listeners = new Set<() => void>()
  const holder: { el: HTMLElement | null } = { el: null }
  const base = {
    getScrollElement: () => holder.el,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    rangeExtractor: keepFocused(holder),
    initialRect: INITIAL_RECT,
    onChange: () => {
      version++
      for (const listener of listeners) listener()
    },
  }
  const v = new Virtualizer<HTMLElement, Element>(buildOptions(base, options))
  return {
    v,
    base,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getVersion: () => version,
    scroller: (el: HTMLElement | null) => {
      holder.el = el
    },
    measure: (el: Element | null) => v.measureElement(el),
    scrollToIndex: (index: number) => v.scrollToIndex(index),
  }
}

type Base = Omit<Opts, "count" | "estimateSize" | "getItemKey" | "overscan">

function buildOptions(base: Base, o: VirtualRowsOptions): Opts {
  const estimate = o.estimateSize
  return { ...base, count: o.count, estimateSize: () => estimate, getItemKey: o.getItemKey, overscan: o.overscan ?? 8 }
}

/** Applies the options and reads the rendered window; `version` only ties the read to virtualizer changes. */
function readRows(v: Virtualizer<HTMLElement, Element>, options: Opts, _version: number) {
  v.setOptions(options)
  let end = 0
  const rows = v.getVirtualItems().map((item) => {
    const gap = Math.max(0, item.start - end)
    end = item.end
    return { item, gap }
  })
  return { rows, after: Math.max(0, v.getTotalSize() - end), lastVisible: v.range?.endIndex ?? -1 }
}

export function useVirtualRows(options: VirtualRowsOptions): VirtualRows {
  const [state] = useState(() => createVirtualizer(options))
  const version = useSyncExternalStore(state.subscribe, state.getVersion, serverVersion)
  const read = readRows(state.v, buildOptions(state.base, options), version)
  useIsoLayoutEffect(() => state.v._didMount(), [state])
  useIsoLayoutEffect(() => {
    state.v._willUpdate()
  })
  return { ...read, scroller: state.scroller, measure: state.measure, scrollToIndex: state.scrollToIndex }
}
