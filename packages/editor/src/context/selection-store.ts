import { useSyncExternalStore, useCallback, useRef } from 'react'
import type { SelectionManager } from '../selection'
import type { SelectionState, EntitySelector, SelectionOrigin, SelectionMode } from './entity-id'
import { useEditor } from './editor-context'

// ── Internal: cached snapshot wrapper for useSyncExternalStore ──

function createCachedSnapshot(sm: SelectionManager): {
  subscribe: (onStoreChange: () => void) => () => void
  getSnapshot: () => SelectionState
} {
  let lastRevision = -1
  let cached = sm.selectionState

  return {
    subscribe: (onStoreChange: () => void) => sm.onChange(onStoreChange),
    getSnapshot: () => {
      if (sm.revision !== lastRevision) {
        lastRevision = sm.revision
        cached = sm.selectionState
      }
      return cached
    },
  }
}

// ── useSelection hook ─────────────────────────────────────────

/**
 * React hook that provides reactive access to the SelectionManager
 * via its internal onChange listener API.
 *
 * Components should use this hook instead of subscribing to
 * SelectionManager directly.
 */
export function useSelection(): SelectionState & {
  select: (input: string | EntitySelector, origin?: SelectionOrigin) => void
  toggle: (input: string | EntitySelector, origin?: SelectionOrigin) => void
  clear: (origin?: SelectionOrigin) => void
  setMode: (mode: SelectionMode) => void
  setHover: (input: string | EntitySelector | null) => void
  clearHover: () => void
  isSelected: (id: string) => boolean
} {
  const { services } = useEditor()
  const sm = services.get('selection')!

  // Build cached snapshot wrapper once — stable for the lifetime of the service
  const snapshotRef = useRef(createCachedSnapshot(sm))
  const { subscribe, getSnapshot } = snapshotRef.current

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const select = useCallback(
    (input: string | EntitySelector, origin?: SelectionOrigin) => sm.select(input, origin),
    [sm],
  )

  const toggle = useCallback(
    (input: string | EntitySelector, origin?: SelectionOrigin) => sm.toggle(input, origin),
    [sm],
  )

  const clear = useCallback(
    (origin?: SelectionOrigin) => sm.clear(origin),
    [sm],
  )

  const setMode = useCallback(
    (mode: SelectionMode) => sm.setMode(mode),
    [sm],
  )

  const setHover = useCallback(
    (input: string | EntitySelector | null) => sm.setHover(input),
    [sm],
  )

  const clearHover = useCallback(
    () => sm.clearHover(),
    [sm],
  )

  const isSelected = useCallback(
    (id: string) => sm.isSelected(id),
    [sm],
  )

  return {
    ...state,
    select,
    toggle,
    clear,
    setMode,
    setHover,
    clearHover,
    isSelected,
  }
}
