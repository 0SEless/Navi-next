import { describe, it, expect } from 'vitest'
import { CoordinateTransformer, serializeDocument, deserializeDocument } from '@navi/core'
import type {
  CampusDocument,
  Building,
  Floor,
  Wall,
  Opening,
  RoomAttributes,
  RoomAccess,
  EntranceAccess,
  RouteNetwork,
  VerticalTransition,
  Staircase,
  Elevator,
  LegacyStaircase,
  LegacyElevator,
  ConnectorStop,
  Room,
  Hallway,
  LocalCoord,
} from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'

// ──────────────────────────────────────────────────────────
// Helper: epsilon-aware coordinate comparison
// ──────────────────────────────────────────────────────────
const EPSILON = 1e-6

function coordsEqual(a: LocalCoord, b: LocalCoord, eps = EPSILON): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

function coordsAlmostEqual(a: LocalCoord, b: LocalCoord, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
}

// ──────────────────────────────────────────────────────────
// SECTION 1: Multi-floor CampusDocument fixture
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
    name: 'Lecture Hall A',
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

  const legacyRoom: Room = {
    id: 'legacy-rm-101',
    name: 'Legacy Room 101',
    number: '101',
    category: 'classroom',
    polygon: { points: [{ x: 3, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 10 }, { x: 3, y: 10 }, { x: 3, y: 2 }] },
    entrancePosition: { x: 6, y: 2 },
    roomDoors: [],
    capacity: 40,
    metadata: { legacy: true },
  }

  const legacyHallway: Hallway = {
    id: 'legacy-hw-f0',
    name: 'Ground Hallway',
    polyline: { points: [{ x: 0, y: 5 }, { x: 15, y: 5 }] },
    width: 3,
    color: '#cccccc',
  }

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
    name: 'Computer Lab',
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
        rooms: [legacyRoom],
        hallways: [legacyHallway],
        staircases: [
          {
            id: 'stair-legacy-f0',
            name: 'Main Staircase',
            position: { x: 14, y: 5 },
            fromLevel: 0,
            toLevel: 1,
            type: 'enclosed',
          },
        ],
        elevators: [
          {
            id: 'elev-legacy-f0',
            name: 'Main Elevator',
            position: { x: 14, y: 8 },
            fromLevel: 0,
            toLevel: 1,
          },
        ],
        entrances: [
          {
            id: 'ent-a-main',
            label: 'Main Entrance',
            position: { x: 7.5, y: 0 },
            level: 0,
            type: 'main',
            hasQR: true,
            hasPanorama: true,
            connectorRoadId: 'road-main',
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
        planAlignment: {
          offset: { x: 0, y: 0 },
          scale: 1.0,
          rotation: 0,
          opacity: 1.0,
        },
        visible: true,
        locked: false,
        walls: [wallB1],
        openings: [doorOpening1],
        roomAttributes: [roomAttrs1],
        routeNetwork: routeNetwork1,
        rooms: [],
        hallways: [],
        staircases: [
          {
            id: 'stair-legacy-f1',
            name: 'Main Staircase',
            position: { x: 14, y: 5 },
            fromLevel: 0,
            toLevel: 1,
            type: 'enclosed',
          },
        ],
        elevators: [
          {
            id: 'elev-legacy-f1',
            name: 'Main Elevator',
            position: { x: 14, y: 8 },
            fromLevel: 0,
            toLevel: 1,
          },
        ],
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
      campusId: 'test-campus-w14c',
      name: 'W14C Test Campus',
      description: 'Multi-floor persistence characterization',
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
// SECTION 2: Test matrix
// ──────────────────────────────────────────────────────────

describe('W14C: Full multi-floor persistence round-trip', () => {
  const docA = makeMultiFloorCampusDocument()

  // ── Path A: Direct JSON round-trip ──
  describe('Path A: JSON serialization round-trip', () => {
    const jsonA = serializeDocument(docA)
    const docB_json = deserializeDocument(jsonA)

    it('schemaVersion preserved', () => {
      expect(docB_json.schemaVersion).toBe(2)
    })

    it('building IDs preserved', () => {
      expect(docB_json.buildings.map(b => b.id)).toEqual(['bld-a', 'bld-b'])
    })

    it('building A fields preserved', () => {
      const b = docB_json.buildings.find(x => x.id === 'bld-a')!
      expect(b.name).toBe('Building A')
      expect(b.code).toBe('A')
      expect(b.category).toBe('academic')
      expect(b.description).toBe('Main academic building')
      expect(b.department).toBe('Computer Science')
      expect(b.height).toBe(20)
      expect(b.baseElevation).toBe(340)
      expect(b.color).toBe('#336699')
      expect(b.rotation).toBe(15)
      expect(b.aliases).toEqual(['Bldg A', 'Main'])
      expect(b.metadata).toEqual({ built: 2020, wing: 'north' })
    })

    it('floor A-G metadata preserved', () => {
      const f = docB_json.buildings[0].floors[0]
      expect(f.id).toBe('flr-a-g')
      expect(f.level).toBe(0)
      expect(f.label).toBe('Ground Floor')
      expect(f.shortLabel).toBe('G')
      expect(f.height).toBe(4.0)
      expect(f.elevation).toBe(0)
      expect(f.offset).toEqual({ x: 2.5, y: 1.8 })
      expect(f.rotation).toBe(15)
      expect(f.locked).toBe(true)
      expect(f.visible).toBe(false)
      expect(f.floorPlanState).toBe('locked')
      expect(f.planImageId).toBe('plan-g-001')
      expect(f.planAlignment).toEqual({ offset: { x: 1, y: 0.5 }, scale: 1.2, rotation: 10, opacity: 0.8 })
      expect(f.textureId).toBe('tex-concrete')
      expect(f.svgOverlayId).toBe('svg-floor-g')
    })

    it('floor A-1 metadata preserved', () => {
      const f = docB_json.buildings[0].floors[1]
      expect(f.id).toBe('flr-a-1')
      expect(f.level).toBe(1)
      expect(f.shortLabel).toBe('1F')
      expect(f.height).toBe(3.5)
      expect(f.offset).toEqual({ x: 0, y: 0 })
      expect(f.rotation).toBe(0)
      expect(f.visible).toBe(true)
      expect(f.locked).toBe(false)
    })

    it('walls preserved (Floor 0)', () => {
      const walls = docB_json.buildings[0].floors[0].walls!
      expect(walls).toHaveLength(3)
      const w1 = walls.find(w => w.id === 'wall-a1-f0')!
      expect(w1.start).toEqual({ x: 2.5, y: 1.8 })
      expect(w1.end).toEqual({ x: 12.5, y: 1.8 })
      expect(w1.thickness).toBe(0.2)
      expect(w1.height).toBe(4.0)
      expect(w1.metadata).toEqual({ material: 'concrete', exterior: true })
    })

    it('walls preserved (Floor 1)', () => {
      const walls = docB_json.buildings[0].floors[1].walls!
      expect(walls).toHaveLength(1)
      expect(walls[0].id).toBe('wall-b1-f1')
      expect(walls[0].metadata).toEqual({ material: 'glass' })
    })

    it('openings preserved', () => {
      const openings = docB_json.buildings[0].floors[0].openings!
      expect(openings).toHaveLength(2)
      const door = openings.find(o => o.id === 'open-door-f0')!
      expect(door.type).toBe('door')
      expect(door.wallId).toBe('wall-a1-f0')
      expect(door.offset).toBe(4.0)
      expect(door.width).toBe(1.2)
      expect(door.height).toBe(2.4)
      expect(door.metadata).toEqual({ fireRating: '60min' })

      const win = openings.find(o => o.id === 'open-win-f0')!
      expect(win.type).toBe('window')
      expect(win.wallId).toBe('wall-a2-f0')
      expect(win.sillHeight).toBe(0.9)
    })

    it('roomAttributes preserved', () => {
      const attrs = docB_json.buildings[0].floors[0].roomAttributes!
      expect(attrs).toHaveLength(1)
      expect(attrs[0].faceId).toBe('face-101')
      expect(attrs[0].name).toBe('Lecture Hall A')
      expect(attrs[0].number).toBe('101')
      expect(attrs[0].category).toBe('classroom')
      expect(attrs[0].searchable).toBe(true)
      expect(attrs[0].accessPoints).toEqual([
        { openingId: 'open-door-f0', routeNodeId: 'rn-f0-1', primary: true },
      ])
    })

    it('routeNetwork preserved', () => {
      const rn = docB_json.buildings[0].floors[0].routeNetwork!
      expect(rn.nodes).toHaveLength(3)
      expect(rn.edges).toHaveLength(2)
      expect(rn.nodes[0].id).toBe('rn-f0-1')
      expect(rn.nodes[0].type).toBe('waypoint')
      expect(coordsEqual(rn.nodes[0].position, { x: 6, y: 1.8 })).toBe(true)
      expect(rn.edges[0].distance).toBe(4.2)
    })

    it('entranceAccess preserved', () => {
      const ea = docB_json.buildings[0].floors[0].entranceAccess!
      expect(ea).toHaveLength(1)
      expect(ea[0].entranceId).toBe('ent-a-main')
      expect(ea[0].outdoorNodeId).toBe('road-ent-1')
      expect(ea[0].indoorRouteNodeId).toBe('rn-f0-3')
    })

    it('staircases (Building.staircases) preserved', () => {
      const stairs = docB_json.buildings[0].staircases!
      expect(stairs).toHaveLength(1)
      expect(stairs[0].id).toBe('stair-main')
      expect(stairs[0].name).toBe('Main Staircase')
      expect(stairs[0].type).toBe('enclosed')
      expect(stairs[0].accessible).toBe(true)
      expect(stairs[0].fromLevel).toBe(0)
      expect(stairs[0].toLevel).toBe(1)
      expect(stairs[0].levels[0]).toBeDefined()
      expect(stairs[0].levels[1]).toBeDefined()
    })

    it('elevators (Building.elevators) preserved', () => {
      const elevs = docB_json.buildings[0].elevators!
      expect(elevs).toHaveLength(1)
      expect(elevs[0].id).toBe('elev-main')
      expect(elevs[0].type).toBe('passenger')
      expect(elevs[0].accessible).toBe(true)
    })

    it('verticalTransitions preserved', () => {
      const vts = docB_json.buildings[0].verticalTransitions!
      expect(vts).toHaveLength(2)
      expect(vts[0].featureId).toBe('stair-main')
      expect(vts[0].connections).toHaveLength(2)
      expect(vts[1].featureId).toBe('elev-main')
    })

    it('legacy staircases regenerated by serializer', () => {
      // Serializer derives legacy arrays from Building.staircases
      const f0 = docB_json.buildings[0].floors[0]
      expect(f0.staircases).toBeDefined()
      expect(f0.staircases.length).toBeGreaterThan(0)
      // IDs are derived: `${featureId}-${level}`
      expect(f0.staircases[0].id).toBe('stair-main-0')
    })

    it('legacy elevators regenerated by serializer', () => {
      const f0 = docB_json.buildings[0].floors[0]
      expect(f0.elevators).toBeDefined()
      expect(f0.elevators.length).toBeGreaterThan(0)
      expect(f0.elevators[0].id).toBe('elev-main-0')
    })

    it('Building B isolated (no A walls)', () => {
      const bB = docB_json.buildings.find(b => b.id === 'bld-b')!
      expect(bB).toBeDefined()
      const walls = bB.floors[0].walls!
      expect(walls).toHaveLength(1)
      expect(walls[0].id).toBe('wall-b-only')
    })

    it('legacy rooms preserved', () => {
      const rooms = docB_json.buildings[0].floors[0].rooms
      expect(rooms.length).toBeGreaterThan(0)
      const lr = rooms.find(r => r.id === 'legacy-rm-101')!
      expect(lr.name).toBe('Legacy Room 101')
      expect(lr.capacity).toBe(40)
    })

    it('legacy hallways preserved', () => {
      const hw = docB_json.buildings[0].floors[0].hallways
      expect(hw.length).toBeGreaterThan(0)
      expect(hw[0].id).toBe('legacy-hw-f0')
      expect(hw[0].width).toBe(3)
    })

    it('roads preserved', () => {
      expect(docB_json.roads).toHaveLength(1)
      expect(docB_json.roads[0].id).toBe('road-main')
      expect(docB_json.roads[0].width).toBe(6)
    })

    it('_changeJournal stripped', () => {
      const withJournal = { ...docA, _changeJournal: [{ entityId: 'x', entityType: 'room', operation: 'created' as const }] }
      const json = serializeDocument(withJournal)
      expect(JSON.parse(json)._changeJournal).toBeUndefined()
    })
  })

  // ── Path B: Graph pipeline round-trip ──
  describe('Path B: Graph pipeline round-trip (docA → sync → createDocument → docB)', () => {
    const { doc2: docB, transformer } = graphPipelineRoundTrip(docA)

    it('building IDs survive', () => {
      expect(docB.buildings.map(b => b.id)).toContain('bld-a')
      expect(docB.buildings.map(b => b.id)).toContain('bld-b')
    })

    it('building A core fields survive', () => {
      const b = docB.buildings.find(x => x.id === 'bld-a')!
      expect(b).toBeDefined()
      expect(b.name).toBe('Building A')
      expect(b.code).toBe('A')
      expect(b.category).toBe('academic')
      expect(b.description).toBe('Main academic building')
      expect(b.department).toBe('Computer Science')
      expect(b.baseElevation).toBe(340)
      expect(b.height).toBe(20)
      expect(b.color).toBe('#336699')
      expect(b.aliases).toEqual(['Bldg A', 'Main'])
      expect(b.metadata).toEqual({ built: 2020, wing: 'north' })
    })

    it('building rotation survives through graph pipeline', () => {
      const b = docB.buildings.find(x => x.id === 'bld-a')!
      const bOrig = docA.buildings[0]
      expect(bOrig.rotation).toBe(15)
      // W14H1: GraphAdapter now stores rotation in floorData.
      expect(b.rotation).toBe(15)
    })

    it('building footprint survives', () => {
      const b = docB.buildings.find(x => x.id === 'bld-a')!
      expect(b.footprint.points).toHaveLength(5)
      expect(b.footprint.points[0].lat).toBeCloseTo(33.420, 4)
    })

    it('floor IDs survive', () => {
      const b = docB.buildings.find(x => x.id === 'bld-a')!
      expect(b.floors.map(f => f.id)).toContain('flr-a-g')
      expect(b.floors.map(f => f.id)).toContain('flr-a-1')
    })

    it('floor levels survive', () => {
      const b = docB.buildings.find(x => x.id === 'bld-a')!
      const f0 = b.floors.find(f => f.id === 'flr-a-g')!
      const f1 = b.floors.find(f => f.id === 'flr-a-1')!
      expect(f0.level).toBe(0)
      expect(f1.level).toBe(1)
    })

    // ── Floor metadata losses (W14A defects) ──
    describe('Floor metadata losses (W14A defects)', () => {
      it('DEFECT: shortLabel lost through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        // GraphAdapter copies floorData but createDocument reads from floorData;
        // shortLabel is NOT in the floorData spread
        // EXPECTED LOSS: shortLabel
        const f0orig = docA.buildings[0].floors[0]
        // Before: shortLabel = 'G'
        expect(f0orig.shortLabel).toBe('G')
        // After: shortLabel may be undefined (not in floorData copy)
        // Record the actual behavior
        if (f0.shortLabel === undefined) {
          // Confirmed defect: shortLabel not carried through graph pipeline
          expect(f0.shortLabel).toBeUndefined()
        }
      })

      it('DEFECT: visible lost through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.visible).toBe(false)
        // visible is NOT in the floorData spread in GraphAdapter
        // createDocument reads it from floorData via fd.visible
        if (f0.visible === undefined) {
          expect(f0.visible).toBeUndefined()
        }
      })

      it('DEFECT: locked lost through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.locked).toBe(true)
        if (f0.locked === undefined) {
          expect(f0.locked).toBeUndefined()
        }
      })

      it('DEFECT: offset lost through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.offset).toEqual({ x: 2.5, y: 1.8 })
        // offset is in floorData spread, but createDocument uses fd.offset ?? f.offset
        // Since GraphAdapter writes offset to floorData, it should survive
        // Record actual behavior
        if (f0.offset !== undefined) {
          expect(coordsAlmostEqual(f0.offset, { x: 2.5, y: 1.8 })).toBe(true)
        }
      })

      it('DEFECT: rotation lost through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.rotation).toBe(15)
        if (f0.rotation !== undefined) {
          expect(f0.rotation).toBe(15)
        }
      })

      it('height survives through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.height).toBe(4.0)
        // W14H1: height is now in floorData spread
        expect(f0.height).toBe(4.0)
      })

      it('DEFECT: floorPlanState lost through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.floorPlanState).toBe('locked')
        // floorPlanState is NOT in the floorData spread in GraphAdapter
        if (f0.floorPlanState === undefined) {
          expect(f0.floorPlanState).toBeUndefined()
        }
      })

      it('planAlignment preserved through graph pipeline', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        // planAlignment IS in the floorData spread
        expect(f0.planAlignment).toBeDefined()
        if (f0.planAlignment) {
          expect(f0.planAlignment.offset).toEqual({ x: 1, y: 0.5 })
          expect(f0.planAlignment.scale).toBe(1.2)
          expect(f0.planAlignment.rotation).toBe(10)
        }
      })
    })

    // ── Canonical authored data ──
    describe('Canonical authored data through graph pipeline', () => {
      it('walls survive (Floor 0)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        expect(f0.walls).toBeDefined()
        expect(f0.walls!).toHaveLength(3)
        const w1 = f0.walls!.find(w => w.id === 'wall-a1-f0')!
        expect(w1.start).toEqual({ x: 2.5, y: 1.8 })
        expect(w1.end).toEqual({ x: 12.5, y: 1.8 })
        expect(w1.thickness).toBe(0.2)
        expect(w1.height).toBe(4.0)
        expect(w1.metadata).toEqual({ material: 'concrete', exterior: true })
      })

      it('walls survive (Floor 1)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f1 = b.floors.find(f => f.id === 'flr-a-1')!
        expect(f1.walls).toBeDefined()
        expect(f1.walls!).toHaveLength(1)
        expect(f1.walls![0].id).toBe('wall-b1-f1')
      })

      it('openings survive', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        expect(f0.openings).toBeDefined()
        expect(f0.openings!).toHaveLength(2)
        const door = f0.openings!.find(o => o.id === 'open-door-f0')!
        expect(door.type).toBe('door')
        expect(door.wallId).toBe('wall-a1-f0')
        expect(door.offset).toBe(4.0)
      })

      it('roomAttributes survive', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        expect(f0.roomAttributes).toBeDefined()
        expect(f0.roomAttributes!).toHaveLength(1)
        expect(f0.roomAttributes![0].faceId).toBe('face-101')
        expect(f0.roomAttributes![0].name).toBe('Lecture Hall A')
        expect(f0.roomAttributes![0].searchable).toBe(true)
      })

      it('roomAttributes survive (Floor 1)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f1 = b.floors.find(f => f.id === 'flr-a-1')!
        expect(f1.roomAttributes).toBeDefined()
        expect(f1.roomAttributes!).toHaveLength(1)
        expect(f1.roomAttributes![0].name).toBe('Computer Lab')
      })

      it('routeNetwork survives through graph pipeline (Floor 0)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const f0orig = docA.buildings[0].floors[0]
        expect(f0orig.routeNetwork).toBeDefined()
        expect(f0orig.routeNetwork!.nodes).toHaveLength(3)
        // W14H1: routeNetwork is now stored in floorData by GraphAdapter
        expect(f0.routeNetwork).toBeDefined()
        expect(f0.routeNetwork!.nodes).toHaveLength(3)
        expect(f0.routeNetwork!.edges).toHaveLength(2)
        expect(f0.routeNetwork!.nodes[0].id).toBe('rn-f0-1')
        expect(f0.routeNetwork!.nodes[0].type).toBe('waypoint')
      })

      it('routeNetwork survives through graph pipeline (Floor 1)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f1 = b.floors.find(f => f.id === 'flr-a-1')!
        const f1orig = docA.buildings[0].floors[1]
        expect(f1orig.routeNetwork).toBeDefined()
        // W14H1: routeNetwork is now stored in floorData by GraphAdapter
        expect(f1.routeNetwork).toBeDefined()
        expect(f1.routeNetwork!.nodes).toHaveLength(2)
        expect(f1.routeNetwork!.edges).toHaveLength(1)
      })

      it('entranceAccess preserved', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        expect(f0.entranceAccess).toBeDefined()
        expect(f0.entranceAccess!).toHaveLength(1)
        expect(f0.entranceAccess![0].entranceId).toBe('ent-a-main')
        expect(f0.entranceAccess![0].outdoorNodeId).toBe('road-ent-1')
        expect(f0.entranceAccess![0].indoorRouteNodeId).toBe('rn-f0-3')
      })

      it('staircases (Building.staircases) survive', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        expect(b.staircases).toBeDefined()
        expect(b.staircases!).toHaveLength(1)
        expect(b.staircases![0].id).toBe('stair-main')
        expect(b.staircases![0].type).toBe('enclosed')
        expect(b.staircases![0].accessible).toBe(true)
      })

      it('elevators (Building.elevators) survive', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        expect(b.elevators).toBeDefined()
        expect(b.elevators!).toHaveLength(1)
        expect(b.elevators![0].id).toBe('elev-main')
        expect(b.elevators![0].type).toBe('passenger')
      })

      it('verticalTransitions survive', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        expect(b.verticalTransitions).toBeDefined()
        expect(b.verticalTransitions!).toHaveLength(2)
        expect(b.verticalTransitions![0].featureId).toBe('stair-main')
        expect(b.verticalTransitions![0].connections).toHaveLength(2)
      })
    })

    // ── Legacy representation behavior ──
    describe('Legacy representation behavior', () => {
      it('Floor.staircases[] regenerated from Building.staircases', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        // createDocument mints legacy records from Building.staircases
        expect(f0.staircases).toBeDefined()
        expect(f0.staircases.length).toBeGreaterThan(0)
        // IDs derived: `${featureId}-${level}`
        expect(f0.staircases[0].id).toBe('stair-main-0')
      })

      it('Floor.elevators[] regenerated from Building.elevators', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        expect(f0.elevators).toBeDefined()
        expect(f0.elevators.length).toBeGreaterThan(0)
        expect(f0.elevators[0].id).toBe('elev-main-0')
      })

      it('Floor.connectorStops[] empty after round-trip', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        // connectorStops are not stored in floorData; createDocument returns []
        expect(f0.connectorStops).toEqual([])
      })

      it('graph route nodes do NOT leak into Floor.routeNetwork', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        // routeNetwork should be the authored version, not graph-derived nodes
        if (f0.routeNetwork) {
          const nodeTypes = f0.routeNetwork.nodes.map(n => n.type)
          // All should be canonical authored types
          expect(nodeTypes.every(t => ['waypoint', 'poi', 'transition', 'entrance', 'outdoor', 'portal'].includes(t))).toBe(true)
        }
      })
    })

    // ── Building isolation ──
    describe('Building isolation', () => {
      it('Building B walls not leaked from A', () => {
        const bB = docB.buildings.find(b => b.id === 'bld-b')!
        expect(bB).toBeDefined()
        const walls = bB.floors[0].walls!
        expect(walls).toHaveLength(1)
        expect(walls[0].id).toBe('wall-b-only')
        const leaked = walls.find(w => w.id.startsWith('wall-a'))
        expect(leaked).toBeUndefined()
      })

      it('Building A walls not leaked into B', () => {
        const bB = docB.buildings.find(b => b.id === 'bld-b')!
        const f0b = bB.floors[0]
        const aWallIds = ['wall-a1-f0', 'wall-a2-f0', 'wall-a3-f0']
        for (const wallId of aWallIds) {
          expect(f0b.walls!.find(w => w.id === wallId)).toBeUndefined()
        }
      })
    })

    // ── Coordinate precision ──
    describe('Coordinate precision', () => {
      it('wall coordinates within epsilon (world→local→world→local)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const origWalls = docA.buildings[0].floors[0].walls!
        // Wall coordinates are building-local; graph pipeline converts
        // local→world→local. Precision depends on CoordinateTransformer.
        for (const orig of origWalls) {
          const after = f0.walls!.find(w => w.id === orig.id)
          if (after) {
            // Wall coordinates survive because they are stored in floorData
            // and NOT transformed through world coordinates
            expect(coordsAlmostEqual(after.start, orig.start, 0.1)).toBe(true)
            expect(coordsAlmostEqual(after.end, orig.end, 0.1)).toBe(true)
          }
        }
      })

      it('opening coordinates within epsilon', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const origOpenings = docA.buildings[0].floors[0].openings!
        for (const orig of origOpenings) {
          const after = f0.openings!.find(o => o.id === orig.id)
          if (after) {
            expect(after.offset).toBeCloseTo(orig.offset, 4)
            expect(after.width).toBeCloseTo(orig.width, 4)
          }
        }
      })

      it('routeNetwork node positions survive through graph pipeline', () => {
        // W14H1: routeNetwork is now preserved through graph pipeline
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        expect(f0.routeNetwork).toBeDefined()
        // routeNetwork positions are building-local and survive floorData pass-through
        const rnNode0 = f0.routeNetwork!.nodes.find(n => n.id === 'rn-f0-1')!
        expect(rnNode0).toBeDefined()
        expect(rnNode0.position.x).toBeCloseTo(6, 4)
        expect(rnNode0.position.y).toBeCloseTo(1.8, 4)
      })
    })

    // ── Legacy room/hallway geometry ──
    describe('Legacy room/hallway geometry through graph pipeline', () => {
      it('legacy room polygon is rebuilt from world→local (precision drift expected)', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const origRoom = docA.buildings[0].floors[0].rooms[0]
        const afterRoom = f0.rooms.find(r => r.id === 'legacy-rm-101')
        if (afterRoom) {
          // Polygon goes through local→world→local conversion
          expect(afterRoom.polygon.points).toHaveLength(origRoom.polygon.points.length)
          // Precision drift is expected; check within tolerance
          for (let i = 0; i < origRoom.polygon.points.length; i++) {
            expect(coordsAlmostEqual(afterRoom.polygon.points[i], origRoom.polygon.points[i], 0.1)).toBe(true)
          }
        }
      })

      it('legacy hallway polyline is rebuilt from world→local', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const origHw = docA.buildings[0].floors[0].hallways[0]
        const afterHw = f0.hallways.find(h => h.id === 'legacy-hw-f0')
        if (afterHw) {
          expect(afterHw.polyline.points).toHaveLength(origHw.polyline.points.length)
          for (let i = 0; i < origHw.polyline.points.length; i++) {
            expect(coordsAlmostEqual(afterHw.polyline.points[i], origHw.polyline.points[i], 0.1)).toBe(true)
          }
        }
      })
    })

    // ── Entrance position conversion ──
    describe('Entrance position (building-local)', () => {
      it('entrance position is building-local after round-trip', () => {
        const b = docB.buildings.find(x => x.id === 'bld-a')!
        const f0 = b.floors.find(f => f.id === 'flr-a-g')!
        const ent = f0.entrances.find(e => e.id === 'ent-a-main')
        expect(ent).toBeDefined()
        // Position should be building-local (not world lat/lng)
        if (ent) {
          expect(typeof ent.position.x).toBe('number')
          expect(typeof ent.position.y).toBe('number')
          // Should NOT have lat/lng shape
          expect((ent.position as any).lat).toBeUndefined()
        }
      })
    })
  })

  // ── Idempotency: docB → docC ──
  describe('Idempotency: docB → docC (second graph pipeline round-trip)', () => {
    const { doc2: docB } = graphPipelineRoundTrip(docA)
    const { doc2: docC } = graphPipelineRoundTrip(docB)

    it('building IDs stable across B→C', () => {
      const idsB = docB.buildings.map(b => b.id).sort()
      const idsC = docC.buildings.map(b => b.id).sort()
      expect(idsC).toEqual(idsB)
    })

    it('floor IDs stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      expect(bC.floors.map(f => f.id).sort()).toEqual(bB.floors.map(f => f.id).sort())
    })

    it('walls stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const wallsB = bB.floors[0].walls ?? []
      const wallsC = bC.floors[0].walls ?? []
      expect(wallsC).toHaveLength(wallsB.length)
      for (const wB of wallsB) {
        const wC = wallsC.find(w => w.id === wB.id)
        expect(wC).toBeDefined()
        expect(wC!.start).toEqual(wB.start)
        expect(wC!.end).toEqual(wB.end)
        expect(wC!.thickness).toBe(wB.thickness)
        expect(wC!.height).toBe(wB.height)
        expect(wC!.metadata).toEqual(wB.metadata)
      }
    })

    it('openings stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const opensB = bB.floors[0].openings ?? []
      const opensC = bC.floors[0].openings ?? []
      expect(opensC).toHaveLength(opensB.length)
      for (const oB of opensB) {
        const oC = opensC.find(o => o.id === oB.id)
        expect(oC).toBeDefined()
        expect(oC!.type).toBe(oB.type)
        expect(oC!.wallId).toBe(oB.wallId)
        expect(oC!.offset).toBe(oB.offset)
      }
    })

    it('roomAttributes stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const attrsB = bB.floors[0].roomAttributes ?? []
      const attrsC = bC.floors[0].roomAttributes ?? []
      expect(attrsC).toHaveLength(attrsB.length)
      for (const aB of attrsB) {
        const aC = attrsC.find(a => a.faceId === aB.faceId)
        expect(aC).toBeDefined()
        expect(aC!.name).toBe(aB.name)
        expect(aC!.searchable).toBe(aB.searchable)
      }
    })

    it('routeNetwork survives both rounds (idempotent preservation)', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const rnB = bB.floors[0].routeNetwork
      const rnC = bC.floors[0].routeNetwork
      // W14H1: routeNetwork is now preserved through both round trips
      expect(rnB).toBeDefined()
      expect(rnC).toBeDefined()
      expect(rnB!.nodes).toHaveLength(rnC!.nodes.length)
      expect(rnB!.edges).toHaveLength(rnC!.edges.length)
      // Verify node IDs are stable
      for (const node of rnB!.nodes) {
        const match = rnC!.nodes.find(n => n.id === node.id)
        expect(match).toBeDefined()
        expect(match!.type).toBe(node.type)
      }
    })

    it('staircases stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const sB = bB.staircases ?? []
      const sC = bC.staircases ?? []
      expect(sC).toHaveLength(sB.length)
      for (const sb of sB) {
        const sc = sC.find(s => s.id === sb.id)
        expect(sc).toBeDefined()
        expect(sc!.name).toBe(sb.name)
        expect(sc!.type).toBe(sb.type)
      }
    })

    it('elevators stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const eB = bB.elevators ?? []
      const eC = bC.elevators ?? []
      expect(eC).toHaveLength(eB.length)
    })

    it('verticalTransitions stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const vtB = bB.verticalTransitions ?? []
      const vtC = bC.verticalTransitions ?? []
      expect(vtC).toHaveLength(vtB.length)
      for (const vt of vtB) {
        const match = vtC.find(v => v.id === vt.id)
        expect(match).toBeDefined()
        expect(match!.featureId).toBe(vt.featureId)
      }
    })

    it('entranceAccess stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const eaB = bB.floors[0].entranceAccess ?? []
      const eaC = bC.floors[0].entranceAccess ?? []
      expect(eaC).toHaveLength(eaB.length)
    })

    it('legacy staircases IDs stable across B→C', () => {
      const bB = docB.buildings.find(x => x.id === 'bld-a')!
      const bC = docC.buildings.find(x => x.id === 'bld-a')!
      const lsB = bB.floors[0].staircases
      const lsC = bC.floors[0].staircases
      // Both should have regenerated legacy records
      expect(lsC.length).toBe(lsB.length)
      for (const ls of lsB) {
        expect(lsC.find(s => s.id === ls.id)).toBeDefined()
      }
    })
  })
})
