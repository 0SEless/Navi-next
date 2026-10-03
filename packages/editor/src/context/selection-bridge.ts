import type { SelectionManager } from '../selection'
import type { EntitySelector, SelectionState } from './entity-id'
import { SelectionOrigin } from './entity-id'

/**
 * Legacy-compatible snapshot extracted from the new SelectionState.
 * Intended for syncing to older Zustand stores that use flat ID fields.
 */
export interface LegacySyncState {
  selectedNodeId: string | null
  selectedTraceId: string | null
  activeBuildingId: string | null
}

/**
 * Target interface for the bridge subscriber.
 */
export interface BridgeSyncTarget {
  /** Called when SelectionManager pushes a change (origin-protected, no loops). */
  onSelectionChanged: (state: SelectionState, legacy: LegacySyncState) => void
}

/**
 * SelectionBridge — Two-way sync between SelectionManager and external
 * (legacy) state stores, with mutual recursion protection.
 *
 * Usage:
 *   const bridge = new SelectionBridge(selectionManager)
 *   bridge.connect({
 *     onSelectionChanged(state, legacy) {
 *       // e.g. useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId })
 *     }
 *   })
 *   // When legacy store changes:
 *   bridge.pushExternal(selector, SelectionOrigin.Explorer)
 */
export class SelectionBridge {
  private syncing = false
  private subscribed = false
  private unsubscribe: (() => void) | null = null

  constructor(private sm: SelectionManager) {}

  /**
   * Start listening to SelectionManager changes.
   * Calls `target.onSelectionChanged` with both the full SelectionState
   * and a legacy-compatible flat snapshot.
   * Returns an unsubscribe function.
   */
  connect(target: BridgeSyncTarget): () => void {
    if (this.subscribed) {
      throw new Error('SelectionBridge is already connected')
    }
    this.subscribed = true
    this.unsubscribe = this.sm.onChange(() => {
      if (this.syncing) return
      this.syncing = true
      try {
        target.onSelectionChanged(this.sm.selectionState, this.toLegacy())
      } finally {
        this.syncing = false
      }
    })
    return () => this.disconnect()
  }

  /** Disconnect from SelectionManager. */
  disconnect(): void {
    this.unsubscribe?.()
    this.subscribed = false
    this.unsubscribe = null
  }

  /**
   * Push a selection from an external source (e.g. legacy Zustand store)
   * into SelectionManager. Guarded against sync loops.
   */
  pushExternal(selector: EntitySelector | null, origin: SelectionOrigin = SelectionOrigin.Programmatic): void {
    if (this.syncing) return
    this.syncing = true
    try {
      if (selector) {
        this.sm.select(selector, origin)
      } else {
        this.sm.clear(origin)
      }
    } finally {
      this.syncing = false
    }
  }

  /** Derived: is the bridge currently processing a sync? */
  get isSyncing(): boolean {
    return this.syncing
  }

  /**
   * Convert the current SelectionState into a LegacySyncState
   * (flat IDs for Zustand stores that still use strings).
   */
  private toLegacy(): LegacySyncState {
    const state = this.sm.selectionState
    const last = state.lastSelected

    // Determine activeBuildingId from the last selected entity
    let activeBuildingId: string | null = null
    if (last) {
      if (last.type === 'building') {
        activeBuildingId = last.id
      } else if ('buildingId' in last && last.buildingId) {
        activeBuildingId = last.buildingId
      }
    }

    const firstSelected = state.selected[0]

    return {
      selectedNodeId: firstSelected?.id ?? null,
      selectedTraceId: null, // traces exist only in legacy stores
      activeBuildingId,
    }
  }
}
