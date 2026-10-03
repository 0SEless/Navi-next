import type { RouteNode, RouteNetwork, RouteEdge, LocalCoord } from '@navi/core'
import type { Staircase, Elevator, StairLevelGeometry, ElevatorLevelGeometry } from '@navi/core'
import { genId } from '../id'

type FeatureGeometry = StairLevelGeometry | ElevatorLevelGeometry

/**
 * Get the position of a staircase or elevator on a specific floor.
 */
function getFeaturePosition(
  feature: Staircase | Elevator,
  floor: number,
): LocalCoord | undefined {
  const level = feature.levels[floor]
  if (!level) return undefined
  return level.position
}

/**
 * Calculate the Euclidean distance between two positions.
 */
function calculateDistance(a: LocalCoord, b: LocalCoord): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Check if a node belongs to a specific feature based on its ID pattern.
 */
function isFeatureNode(node: RouteNode, featureId: string): boolean {
  return node.type === 'transition' && node.id.startsWith(`tr-${featureId}-`)
}

/**
 * Create transition nodes and edges for a floor transition (staircase or elevator).
 *
 * Creates two transition nodes (one per floor) in the route network and connects
 * them with an edge of type 'stairs' or 'elevator'.
 *
 * @param feature - The staircase or elevator entity
 * @param floor1 - The first floor level
 * @param floor2 - The second floor level
 * @param network - The route network to add nodes/edges to
 * @returns The created transition nodes and edge, or null if positions are invalid
 */
export function createFloorTransition(
  feature: Staircase | Elevator,
  floor1: number,
  floor2: number,
  network: RouteNetwork,
): { node1: RouteNode; node2: RouteNode; edge: RouteEdge } | null {
  const pos1 = getFeaturePosition(feature, floor1)
  const pos2 = getFeaturePosition(feature, floor2)

  if (!pos1 || !pos2) return null

  const isElevator = 'type' in feature && feature.type === 'passenger'
  const edgeType = isElevator ? 'elevator' : 'stairs'

  const node1: RouteNode = {
    id: `tr-${feature.id}-${floor1}`,
    type: 'transition',
    position: { x: pos1.x, y: pos1.y },
    floor: floor1,
  }

  const node2: RouteNode = {
    id: `tr-${feature.id}-${floor2}`,
    type: 'transition',
    position: { x: pos2.x, y: pos2.y },
    floor: floor2,
  }

  const edge: RouteEdge = {
    id: genId('te'),
    from: node1.id,
    to: node2.id,
    type: edgeType,
    distance: calculateDistance(pos1, pos2),
  }

  network.nodes.push(node1, node2)
  network.edges.push(edge)

  return { node1, node2, edge }
}

/**
 * Remove all transition nodes and edges associated with a specific staircase/elevator.
 *
 * @param featureId - The ID of the staircase or elevator
 * @param network - The route network to remove nodes/edges from
 * @returns The number of nodes removed
 */
export function removeFloorTransition(
  featureId: string,
  network: RouteNetwork,
): number {
  const nodeIdsToRemove = new Set<string>()

  for (const node of network.nodes) {
    if (isFeatureNode(node, featureId)) {
      nodeIdsToRemove.add(node.id)
    }
  }

  if (nodeIdsToRemove.size === 0) return 0

  network.nodes = network.nodes.filter((n) => !nodeIdsToRemove.has(n.id))
  network.edges = network.edges.filter(
    (e) => !nodeIdsToRemove.has(e.from) && !nodeIdsToRemove.has(e.to),
  )

  return nodeIdsToRemove.size
}

/**
 * Validate that a floor transition is properly set up.
 *
 * @param feature - The staircase or elevator entity
 * @param network - The route network containing the transition
 * @returns True if the transition is valid, false otherwise
 */
export function validateFloorTransition(
  feature: Staircase | Elevator,
  network: RouteNetwork,
): boolean {
  const floors = Object.keys(feature.levels).map(Number)

  if (floors.length < 2) return false

  const expectedEdgeType = 'type' in feature && feature.type === 'passenger'
    ? 'elevator'
    : 'stairs'

  for (const floor of floors) {
    const node = network.nodes.find((n) => isFeatureNode(n, feature.id) && n.floor === floor)
    if (!node) return false

    const pos = getFeaturePosition(feature, floor)
    if (!pos) return false

    if (node.position.x !== pos.x || node.position.y !== pos.y) return false
  }

  const edges = network.edges.filter(
    (e) =>
      e.type === expectedEdgeType &&
      (e.from.startsWith(`tr-${feature.id}-`) || e.to.startsWith(`tr-${feature.id}-`)),
  )

  return edges.length === floors.length - 1
}