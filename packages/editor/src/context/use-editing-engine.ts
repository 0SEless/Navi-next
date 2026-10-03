import { useSyncExternalStore, useRef, useCallback } from 'react'
import { createEditingSession, type EditingSession, type EditingSessionConfig } from '@navi/editing-engine'
import type { EditingOperation } from '@navi/editing-engine'
import type { EditingState } from '@navi/editing-engine'

export interface EditingEngineValue {
  operation: EditingOperation | null
  preview: unknown
  state: EditingState
  isDirty: boolean
  geometryDirty: boolean
  metadataDirty: boolean
  compilerDirty: boolean
  assetDirty: boolean
}

/**
 * Creates a singleton EditingSession and provides reactive snapshot via
 * useSyncExternalStore. The session is stable for the lifetime of the
 * component. Calling code handles command dispatch via the returned session.
 */
export function useEditingEngine(config?: EditingSessionConfig): {
  snapshot: EditingEngineValue
  session: EditingSession

  begin: (op: EditingOperation) => void
  /** Commits without dispatching a command — returns the result for the caller to handle. */
  doCommit: () => ReturnType<EditingSession['commit']>
  execute: (op: EditingOperation) => ReturnType<EditingSession['execute']>
  cancel: () => void
  clickEmptySpace: () => void
  escape: () => void
  reset: () => void
  preview: (data: unknown) => void
  validate: () => ReturnType<EditingSession['validate']>
} {
  const sessionRef = useRef<EditingSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = createEditingSession(config)
  }
  const session = sessionRef.current

  // Cached snapshot — only creates a new object when session.version changes
  const snapshotRef = useRef<{ subscribe: (onChange: () => void) => () => void; getSnapshot: () => EditingEngineValue } | null>(null)
  if (!snapshotRef.current) {
    let lastVersion = -1
    let cached: EditingEngineValue = {
      operation: null, preview: null, state: session.state, isDirty: false,
      geometryDirty: false, metadataDirty: false, compilerDirty: false, assetDirty: false,
    }
    snapshotRef.current = {
      subscribe: (onChange: () => void) => session.subscribe(onChange),
      getSnapshot: () => {
        if (session.version !== lastVersion) {
          lastVersion = session.version
          const flags = session.dirtyTracker.flags
          cached = {
            operation: session.currentOperation,
            preview: session.previewData,
            state: session.state,
            isDirty: session.dirtyTracker.isDirty,
            geometryDirty: flags.geometryDirty,
            metadataDirty: flags.metadataDirty,
            compilerDirty: flags.compilerDirty,
            assetDirty: flags.assetDirty,
          }
        }
        return cached
      },
    }
  }
  const { subscribe, getSnapshot } = snapshotRef.current

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const begin = useCallback((op: EditingOperation) => session.begin(op), [session])
  const doCommit = useCallback(() => session.commit(), [session])
  const execute = useCallback((op: EditingOperation) => session.execute(op), [session])
  const cancel = useCallback(() => session.cancel(), [session])
  const clickEmptySpace = useCallback(() => session.clickEmptySpace(), [session])
  const escape_ = useCallback(() => session.escape(), [session])
  const reset = useCallback(() => session.reset(), [session])
  const preview = useCallback((data: unknown) => session.preview(data), [session])
  const validate = useCallback(() => session.validate(), [session])

  return {
    snapshot,
    session,

    begin,
    doCommit,
    execute,
    cancel,
    clickEmptySpace,
    escape: escape_,
    reset,
    preview,
    validate,
  }
}
