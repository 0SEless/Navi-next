import { describe, expect, it } from 'vitest'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { compileCanonicalAccess } from '../primitives/canonical-access-compiler'
import { connectPrimitives } from '../primitives/connector'
import type {
  CanonicalAccessResult,
} from '../primitives/canonical-access-compiler'
import type {
  DoorSpec,
  NormalizedDocument,
  PrimitiveGraph,
  PrimitiveNode,
} from '../types'

function source(entityId: string, entityType: string) {
  return { entityId, entityType, generatorId: 'phase-2-test' }
}

function waypoint(id: string, lat: number, floor: number, buildingId: string): PrimitiveNode {
  return {
    id,
    kind: 'waypoint',
    position: { lat, lng: 121 },
    floor,
    buildingId,
    source: source(id, 'route_node'),
  }
}

function roomPoi(id: string, lat: number, floor: number, buildingId: string): PrimitiveNode {
  return {
    id,
    kind: 'poi',
    label: id,
    poiCategory: 'room',
    position: { lat, lng: 121 },
    floor,
    buildingId,
    source: source(id, 'room'),
  }
}

function graph(nodes: PrimitiveNode[]): PrimitiveGraph {
  return {
    nodes,
    edges: [],
    metadata: { campusId: 'phase-2', buildingCount: 2, floorCount: 2, generatedAt: 0 },
    diagnostics: [],
  }
}

function canonical(overrides: Partial<CanonicalAccessResult> = {}): CanonicalAccessResult {
  return {
    canonicalRoomIds: new Set(),
    canonicalEntranceIds: new Set(),
    canonicalFeatureIds: new Set(),
    ...overrides,
  }
}

function normalizedDocument(overrides: Record<string, unknown>): NormalizedDocument {
  return {
    buildings: [{
      id: 'building-a',
      name: 'A',
      code: 'A',
      category: 'academic',
      position: { lat: 14, lng: 121 },
      baseElevation: 0,
      height: 7,
      floors: [],
      ...overrides,
    }],
    roads: [],
  } as NormalizedDocument
}

describe('Phase 2 canonical authority and legacy fallback integrity', () => {
  it('malformed RoomAccess suppresses a nearby legacy door fallback', () => {
    const nodes = [
      roomPoi('room-a', 14, 0, 'building-a'),
      waypoint('legacy-waypoint', 14.00001, 0, 'building-a'),
    ]
    const document = normalizedDocument({
      floors: [{
        id: 'floor-a', level: 0, label: 'Ground', elevation: 0, buildingId: 'building-a',
        rooms: [], hallways: [], connectorStops: [], entrances: [], anchors: [],
        roomAttributes: [{
          faceId: 'room-a', name: 'Room A', searchable: true,
          accessPoints: [{ openingId: 'opening-a', routeNodeId: 'missing-node', primary: true }],
        }],
      }],
    })
    const authority = compileCanonicalAccess(document, nodes).canonicalAccess
    const doors: DoorSpec[] = [{
      roomId: 'room-a', doorId: 'door-a', position: { lat: 14, lng: 121 },
      floor: 0, buildingId: 'building-a',
    }]

    const result = connectPrimitives(graph(nodes), doors, new Map(), 50, undefined, authority)

    expect(authority.canonicalRoomIds.has('room-a')).toBe(true)
    expect(result.edges).toEqual([])
  })

  it('malformed EntranceAccess suppresses portal and nearby indoor fallbacks', () => {
    const portal: PrimitiveNode = {
      id: 'portal-a', kind: 'entrance_portal', entranceId: 'entrance-a',
      position: { lat: 14, lng: 121 },
      indoorPosition: { lat: 14, lng: 121 },
      outdoorPosition: { lat: 14, lng: 121 },
      floor: 0, buildingId: 'building-a', accessible: true,
      source: source('entrance-a', 'entrance'),
    }
    const nodes = [portal, waypoint('legacy-waypoint', 14.00001, 0, 'building-a')]
    const document = normalizedDocument({
      floors: [{
        id: 'floor-a', level: 0, label: 'Ground', elevation: 0, buildingId: 'building-a',
        rooms: [], hallways: [], connectorStops: [], entrances: [], anchors: [],
        entranceAccess: [{
          entranceId: 'entrance-a', outdoorNodeId: 'missing-outdoor', indoorRouteNodeId: 'missing-indoor',
        }],
      }],
    })
    const authority = compileCanonicalAccess(document, nodes).canonicalAccess

    const result = connectPrimitives(graph(nodes), [], new Map(), 50, undefined, authority)

    expect(authority.canonicalEntranceIds.has('entrance-a')).toBe(true)
    expect(result.edges).toEqual([])
  })

  it('malformed VerticalTransition suppresses legacy transition and access fallbacks', () => {
    const transition0: PrimitiveNode = {
      id: 'transition-0', kind: 'transition', connectorId: 'stair-a', behavior: 'stairs',
      accessible: true, baseCost: 15, position: { lat: 14, lng: 121 },
      floor: 0, buildingId: 'building-a', source: source('stair-a', 'staircase'),
    }
    const transition1: PrimitiveNode = {
      ...transition0,
      id: 'transition-1',
      floor: 1,
    }
    const nodes = [
      transition0,
      transition1,
      waypoint('legacy-waypoint-0', 14.00001, 0, 'building-a'),
      waypoint('legacy-waypoint-1', 14.00001, 1, 'building-a'),
    ]
    const document = normalizedDocument({
      floors: [
        { id: 'floor-0', level: 0, label: 'Ground', elevation: 0, buildingId: 'building-a', rooms: [], hallways: [], connectorStops: [], entrances: [], anchors: [] },
        { id: 'floor-1', level: 1, label: 'First', elevation: 3.5, buildingId: 'building-a', rooms: [], hallways: [], connectorStops: [], entrances: [], anchors: [] },
      ],
      verticalTransitions: [{
        id: 'vertical-a', featureId: 'stair-a', type: 'staircase',
        connections: [
          { floorId: 'floor-0', routeNodeId: 'missing-0' },
          { floorId: 'floor-1', routeNodeId: 'missing-1' },
        ],
      }],
    })
    const authority = compileCanonicalAccess(document, nodes).canonicalAccess

    const result = connectPrimitives(graph(nodes), [], new Map(), 50, undefined, authority)

    expect(authority.canonicalFeatureIds.has('stair-a')).toBe(true)
    expect(result.edges).toEqual([])
  })

  it('legacy nearest fallback cannot cross building scope', () => {
    const nodes = [
      roomPoi('room-a', 14, 0, 'building-a'),
      waypoint('wrong-building', 14, 0, 'building-b'),
      waypoint('correct-building', 14.0001, 0, 'building-a'),
    ]
    const doors: DoorSpec[] = [{
      roomId: 'room-a', doorId: 'door-a', position: { lat: 14, lng: 121 },
      floor: 0, buildingId: 'building-a',
    }]

    const result = connectPrimitives(graph(nodes), doors, new Map(), 50, undefined, canonical())

    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'room-a', to: 'correct-building' }))
    expect(result.edges.some(edge => edge.kind !== 'portal' && edge.to === 'wrong-building')).toBe(false)
  })

  it('legacy nearest fallback remains floor scoped', () => {
    const nodes = [
      roomPoi('room-a', 14, 1, 'building-a'),
      waypoint('wrong-floor', 14, 0, 'building-a'),
      waypoint('correct-floor', 14.0001, 1, 'building-a'),
    ]
    const doors: DoorSpec[] = [{
      roomId: 'room-a', doorId: 'door-a', position: { lat: 14, lng: 121 },
      floor: 1, buildingId: 'building-a',
    }]

    const result = connectPrimitives(graph(nodes), doors, new Map(), 50, undefined, canonical())

    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'room-a', to: 'correct-floor' }))
    expect(result.edges.some(edge => edge.kind !== 'portal' && edge.to === 'wrong-floor')).toBe(false)
  })

  it('legacy nearest fallback rejects waypoints beyond the named compatibility radius', () => {
    const nodes = [
      roomPoi('room-a', 14, 0, 'building-a'),
      waypoint('too-far', 14.001, 0, 'building-a'),
    ]
    const doors: DoorSpec[] = [{
      roomId: 'room-a', doorId: 'door-a', position: { lat: 14, lng: 121 },
      floor: 0, buildingId: 'building-a',
    }]

    const result = connectPrimitives(graph(nodes), doors, new Map(), 50, undefined, canonical())

    expect(ROUTE_NETWORK_THRESHOLDS.compilerFallbackMeters).toBe(50)
    expect(result.edges).toEqual([])
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'DOOR_ORPHANED')).toBe(true)
  })
})
