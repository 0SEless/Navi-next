import { createHash } from 'crypto'
import type { ConnectivityGraph, NavigationGraph, NavNode, NavEdge } from '../types'

let seqId = 0
function nextId(prefix: string): string {
  return `${prefix}-${++seqId}`
}

function assertNever(_x: never): void {}

function behaviorToNavEdgeType(behavior: string): NavEdge['type'] {
  switch (behavior) {
    case 'stairs': return 'stairs'
    case 'elevator': return 'elevator'
    case 'escalator': return 'transition'
    case 'ramp': return 'walk'
    default: return 'walk'
  }
}

/**
 * Phase 3.3: Emit Graph.
 *
 * Pure mechanical for-loop. Zero spatial search. Zero geometry repair.
 * Zero validation. Every PrimitiveNode → NavNode. Every PrimitiveEdge → NavEdge.
 *
 * Special case: entrance_portal → TWO NavNodes (outdoor + entrance) + one NavEdge.
 *
 * ALWAYS run the AC4 spy test after changing this function —
 * if any spatial function (haversine, nearest neighbor) is called here, the test MUST fail.
 */
export function emitGraph(graph: ConnectivityGraph): NavigationGraph {
  const navNodes: NavNode[] = []
  const navEdges: NavEdge[] = []

  // Build ID mapping: primitive node ID → emitted NavNode IDs
  // (entrance_portal nodes produce 2 NavNodes, so we need to track both)
  const nodeIdMap = new Map<string, string[]>() // primitiveId → [outdoorId?, indoorId?]

  for (const node of graph.nodes) {
    switch (node.kind) {
      case 'waypoint': {
        const id = nextId('N')
        navNodes.push({
          id,
          label: '',
          type: 'waypoint',
          position: node.position,
          floor: node.floor,
          buildingId: node.buildingId,
          properties: {},
        })
        nodeIdMap.set(node.id, [id])
        break
      }
      case 'poi': {
        const id = nextId('N')
        navNodes.push({
          id,
          label: node.label,
          type: 'poi',
          position: node.position,
          floor: node.floor,
          buildingId: node.buildingId,
          properties: {},
        })
        nodeIdMap.set(node.id, [id])
        break
      }
      case 'transition': {
        const id = nextId('N')
        navNodes.push({
          id,
          label: '',
          type: 'transition',
          position: node.position,
          floor: node.floor,
          buildingId: node.buildingId,
          // P1-T9 (R8.4): carry the vertical entity's identity so consumers
          // can tell stair/elevator/connector nodes apart — one node per
          // access floor (`N-stair-{id}-{floor}` semantics via properties).
          properties: {
            ...(node.source?.entityType ? { entityType: node.source.entityType, entityId: node.source.entityId } : {}),
            ...((node.source?.entityType === 'staircase' || node.source?.entityType === 'elevator') ? { level: node.floor } : {}),
          },
        })
        nodeIdMap.set(node.id, [id])
        break
      }
      case 'entrance_portal': {
        // Emit TWO NavNodes: outdoor + entrance
        const outdoorId = nextId('N')
        const entranceId = nextId('N')

        navNodes.push({
          id: outdoorId,
          label: '',
          type: 'outdoor',
          position: node.outdoorPosition,
          floor: node.floor,
          buildingId: node.buildingId,
          properties: {},
        })

        navNodes.push({
          id: entranceId,
          label: '',
          type: 'entrance',
          position: node.indoorPosition,
          floor: node.floor,
          buildingId: node.buildingId,
          properties: {},
        })

        nodeIdMap.set(node.id, [outdoorId, entranceId])

        // Emit NavEdge between outdoor and entrance (from portal edge)
        // We'll find the corresponding portal edge in the edge loop
        break
      }
      default:
        assertNever(node as never)
    }
  }

  // Build a reverse map: outdoor NavNode ID → entrance NavNode ID
  const outdoorToEntrance = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.kind === 'entrance_portal') {
      const ids = nodeIdMap.get(node.id)
      if (ids && ids.length === 2) {
        outdoorToEntrance.set(ids[0], ids[1])
      }
    }
  }

  for (const edge of graph.edges) {
    switch (edge.kind) {
      case 'skeleton': {
        const fromIds = nodeIdMap.get(edge.from)
        const toIds = nodeIdMap.get(edge.to)
        if (!fromIds || !toIds) continue
        navEdges.push({
          id: nextId('E'),
          from: fromIds[0],
          to: toIds[0],
          type: 'walk',
          distance: edge.distance,
          weight: edge.distance,
          ...(edge.routing ? { routing: edge.routing } : {}),
        })
        break
      }
      case 'access': {
        const fromIds = nodeIdMap.get(edge.from)
        const toIds = nodeIdMap.get(edge.to)
        if (!fromIds || !toIds) continue
        navEdges.push({
          id: nextId('E'),
          from: fromIds[0],
          to: toIds[0],
          type: 'walk',
          distance: edge.distance,
          weight: edge.distance,
        })
        break
      }
      case 'transition': {
        const fromIds = nodeIdMap.get(edge.from)
        const toIds = nodeIdMap.get(edge.to)
        if (!fromIds || !toIds) continue
        navEdges.push({
          id: nextId('E'),
          from: fromIds[0],
          to: toIds[0],
          type: behaviorToNavEdgeType(edge.behavior),
          distance: edge.distance,
          weight: edge.baseCost,
        })
        break
      }
      case 'portal': {
        // Portal edge connects the outdoor NavNode to the entrance NavNode
        // of the same entrance_portal node
        const ids = nodeIdMap.get(edge.nodeId)
        if (!ids || ids.length !== 2) continue
        navEdges.push({
          id: nextId('E'),
          from: ids[0],
          to: ids[1],
          type: 'walk',
          distance: edge.distance,
          weight: edge.distance,
        })
        break
      }
      default:
        assertNever(edge as never)
    }
  }

  // Compute bounding box
  const bbox = navNodes.length > 0
    ? navNodes.reduce(
        (bb, n) => ({
          minLng: Math.min(bb.minLng, n.position.lng),
          maxLng: Math.max(bb.maxLng, n.position.lng),
          minLat: Math.min(bb.minLat, n.position.lat),
          maxLat: Math.max(bb.maxLat, n.position.lat),
        }),
        { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
      )
    : { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 }

  const buildingSet = new Set(navNodes.map(n => n.buildingId).filter(Boolean))
  const floorSet = new Set(navNodes.map(n => `${n.buildingId}:${n.floor}`))

  const contentOnly = {
    nodes: navNodes,
    edges: navEdges,
    version: '1.0.0',
    campusId: graph.metadata.campusId,
    metadata: {
      nodeCount: navNodes.length,
      edgeCount: navEdges.length,
      buildings: buildingSet.size,
      floors: floorSet.size,
      boundingBox: bbox,
    },
  }

  return {
    version: '1.0.0',
    campusId: graph.metadata.campusId,
    createdAt: '',
    checksum: createHash('sha256').update(JSON.stringify(contentOnly)).digest('hex'),
    nodes: navNodes,
    edges: navEdges,
    metadata: {
      nodeCount: navNodes.length,
      edgeCount: navEdges.length,
      buildings: buildingSet.size,
      floors: floorSet.size,
      boundingBox: bbox,
    },
  }
}
