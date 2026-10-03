import { useSyncExternalStore, useCallback, useRef } from 'react'
import { useEditor } from '../../context'
import type { WorkflowService } from '../../services/workflow-service'
import type { WorkflowStore, WorkflowSnapshot } from '../../services/workflow-store'
import { computeProgress, type WorkflowProgress } from './workflow-progress'

// ── Fallback store for pre-registration contexts ──────────────

const EMPTY_SNAPSHOT: WorkflowSnapshot = Object.freeze({
  version: 0,
  lastValidation: null,
  lastCompile: null,
  lastSave: null,
  lastPublish: null,
  syncStatus: 'idle',
  lastSaveVersion: 0,
  saveState: 'idle',
  saveError: null,
  lastSaveReason: null,
  lastSavedAt: 0,
})

const noopSubscribe = (_: () => void) => () => {}

// Stable singletons so useSyncExternalStore doesn't re-subscribe on every render
const FALLBACK_STORE: WorkflowStore = {
  subscribe: noopSubscribe,
  getSnapshot: () => EMPTY_SNAPSHOT,
} as unknown as WorkflowStore

const FALLBACK_SERVICE: WorkflowService = {
  isDirty: () => false,
  validate: async () => {},
  compile: async () => {},
  save: async () => {},
} as unknown as WorkflowService

// ── useWorkflow hook ──────────────────────────────────────────

/**
 * Reactive hook into the editor workflow state.
 *
 * Returns live workflow status (via WorkflowStore.getSnapshot) and
 * action methods that delegate to WorkflowService.
 *
 * Gracefully falls back to empty defaults if services aren't
 * registered (e.g. in tests or legacy contexts without WorkflowStore).
 *
 * Follows the same pattern as useSelection / useDocumentVersion.
 */
export function useWorkflow(): WorkflowProgress & {
  /** Re-run validation */
  validate: () => Promise<void>
  /** Compile navigation graph */
  compile: () => Promise<void>
  /** Save document */
  save: () => Promise<void>
  /** Whether the document has unsaved changes */
  isDirty: boolean
  /** Raw snapshot for advanced consumers */
  snapshot: WorkflowSnapshot
} {
  const { services } = useEditor()

  const workflowStore = services.get('workflowStore') ?? FALLBACK_STORE
  const workflowService = services.get('workflow') ?? FALLBACK_SERVICE

  // Reactive subscription to WorkflowStore
  // Arrow wrappers preserve `this` context (useSyncExternalStore passes
  // bare references, losing class method `this`).
  const snapshot = useSyncExternalStore(
    (cb: () => void) => workflowStore.subscribe(cb),
    () => workflowStore.getSnapshot(),
    () => workflowStore.getSnapshot(),
  )

  // Cache ref for stable callbacks
  const svcRef = useRef(workflowService)
  svcRef.current = workflowService

  const isDirty = svcRef.current.isDirty()
  const progress = computeProgress(snapshot, isDirty)

  const validate = useCallback(async () => {
    await svcRef.current.validate()
  }, [])

  const compile = useCallback(async () => {
    await svcRef.current.compile()
  }, [])

  const save = useCallback(async () => {
    await svcRef.current.save('manual')
  }, [])

  return {
    ...progress,
    validate,
    compile,
    save,
    isDirty,
    snapshot,
  }
}
