import { describe, expect, it } from 'vitest'
import { deserializeDocument, serializeDocument } from '@navi/core'
import type { Building, CampusDocument, Floor } from '@navi/core'
import { compileCanonicalAccess } from '../../../../compiler/src/primitives/canonical-access-compiler'
import type { NormalizedDocument, PrimitiveNode } from '../../../../compiler/src/types'
import { buildingDeleteHandler } from '../building-handlers'
import { entranceDeleteHandler } from '../entrance-handlers'
import { entityDeleteHandler } from '../entity-delete-handler'
import { featureCreateHandler, featureDeleteHandler } from '../feature-handlers'
import { floorDeleteHandler } from '../floor-handlers'
import { roadDeleteHandler } from '../road-handlers'
import { routeNodeDeleteHandler } from '../route-network-handlers'

function floor(id: string, level: number): Floor {
  return {
    id,
    level,
    label: `Floor ${level}`,
    elevation: level * 3.5,
    height: 3.5,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
  }
}

function building(id: string, floors: Floor[]): Building {
  return {
    id,
    name: id,
    code: id,
    category: 'academic',
    description: '',
    footprint: { points: [
      { lat: 14, lng: 121 },
      { lat: 14, lng: 121.001 },
      { lat: 14.001, lng: 121.001 },
      { lat: 14, lng: 121 },
    ] },
    baseElevation: 0,
    height: floors.length * 3.5,
    floors,
    verticalConnectors: [],
    color: '#000000',
    aliases: [],
    metadata: {},
  }
}

function document(buildings: Building[]): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: {
      campusId: 'phase-2',
      name: 'Phase 2',
      description: '',
      lastModified: '',
      editorVersion: '1.0.0',
    },
    buildings,
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Phase 2 routing relationship cleanup', () => {
  it('deleting a road clears every confirmed road reference without reassignment', () => {
    const f0 = floor('f0', 0)
    f0.entrances = [
      { id: 'entrance-a', label: 'A', position: { x: 1, y: 1 }, level: 0, type: 'main', hasQR: false, hasPanorama: false, connectorRoadId: 'road-a' },
      { id: 'entrance-b', label: 'B', position: { x: 2, y: 2 }, level: 0, type: 'side', hasQR: false, hasPanorama: false, connectorRoadId: 'road-b' },
    ]
    f0.entranceAccess = [
      { entranceId: 'entrance-a', outdoorNodeId: 'road-a', outdoorRouteId: 'road-a', indoorRouteNodeId: 'node-a' },
      { entranceId: 'entrance-b', outdoorNodeId: 'outdoor-b', outdoorRouteId: 'road-b', indoorRouteNodeId: 'node-b' },
    ]
    const doc = document([building('building-a', [f0])])
    doc.roads = [
      { id: 'road-a', name: 'A', polyline: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-a', metadata: {} },
      { id: 'road-b', name: 'B', polyline: { points: [{ lat: 14.001, lng: 121 }, { lat: 14.001, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-b', metadata: {} },
    ]
    doc.roadJunctions = [{ id: 'junction', position: { lat: 14, lng: 121 }, roadIds: ['road-a', 'road-b'] }]
    doc.separatedCrossings = [{ id: 'separate', position: { lat: 14, lng: 121 }, roadIds: ['road-a', 'road-b'] }]

    expect(roadDeleteHandler.execute(doc, { roadId: 'road-a' }).success).toBe(true)

    expect(f0.entrances[0]?.connectorRoadId).toBeUndefined()
    expect(f0.entrances[1]?.connectorRoadId).toBe('road-b')
    expect(f0.entranceAccess).toEqual([
      { entranceId: 'entrance-b', outdoorNodeId: 'outdoor-b', outdoorRouteId: 'road-b', indoorRouteNodeId: 'node-b' },
    ])
    expect(doc.roadJunctions).toEqual([])
    expect(doc.separatedCrossings).toEqual([])
  })

  it('deleting a route node removes semantic references and never selects a nearby replacement', () => {
    const f0 = floor('f0', 0)
    const f1 = floor('f1', 1)
    f0.routeNetwork = {
      nodes: [
        { id: 'deleted-node', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'nearby-node', type: 'waypoint', position: { x: 0.01, y: 0 }, floor: 0 },
      ],
      edges: [],
    }
    f0.roomAttributes = [{
      faceId: 'room-a',
      name: 'Room A',
      searchable: true,
      accessPoints: [{ openingId: 'opening-a', routeNodeId: 'deleted-node', primary: true }],
    }]
    f0.entranceAccess = [{ entranceId: 'entrance-a', outdoorNodeId: 'outdoor-a', indoorRouteNodeId: 'deleted-node' }]
    f1.routeNetwork = { nodes: [{ id: 'node-f1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 1 }], edges: [] }
    const b = building('building-a', [f0, f1])
    b.verticalTransitions = [{
      id: 'transition-a',
      featureId: 'stair-a',
      type: 'staircase',
      connections: [
        { floorId: 'f0', routeNodeId: 'deleted-node' },
        { floorId: 'f1', routeNodeId: 'node-f1' },
      ],
    }]
    const doc = document([b])

    expect(routeNodeDeleteHandler.execute(doc, { nodeId: 'deleted-node' }).success).toBe(true)

    expect(f0.roomAttributes[0]?.accessPoints).toEqual([])
    expect(f0.entranceAccess).toEqual([])
    expect(b.verticalTransitions).toEqual([])
    expect(f0.roomAttributes[0]?.accessPoints?.some(point => point.routeNodeId === 'nearby-node')).toBe(false)
  })

  it('deleting one of three entrances clears only its access and reverse road link', () => {
    const f0 = floor('f0', 0)
    f0.entrances = [
      { id: 'entrance-a', label: 'A', position: { x: 1, y: 1 }, level: 0, type: 'main', hasQR: false, hasPanorama: false },
      { id: 'entrance-b', label: 'B', position: { x: 2, y: 2 }, level: 0, type: 'side', hasQR: false, hasPanorama: false },
      { id: 'entrance-c', label: 'C', position: { x: 3, y: 3 }, level: 0, type: 'emergency', hasQR: false, hasPanorama: false },
    ]
    f0.entranceAccess = [
      { entranceId: 'entrance-a', outdoorNodeId: 'outdoor-a', indoorRouteNodeId: 'node-a' },
      { entranceId: 'entrance-b', outdoorNodeId: 'outdoor-b', indoorRouteNodeId: 'node-b' },
      { entranceId: 'entrance-c', outdoorNodeId: 'outdoor-c', indoorRouteNodeId: 'node-c' },
    ]
    const doc = document([building('building-a', [f0])])
    doc.roads = [
      { id: 'road-a', name: 'A', polyline: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-a', metadata: {} },
      { id: 'road-b', name: 'B', polyline: { points: [{ lat: 14.001, lng: 121 }, { lat: 14.001, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-b', metadata: {} },
      { id: 'road-c', name: 'C', polyline: { points: [{ lat: 14.002, lng: 121 }, { lat: 14.002, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-c', metadata: {} },
    ]

    expect(entranceDeleteHandler.execute(doc, { entranceId: 'entrance-b' }).success).toBe(true)

    expect(f0.entrances.map(entrance => entrance.id)).toEqual(['entrance-a', 'entrance-c'])
    expect(f0.entranceAccess?.map(access => access.entranceId)).toEqual(['entrance-a', 'entrance-c'])
    expect(doc.roads[0]?.connectorEntranceId).toBe('entrance-a')
    expect(doc.roads[1]?.connectorEntranceId).toBeUndefined()
    expect(doc.roads[2]?.connectorEntranceId).toBe('entrance-c')
  })

  it('deleting a feature clears only its VerticalTransition', () => {
    const f0 = floor('f0', 0)
    const b = building('building-a', [f0])
    b.staircases = [{
      id: 'stair-a', buildingId: b.id, name: 'A', type: 'standard', accessible: false,
      fromLevel: 0, toLevel: 1, levels: { 0: { position: { x: 0, y: 0 }, rotation: 0 } },
    }]
    b.elevators = [{
      id: 'elevator-b', buildingId: b.id, name: 'B', type: 'passenger', accessible: true,
      fromLevel: 0, toLevel: 1, levels: { 0: { position: { x: 2, y: 2 }, rotation: 0 } },
    }]
    b.verticalTransitions = [
      { id: 'transition-a', featureId: 'stair-a', type: 'staircase', connections: [] },
      { id: 'transition-b', featureId: 'elevator-b', type: 'elevator', connections: [] },
    ]
    const doc = document([b])

    expect(featureDeleteHandler.execute(doc, { featureId: 'stair-a' }).success).toBe(true)

    expect(b.verticalTransitions?.map(transition => transition.id)).toEqual(['transition-b'])
  })

  it('feature deletion undo restores the removed VerticalTransition verbatim', () => {
    const f0 = floor('f0', 0)
    const b = building('building-a', [f0])
    b.staircases = [{
      id: 'stair-a', buildingId: b.id, name: 'A', type: 'standard', accessible: false,
      fromLevel: 0, toLevel: 1, levels: { 0: { position: { x: 0, y: 0 }, rotation: 0 } },
    }]
    b.verticalTransitions = [{
      id: 'transition-a', featureId: 'stair-a', type: 'staircase',
      connections: [{ floorId: 'f0', routeNodeId: 'node-a' }],
    }]
    const doc = document([b])
    const deleted = featureDeleteHandler.execute(doc, { featureId: 'stair-a' })
    const inverse = featureDeleteHandler.inverse?.({ featureId: 'stair-a' }, deleted)

    expect(inverse).not.toBeNull()
    expect(featureCreateHandler.execute(doc, inverse!.payload).success).toBe(true)
    expect(b.verticalTransitions).toEqual([{
      id: 'transition-a', featureId: 'stair-a', type: 'staircase',
      connections: [{ floorId: 'f0', routeNodeId: 'node-a' }],
    }])
  })

  it('deleting a building clears external road links to its entrances only', () => {
    const fA = floor('fa', 0)
    fA.entrances = [{ id: 'entrance-a', label: 'A', position: { x: 1, y: 1 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }]
    const fB = floor('fb', 0)
    fB.entrances = [{ id: 'entrance-b', label: 'B', position: { x: 2, y: 2 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }]
    const doc = document([building('building-a', [fA]), building('building-b', [fB])])
    doc.roads = [
      { id: 'road-a', name: 'A', polyline: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-a', metadata: {} },
      { id: 'road-b', name: 'B', polyline: { points: [{ lat: 14.001, lng: 121 }, { lat: 14.001, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-b', metadata: {} },
    ]

    expect(buildingDeleteHandler.execute(doc, { buildingId: 'building-a' }).success).toBe(true)

    expect(doc.roads[0]?.connectorEntranceId).toBeUndefined()
    expect(doc.roads[1]?.connectorEntranceId).toBe('entrance-b')
  })

  it('generic deletion applies the same entrance cleanup policy', () => {
    const f0 = floor('f0', 0)
    f0.entrances = [{ id: 'entrance-a', label: 'A', position: { x: 1, y: 1 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }]
    f0.entranceAccess = [{ entranceId: 'entrance-a', outdoorNodeId: 'outdoor-a', indoorRouteNodeId: 'node-a' }]
    const doc = document([building('building-a', [f0])])
    doc.roads = [{ id: 'road-a', name: 'A', polyline: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }] }, width: 4, surface: 'paved', type: 'service', connectorEntranceId: 'entrance-a', metadata: {} }]

    expect(entityDeleteHandler.execute(doc, { entityId: 'entrance-a' }).success).toBe(true)

    expect(f0.entranceAccess).toEqual([])
    expect(doc.roads[0]?.connectorEntranceId).toBeUndefined()
  })

  it('deleting the middle floor survives reload without creating an F0-to-F2 shortcut', () => {
    const f0 = floor('f0', 0)
    const f1 = floor('f1', 1)
    const f2 = floor('f2', 2)
    f0.routeNetwork = { nodes: [{ id: 'node-f0', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }], edges: [] }
    f1.routeNetwork = { nodes: [{ id: 'node-f1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 1 }], edges: [] }
    f2.routeNetwork = { nodes: [{ id: 'node-f2', type: 'waypoint', position: { x: 0, y: 0 }, floor: 2 }], edges: [] }
    const b = building('building-a', [f0, f1, f2])
    b.staircases = [{
      id: 'stair-a', buildingId: b.id, name: 'A', type: 'standard', accessible: false,
      fromLevel: 0, toLevel: 2,
      levels: {
        0: { position: { x: 0, y: 0 }, rotation: 0 },
        1: { position: { x: 0, y: 0 }, rotation: 0 },
        2: { position: { x: 0, y: 0 }, rotation: 0 },
      },
    }]
    b.verticalTransitions = [{
      id: 'transition-a',
      featureId: 'stair-a',
      type: 'staircase',
      connections: [
        { floorId: 'f0', routeNodeId: 'node-f0' },
        { floorId: 'f1', routeNodeId: 'node-f1' },
        { floorId: 'f2', routeNodeId: 'node-f2' },
      ],
    }]
    const doc = document([b])

    expect(floorDeleteHandler.execute(doc, { floorId: 'f1' }).success).toBe(true)
    const restored = deserializeDocument(serializeDocument(doc))
    const restoredBuilding = restored.buildings[0]!

    expect(restoredBuilding.floors.map(candidate => candidate.id)).toEqual(['f0', 'f2'])
    expect(restoredBuilding.staircases?.[0]?.levels[1]).toBeUndefined()
    expect(Object.keys(restoredBuilding.staircases?.[0]?.levels ?? {})).toEqual(['0', '2'])
    expect(restoredBuilding.verticalTransitions).toEqual([])

    const compiledNodes: PrimitiveNode[] = [
      {
        id: 'R-node-f0', kind: 'waypoint', position: { lat: 14, lng: 121 }, floor: 0,
        buildingId: 'building-a', accessible: true,
        source: { entityId: 'node-f0', entityType: 'route_node', generatorId: 'test' },
      },
      {
        id: 'R-node-f2', kind: 'waypoint', position: { lat: 14, lng: 121 }, floor: 2,
        buildingId: 'building-a', accessible: true,
        source: { entityId: 'node-f2', entityType: 'route_node', generatorId: 'test' },
      },
    ]
    const result = compileCanonicalAccess(restored as unknown as NormalizedDocument, compiledNodes)
    expect(result.edges.filter(edge => edge.kind === 'transition')).toEqual([])
  })
})
