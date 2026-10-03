import { isValidRoadEdgeRouting, type NavEdge } from '@navi/core'

export interface PedestrianEligibilityProfile {
  readonly version: 'STANDARD_PEDESTRIAN_ELIGIBILITY_V1'
}

export const STANDARD_PEDESTRIAN_ELIGIBILITY_V1: PedestrianEligibilityProfile = Object.freeze({
  version: 'STANDARD_PEDESTRIAN_ELIGIBILITY_V1',
})

export function isTraversalEligible(
  edge: NavEdge,
  traversalFromNodeId: string,
  profile: PedestrianEligibilityProfile,
): boolean {
  if (traversalFromNodeId !== edge.from && traversalFromNodeId !== edge.to) {
    throw new Error(`Traversal origin must be an edge endpoint for edge ${edge.id}`)
  }
  if (profile.version !== 'STANDARD_PEDESTRIAN_ELIGIBILITY_V1') {
    throw new Error(`Unsupported pedestrian eligibility profile: ${String(profile.version)}`)
  }
  if (!isValidRoadEdgeRouting(edge.routing)) return true

  const { direction = 'both', walkable } = edge.routing.authored
  if (walkable === false) return false
  if (direction === 'forward') return traversalFromNodeId === edge.from
  if (direction === 'reverse') return traversalFromNodeId === edge.to
  return true
}
