import { describe, it, expect } from 'vitest'
import type {
  CampusDocument,
  Building,
  Floor,
  Wall,
  Opening,
  RoomAttributes,
  RoomAccess,
  EntranceAccess,
  VerticalTransition,
  Staircase,
  Elevator,
  Entrance,
  RouteNetwork,
} from '@navi/core'
import { serializeDocument, deserializeDocument } from '@navi/core'
import { validateIndoorRelationships, type RelationshipIssue } from '../rules/modules/indoor-relationships'

// ─── Helpers ───────────────────────────────────────────────

function makeWall(id: string, sx: number, sy: number, ex: number, ey: number): Wall {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: 0.15, height: 3.5 }
}

function makeOpening(id: string, wallId: string, offset: number, type: 'door' | 'window' = 'door'): Opening {
  return { id, type, wallId, offset, width: 0.9 }
}

function makeRouteNode(id: string, floor: number): import('@navi/core').RouteNode {
  return { id, type: 'waypoint', position: { x: 5, y: 5 }, floor }
}

function makeEntrance(id: string, level: number = 0): Entrance {
  return { id, label: id, position: { x: 0, y: 0 }, level, type: 'main', hasQR: false, hasPanorama: false }
}

function makeStaircase(id: string, buildingId: string): Staircase {
  return {
    id, buildingId, name: id, type: 'standard', accessible: false,
    fromLevel: 0, toLevel: 2,
    levels: { 0: { position: { x: 0, y: 0 }, rotation: 0 } },
  }
}

function makeElevator(id: string, buildingId: string): Elevator {
  return {
    id, buildingId, name: id, type: 'standard', accessible: true,
    fromLevel: 0, toLevel: 3,
    levels: { 0: { position: { x: 0, y: 0 }, rotation: 0 } },
  }
}

function makeFloor(id: string, level: number, overrides?: Partial<Floor>): Floor {
  return {
    id, level, label: `Floor ${level}`, elevation: 0, height: 3.5,
    rooms: [], hallways: [], staircases: [], elevators: [],
    entrances: [], connectorStops: [], parametricComponents: [],
    metadata: {},
    ...overrides,
  }
}

function makeBuilding(id: string, floors?: Floor[], overrides?: Partial<Building>): Building {
  return {
    id, name: id, code: id, category: 'academic', description: '',
    footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
    baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
    verticalConnectors: [],
    floors: floors ?? [makeFloor('flr-1', 0)],
    ...overrides,
  }
}

function makeDoc(buildings?: Building[]): CampusDocument {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: buildings ?? [makeBuilding('bld-1')],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function typesOf(issues: RelationshipIssue[]): string[] {
  return [...new Set(issues.map(i => i.type))]
}

// ─── Tests ─────────────────────────────────────────────────

describe('W14F — Canonical Relationship Integrity', () => {
  describe('1. Opening → Wall', () => {
    it('valid opening on valid wall passes', () => {
      const floor = makeFloor('flr-1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-wall')).toHaveLength(0)
    })

    it('opening referencing nonexistent wall', () => {
      const floor = makeFloor('flr-1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'nonexistent', 5)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-wall', entityId: 'o1', targetId: 'nonexistent' }))
    })

    it('opening on wrong floor', () => {
      const f0 = makeFloor('flr-0', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const f1 = makeFloor('flr-1', 1, {
        openings: [makeOpening('o1', 'w1', 5)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0, f1])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-wall', entityId: 'o1', targetId: 'w1', floorId: 'flr-1' }))
    })

    it('opening offset out of bounds', () => {
      const floor = makeFloor('flr-1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 15)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'opening-offset-out-of-bounds', entityId: 'o1' }))
    })

    it('deletion: removing wall leaves orphan opening', () => {
      const floor = makeFloor('flr-1', 0, {
        walls: [],
        openings: [makeOpening('o1', 'w1', 5)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-wall', entityId: 'o1' }))
    })
  })

  describe('2. RoomAttributes → Face', () => {
    it('valid RoomAttributes with faceId passes', () => {
      const floor = makeFloor('flr-1', 0, {
        roomAttributes: [{ faceId: 'face-1', name: 'Room A', searchable: true }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'invalid-face-reference')).toHaveLength(0)
    })

    it('empty faceId flagged', () => {
      const floor = makeFloor('flr-1', 0, {
        roomAttributes: [{ faceId: '', name: 'Room A', searchable: true }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'invalid-face-reference' }))
    })

    it('faceId survives edit (stable identity)', () => {
      const floor = makeFloor('flr-1', 0, {
        roomAttributes: [{ faceId: 'face-42', name: 'Room B', searchable: true }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.entityId === 'room-attr:face-42')).toHaveLength(0)
    })

    it('faceId persists through save/reload', () => {
      const floor = makeFloor('flr-1', 0, {
        roomAttributes: [{ faceId: 'face-7', name: 'Room C', searchable: true }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const issues = validateIndoorRelationships(restored)
      expect(issues.filter(i => i.type === 'invalid-face-reference')).toHaveLength(0)
    })
  })

  describe('3. RoomAccess → Door', () => {
    it('valid access to door opening on same floor passes', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-opening' || i.type === 'opening-not-door' || i.type === 'missing-route-node')).toHaveLength(0)
    })

    it('rejects window opening', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'window')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'opening-not-door', entityId: expect.stringContaining('o1') }))
    })

    it('rejects nonexistent opening', () => {
      const floor = makeFloor('flr-1', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'ghost', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-opening', targetId: 'ghost' }))
    })

    it('rejects access to door on wrong floor', () => {
      const f0 = makeFloor('flr-0', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const f1 = makeFloor('flr-1', 1, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 1)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0, f1])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-opening', floorId: 'flr-1' }))
    })

    it('deletion: removing opening creates orphan access', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-opening', targetId: 'o1' }))
    })
  })

  describe('4. RoomAccess → RouteNode', () => {
    it('valid access to route node on same floor passes', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-route-node')).toHaveLength(0)
    })

    it('rejects nonexistent route node', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'ghost', primary: true }],
        }],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-route-node', targetId: 'ghost' }))
    })

    it('rejects route node from wrong floor', () => {
      const f0 = makeFloor('flr-0', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const f1 = makeFloor('flr-1', 1, {
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0, f1])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-route-node', floorId: 'flr-1' }))
    })

    it('deletion: removing route node creates orphan access', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
        walls: [makeWall('w1', 0, 0, 10, 0)],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-route-node', targetId: 'rn1' }))
    })
  })

  describe('5. EntranceAccess', () => {
    it('valid entrance access passes', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [makeEntrance('ent-1')],
        routeNetwork: { nodes: [makeRouteNode('rn-indoor', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'rn-outdoor', indoorRouteNodeId: 'rn-indoor' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-entrance' || i.type === 'missing-indoor-route-node')).toHaveLength(0)
    })

    it('rejects missing entrance', () => {
      const floor = makeFloor('flr-1', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn-indoor', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ghost', outdoorNodeId: 'rn-outdoor', indoorRouteNodeId: 'rn-indoor' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-entrance', targetId: 'ghost' }))
    })

    it('rejects missing indoor route node', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [makeEntrance('ent-1')],
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'rn-outdoor', indoorRouteNodeId: 'ghost' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-indoor-route-node', targetId: 'ghost' }))
    })

    it('outdoorNodeId is preserved (external reference, not validated)', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [makeEntrance('ent-1')],
        routeNetwork: { nodes: [makeRouteNode('rn-indoor', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'ext-node-99', indoorRouteNodeId: 'rn-indoor' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.targetId === 'ext-node-99')).toHaveLength(0)
    })

    it('deletion: removing entrance creates orphan access', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [],
        routeNetwork: { nodes: [makeRouteNode('rn-indoor', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'rn-outdoor', indoorRouteNodeId: 'rn-indoor' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-entrance', targetId: 'ent-1' }))
    })

    it('wrong floor entrance reference', () => {
      const f0 = makeFloor('flr-0', 0, {
        entrances: [makeEntrance('ent-1')],
      })
      const f1 = makeFloor('flr-1', 1, {
        routeNetwork: { nodes: [makeRouteNode('rn-indoor', 1)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'rn-outdoor', indoorRouteNodeId: 'rn-indoor' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0, f1])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-entrance', floorId: 'flr-1' }))
    })
  })

  describe('6. VerticalTransition → Feature', () => {
    it('valid transition to staircase passes', () => {
      const stair = makeStaircase('stair-1', 'bld-1')
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'staircase',
        connections: [{ floorId: 'flr-0', routeNodeId: 'rn-0' }],
      }
      const f0 = makeFloor('flr-0', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn-0', 0)], edges: [] },
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0], {
        staircases: [stair],
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-vertical-feature')).toHaveLength(0)
    })

    it('valid transition to elevator passes', () => {
      const elev = makeElevator('elev-1', 'bld-1')
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'elev-1', type: 'elevator',
        connections: [{ floorId: 'flr-0', routeNodeId: 'rn-0' }],
      }
      const f0 = makeFloor('flr-0', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn-0', 0)], edges: [] },
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0], {
        elevators: [elev],
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-vertical-feature')).toHaveLength(0)
    })

    it('rejects nonexistent feature', () => {
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'ghost', type: 'staircase',
        connections: [{ floorId: 'flr-0', routeNodeId: 'rn-0' }],
      }
      const f0 = makeFloor('flr-0', 0)
      const doc = makeDoc([makeBuilding('bld-1', [f0], { verticalTransitions: [vt] })])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-vertical-feature', targetId: 'ghost' }))
    })

    it('rejects type mismatch', () => {
      const stair = makeStaircase('stair-1', 'bld-1')
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'elevator',
        connections: [],
      }
      const doc = makeDoc([makeBuilding('bld-1', [makeFloor('flr-0', 0)], {
        staircases: [stair],
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'vertical-transition-type-mismatch', entityId: 'vt-1' }))
    })
  })

  describe('7. VerticalTransition Connections', () => {
    it('valid connection with existing floor and node passes', () => {
      const stair = makeStaircase('stair-1', 'bld-1')
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'staircase',
        connections: [{ floorId: 'flr-0', routeNodeId: 'rn-0' }],
      }
      const f0 = makeFloor('flr-0', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn-0', 0)], edges: [] },
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0], {
        staircases: [stair],
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.type === 'missing-floor-in-connection' || i.type === 'missing-route-node-in-connection')).toHaveLength(0)
    })

    it('rejects connection to nonexistent floor', () => {
      const stair = makeStaircase('stair-1', 'bld-1')
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'staircase',
        connections: [{ floorId: 'ghost-floor', routeNodeId: 'rn-0' }],
      }
      const doc = makeDoc([makeBuilding('bld-1', [makeFloor('flr-0', 0)], {
        staircases: [stair],
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-floor-in-connection', targetId: 'ghost-floor' }))
    })

    it('rejects connection to nonexistent route node', () => {
      const stair = makeStaircase('stair-1', 'bld-1')
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'staircase',
        connections: [{ floorId: 'flr-0', routeNodeId: 'ghost-node' }],
      }
      const f0 = makeFloor('flr-0', 0, {
        routeNetwork: { nodes: [], edges: [] },
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0], {
        staircases: [stair],
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-route-node-in-connection', targetId: 'ghost-node', floorId: 'flr-0' }))
    })
  })

  describe('8. Multi-floor isolation', () => {
    it('cross-floor opening reference rejected', () => {
      const f0 = makeFloor('flr-0', 0, { walls: [makeWall('w1', 0, 0, 10, 0)] })
      const f1 = makeFloor('flr-1', 1, { openings: [makeOpening('o1', 'w1', 5)] })
      const doc = makeDoc([makeBuilding('bld-1', [f0, f1])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-wall', floorId: 'flr-1' }))
    })

    it('cross-floor route node reference rejected', () => {
      const f0 = makeFloor('flr-0', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
      })
      const f1 = makeFloor('flr-1', 1, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        walls: [makeWall('w1', 0, 0, 10, 0)],
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [f0, f1])])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-route-node', floorId: 'flr-1' }))
    })

    it('cross-building reference not validated (outdoorNodeId external)', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [makeEntrance('ent-1')],
        routeNetwork: { nodes: [makeRouteNode('rn-indoor', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'bld-2-road-node', indoorRouteNodeId: 'rn-indoor' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.filter(i => i.targetId === 'bld-2-road-node')).toHaveLength(0)
    })
  })

  describe('9. Deletion cascade / sanitization', () => {
    it('delete Wall → Opening orphaned', () => {
      const floor = makeFloor('flr-1', 0, { walls: [], openings: [makeOpening('o1', 'w1', 5)] })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.some(i => i.type === 'missing-wall')).toBe(true)
    })

    it('delete Opening → RoomAccess orphaned', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'f1', name: 'R', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.some(i => i.type === 'missing-opening')).toBe(true)
    })

    it('delete RouteNode → RoomAccess orphaned', () => {
      const floor = makeFloor('flr-1', 0, {
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        walls: [makeWall('w1', 0, 0, 10, 0)],
        routeNetwork: { nodes: [], edges: [] },
        roomAttributes: [{
          faceId: 'f1', name: 'R', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.some(i => i.type === 'missing-route-node')).toBe(true)
    })

    it('delete RouteNode → EntranceAccess orphaned', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [makeEntrance('ent-1')],
        routeNetwork: { nodes: [], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'out', indoorRouteNodeId: 'rn1' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.some(i => i.type === 'missing-indoor-route-node')).toBe(true)
    })

    it('delete Entrance → EntranceAccess orphaned', () => {
      const floor = makeFloor('flr-1', 0, {
        entrances: [],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'out', indoorRouteNodeId: 'rn1' }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])
      const issues = validateIndoorRelationships(doc)
      expect(issues.some(i => i.type === 'missing-entrance')).toBe(true)
    })

    it('delete Staircase → VerticalTransition orphaned', () => {
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'staircase',
        connections: [],
      }
      const doc = makeDoc([makeBuilding('bld-1', [makeFloor('flr-0', 0)], {
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-vertical-feature', targetId: 'stair-1' }))
    })

    it('delete Elevator → VerticalTransition orphaned', () => {
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'elev-1', type: 'elevator',
        connections: [],
      }
      const doc = makeDoc([makeBuilding('bld-1', [makeFloor('flr-0', 0)], {
        verticalTransitions: [vt],
      })])
      const issues = validateIndoorRelationships(doc)
      expect(issues).toContainEqual(expect.objectContaining({ type: 'missing-vertical-feature', targetId: 'elev-1' }))
    })
  })

  describe('10. Save/reload integrity', () => {
    it('valid relationship graph round-trips cleanly', () => {
      const stair = makeStaircase('stair-1', 'bld-1')
      const f0 = makeFloor('flr-0', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        entrances: [makeEntrance('ent-1')],
        routeNetwork: { nodes: [makeRouteNode('rn-0', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn-0', primary: true }],
        }],
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'out-1', indoorRouteNodeId: 'rn-0' }],
      })
      const vt: VerticalTransition = {
        id: 'vt-1', featureId: 'stair-1', type: 'staircase',
        connections: [{ floorId: 'flr-0', routeNodeId: 'rn-0' }],
      }
      const doc = makeDoc([makeBuilding('bld-1', [f0], { staircases: [stair], verticalTransitions: [vt] })])
      const before = validateIndoorRelationships(doc)
      expect(before).toHaveLength(0)

      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const after = validateIndoorRelationships(restored)
      expect(after).toHaveLength(0)
    })

    it('edited relationships round-trip cleanly', () => {
      const floor = makeFloor('flr-1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{
          faceId: 'face-1', name: 'Room', searchable: true,
          accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }],
        }],
      })
      const doc = makeDoc([makeBuilding('bld-1', [floor])])

      // Edit: move opening offset
      doc.buildings[0].floors[0].openings![0].offset = 3
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const issues = validateIndoorRelationships(restored)
      expect(issues.filter(i => i.entityId === 'o1')).toHaveLength(0)
    })
  })

  describe('11. Gate cases (24 required)', () => {
    it('G1: valid opening → valid wall', () => {
      const floor = makeFloor('f1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5)],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])]))).toHaveLength(0)
    })

    it('G2: opening → nonexistent wall', () => {
      const floor = makeFloor('f1', 0, { openings: [makeOpening('o1', 'w-miss', 5)] })
      const issues = validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])]))
      expect(issues.some(i => i.type === 'missing-wall')).toBe(true)
    })

    it('G3: opening → wall on wrong floor', () => {
      const f0 = makeFloor('f0', 0, { walls: [makeWall('w1', 0, 0, 10, 0)] })
      const f1 = makeFloor('f1', 1, { openings: [makeOpening('o1', 'w1', 5)] })
      const issues = validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0, f1])]))
      expect(issues.some(i => i.type === 'missing-wall' && i.floorId === 'f1')).toBe(true)
    })

    it('G4: opening offset out of bounds', () => {
      const floor = makeFloor('f1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 20)],
      })
      const issues = validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])]))
      expect(issues.some(i => i.type === 'opening-offset-out-of-bounds')).toBe(true)
    })

    it('G5: valid RoomAttributes → face', () => {
      const floor = makeFloor('f1', 0, { roomAttributes: [{ faceId: 'face-1', name: 'R', searchable: true }] })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])]))).toHaveLength(0)
    })

    it('G6: empty faceId', () => {
      const floor = makeFloor('f1', 0, { roomAttributes: [{ faceId: '', name: 'R', searchable: true }] })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'invalid-face-reference')).toBe(true)
    })

    it('G7: valid RoomAccess → door + node', () => {
      const floor = makeFloor('f1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])]))).toHaveLength(0)
    })

    it('G8: RoomAccess → window', () => {
      const floor = makeFloor('f1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5, 'window')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'opening-not-door')).toBe(true)
    })

    it('G9: RoomAccess → nonexistent opening', () => {
      const floor = makeFloor('f1', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'ghost', routeNodeId: 'rn1', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'missing-opening')).toBe(true)
    })

    it('G10: RoomAccess → wrong room/floor opening', () => {
      const f0 = makeFloor('f0', 0, { walls: [makeWall('w1', 0, 0, 10, 0)], openings: [makeOpening('o1', 'w1', 5, 'door')] })
      const f1 = makeFloor('f1', 1, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 1)], edges: [] },
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0, f1])])).some(i => i.type === 'missing-opening' && i.floorId === 'f1')).toBe(true)
    })

    it('G11: RoomAccess → nonexistent route node', () => {
      const floor = makeFloor('f1', 0, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        routeNetwork: { nodes: [], edges: [] },
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'o1', routeNodeId: 'ghost', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'missing-route-node')).toBe(true)
    })

    it('G12: RoomAccess → route node on wrong floor', () => {
      const f0 = makeFloor('f0', 0, { routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] } })
      const f1 = makeFloor('f1', 1, {
        walls: [makeWall('w1', 0, 0, 10, 0)],
        openings: [makeOpening('o1', 'w1', 5, 'door')],
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0, f1])])).some(i => i.type === 'missing-route-node' && i.floorId === 'f1')).toBe(true)
    })

    it('G13: valid EntranceAccess', () => {
      const floor = makeFloor('f1', 0, {
        entrances: [makeEntrance('ent-1')],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'out', indoorRouteNodeId: 'rn1' }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])]))).toHaveLength(0)
    })

    it('G14: EntranceAccess → missing entrance', () => {
      const floor = makeFloor('f1', 0, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        entranceAccess: [{ entranceId: 'ghost', outdoorNodeId: 'out', indoorRouteNodeId: 'rn1' }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'missing-entrance')).toBe(true)
    })

    it('G15: EntranceAccess → wrong floor entrance', () => {
      const f0 = makeFloor('f0', 0, { entrances: [makeEntrance('ent-1')] })
      const f1 = makeFloor('f1', 1, {
        routeNetwork: { nodes: [makeRouteNode('rn1', 1)], edges: [] },
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'out', indoorRouteNodeId: 'rn1' }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0, f1])])).some(i => i.type === 'missing-entrance' && i.floorId === 'f1')).toBe(true)
    })

    it('G16: EntranceAccess → missing indoor node', () => {
      const floor = makeFloor('f1', 0, {
        entrances: [makeEntrance('ent-1')],
        entranceAccess: [{ entranceId: 'ent-1', outdoorNodeId: 'out', indoorRouteNodeId: 'ghost' }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'missing-indoor-route-node')).toBe(true)
    })

    it('G17: valid VerticalTransition → staircase', () => {
      const stair = makeStaircase('stair-1', 'b1')
      const f0 = makeFloor('f0', 0, { routeNetwork: { nodes: [makeRouteNode('rn0', 0)], edges: [] } })
      const vt: VerticalTransition = { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [{ floorId: 'f0', routeNodeId: 'rn0' }] }
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0], { staircases: [stair], verticalTransitions: [vt] })]))).toHaveLength(0)
    })

    it('G18: valid VerticalTransition → elevator', () => {
      const elev = makeElevator('elev-1', 'b1')
      const f0 = makeFloor('f0', 0, { routeNetwork: { nodes: [makeRouteNode('rn0', 0)], edges: [] } })
      const vt: VerticalTransition = { id: 'vt-1', featureId: 'elev-1', type: 'elevator', connections: [{ floorId: 'f0', routeNodeId: 'rn0' }] }
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0], { elevators: [elev], verticalTransitions: [vt] })]))).toHaveLength(0)
    })

    it('G19: VerticalTransition → nonexistent feature', () => {
      const vt: VerticalTransition = { id: 'vt-1', featureId: 'ghost', type: 'staircase', connections: [] }
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [makeFloor('f0', 0)], { verticalTransitions: [vt] })])).some(i => i.type === 'missing-vertical-feature')).toBe(true)
    })

    it('G20: VerticalTransition type mismatch', () => {
      const stair = makeStaircase('stair-1', 'b1')
      const vt: VerticalTransition = { id: 'vt-1', featureId: 'stair-1', type: 'elevator', connections: [] }
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [makeFloor('f0', 0)], { staircases: [stair], verticalTransitions: [vt] })])).some(i => i.type === 'vertical-transition-type-mismatch')).toBe(true)
    })

    it('G21: VerticalTransition → nonexistent floor in connection', () => {
      const stair = makeStaircase('stair-1', 'b1')
      const vt: VerticalTransition = { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [{ floorId: 'ghost', routeNodeId: 'rn0' }] }
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [makeFloor('f0', 0)], { staircases: [stair], verticalTransitions: [vt] })])).some(i => i.type === 'missing-floor-in-connection')).toBe(true)
    })

    it('G22: VerticalTransition → nonexistent route node in connection', () => {
      const stair = makeStaircase('stair-1', 'b1')
      const f0 = makeFloor('f0', 0, { routeNetwork: { nodes: [], edges: [] } })
      const vt: VerticalTransition = { id: 'vt-1', featureId: 'stair-1', type: 'staircase', connections: [{ floorId: 'f0', routeNodeId: 'ghost' }] }
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [f0], { staircases: [stair], verticalTransitions: [vt] })])).some(i => i.type === 'missing-route-node-in-connection')).toBe(true)
    })

    it('G23: deletion cascade Wall → Opening', () => {
      const floor = makeFloor('f1', 0, { walls: [], openings: [makeOpening('o1', 'w1', 5)] })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'missing-wall')).toBe(true)
    })

    it('G24: deletion cascade Opening → RoomAccess', () => {
      const floor = makeFloor('f1', 0, {
        openings: [],
        routeNetwork: { nodes: [makeRouteNode('rn1', 0)], edges: [] },
        roomAttributes: [{ faceId: 'f1', name: 'R', searchable: true, accessPoints: [{ openingId: 'o1', routeNodeId: 'rn1', primary: true }] }],
      })
      expect(validateIndoorRelationships(makeDoc([makeBuilding('b1', [floor])])).some(i => i.type === 'missing-opening')).toBe(true)
    })
  })
})
