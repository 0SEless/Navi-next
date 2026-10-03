import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building, Component, LocalPolygon } from '@navi/core'
import { compileComponent } from '@/engine/component-compiler'
import { ValidationEngine } from '../validation-engine'
import { featureExtentRule, featureOverlapRule, featureConnectivityRule } from '../rules/modules/feature-rules'

function createBaseBuilding(): Building {
  return {
    id: 'bld-1',
    name: 'Science Hall',
    code: 'SH',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 33.42, lng: -111.93 },
        { lat: 33.421, lng: -111.93 },
        { lat: 33.421, lng: -111.929 },
        { lat: 33.42, lng: -111.929 },
        { lat: 33.42, lng: -111.93 },
      ],
    },
    baseElevation: 0,
    height: 20,
    floors: [
      {
        id: 'flr-0',
        level: 0,
        label: 'Ground',
        elevation: 0,
        rooms: [],
        hallways: [
          {
            id: 'hw-0',
            name: 'Main Corridor F0',
            polyline: {
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
              ],
            },
            width: 2,
            floorId: 'flr-0',
          },
        ],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
      {
        id: 'flr-1',
        level: 1,
        label: 'First Floor',
        elevation: 4,
        rooms: [],
        hallways: [
          {
            id: 'hw-1',
            name: 'Main Corridor F1',
            polyline: {
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
              ],
            },
            width: 2,
            floorId: 'flr-1',
          },
        ],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
      {
        id: 'flr-2',
        level: 2,
        label: 'Second Floor',
        elevation: 8,
        rooms: [],
        hallways: [
          {
            id: 'hw-2',
            name: 'Main Corridor F2',
            polyline: {
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
              ],
            },
            width: 2,
            floorId: 'flr-2',
          },
        ],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
      {
        id: 'flr-3',
        level: 3,
        label: 'Third Floor',
        elevation: 12,
        rooms: [],
        hallways: [
          {
            id: 'hw-3',
            name: 'Main Corridor F3',
            polyline: {
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
              ],
            },
            width: 2,
            floorId: 'flr-3',
          },
        ],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
    ],
    verticalConnectors: [],
    aliases: [],
    color: '#0000ff',
    metadata: {},
  }
}

function createDoc(bld: Building): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'test-campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [bld],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('P2 Derivation: Deterministic Node and Edge IDs', () => {
  it('derives deterministic N-stair and E-stair IDs and connects served floors across floors', () => {
    const featureId = 'stair-alpha'
    const context: any = {
      buildings: new Map(),
      existingNodes: [
        {
          id: 'hw-node-0',
          label: 'Hallway F0',
          name: 'Hallway F0',
          type: 'hallway',
          buildingId: 'bld-1',
          campusId: 'test-campus',
          floor: 0,
          position: { lat: 33.4201, lng: -111.9299 },
        },
      ],
      existingEdges: [],
      componentId: `${featureId}-0`,
      campusId: 'test-campus',
    }

    // Compile Floor 0
    const comp0: Component = {
      id: `${featureId}-0`,
      featureId,
      type: 'stair',
      name: 'Central Stair',
      buildingId: 'bld-1',
      campusId: 'test-campus',
      floor: 0,
      position: { lat: 33.4201, lng: -111.9299 },
    }
    const res0 = compileComponent(comp0, context)
    expect(res0.nodes).toHaveLength(1)
    expect(res0.nodes[0].id).toBe(`N-stair-${featureId}-0`)

    // Add floor 0 node and hallway node to context for Floor 1 compilation
    context.existingNodes.push(res0.nodes[0])
    context.existingNodes.push({
      id: 'hw-node-1',
      label: 'Hallway F1',
      name: 'Hallway F1',
      type: 'hallway',
      buildingId: 'bld-1',
      campusId: 'test-campus',
      floor: 1,
      position: { lat: 33.4201, lng: -111.9299 },
    })

    // Compile Floor 1
    const comp1: Component = {
      id: `${featureId}-1`,
      featureId,
      type: 'stair',
      name: 'Central Stair',
      buildingId: 'bld-1',
      campusId: 'test-campus',
      floor: 1,
      position: { lat: 33.4201, lng: -111.9299 },
    }
    const res1 = compileComponent(comp1, context)
    expect(res1.nodes).toHaveLength(1)
    expect(res1.nodes[0].id).toBe(`N-stair-${featureId}-1`)

    // Vertical chain edge
    const vertEdge = res1.edges.find((e) => e.type === 'stairs' && e.to === `N-stair-${featureId}-1` && e.from === `N-stair-${featureId}-0`)
    expect(vertEdge).toBeDefined()
    expect(vertEdge!.id).toBe(`E-stair-${featureId}-0-1`)
  })

  it('handles elevator pass-through correctly (extent G->3, access G,1,3 without creating floor 2 node or edges)', () => {
    const featureId = 'elev-main'
    const context: any = {
      buildings: new Map(),
      existingNodes: [
        { id: 'hw0', name: 'hw0', type: 'hallway', buildingId: 'bld-1', floor: 0, position: { lat: 33.42, lng: -111.93 } },
      ],
      existingEdges: [],
      componentId: `${featureId}-0`,
      campusId: 'test-campus',
    }

    // Floor 0
    const res0 = compileComponent({
      id: `${featureId}-0`, featureId, type: 'elevator', name: 'Main Elevator',
      buildingId: 'bld-1', campusId: '', floor: 0, position: { lat: 33.42, lng: -111.93 },
    }, context)
    expect(res0.nodes[0].id).toBe(`N-elevator-${featureId}-0`)
    context.existingNodes.push(res0.nodes[0])

    // Floor 1
    context.existingNodes.push({ id: 'hw1', name: 'hw1', type: 'hallway', buildingId: 'bld-1', floor: 1, position: { lat: 33.42, lng: -111.93 } })
    const res1 = compileComponent({
      id: `${featureId}-1`, featureId, type: 'elevator', name: 'Main Elevator',
      buildingId: 'bld-1', campusId: '', floor: 1, position: { lat: 33.42, lng: -111.93 },
    }, context)
    expect(res1.nodes[0].id).toBe(`N-elevator-${featureId}-1`)
    expect(res1.edges.find((e) => e.id === `E-elevator-${featureId}-0-1`)).toBeDefined()
    context.existingNodes.push(res1.nodes[0])

    // Floor 2 is pass-through (no component emitted)

    // Floor 3
    context.existingNodes.push({ id: 'hw3', name: 'hw3', type: 'hallway', buildingId: 'bld-1', floor: 3, position: { lat: 33.42, lng: -111.93 } })
    const res3 = compileComponent({
      id: `${featureId}-3`, featureId, type: 'elevator', name: 'Main Elevator',
      buildingId: 'bld-1', campusId: '', floor: 3, position: { lat: 33.42, lng: -111.93 },
    }, context)
    expect(res3.nodes[0].id).toBe(`N-elevator-${featureId}-3`)
    // Directly chains served floors 1 -> 3
    expect(res3.edges.find((e) => e.id === `E-elevator-${featureId}-1-3`)).toBeDefined()
  })

  it('proves that moving geometry changes edge distances/weights but preserves featureId and node/edge identities', () => {
    const featureId = 'stair-stable'
    const context: any = {
      buildings: new Map(),
      existingNodes: [
        { id: `N-stair-${featureId}-0`, name: 's0', type: 'staircase', buildingId: 'bld-1', floor: 0, position: { lat: 33.42, lng: -111.93 } },
        { id: 'hw1', name: 'hw1', type: 'hallway', buildingId: 'bld-1', floor: 1, position: { lat: 33.4205, lng: -111.9305 } },
      ],
      existingEdges: [],
      componentId: `${featureId}-1`,
      campusId: 'test',
    }

    // Initial position
    const resInitial = compileComponent({
      id: `${featureId}-1`, featureId, type: 'stair', name: 'Stair', buildingId: 'bld-1', campusId: '', floor: 1,
      position: { lat: 33.4201, lng: -111.9301 },
    }, context)

    // Moved position
    const resMoved = compileComponent({
      id: `${featureId}-1`, featureId, type: 'stair', name: 'Stair', buildingId: 'bld-1', campusId: '', floor: 1,
      position: { lat: 33.4203, lng: -111.9303 },
    }, context)

    // IDs are identical
    expect(resInitial.nodes[0].id).toBe(`N-stair-${featureId}-1`)
    expect(resMoved.nodes[0].id).toBe(`N-stair-${featureId}-1`)

    const initialHallEdge = resInitial.edges.find((e) => e.id === `E-stair-hall-${featureId}-1`)!
    const movedHallEdge = resMoved.edges.find((e) => e.id === `E-stair-hall-${featureId}-1`)!
    expect(initialHallEdge).toBeDefined()
    expect(movedHallEdge).toBeDefined()
    expect(initialHallEdge.distance).not.toBe(movedHallEdge.distance)
  })
})

describe('P2 Feature Validation Rules', () => {
  it('validates compliant staircase without diagnostics', () => {
    const bld = createBaseBuilding()
    bld.staircases = [
      {
        id: 'stair-valid',
        buildingId: 'bld-1',
        name: 'Valid Stair',
        type: 'standard',
        accessible: false,
        fromLevel: 0,
        toLevel: 1,
        levels: {
          0: { position: { x: 5, y: 0 }, rotation: 0 },
          1: { position: { x: 5, y: 0 }, rotation: 0 },
        },
      },
    ]

    const doc = createDoc(bld)
    const engine = new ValidationEngine()
    engine.registerRule(featureExtentRule)
    engine.registerRule(featureOverlapRule)
    engine.registerRule(featureConnectivityRule)
    engine.initialize()

    const snapshot = engine.validate(doc)
    const featureIssues = snapshot.issues.filter((i) => i.targets.some((t) => t.entityId === 'stair-valid'))
    expect(featureIssues).toHaveLength(0)
  })

  it('detects endpoint violation when staircase spans G->1 but geometry only exists on G', () => {
    const bld = createBaseBuilding()
    bld.staircases = [
      {
        id: 'stair-missing-endpoint',
        buildingId: 'bld-1',
        name: 'Incomplete Stair',
        type: 'standard',
        accessible: false,
        fromLevel: 0,
        toLevel: 1,
        levels: {
          0: { position: { x: 5, y: 0 }, rotation: 0 },
          // Missing level 1!
        },
      },
    ]

    const doc = createDoc(bld)
    const engine = new ValidationEngine()
    engine.registerRule(featureExtentRule)
    engine.initialize()

    const snapshot = engine.validate(doc)
    const issue = snapshot.issues.find((i) => i.ruleId === 'feature-extent' && i.targets.some((t) => t.entityId === 'stair-missing-endpoint'))
    expect(issue).toBeDefined()
    expect(issue!.message).toContain('spans to floor 1 but has no access/geometry')
  })

  it('detects room overlap when staircase polygon overlaps room interior', () => {
    const bld = createBaseBuilding()
    const roomPoly: LocalPolygon = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
    }
    bld.floors[0].rooms.push({
      id: 'rm-101',
      name: 'Conference Room',
      number: '101',
      floorId: 'flr-0',
      polygon: roomPoly,
      roomDoors: [],
      capacity: 20,
      metadata: {},
    })

    bld.staircases = [
      {
        id: 'stair-overlap',
        buildingId: 'bld-1',
        name: 'Overlapping Stair',
        type: 'standard',
        accessible: false,
        fromLevel: 0,
        toLevel: 1,
        levels: {
          0: {
            position: { x: 5, y: 5 },
            rotation: 0,
            polygon: {
              points: [
                { x: 4, y: 4 },
                { x: 6, y: 4 },
                { x: 6, y: 6 },
                { x: 4, y: 6 },
                { x: 4, y: 4 },
              ],
            },
          },
          1: { position: { x: 5, y: 5 }, rotation: 0 },
        },
      },
    ]

    const doc = createDoc(bld)
    const engine = new ValidationEngine()
    engine.registerRule(featureOverlapRule)
    engine.initialize()

    const snapshot = engine.validate(doc)
    const issue = snapshot.issues.find((i) => i.ruleId === 'feature-overlap' && i.targets.some((t) => t.entityId === 'stair-overlap'))
    expect(issue).toBeDefined()
    expect(issue!.message).toContain('overlaps with room "Conference Room"')
  })

  it('detects unreachable feature when staircase is too far from hallway', () => {
    const bld = createBaseBuilding()
    bld.staircases = [
      {
        id: 'stair-unconnected',
        buildingId: 'bld-1',
        name: 'Isolated Stair',
        type: 'standard',
        accessible: false,
        fromLevel: 0,
        toLevel: 1,
        levels: {
          0: { position: { x: 100, y: 100 }, rotation: 0 }, // 100m away from hallway
          1: { position: { x: 5, y: 0 }, rotation: 0 },
        },
      },
    ]

    const doc = createDoc(bld)
    const engine = new ValidationEngine()
    engine.registerRule(featureConnectivityRule)
    engine.initialize()

    const snapshot = engine.validate(doc)
    const issue = snapshot.issues.find((i) => i.ruleId === 'feature-connectivity' && i.targets.some((t) => t.entityId === 'stair-unconnected'))
    expect(issue).toBeDefined()
    expect(issue!.message).toContain('is 128m from nearest hallway')
  })
})
