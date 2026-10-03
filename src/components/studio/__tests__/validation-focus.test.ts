import { describe, expect, it } from 'vitest'
import { CoordinateTransformer } from '@navi/core'
import type { Building, CampusDocument, Floor, Room, Entrance } from '@navi/core'
import type { ValidationIssue } from '@navi/editor'
import { Graph } from '@/engine/graph'
import type { NavNode } from '@/types/nav-types'
import { resolveValidationFocus } from '../validation-focus'

const ORIGIN = { lat: 10, lng: 20 }

function makeRoom(): Room {
  return {
    id: 'room-1',
    name: 'Room 1',
    number: '101',
    category: 'other' as Room['category'],
    polygon: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 0 },
      ],
    },
    roomDoors: [],
    metadata: {},
  }
}

function makeEntrance(): Entrance {
  return {
    id: 'entrance-1',
    label: 'Main entrance',
    position: { x: 0, y: 0 },
    level: 0,
    type: 'main' as Entrance['type'],
    hasQR: false,
    hasPanorama: false,
  }
}

function makeFloor(): Floor {
  return {
    id: 'floor-0',
    level: 0,
    label: 'Ground floor',
    elevation: 0,
    height: 3.5,
    rooms: [makeRoom()],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [makeEntrance()],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
  }
}

function makeBuilding(): Building {
  return {
    id: 'building-1',
    name: 'Test building',
    code: 'TB',
    category: 'other' as Building['category'],
    description: '',
    footprint: {
      points: [
        { lat: 10, lng: 20 },
        { lat: 10, lng: 20.001 },
        { lat: 10.001, lng: 20.001 },
        { lat: 10, lng: 20 },
      ],
    },
    baseElevation: 0,
    height: 10,
    floors: [makeFloor()],
    verticalConnectors: [],
    color: '#ffffff',
    aliases: [],
    metadata: {},
  }
}

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'campus-1',
      name: 'Test campus',
      description: '',
      lastModified: '2026-08-31T00:00:00.000Z',
      editorVersion: 'test',
    },
    buildings: [makeBuilding()],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'building-1', origin: ORIGIN, rotation: 0 })
  return transformer
}

function makeIssue(targets: ValidationIssue['targets'], overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    issueId: 'issue-1',
    ruleId: 'test-rule',
    severity: 'error',
    message: 'Test validation issue',
    targets,
    ...overrides,
  }
}

function makeNode(id: string, position: { lat: number; lng: number }): NavNode {
  return {
    id,
    label: id,
    position,
    floor: 0,
    buildingId: 'building-1',
    campusId: 'campus-1',
    type: 'walkway',
  }
}

describe('resolveValidationFocus', () => {
  it('resolves authored building, room, and entrance targets with scope', () => {
    const document = makeDocument()
    const graph = new Graph()
    const transformer = makeTransformer()

    const buildingFocus = resolveValidationFocus(
      makeIssue([{ entityId: 'building-1', entityType: 'building' }], { buildingId: 'building-1', layer: 'base' }),
      document,
      graph,
      transformer,
    )
    expect(buildingFocus).toMatchObject({ targetId: 'building-1', targetType: 'building', buildingId: 'building-1', geometry: { kind: 'polygon' } })

    const roomFocus = resolveValidationFocus(
      makeIssue([{ entityId: 'room-1', entityType: 'room' }], { buildingId: 'building-1', floorId: 'floor-0', layer: 'architecture' }),
      document,
      graph,
      transformer,
    )
    expect(roomFocus).toMatchObject({ targetId: 'room-1', targetType: 'room', buildingId: 'building-1', floor: 0, geometry: { kind: 'polygon' } })
    if (roomFocus?.geometry.kind === 'polygon') {
      expect(roomFocus.geometry.points).toHaveLength(4)
      expect(roomFocus.geometry.points[0].lat).toBeCloseTo(ORIGIN.lat, 8)
      expect(roomFocus.geometry.points[0].lng).toBeCloseTo(ORIGIN.lng, 8)
    }

    const entranceFocus = resolveValidationFocus(
      makeIssue([{ entityId: 'entrance-1', entityType: 'entrance' }], { buildingId: 'building-1', floorId: 'floor-0', layer: 'access' }),
      document,
      graph,
      transformer,
    )
    expect(entranceFocus).toMatchObject({ targetId: 'entrance-1', targetType: 'entrance', buildingId: 'building-1', floor: 0, geometry: { kind: 'point' } })
  })

  it('resolves a derived route node from the graph without coercing its selector type', () => {
    const graph = new Graph()
    graph.addNode(makeNode('route-node-1', { lat: 10.002, lng: 20.002 }))

    const focus = resolveValidationFocus(
      makeIssue([{ entityId: 'route-node-1', entityType: 'route-node' }], { buildingId: 'building-1', floorId: 'floor-0', layer: 'navigation' }),
      makeDocument(),
      graph,
      makeTransformer(),
    )

    expect(focus).toMatchObject({ targetId: 'route-node-1', targetType: 'route-node', buildingId: 'building-1', floor: 0, geometry: { kind: 'point', position: { lat: 10.002, lng: 20.002 } } })
  })

  it('resolves a derived route edge as the line between its endpoint nodes', () => {
    const graph = new Graph()
    graph.addNode(makeNode('route-node-a', { lat: 10.002, lng: 20.002 }))
    graph.addNode(makeNode('route-node-b', { lat: 10.003, lng: 20.003 }))
    graph.addEdge({ id: 'route-edge-1', from: 'route-node-a', to: 'route-node-b', type: 'walk', distance: 10 })

    const focus = resolveValidationFocus(
      makeIssue([{ entityId: 'route-edge-1', entityType: 'route-edge' }], { buildingId: 'building-1', floorId: 'floor-0', layer: 'navigation' }),
      makeDocument(),
      graph,
      makeTransformer(),
    )

    expect(focus).toMatchObject({ targetId: 'route-edge-1', targetType: 'route-edge', buildingId: 'building-1', floor: 0, geometry: { kind: 'line', points: [{ lat: 10.002, lng: 20.002 }, { lat: 10.003, lng: 20.003 }] } })
  })

  it('resolves raw document route IDs projected by GraphAdapter', () => {
    const graph = new Graph()
    graph.addNode({
      ...makeNode('N-route-route-node-raw', { lat: 10.002, lng: 20.002 }),
      metadata: { routeNodeId: 'route-node-raw' },
    })
    graph.addNode({
      ...makeNode('N-route-route-node-raw-b', { lat: 10.003, lng: 20.003 }),
      metadata: { routeNodeId: 'route-node-raw-b' },
    })
    graph.addEdge({ id: 'E-route-route-edge-raw', from: 'N-route-route-node-raw', to: 'N-route-route-node-raw-b', type: 'walk', distance: 10 })

    const nodeFocus = resolveValidationFocus(
      makeIssue([{ entityId: 'route-node-raw', entityType: 'route-node' }], { buildingId: 'building-1', layer: 'navigation' }),
      makeDocument(),
      graph,
      makeTransformer(),
    )
    const edgeFocus = resolveValidationFocus(
      makeIssue([{ entityId: 'route-edge-raw', entityType: 'route-edge' }], { buildingId: 'building-1', layer: 'navigation' }),
      makeDocument(),
      graph,
      makeTransformer(),
    )

    expect(nodeFocus).toMatchObject({ targetId: 'route-node-raw', targetType: 'route-node', geometry: { kind: 'point' } })
    expect(edgeFocus).toMatchObject({ targetId: 'route-edge-raw', targetType: 'route-edge', geometry: { kind: 'line' } })
  })

  it('returns null for a missing route node instead of jumping to the origin', () => {
    const focus = resolveValidationFocus(
      makeIssue([{ entityId: 'missing-node', entityType: 'route-node' }]),
      makeDocument(),
      new Graph(),
      makeTransformer(),
    )

    expect(focus).toBeNull()
  })

  it('returns null for a document-wide issue with no concrete target', () => {
    const focus = resolveValidationFocus(
      makeIssue([], { buildingId: 'building-1', floorId: 'floor-0' }),
      makeDocument(),
      new Graph(),
      makeTransformer(),
    )

    expect(focus).toBeNull()
  })
})
