import { useSelection } from './selection-store'
import { deriveWorkspace } from '../projections/workspace'
export type { WorkspaceMode, Workspace } from '../projections/workspace'

/**
 * React hook that derives the current workspace context from selection state.
 * Pure derivation — no state, no subscriptions beyond useSelection.
 *
 * @example
 * ```tsx
 * const { mode, activeBuildingId, activeFloorId } = useWorkspace()
 * if (mode === 'floor') { /* show floor-level UI *&#47; }
 * ```
 */
export function useWorkspace(): ReturnType<typeof deriveWorkspace> {
  const { lastSelected } = useSelection()
  return deriveWorkspace(lastSelected)
}
