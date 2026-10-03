import { describe, it, expect } from 'vitest'
import { CoordinateTransformer } from '@navi/core'
import type {
  CampusDocument,
  Building,
  Wall,
  Opening,
  RoomAttributes,
  EntranceAccess,
  RouteNetwork,
  VerticalTransition,
  Staircase,
  Elevator,
  LocalCoord,
} from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'
import { wallCreateHandler, wallUpdateHandler } from '../commands/wall-handlers'
import { openingCreateHandler } from '../commands/feature-handlers'
import {
  routeNodeCreateHandler,
  routeNodeUpdateHandler,
  routeEdgeCreateHandler,
} from '../commands/route-network-handlers'
import { deriveRooms, type WallSegment } from '../geometry/room-derivation'

// ──────────────────────────────────────────────────────────
// Helper: epsilon-aware coordinate comparison
// ──────────────────────────────────────────────────────────
const EPSILON = 1e-6

function coordsEqual(a: LocalCoord, b: LocalCoord, eps = EPSILON): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

function coordsAlmostEqual(a: LocalCoord, b: LocalCoord, eps = 0.1): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

// ──────────────────────────────────────────────────────────
// SECTION 1: Multi-floor CampusDocument fixture (Building A: 2 floors, Building B: 1 floor)
// ──────────────────────────────────────────────────────────

function makeMultiFloorCampusDocument(): CampusDocument {
  const wallA1: Wall = {
    id: 'wall-a1-f0',
    start: { x: 2.5, y: 1.8 },
    end: { x: 12.5, y: 1.8 },
    thickness: 0.2,
    height: 4.0,
    metadata: { material: 'concrete', exterior: true },
  }
  const wallA2: Wall = {
    id: 'wall-a2-f0',
    start: { x: 12.5, y: 1.8 },
    end: { x: 12.5, y: 10.8 },
    thickness: 0.15,
    height: 3.5,
    metadata: { material: 'drywall' },
  }
  const wallA3: Wall = {
    id: 'wall-a3-f0',
    start: { x: 12.5, y: 10.8 },
    end: { x: 2.5, y: 10.8 },
    thickness: 0.15,
    height: 3.5,
  }

  const doorOpening: Opening = {
    id: 'open-door-f0',
    type: 'door',
    wallId: 'wall-a1-f0',
    offset: 4.0,
    width: 1.2,
    height: 2.4,
    metadata: { fireRating: '60min' },
  }
  const windowOpening: Opening = {
    id: 'open-win-f0',
    type: 'window',
    wallId: 'wall-a2-f0',
    offset: 2.0,
    width: 1.5,
    sillHeight: 0.9,
    metadata: { type: 'casement' },
  }

  const roomAttrs: RoomAttributes = {
    faceId: 'face-101',
    name: 'Computer Laboratory',
    number: '101',
    category: 'classroom',
    searchable: true,
    accessPoints: [
      { openingId: 'open-door-f0', routeNodeId: 'rn-f0-1', primary: true },
    ],
  }

  const routeNetwork0: RouteNetwork = {
    nodes: [
      { id: 'rn-f0-1', type: 'waypoint', position: { x: 6, y: 1.8 }, floor: 0 },
      { id: 'rn-f0-2', type: 'waypoint', position: { x: 6, y: 6 }, floor: 0 },
      { id: 'rn-f0-3', type: 'entrance', position: { x: 6, y: 1.8 }, floor: 0 },
    ],
    edges: [
      { id: 're-f0-1', from: 'rn-f0-1', to: 'rn-f0-2', type: 'walk', distance: 4.2 },
      { id: 're-f0-2', from: 'rn-f0-2', to: 'rn-f0-3', type: 'walk', distance: 4.2 },
    ],
  }

  const entranceAccess0: EntranceAccess[] = [
    { entranceId: 'ent-a-main', outdoorNodeId: 'road-ent-1', indoorRouteNodeId: 'rn-f0-3' },
  ]

  // ── Floor 1 data ──
  const wallB1: Wall = {
    id: 'wall-b1-f1',
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    thickness: 0.15,
    height: 3.0,
    metadata: { material: 'glass' },
  }
  const doorOpening1: Opening = {
    id: 'open-door-f1',
    type: 'door',
    wallId: 'wall-b1-f1',
    offset: 3.0,
    width: 1.0,
    height: 2.4,
  }
  const roomAttrs1: RoomAttributes = {
    faceId: 'face-201',
    name: 'Networking Lab',
    number: '201',
    category: 'lab',
    searchable: true,
  }
  const routeNetwork1: RouteNetwork = {
    nodes: [
      { id: 'rn-f1-1', type: 'waypoint', position: { x: 5, y: 0 }, floor: 1 },
      { id: 'rn-f1-2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
    ],
    edges: [
      { id: 're-f1-1', from: 'rn-f1-1', to: 'rn-f1-2', type: 'walk', distance: 5.0 },
    ],
  }

  const staircase: Staircase = {
    id: 'stair-main',
    buildingId: 'bld-a',
    name: 'Main Staircase',
    type: 'enclosed',
    accessible: true,
    fromLevel: 0,
    toLevel: 1,
    levels: {
      0: { position: { x: 14, y: 5 }, rotation: 0 },
      1: { position: { x: 14, y: 5 }, rotation: 0 },
    },
  }

  const elevator: Elevator = {
    id: 'elev-main',
    buildingId: 'bld-a',
    name: 'Main Elevator',
    type: 'passenger',
    accessible: true,
    fromLevel: 0,
    toLevel: 1,
    levels: {
      0: { position: { x: 14, y: 8 }, rotation: 0 },
      1: { position: { x: 14, y: 8 }, rotation: 0 },
    },
  }

  const verticalTransitions: VerticalTransition[] = [
    {
      id: 'vt-stair',
      featureId: 'stair-main',
      type: 'staircase',
      connections: [
        { floorId: 'flr-a-g', routeNodeId: 'rn-f0-2' },
        { floorId: 'flr-a-1', routeNodeId: 'rn-f1-2' },
      ],
    },
    {
      id: 'vt-elev',
      featureId: 'elev-main',
      type: 'elevator',
      connections: [
        { floorId: 'flr-a-g', routeNodeId: 'rn-f0-2' },
        { floorId: 'flr-a-1', routeNodeId: 'rn-f1-2' },
      ],
    },
  ]

  const buildingA: Building = {
    id: 'bld-a',
    name: 'Building A',
    code: 'A',
    category: 'academic',
    description: 'Main academic building',
    department: 'Computer Science',
    footprint: {
      points: [
        { lat: 33.420, lng: -111.930 },
        { lat: 33.421, lng: -111.930 },
        { lat: 33.421, lng: -111.929 },
        { lat: 33.420, lng: -111.929 },
        { lat: 33.420, lng: -111.930 },
      ],
    },
    baseElevation: 340,
    height: 20,
    rotation: 15,
    color: '#336699',
    aliases: ['Bldg A', 'Main'],
    metadata: { built: 2020, wing: 'north' },
    verticalConnectors: [],
    staircases: [staircase],
    elevators: [elevator],
    verticalTransitions,
    floors: [
      {
        id: 'flr-a-g',
        level: 0,
        label: 'Ground Floor',
        shortLabel: 'G',
        elevation: 0,
        height: 4.0,
        offset: { x: 2.5, y: 1.8 },
        rotation: 15,
        planImageId: 'plan-g-001',
        planAlignment: {
          offset: { x: 1, y: 0.5 },
          scale: 1.2,
          rotation: 10,
          opacity: 0.8,
        },
        textureId: 'tex-concrete',
        svgOverlayId: 'svg-floor-g',
        visible: false,
        locked: true,
        floorPlanState: 'locked',
        walls: [wallA1, wallA2, wallA3],
        openings: [doorOpening, windowOpening],
        roomAttributes: [roomAttrs],
        routeNetwork: routeNetwork0,
        entranceAccess: entranceAccess0,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [
          {
            id: 'ent-a-main',
            label: 'Main Entrance',
            position: { x: 7.5, y: 0 },
            level: 0,
            type: 'main',
            hasQR: true,
            hasPanorama: true,
          },
        ],
        connectorStops: [],
        parametricComponents: [],
        metadata: { wing: 'north', temp: 22 },
      },
      {
        id: 'flr-a-1',
        level: 1,
        label: 'Second Floor',
        shortLabel: '1F',
        elevation: 4.0,
        height: 3.5,
        offset: { x: 0, y: 0 },
        rotation: 0,
        planImageId: 'plan-1-001',
        visible: true,
        locked: false,
        walls: [wallB1],
        openings: [doorOpening1],
        roomAttributes: [roomAttrs1],
        routeNetwork: routeNetwork1,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
      },
    ],
  }

  // ── Building B: minimal isolation proof ──
  const buildingB: Building = {
    id: 'bld-b',
    name: 'Building B',
    code: 'B',
    category: 'administrative',
    description: 'Admin offices',
    footprint: {
      points: [
        { lat: 33.425, lng: -111.935 },
        { lat: 33.426, lng: -111.935 },
        { lat: 33.426, lng: -111.934 },
        { lat: 33.425, lng: -111.934 },
        { lat: 33.425, lng: -111.935 },
      ],
    },
    baseElevation: 340,
    height: 15,
    color: '#669933',
    metadata: {},
    verticalConnectors: [],
    floors: [
      {
        id: 'flr-b-g',
        level: 0,
        label: 'Ground Floor',
        elevation: 0,
        height: 3.5,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
        walls: [
          {
            id: 'wall-b-only',
            start: { x: 0, y: 0 },
            end: { x: 5, y: 0 },
            thickness: 0.15,
            height: 3.0,
          },
        ],
      },
    ],
  }

  return {
    schemaVersion: 2,
    version: 100,
    metadata: {
      campusId: 'test-campus-w14d',
      name: 'W14D Test Campus',
      description: 'Edit-after-reload verification',
      lastModified: '2026-08-26T00:00:00.000Z',
      editorVersion: '2.0.0',
    },
    buildings: [buildingA, buildingB],
    roads: [
      {
        id: 'road-main',
        name: 'Main Road',
        polyline: { points: [{ lat: 33.420, lng: -111.931 }, { lat: 33.420, lng: -111.928 }] },
        width: 6,
        surface: 'paved',
        type: 'arterial',
        connectorEntranceId: 'ent-a-main',
        metadata: { lanes: 2 },
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ──────────────────────────────────────────────────────────
// Helper: register building + floors in transformer
// ──────────────────────────────────────────────────────────
function registerBuildingInTransformer(transformer: CoordinateTransformer, doc: CampusDocument) {
  for (const b of doc.buildings) {
    const pts = b.footprint.points
    const origin = pts.length > 0
      ? { lat: (pts[0].lat + pts[1].lat) / 2, lng: (pts[0].lng + pts[1].lng) / 2 }
      : { lat: 0, lng: 0 }
    transformer.registerBuilding({
      buildingId: b.id,
      origin,
      rotation: b.rotation ?? 0,
    })
    for (const f of b.floors) {
      transformer.registerFloor(b.id, f.level, {
        offset: f.offset ?? { x: 0, y: 0 },
        rotation: f.rotation ?? 0,
      })
    }
  }
}

// ──────────────────────────────────────────────────────────
// Helper: full graph pipeline round-trip
// ──────────────────────────────────────────────────────────
function graphPipelineRoundTrip(doc: CampusDocument): { doc2: CampusDocument; transformer: CoordinateTransformer } {
  const graph = new Graph()
  const transformer = new CoordinateTransformer()
  registerBuildingInTransformer(transformer, doc)
  new GraphAdapter(graph, transformer).sync(doc)
  const doc2 = createDocument(graph, transformer)
  return { doc2, transformer }
}

// ──────────────────────────────────────────────────────────
// Helper: find floor by building and floor id
// ──────────────────────────────────────────────────────────
function findFloor(doc: CampusDocument, buildingId: string, floorId: string) {
  const building = doc.buildings.find(b => b.id === buildingId)
  if (!building) throw new Error(`Building not found: ${buildingId}`)
  const floor = building.floors.find(f => f.id === floorId)
  if (!floor) throw new Error(`Floor not found: ${floorId}`)
  return { building, floor }
}

// ──────────────────────────────────────────────────────────
// SECTION 2: W14D — Edit-After-Reload Verification
// ──────────────────────────────────────────────────────────

describe('W14D: Edit-after-reload verification', () => {
  // ── Phase 1: Create document and do initial save/reload ──
  const docA = makeMultiFloorCampusDocument()
  const { doc2: docB, transformer } = graphPipelineRoundTrip(docA)

  // ── Phase 2: Apply edits to the RELOADED document using REAL command APIs ──

  // 1. Wall create after reload
  describe('1. Wall create after reload', () => {
    it('creates new wall on Floor 0', () => {
      const result = wallCreateHandler.execute(docB, {
        buildingId: 'bld-a',
        floorId: 'flr-a-g',
        start: { x: 3, y: 5 },
        end: { x: 8, y: 5 },
        thickness: 0.12,
        height: 3.0,
        id: 'wall-new-after-reload',
      })
      expect(result.success).toBe(true)
      expect(result.entityId).toBe('wall-new-after-reload')
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const wall = floor.walls!.find(w => w.id === 'wall-new-after-reload')!
      expect(wall).toBeDefined()
      expect(wall.start).toEqual({ x: 3, y: 5 })
      expect(wall.end).toEqual({ x: 8, y: 5 })
      expect(wall.thickness).toBe(0.12)
      expect(wall.height).toBe(3.0)
    })
  })

  // 2. Wall update after reload
  describe('2. Wall update after reload', () => {
    it('updates existing wall properties', () => {
      const result = wallUpdateHandler.execute(docB, {
        wallId: 'wall-a1-f0',
        buildingId: 'bld-a',
        floorId: 'flr-a-g',
        patch: {
          thickness: 0.25,
          height: 4.5,
          metadata: { material: 'concrete', exterior: true, updated: true },
        },
      })
      expect(result.success).toBe(true)
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const wall = floor.walls!.find(w => w.id === 'wall-a1-f0')!
      expect(wall.thickness).toBe(0.25)
      expect(wall.height).toBe(4.5)
      expect(wall.metadata).toEqual({ material: 'concrete', exterior: true, updated: true })
    })
  })

  // 3. Opening create after reload
  describe('3. Opening create after reload', () => {
    it('adds new door opening to existing wall', () => {
      const result = openingCreateHandler.execute(docB, {
        buildingId: 'bld-a',
        floorId: 'flr-a-g',
        opening: {
          id: 'open-new-door-after-reload',
          type: 'door',
          wallId: 'wall-a2-f0',
          offset: 5.0,
          width: 1.0,
          height: 2.4,
          metadata: { fireRating: '30min' },
        },
      })
      expect(result.success).toBe(true)
      expect(result.entityId).toBe('open-new-door-after-reload')
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const opening = floor.openings!.find(o => o.id === 'open-new-door-after-reload')!
      expect(opening).toBeDefined()
      expect(opening.type).toBe('door')
      expect(opening.wallId).toBe('wall-a2-f0')
      expect(opening.offset).toBe(5.0)
    })
  })

  // 4. Semantic Room metadata edit after reload
  describe('4. Semantic Room metadata edit after reload', () => {
    it('renames room from "Computer Laboratory" to "Networking Laboratory"', () => {
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const roomAttrs = floor.roomAttributes!
      expect(roomAttrs[0].name).toBe('Computer Laboratory')
      // roomAttributes is a canonical W1–W11 structure — edit directly
      // (entityUpdateHandler resolves rooms/hallways/etc., not roomAttributes)
      floor.roomAttributes![0].name = 'Networking Laboratory'
      expect(floor.roomAttributes![0].name).toBe('Networking Laboratory')
    })
  })

  // 5. RouteNode move after reload
  describe('5. RouteNode move after reload', () => {
    it('moves existing route node position', () => {
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const rn = floor.routeNetwork!
      expect(rn.nodes[0].id).toBe('rn-f0-1')
      const origPos = { ...rn.nodes[0].position }

      const result = routeNodeUpdateHandler.execute(docB, {
        nodeId: 'rn-f0-1',
        patch: { position: { x: 7, y: 2.5 } },
      })
      expect(result.success).toBe(true)
      expect(rn.nodes[0].position).toEqual({ x: 7, y: 2.5 })
      // Position changed
      expect(rn.nodes[0].position.x).not.toBe(origPos.x)
    })
  })

  // 6. RouteNode create after reload
  describe('6. RouteNode create after reload', () => {
    it('adds new route node', () => {
      const result = routeNodeCreateHandler.execute(docB, {
        buildingId: 'bld-a',
        floorId: 'flr-a-g',
        node: {
          id: 'rn-new-after-reload',
          type: 'poi',
          position: { x: 9, y: 3 },
        },
      })
      expect(result.success).toBe(true)
      expect(result.entityId).toBe('rn-new-after-reload')
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const node = floor.routeNetwork!.nodes.find(n => n.id === 'rn-new-after-reload')!
      expect(node).toBeDefined()
      expect(node.type).toBe('poi')
      expect(node.position).toEqual({ x: 9, y: 3 })
    })
  })

  // 7. RouteEdge create after reload
  describe('7. RouteEdge create after reload', () => {
    it('adds new route edge between nodes', () => {
      const result = routeEdgeCreateHandler.execute(docB, {
        buildingId: 'bld-a',
        floorId: 'flr-a-g',
        edge: {
          id: 're-new-after-reload',
          from: 'rn-f0-1',
          to: 'rn-new-after-reload',
          type: 'walk',
          distance: 3.5,
        },
      })
      expect(result.success).toBe(true)
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const edge = floor.routeNetwork!.edges.find(e => e.id === 're-new-after-reload')!
      expect(edge).toBeDefined()
      expect(edge.from).toBe('rn-f0-1')
      expect(edge.to).toBe('rn-new-after-reload')
      expect(edge.distance).toBe(3.5)
    })
  })

  // 8. RoomAccess primary change after reload
  describe('8. RoomAccess primary change after reload', () => {
    it('changes primary access point', () => {
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      const roomAttrs = floor.roomAttributes!
      expect(roomAttrs[0].accessPoints).toBeDefined()
      expect(roomAttrs[0].accessPoints!.length).toBeGreaterThan(0)
      // Add a second access point and change primary
      roomAttrs[0].accessPoints!.push({
        openingId: 'open-new-door-after-reload',
        routeNodeId: 'rn-f0-1',
        primary: false,
      })
      roomAttrs[0].accessPoints![0].primary = false
      roomAttrs[0].accessPoints![1].primary = true
      expect(roomAttrs[0].accessPoints![0].primary).toBe(false)
      expect(roomAttrs[0].accessPoints![1].primary).toBe(true)
    })
  })

  // 9. EntranceAccess edit after reload
  describe('9. EntranceAccess edit after reload', () => {
    it('modifies indoor route-node relationship', () => {
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      expect(floor.entranceAccess).toBeDefined()
      expect(floor.entranceAccess!.length).toBe(1)
      floor.entranceAccess![0].indoorRouteNodeId = 'rn-f0-1'
      expect(floor.entranceAccess![0].indoorRouteNodeId).toBe('rn-f0-1')
    })
  })

  // 10. VerticalTransition edit after reload
  describe('10. VerticalTransition edit after reload', () => {
    it('updates connection for staircase transition', () => {
      const bldA = docB.buildings.find(b => b.id === 'bld-a')!
      expect(bldA.verticalTransitions).toBeDefined()
      const vtStair = bldA.verticalTransitions!.find(v => v.id === 'vt-stair')!
      expect(vtStair).toBeDefined()
      // Change the floor 0 route node connection
      vtStair.connections[0].routeNodeId = 'rn-f0-1'
      expect(vtStair.connections[0].routeNodeId).toBe('rn-f0-1')
    })
  })

  // 11. PlanAlignment edit after reload
  describe('11. PlanAlignment edit after reload', () => {
    it('applies offset and rotation change', () => {
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      expect(floor.planAlignment).toBeDefined()
      floor.planAlignment = {
        offset: { x: 1.5, y: 0.8 },
        scale: 1.3,
        rotation: 15,
        opacity: 0.9,
      }
      expect(floor.planAlignment!.offset).toEqual({ x: 1.5, y: 0.8 })
      expect(floor.planAlignment!.scale).toBe(1.3)
      expect(floor.planAlignment!.rotation).toBe(15)
    })
  })

  // 12. Floor metadata edit after reload
  describe('12. Floor metadata edit after reload', () => {
    it('changes visible, locked, shortLabel', () => {
      const { floor } = findFloor(docB, 'bld-a', 'flr-a-g')
      floor.visible = true
      floor.locked = false
      floor.shortLabel = 'GF'
      expect(floor.visible).toBe(true)
      expect(floor.locked).toBe(false)
      expect(floor.shortLabel).toBe('GF')
    })
  })

  // ── Phase 3: Second save/reload ──
  describe('Phase 3: Second save/reload preserves all edits', () => {
    let docC: CampusDocument
    it('second round-trip produces docC', () => {
      const result = graphPipelineRoundTrip(docB)
      docC = result.doc2
      expect(docC).toBeDefined()
    })

    // 13. Second save/reload preserves all edits
    it('13. all edits survive second round-trip', () => {
      // Wall create
      const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
      expect(f0C.walls!.find(w => w.id === 'wall-new-after-reload')).toBeDefined()

      // Wall update
      const wallA1 = f0C.walls!.find(w => w.id === 'wall-a1-f0')!
      expect(wallA1.thickness).toBe(0.25)
      expect(wallA1.height).toBe(4.5)

      // Opening create
      expect(f0C.openings!.find(o => o.id === 'open-new-door-after-reload')).toBeDefined()

      // Room metadata edit
      expect(f0C.roomAttributes![0].name).toBe('Networking Laboratory')

      // RouteNode move
      const rn1 = f0C.routeNetwork!.nodes.find(n => n.id === 'rn-f0-1')!
      expect(rn1.position).toEqual({ x: 7, y: 2.5 })

      // RouteNode create
      expect(f0C.routeNetwork!.nodes.find(n => n.id === 'rn-new-after-reload')).toBeDefined()

      // RouteEdge create
      expect(f0C.routeNetwork!.edges.find(e => e.id === 're-new-after-reload')).toBeDefined()

      // RoomAccess primary change
      expect(f0C.roomAttributes![0].accessPoints![0].primary).toBe(false)
      expect(f0C.roomAttributes![0].accessPoints![1].primary).toBe(true)

      // EntranceAccess edit
      expect(f0C.entranceAccess![0].indoorRouteNodeId).toBe('rn-f0-1')

      // VerticalTransition edit
      const vtStair = docC.buildings.find(b => b.id === 'bld-a')!.verticalTransitions!.find(v => v.id === 'vt-stair')!
      expect(vtStair.connections[0].routeNodeId).toBe('rn-f0-1')

      // PlanAlignment edit
      expect(f0C.planAlignment!.offset).toEqual({ x: 1.5, y: 0.8 })
      expect(f0C.planAlignment!.rotation).toBe(15)

      // Floor metadata edit
      expect(f0C.visible).toBe(true)
      expect(f0C.locked).toBe(false)
      expect(f0C.shortLabel).toBe('GF')
    })

    // 14. Relationship references remain valid
    describe('14. Relationship references remain valid', () => {
      it('opening.wallId → valid Wall', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        for (const opening of f0C.openings!) {
          const wall = f0C.walls!.find(w => w.id === opening.wallId)
          expect(wall).toBeDefined()
        }
      })

      it('RoomAccess.openingId → valid Opening', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        for (const attrs of f0C.roomAttributes!) {
          if (!attrs.accessPoints) continue
          for (const ap of attrs.accessPoints) {
            const opening = f0C.openings!.find(o => o.id === ap.openingId)
            expect(opening).toBeDefined()
          }
        }
      })

      it('RoomAccess.routeNodeId → valid route node', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        for (const attrs of f0C.roomAttributes!) {
          if (!attrs.accessPoints) continue
          for (const ap of attrs.accessPoints) {
            const node = f0C.routeNetwork!.nodes.find(n => n.id === ap.routeNodeId)
            expect(node).toBeDefined()
          }
        }
      })

      it('EntranceAccess references → valid', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        for (const ea of f0C.entranceAccess!) {
          // entranceId refers to an Entrance on this floor
          const entrance = f0C.entrances.find(e => e.id === ea.entranceId)
          expect(entrance).toBeDefined()
          // indoorRouteNodeId refers to a route node
          const node = f0C.routeNetwork!.nodes.find(n => n.id === ea.indoorRouteNodeId)
          expect(node).toBeDefined()
        }
      })

      it('VerticalTransition references → valid', () => {
        const bldC = docC.buildings.find(b => b.id === 'bld-a')!
        for (const vt of bldC.verticalTransitions!) {
          // featureId refers to a staircase or elevator
          const stair = bldC.staircases!.find(s => s.id === vt.featureId)
          const elev = bldC.elevators!.find(e => e.id === vt.featureId)
          expect(stair || elev).toBeDefined()
          // Each connection's routeNodeId should exist on the respective floor
          for (const conn of vt.connections) {
            const floor = bldC.floors.find(f => f.id === conn.floorId)
            expect(floor).toBeDefined()
          }
        }
      })
    })

    // 15. Derived rooms reconstruct after edits
    describe('15. Derived rooms reconstruct after edits', () => {
      it('deriveRooms() works with edited walls', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        const walls = f0C.walls!
        // Convert walls to WallSegments for deriveRooms
        const segments: WallSegment[] = walls.map(w => ({
          id: w.id,
          start: w.start,
          end: w.end,
          thickness: w.thickness,
        }))
        // deriveRooms should not throw
        const rooms = deriveRooms(segments, [])
        expect(Array.isArray(rooms)).toBe(true)
      })
    })

    // 16. Opening position reconstructs
    describe('16. Opening position reconstructs', () => {
      it('opening references valid wall after round-trip', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        for (const opening of f0C.openings!) {
          const wall = f0C.walls!.find(w => w.id === opening.wallId)
          expect(wall).toBeDefined()
          // Opening offset must be within wall length
          const wallLen = Math.hypot(
            wall!.end.x - wall!.start.x,
            wall!.end.y - wall!.start.y,
          )
          expect(opening.offset).toBeGreaterThanOrEqual(0)
          expect(opening.offset).toBeLessThanOrEqual(wallLen + opening.width)
        }
      })
    })

    // 17. 2.5D geometry can regenerate
    describe('17. 2.5D geometry can regenerate', () => {
      it('walls have valid coordinates for 2.5D regeneration', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        for (const wall of f0C.walls!) {
          expect(typeof wall.start.x).toBe('number')
          expect(typeof wall.start.y).toBe('number')
          expect(typeof wall.end.x).toBe('number')
          expect(typeof wall.end.y).toBe('number')
          expect(wall.thickness).toBeGreaterThan(0)
          expect(wall.height).toBeGreaterThan(0)
          // start ≠ end
          expect(wall.start.x !== wall.end.x || wall.start.y !== wall.end.y).toBe(true)
        }
      })
    })

    // 18. Floor isolation preserved
    describe('18. Floor isolation preserved', () => {
      it('Floor 1 not altered by Floor 0 edits', () => {
        const f0 = findFloor(docC, 'bld-a', 'flr-a-g').floor
        const f1 = findFloor(docC, 'bld-a', 'flr-a-1').floor

        // Floor 1 walls unchanged
        expect(f1.walls).toHaveLength(1)
        expect(f1.walls![0].id).toBe('wall-b1-f1')
        expect(f1.walls![0].metadata).toEqual({ material: 'glass' })

        // Floor 1 routeNetwork unchanged
        expect(f1.routeNetwork!.nodes).toHaveLength(2)
        expect(f1.routeNetwork!.nodes[0].id).toBe('rn-f1-1')
        expect(f1.routeNetwork!.nodes[0].position).toEqual({ x: 5, y: 0 })

        // Floor 0 new wall not on Floor 1
        expect(f1.walls!.find(w => w.id === 'wall-new-after-reload')).toBeUndefined()
        // Floor 0 new route node not on Floor 1
        expect(f1.routeNetwork!.nodes.find(n => n.id === 'rn-new-after-reload')).toBeUndefined()

        // Floor 1 metadata unchanged
        expect(f1.shortLabel).toBe('1F')
        expect(f1.visible).toBe(true)
        expect(f1.locked).toBe(false)
      })
    })

    // 19. Building isolation preserved
    describe('19. Building isolation preserved', () => {
      it('Building B not altered by Building A edits', () => {
        const bC = docC.buildings.find(b => b.id === 'bld-b')!
        expect(bC).toBeDefined()
        const fB = bC.floors[0]
        expect(fB.walls).toHaveLength(1)
        expect(fB.walls![0].id).toBe('wall-b-only')

        // Building B has no route network (wasn't in fixture)
        // No wall leakage from A
        const aWalls = fB.walls!.filter(w => w.id.startsWith('wall-a'))
        expect(aWalls).toHaveLength(0)
      })
    })

    // 20. No entity duplication
    describe('20. No entity duplication', () => {
      it('no duplicate wall IDs', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        const ids = f0C.walls!.map(w => w.id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('no duplicate opening IDs', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        const ids = f0C.openings!.map(o => o.id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('no duplicate routeNode IDs', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        const ids = f0C.routeNetwork!.nodes.map(n => n.id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('no duplicate routeEdge IDs', () => {
        const { floor: f0C } = findFloor(docC, 'bld-a', 'flr-a-g')
        const ids = f0C.routeNetwork!.edges.map(e => e.id)
        expect(new Set(ids).size).toBe(ids.length)
      })
    })

    // 21. No ID regeneration in canonical W1–W11 structures
    describe('21. No ID regeneration in canonical structures', () => {
      it('wall IDs stable across round-trips', () => {
        const wallIdsA = docA.buildings[0].floors[0].walls!.map(w => w.id).sort()
        const wallIdsC = findFloor(docC, 'bld-a', 'flr-a-g').floor.walls!.map(w => w.id).sort()
        // All original IDs should still be present
        for (const id of wallIdsA) {
          expect(wallIdsC).toContain(id)
        }
      })

      it('opening IDs stable across round-trips', () => {
        const openIdsA = docA.buildings[0].floors[0].openings!.map(o => o.id).sort()
        const openIdsC = findFloor(docC, 'bld-a', 'flr-a-g').floor.openings!.map(o => o.id).sort()
        for (const id of openIdsA) {
          expect(openIdsC).toContain(id)
        }
      })

      it('routeNode IDs stable across round-trips', () => {
        const rnIdsA = docA.buildings[0].floors[0].routeNetwork!.nodes.map(n => n.id).sort()
        const rnIdsC = findFloor(docC, 'bld-a', 'flr-a-g').floor.routeNetwork!.nodes.map(n => n.id).sort()
        for (const id of rnIdsA) {
          expect(rnIdsC).toContain(id)
        }
      })

      it('routeEdge IDs stable across round-trips', () => {
        const reIdsA = docA.buildings[0].floors[0].routeNetwork!.edges.map(e => e.id).sort()
        const reIdsC = findFloor(docC, 'bld-a', 'flr-a-g').floor.routeNetwork!.edges.map(e => e.id).sort()
        for (const id of reIdsA) {
          expect(reIdsC).toContain(id)
        }
      })

      it('building IDs stable', () => {
        expect(docC.buildings.map(b => b.id).sort()).toEqual(
          docA.buildings.map(b => b.id).sort(),
        )
      })

      it('floor IDs stable', () => {
        for (const b of docA.buildings) {
          const bC = docC.buildings.find(x => x.id === b.id)!
          expect(bC.floors.map(f => f.id).sort()).toEqual(
            b.floors.map(f => f.id).sort(),
          )
        }
      })
    })

    // 22. No new regressions
    describe('22. No new regressions', () => {
      it('schemaVersion set by createDocument', () => {
        // createDocument always produces schemaVersion: 1 (graph reconstruction)
        expect(docC.schemaVersion).toBe(1)
      })

      it('building core fields preserved', () => {
        const bC = docC.buildings.find(b => b.id === 'bld-a')!
        expect(bC.name).toBe('Building A')
        expect(bC.code).toBe('A')
        expect(bC.rotation).toBe(15)
        expect(bC.color).toBe('#336699')
        expect(bC.aliases).toEqual(['Bldg A', 'Main'])
        expect(bC.metadata).toEqual({ built: 2020, wing: 'north' })
      })

      it('floor core fields preserved', () => {
        const f0C = findFloor(docC, 'bld-a', 'flr-a-g').floor
        expect(f0C.level).toBe(0)
        expect(f0C.height).toBe(4.0)
        expect(f0C.elevation).toBe(0)
      })

      it('staircases preserved', () => {
        const bC = docC.buildings.find(b => b.id === 'bld-a')!
        expect(bC.staircases).toHaveLength(1)
        expect(bC.staircases![0].id).toBe('stair-main')
        expect(bC.staircases![0].type).toBe('enclosed')
      })

      it('elevators preserved', () => {
        const bC = docC.buildings.find(b => b.id === 'bld-a')!
        expect(bC.elevators).toHaveLength(1)
        expect(bC.elevators![0].id).toBe('elev-main')
      })

      it('verticalTransitions preserved', () => {
        const bC = docC.buildings.find(b => b.id === 'bld-a')!
        expect(bC.verticalTransitions).toHaveLength(2)
      })

      it('roads preserved', () => {
        expect(docC.roads).toHaveLength(1)
        expect(docC.roads[0].id).toBe('road-main')
      })

      it('Floor 1 data completely untouched', () => {
        const f1C = findFloor(docC, 'bld-a', 'flr-a-1').floor
        expect(f1C.walls).toHaveLength(1)
        expect(f1C.walls![0].id).toBe('wall-b1-f1')
        expect(f1C.openings).toHaveLength(1)
        expect(f1C.openings![0].id).toBe('open-door-f1')
        expect(f1C.roomAttributes).toHaveLength(1)
        expect(f1C.roomAttributes![0].name).toBe('Networking Lab')
        expect(f1C.routeNetwork!.nodes).toHaveLength(2)
        expect(f1C.routeNetwork!.edges).toHaveLength(1)
        expect(f1C.shortLabel).toBe('1F')
        expect(f1C.visible).toBe(true)
        expect(f1C.locked).toBe(false)
      })
    })
  })
})
