import type { EntranceAccess, Floor, RouteNetwork } from './types/entities'

/**
 * W10: CRUD operations for EntranceAccess — bridge relationships between
 * outdoor navigation and indoor RouteNetwork through building entrances.
 */

export interface EntranceAccessResult {
  success: boolean
  error?: string
}

/** Stable graph-node ID used for an explicit Entrance-to-trace junction. */
export function explicitEntranceAccessNodeId(entranceId: string): string {
  return `N-entrance-access-${entranceId}`
}

/**
 * Validate that an EntranceAccess bridge references existing nodes.
 * Checks:
 * - entranceId exists in floor.entrances
 * - outdoorNodeId is a non-empty string (outdoor nodes are external to floor)
 * - indoorRouteNodeId exists in floor.routeNetwork.nodes
 */
export function validateEntranceAccess(
  floor: Floor,
  access: EntranceAccess,
): EntranceAccessResult {
  if (!access.entranceId || typeof access.entranceId !== 'string') {
    return { success: false, error: 'entranceId is required' }
  }
  if (!access.outdoorNodeId || typeof access.outdoorNodeId !== 'string') {
    return { success: false, error: 'outdoorNodeId is required' }
  }
  if (!access.indoorRouteNodeId || typeof access.indoorRouteNodeId !== 'string') {
    return { success: false, error: 'indoorRouteNodeId is required' }
  }
  if (access.outdoorRouteId !== undefined && (
    typeof access.outdoorRouteId !== 'string' || access.outdoorRouteId.trim().length === 0
  )) {
    return { success: false, error: 'outdoorRouteId must be a non-empty string when provided' }
  }
  if (access.outdoorPosition !== undefined) {
    const { lat, lng } = access.outdoorPosition
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { success: false, error: 'outdoorPosition must contain valid world coordinates when provided' }
    }
  }
  if ((access.outdoorRouteId === undefined) !== (access.outdoorPosition === undefined)) {
    return { success: false, error: 'outdoorRouteId and outdoorPosition must be provided together' }
  }

  // Check entrance exists
  const entranceExists = floor.entrances.some(e => e.id === access.entranceId)
  if (!entranceExists) {
    return { success: false, error: `Entrance '${access.entranceId}' not found in floor` }
  }

  // Check indoor route node exists
  if (!floor.routeNetwork) {
    return { success: false, error: 'Floor has no route network' }
  }
  const indoorNodeExists = floor.routeNetwork.nodes.some(
    n => n.id === access.indoorRouteNodeId,
  )
  if (!indoorNodeExists) {
    return { success: false, error: `Indoor route node '${access.indoorRouteNodeId}' not found in floor.routeNetwork` }
  }

  return { success: true }
}

/**
 * Add an EntranceAccess bridge relationship to a floor.
 * Validates that the entrance and indoor route node exist before adding.
 * If a bridge for this entrance already exists, it is replaced.
 */
export function addEntranceAccess(
  floor: Floor,
  access: EntranceAccess,
): EntranceAccessResult {
  const validation = validateEntranceAccess(floor, access)
  if (!validation.success) return validation

  // Initialize array if absent
  if (!floor.entranceAccess) {
    floor.entranceAccess = []
  }

  // Replace existing bridge for same entrance, or add new
  const existingIdx = floor.entranceAccess.findIndex(
    a => a.entranceId === access.entranceId,
  )
  if (existingIdx >= 0) {
    floor.entranceAccess[existingIdx] = access
  } else {
    floor.entranceAccess.push(access)
  }

  return { success: true }
}

/**
 * Remove an EntranceAccess bridge by entrance ID.
 * Returns whether a bridge was removed.
 */
export function removeEntranceAccess(
  floor: Floor,
  entranceId: string,
): { removed: boolean } {
  if (!floor.entranceAccess) {
    return { removed: false }
  }
  const idx = floor.entranceAccess.findIndex(a => a.entranceId === entranceId)
  if (idx < 0) {
    return { removed: false }
  }
  floor.entranceAccess.splice(idx, 1)
  // Clean up empty array
  if (floor.entranceAccess.length === 0) {
    floor.entranceAccess = undefined
  }
  return { removed: true }
}

/**
 * Get the EntranceAccess bridge for a specific entrance.
 */
export function getEntranceAccess(
  floor: Floor,
  entranceId: string,
): EntranceAccess | undefined {
  return floor.entranceAccess?.find(a => a.entranceId === entranceId)
}
