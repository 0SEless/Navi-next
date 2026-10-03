import { describe, it, expect } from 'vitest'
import { normalizeDocument } from '../normalize'
import type { CampusDocument, Building, Floor, RouteNetwork, EntranceAccess, VerticalTransition, RoomAttributes } from '@navi/core'

// ── Helpers ──

function makeMinimalDoc(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}

const FOOTPRINT = {
  points: [
    { lat: 14.0, lng: 121.0 },
    { lat: 14.0, lng: 121.001 },
    { lat: 14.001, lng: 121.001 },
    { lat: 14.001, lng: 121.0 },
    { lat: 14.0, lng: 121.0 },
  ],
}

function makeFloor(overrides?: Partial<Floor>): Floor {
  return {
    id: 'f1', level: 0, label: 'Ground', elevation: 0, height: 3.5,
    rooms: [{
      id: 'r1', name: 'Room 101', number: '101', category: 'classroom',
      polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
      roomDoors: [],
      metadata: {},
    }],
    hallways: [{
      id: 'hw1', name: 'Main Hall', polyline: { points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] }, width: 3,
    }],
    staircases: [], elevators: [],
    connectorStops: [],
    entrances: [{
      id: 'e1', label: 'Main Door',
      position: { lat: 14.0005, lng: 121.0005 } as any,
      level: 0, type: 'main', hasQR: false, hasPanorama: false,
    }],
    parametricComponents: [],
    metadata: {},
    ...overrides,
  }
}

function makeBuilding(overrides?: Partial<Building>): Building {
  return {
    id: 'b1', name: 'Building A', code: 'BA', category: 'academic', description: '',
    footprint: FOOTPRINT,
    baseElevation: 0, height: 10,
    floors: [makeFloor()],
    verticalConnectors: [],
    color: '#ccc', aliases: [], metadata: {},
    ...overrides,
  }
}

function makeDocWithCanonical(overrides?: { floor?: Partial<Floor>; building?: Partial<Building> }): CampusDocument {
  const routeNetwork: RouteNetwork = {
    nodes: [
      { id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 },
      { id: 'rn-2', type: 'waypoint', position: { x: 8, y: 3 }, floor: 0 },
      { id: 'rn-3', type: 'poi', position: { x: 5, y: 6 }, floor: 0 },
    ],
    edges: [
      { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 6 },
      { id: 're-2', from: 'rn-2', to: 'rn-3', type: 'walk', distance: 5 },
    ],
  }

  const roomAttributes: RoomAttributes[] = [
    { faceId: 'face-1', name: 'Room 101', number: '101', category: 'classroom', searchable: true },
  ]

  const entranceAccess: EntranceAccess[] = [
    { entranceId: 'e1', outdoorNodeId: 'outdoor-node-42', indoorRouteNodeId: 'rn-1' },
  ]

  const verticalTransitions: VerticalTransition[] = [
    { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [
      { floorId: 'b1-0', routeNodeId: 'rn-3' },
      { floorId: 'b1-1', routeNodeId: 'rn-upper-1' },
    ]},
  ]

  return makeMinimalDoc({
    buildings: [makeBuilding({
      floors: [makeFloor({
        routeNetwork,
        roomAttributes,
        entranceAccess,
      })],
      verticalTransitions,
      ...overrides?.building,
    })],
  })
}

// ── Tests ──

describe('W15B — Canonical Navigation Data Through Normalization', () => {
  describe('routeNetwork pass-through', () => {
    it('routeNetwork nodes survive normalization with IDs preserved', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.routeNetwork).toBeDefined()
      expect(floor.routeNetwork!.nodes.length).toBe(3)
      expect(floor.routeNetwork!.nodes[0]!.id).toBe('rn-1')
      expect(floor.routeNetwork!.nodes[1]!.id).toBe('rn-2')
      expect(floor.routeNetwork!.nodes[2]!.id).toBe('rn-3')
    })

    it('routeNetwork edges survive normalization with distances preserved', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.routeNetwork!.edges.length).toBe(2)
      expect(floor.routeNetwork!.edges[0]!.distance).toBe(6)
      expect(floor.routeNetwork!.edges[1]!.distance).toBe(5)
    })

    it('routeNetwork local coordinates preserved (not transformed to world)', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!
      const node = floor.routeNetwork!.nodes[0]!

      // Source local coords: { x: 2, y: 3 } — should be passed through as-is
      expect(node.position).toEqual({ x: 2, y: 3 })
    })

    it('routeNetwork edge from/to references preserved', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.routeNetwork!.edges[0]!.from).toBe('rn-1')
      expect(floor.routeNetwork!.edges[0]!.to).toBe('rn-2')
      expect(floor.routeNetwork!.edges[1]!.from).toBe('rn-2')
      expect(floor.routeNetwork!.edges[1]!.to).toBe('rn-3')
    })

    it('routeNetwork edge types preserved', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.routeNetwork!.edges[0]!.type).toBe('walk')
      expect(floor.routeNetwork!.edges[1]!.type).toBe('walk')
    })

    it('routeNetwork node types preserved', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.routeNetwork!.nodes[0]!.type).toBe('waypoint')
      expect(floor.routeNetwork!.nodes[2]!.type).toBe('poi')
    })
  })

  describe('roomAttributes pass-through', () => {
    it('roomAttributes survive normalization', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.roomAttributes).toBeDefined()
      expect(floor.roomAttributes!.length).toBe(1)
      expect(floor.roomAttributes![0]!.faceId).toBe('face-1')
      expect(floor.roomAttributes![0]!.name).toBe('Room 101')
      expect(floor.roomAttributes![0]!.number).toBe('101')
      expect(floor.roomAttributes![0]!.category).toBe('classroom')
      expect(floor.roomAttributes![0]!.searchable).toBe(true)
    })

    it('roomAttributes accessPoints survive normalization', () => {
      const doc = makeDocWithCanonical()
      // Add accessPoints to roomAttributes
      doc.buildings[0]!.floors[0]!.roomAttributes![0]!.accessPoints = [
        { openingId: 'op-1', routeNodeId: 'rn-1', primary: true },
      ]
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.roomAttributes![0]!.accessPoints).toBeDefined()
      expect(floor.roomAttributes![0]!.accessPoints!.length).toBe(1)
      expect(floor.roomAttributes![0]!.accessPoints![0]!.openingId).toBe('op-1')
      expect(floor.roomAttributes![0]!.accessPoints![0]!.routeNodeId).toBe('rn-1')
      expect(floor.roomAttributes![0]!.accessPoints![0]!.primary).toBe(true)
    })
  })

  describe('entranceAccess pass-through', () => {
    it('entranceAccess survive normalization', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.entranceAccess).toBeDefined()
      expect(floor.entranceAccess!.length).toBe(1)
      expect(floor.entranceAccess![0]!.entranceId).toBe('e1')
    })

    it('outdoorNodeId preserved exactly — NOT searched inside floor.routeNetwork', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      // outdoorNodeId is 'outdoor-node-42' — an external campus reference
      expect(floor.entranceAccess![0]!.outdoorNodeId).toBe('outdoor-node-42')

      // Confirm it is NOT an indoor route node
      const indoorNodeIds = floor.routeNetwork!.nodes.map(n => n.id)
      expect(indoorNodeIds).not.toContain('outdoor-node-42')
    })

    it('indoorRouteNodeId preserved exactly', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.entranceAccess![0]!.indoorRouteNodeId).toBe('rn-1')

      // Confirm it IS an indoor route node
      const indoorNodeIds = floor.routeNetwork!.nodes.map(n => n.id)
      expect(indoorNodeIds).toContain('rn-1')
    })

    it('multiple entranceAccess entries survive', () => {
      const doc = makeDocWithCanonical()
      doc.buildings[0]!.floors[0]!.entranceAccess!.push({
        entranceId: 'e2', outdoorNodeId: 'outdoor-road-99', indoorRouteNodeId: 'rn-2',
      })
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.entranceAccess!.length).toBe(2)
      expect(floor.entranceAccess![0]!.outdoorNodeId).toBe('outdoor-node-42')
      expect(floor.entranceAccess![1]!.outdoorNodeId).toBe('outdoor-road-99')
      expect(floor.entranceAccess![1]!.indoorRouteNodeId).toBe('rn-2')
    })
  })

  describe('verticalTransitions pass-through', () => {
    it('verticalTransitions survive normalization', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const bld = result.document.buildings[0]!

      expect(bld.verticalTransitions).toBeDefined()
      expect(bld.verticalTransitions!.length).toBe(1)
      expect(bld.verticalTransitions![0]!.id).toBe('vt-1')
      expect(bld.verticalTransitions![0]!.featureId).toBe('stair-1')
      expect(bld.verticalTransitions![0]!.type).toBe('staircase')
    })

    it('verticalTransitions connections preserved', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const vt = result.document.buildings[0]!.verticalTransitions![0]!

      expect(vt.connections.length).toBe(2)
      expect(vt.connections[0]!.floorId).toBe('b1-0')
      expect(vt.connections[0]!.routeNodeId).toBe('rn-3')
      expect(vt.connections[1]!.floorId).toBe('b1-1')
      expect(vt.connections[1]!.routeNodeId).toBe('rn-upper-1')
    })
  })

  describe('coexistence and backward compatibility', () => {
    it('canonical Floor and legacy Floor coexist in same document', () => {
      const routeNetwork: RouteNetwork = {
        nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 }],
        edges: [],
      }

      const doc = makeMinimalDoc({
        buildings: [makeBuilding({
          floors: [
            // Floor 0: has canonical structures
            makeFloor({
              level: 0, label: 'Ground',
              routeNetwork,
              roomAttributes: [{ faceId: 'f-1', name: 'Lab', searchable: true }],
            }),
            // Floor 1: legacy (no canonical structures)
            makeFloor({
              id: 'f2', level: 1, label: 'First', elevation: 3.5,
              rooms: [{
                id: 'r2', name: 'Room 201', number: '201', category: 'office',
                polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }] },
                roomDoors: [], metadata: {},
              }],
              hallways: [], staircases: [], elevators: [],
              connectorStops: [], entrances: [], parametricComponents: [], metadata: {},
            }),
          ],
        })],
      })

      const result = normalizeDocument(doc)
      const floors = result.document.buildings[0]!.floors

      expect(floors.length).toBe(2)
      // Floor 0: has canonical data
      expect(floors[0]!.routeNetwork).toBeDefined()
      expect(floors[0]!.roomAttributes).toBeDefined()
      // Floor 1: legacy — no canonical fields
      expect(floors[1]!.routeNetwork).toBeUndefined()
      expect(floors[1]!.roomAttributes).toBeUndefined()
      expect(floors[1]!.entranceAccess).toBeUndefined()
    })

    it('old document with no canonical structures still normalizes', () => {
      const doc = makeMinimalDoc({
        buildings: [makeBuilding()],
      })

      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.routeNetwork).toBeUndefined()
      expect(floor.roomAttributes).toBeUndefined()
      expect(floor.entranceAccess).toBeUndefined()
      expect(result.document.buildings[0]!.verticalTransitions).toBeUndefined()
      // Existing data still normalizes correctly
      expect(floor.rooms.length).toBe(1)
      expect(floor.rooms[0]!.id).toBe('r1')
    })
  })

  describe('safety invariants', () => {
    it('normalization does not mutate the input document', () => {
      const doc = makeDocWithCanonical()
      const before = JSON.stringify(doc)
      normalizeDocument(doc)
      expect(JSON.stringify(doc)).toBe(before)
    })

    it('repeated normalization is deterministic', () => {
      const doc = makeDocWithCanonical()
      const a = normalizeDocument(doc)
      const b = normalizeDocument(doc)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('no duplicate canonical entities after normalization', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      const nodeIds = floor.routeNetwork!.nodes.map(n => n.id)
      expect(new Set(nodeIds).size).toBe(nodeIds.length)

      const edgeIds = floor.routeNetwork!.edges.map(e => e.id)
      expect(new Set(edgeIds).size).toBe(edgeIds.length)

      const entranceIds = floor.entranceAccess!.map(a => a.entranceId)
      expect(new Set(entranceIds).size).toBe(entranceIds.length)

      const vtIds = result.document.buildings[0]!.verticalTransitions!.map(v => v.id)
      expect(new Set(vtIds).size).toBe(vtIds.length)
    })

    it('floor IDs are correctly computed with building prefix', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const floor = result.document.buildings[0]!.floors[0]!

      expect(floor.id).toBe('b1-0')
    })
  })

  describe('regression guard', () => {
    it('existing normalize behavior unaffected — rooms still convert to world coords', () => {
      const doc = makeDocWithCanonical()
      const result = normalizeDocument(doc)
      const room = result.document.buildings[0]!.floors[0]!.rooms[0]!

      // Centroid at local (5, 4) from building origin (14.0004, 121.0004)
      expect(room.centroid.lat).toBeCloseTo(14.0004, 3)
      expect(room.centroid.lng).toBeCloseTo(121.0004, 3)
    })

    it('connector stops still normalize with behavior derivation', () => {
      const doc = makeDocWithCanonical()
      doc.buildings[0]!.floors[0]!.connectorStops = [{
        id: 'cs1', connectorId: 'vc1', position: { x: 5, y: 8 },
        anchors: [], accessible: true, metadata: {},
      }]
      doc.buildings[0]!.verticalConnectors = [{
        id: 'vc1', type: 'elevator', name: 'Elev A',
        stopIds: ['cs1'], accessible: true, metadata: {},
      }]

      const result = normalizeDocument(doc)
      const cs = result.document.buildings[0]!.floors[0]!.connectorStops[0]!
      expect(cs.behavior).toBe('elevator')
      expect(cs.baseCost).toBe(20)
    })
  })
})
