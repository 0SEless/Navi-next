import type { EntityId, EntitySelector } from '../context/entity-id'

export type WorkspaceMode = 'campus' | 'building' | 'floor' | 'validation' | 'none'

export interface Workspace {
  mode: WorkspaceMode
  activeBuildingId?: EntityId
  activeFloorId?: EntityId
}

/**
 * Derive workspace context from a selected entity selector.
 * Pure function — no side effects, no state, no React.
 *
 * Rules:
 * - Nothing selected → campus mode
 * - Building selected → building mode
 * - Floor selected → floor mode (with activeBuildingId + activeFloorId)
 * - Nested entity (room, hallway, etc.) → floor mode (with activeBuildingId)
 * - Campus-level entity (road, panorama, QR) → campus mode
 */
export function deriveWorkspace(sel: EntitySelector | null): Workspace {
  if (!sel) return { mode: 'campus' }

  if (sel.type === 'building') {
    return { mode: 'building', activeBuildingId: sel.id }
  }

  if (sel.type === 'floor') {
    return {
      mode: 'floor',
      activeBuildingId: sel.buildingId,
      activeFloorId: sel.id,
    }
  }

  // Any entity nested under a building (room, hallway, staircase, etc.)
  if ('buildingId' in sel && sel.buildingId) {
    return {
      mode: 'floor',
      activeBuildingId: sel.buildingId as EntityId,
    }
  }

  // Roads, panoramas, QRs — treat as campus-level
  return { mode: 'campus' }
}
