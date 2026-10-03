import type { Building, VerticalTransition, Staircase, Elevator } from '@navi/core'

/**
 * Get all Staircase and Elevator features on a building.
 */
function getFeatures(building: Building): Array<Staircase | Elevator> {
  return [
    ...(building.staircases ?? []),
    ...(building.elevators ?? []),
  ]
}

/**
 * Find a feature by ID on the building.
 */
function findFeature(
  building: Building,
  featureId: string,
): Staircase | Elevator | undefined {
  return getFeatures(building).find((f) => f.id === featureId)
}

/**
 * Determine whether a feature is a staircase based on its type property.
 */
function isStaircase(feature: Staircase | Elevator): feature is Staircase {
  return 'type' in feature && feature.type !== 'passenger' && feature.type !== 'freight' && feature.type !== 'service'
}

/**
 * Validate a vertical transition before adding it to a building.
 *
 * Rules:
 * - featureId must reference an existing Staircase or Elevator on the building
 * - type must match the referenced feature's type
 * - Each floorId must exist in building.floors
 * - Each routeNodeId must exist in the referenced floor's routeNetwork
 * - No duplicate floorId connections
 *
 * Returns null on success, or an error message string.
 */
export function validateVerticalTransition(
  building: Building,
  transition: VerticalTransition,
): string | null {
  // Check feature exists
  const feature = findFeature(building, transition.featureId)
  if (!feature) {
    return `Feature not found: ${transition.featureId}`
  }

  // Check type matches feature type
  const expectedType = isStaircase(feature) ? 'staircase' : 'elevator'
  if (transition.type !== expectedType) {
    return `Type mismatch: expected '${expectedType}' for feature '${transition.featureId}', got '${transition.type}'`
  }

  // Check connections array is non-empty
  if (transition.connections.length < 2) {
    return 'At least two connections are required for a vertical transition'
  }

  // Check for duplicate floorIds
  const floorIds = new Set<string>()
  for (const conn of transition.connections) {
    if (floorIds.has(conn.floorId)) {
      return `Duplicate floorId in connections: ${conn.floorId}`
    }
    floorIds.add(conn.floorId)
  }

  // Check each floorId exists in building.floors
  const buildingFloorIds = new Set(building.floors.map((f) => f.id))
  for (const conn of transition.connections) {
    if (!buildingFloorIds.has(conn.floorId)) {
      return `Floor not found in building: ${conn.floorId}`
    }
  }

  // Check each routeNodeId exists in the referenced floor's routeNetwork
  for (const conn of transition.connections) {
    const floor = building.floors.find((f) => f.id === conn.floorId)
    if (!floor) continue
    if (!floor.routeNetwork) {
      return `Floor '${conn.floorId}' has no route network`
    }
    const nodeExists = floor.routeNetwork.nodes.some(
      (n) => n.id === conn.routeNodeId,
    )
    if (!nodeExists) {
      return `Route node '${conn.routeNodeId}' not found in floor '${conn.floorId}'`
    }
  }

  return null
}

/**
 * Add a vertical transition to a building.
 *
 * Validates the transition before adding. Returns the created transition
 * or null with an error message.
 */
export function addVerticalTransition(
  building: Building,
  transition: VerticalTransition,
): { success: true; transition: VerticalTransition } | { success: false; error: string } {
  const error = validateVerticalTransition(building, transition)
  if (error) {
    return { success: false, error }
  }

  if (!building.verticalTransitions) {
    building.verticalTransitions = []
  }

  // Check for duplicate transition ID
  if (building.verticalTransitions.some((vt) => vt.id === transition.id)) {
    return { success: false, error: `Vertical transition already exists: ${transition.id}` }
  }

  building.verticalTransitions.push(transition)
  return { success: true, transition }
}

/**
 * Remove a vertical transition from a building by ID.
 *
 * Returns true if removed, false if not found.
 */
export function removeVerticalTransition(
  building: Building,
  transitionId: string,
): boolean {
  if (!building.verticalTransitions) return false
  const idx = building.verticalTransitions.findIndex((vt) => vt.id === transitionId)
  if (idx === -1) return false
  building.verticalTransitions.splice(idx, 1)
  return true
}

/**
 * Get a vertical transition by ID from a building.
 *
 * Returns the transition or undefined.
 */
export function getVerticalTransition(
  building: Building,
  transitionId: string,
): VerticalTransition | undefined {
  return building.verticalTransitions?.find((vt) => vt.id === transitionId)
}
