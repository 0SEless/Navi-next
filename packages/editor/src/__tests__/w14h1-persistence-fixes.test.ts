import { describe, it, expect } from 'vitest'
import { CoordinateTransformer, serializeDocument, deserializeDocument } from '@navi/core'
import type {
  CampusDocument,
  Building,
  Floor,
  RouteNetwork,
} from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'

const EPSILON = 0.01

function registerBuildingInTransformer(transformer: CoordinateTransformer, doc: CampusDocument) {
  for (const b of doc.buildings) {
    const pts = b.footprint.points
    const origin = pts.length > 0
      ? { lat: (pts[0].lat + pts[1].lat) / 2, lng: (pts[0].lng + pts[1].lng) / 2 }
      : { lat: 0, lng: 0 }
    transformer.registerBuilding({ buildingId: b.id, origin, rotation: b.rotation ?? 0 })
    for (const f of b.floors) {
      transformer.registerFloor(b.id, f.level, {
        offset: f.offset ?? { x: 0, y: 0 },
        rotation: f.rotation ?? 0,
      })
    }
  }
}

function graphPipelineRoundTrip(doc: CampusDocument): { doc2: CampusDocument; transformer: CoordinateTransformer } {
  const graph = new Graph()
  const transformer = new CoordinateTransformer()
  registerBuildingInTransformer(transformer, doc)
  new GraphAdapter(graph, transformer).sync(doc)
  const doc2 = createDocument(graph, transformer)
  return { doc2, transformer }
}

function makeDocument(): CampusDocument {
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

  const routeNetwork1: RouteNetwork = {
    nodes: [
      { id: 'rn-f1-1', type: 'waypoint', position: { x: 5, y: 0 }, floor: 1 },
      { id: 'rn-f1-2', type: 'waypoint', position: { x: 5, y: 5 }, floor: 1 },
    ],
    edges: [
      { id: 're-f1-1', from: 'rn-f1-1', to: 'rn-f1-2', type: 'walk', distance: 5.0 },
    ],
  }

  const buildingA: Building = {
    id: 'bld-a',
    name: 'Building A',
    code: 'A',
    category: 'academic',
    description: 'Main building',
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
    aliases: [],
    metadata: {},
    verticalConnectors: [],
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
        visible: false,
        locked: true,
        floorPlanState: 'locked',
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
        walls: [
          { id: 'wall-a1', start: { x: 2.5, y: 1.8 }, end: { x: 12.5, y: 1.8 }, thickness: 0.2, height: 4.0 },
        ],
        routeNetwork: routeNetwork0,
      },
      {
        id: 'flr-a-1',
        level: 1,
        label: 'Second Floor',
        shortLabel: '1F',
        elevation: 4.0,
        height: 3.5,
        visible: true,
        locked: false,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
        routeNetwork: routeNetwork1,
      },
    ],
  }

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
    rotation: 30,
    metadata: {},
    verticalConnectors: [],
    floors: [
      {
        id: 'flr-b-g',
        level: 0,
        label: 'Ground Floor',
        shortLabel: 'BG',
        elevation: 0,
        height: 3.5,
        rotation: 5,
        offset: { x: 1, y: 1 },
        visible: true,
        locked: false,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
        walls: [
          { id: 'wall-b1', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, height: 3.0 },
        ],
      },
    ],
  }

  return {
    schemaVersion: 2,
    version: 100,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: '',
      lastModified: '2026-08-26T00:00:00.000Z',
      editorVersion: '2.0.0',
    },
    buildings: [buildingA, buildingB],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeLegacyDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'legacy-campus',
      name: 'Legacy Campus',
      description: '',
      lastModified: '2026-01-01T00:00:00.000Z',
      editorVersion: '1.0.0',
    },
    buildings: [
      {
        id: 'bld-legacy',
        name: 'Legacy Building',
        code: 'L',
        category: 'academic',
        description: '',
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
        color: '#336699',
        aliases: [],
        metadata: {},
        verticalConnectors: [],
        floors: [
          {
            id: 'flr-legacy-0',
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
              { id: 'wall-legacy-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.0 },
            ],
          },
        ],
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('W14H1: Critical persistence fixes', () => {
  const docA = makeDocument()

  describe('1. routeNetwork survives exact round-trip', () => {
    it('routeNetwork preserved through graph pipeline (Floor 0)', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.routeNetwork).toBeDefined()
      expect(f0.routeNetwork!.nodes).toHaveLength(3)
      expect(f0.routeNetwork!.edges).toHaveLength(2)
      expect(f0.routeNetwork!.nodes[0].id).toBe('rn-f0-1')
      expect(f0.routeNetwork!.nodes[0].type).toBe('waypoint')
      expect(f0.routeNetwork!.nodes[0].position).toEqual({ x: 6, y: 1.8 })
    })

    it('routeNetwork preserved through graph pipeline (Floor 1)', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f1 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-1')!
      expect(f1.routeNetwork).toBeDefined()
      expect(f1.routeNetwork!.nodes).toHaveLength(2)
      expect(f1.routeNetwork!.edges).toHaveLength(1)
    })
  })

  describe('2. routeNetwork remains idempotent after 2 cycles', () => {
    it('A→B→C routeNetwork is stable', () => {
      const { doc2: docB } = graphPipelineRoundTrip(docA)
      const { doc2: docC } = graphPipelineRoundTrip(docB)
      const rnB = docB.buildings.find(b => b.id === 'bld-a')!.floors[0].routeNetwork
      const rnC = docC.buildings.find(b => b.id === 'bld-a')!.floors[0].routeNetwork
      expect(rnB).toBeDefined()
      expect(rnC).toBeDefined()
      expect(rnC!.nodes).toHaveLength(rnB!.nodes.length)
      expect(rnC!.edges).toHaveLength(rnB!.edges.length)
      for (const node of rnB!.nodes) {
        const match = rnC!.nodes.find(n => n.id === node.id)
        expect(match).toBeDefined()
        expect(match!.type).toBe(node.type)
        expect(match!.position).toEqual(node.position)
      }
    })
  })

  describe('3. Building.rotation survives', () => {
    it('building A rotation preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const b = doc2.buildings.find(x => x.id === 'bld-a')!
      expect(b.rotation).toBe(15)
    })
  })

  describe('4. Floor.shortLabel survives', () => {
    it('floor A-G shortLabel preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.shortLabel).toBe('G')
    })
  })

  describe('5. Floor.visible survives', () => {
    it('floor A-G visible=false preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.visible).toBe(false)
    })

    it('floor A-1 visible=true preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f1 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-1')!
      expect(f1.visible).toBe(true)
    })
  })

  describe('6. Floor.locked survives', () => {
    it('floor A-G locked=true preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.locked).toBe(true)
    })

    it('floor A-1 locked=false preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f1 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-1')!
      expect(f1.locked).toBe(false)
    })
  })

  describe('7. Floor.floorPlanState survives', () => {
    it('floor A-G floorPlanState=locked preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.floorPlanState).toBe('locked')
    })
  })

  describe('8. Floor.offset survives', () => {
    it('floor A-G offset preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.offset).toBeDefined()
      expect(f0.offset!.x).toBeCloseTo(2.5, 4)
      expect(f0.offset!.y).toBeCloseTo(1.8, 4)
    })
  })

  describe('9. Floor.rotation survives', () => {
    it('floor A-G rotation=15 preserved', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.rotation).toBe(15)
    })
  })

  describe('10. Floor.height survives', () => {
    it('floor A-G height=4.0 preserved (not defaulted to 3.5)', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.height).toBe(4.0)
    })
  })

  describe('11. Floor A metadata does not leak to Floor B', () => {
    it('floor A routeNetwork does not appear on floor B', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      const f1 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-1')!
      expect(f0.routeNetwork!.nodes.map(n => n.id)).toContain('rn-f0-1')
      expect(f0.routeNetwork!.nodes.map(n => n.id)).not.toContain('rn-f1-1')
      expect(f1.routeNetwork!.nodes.map(n => n.id)).toContain('rn-f1-1')
      expect(f1.routeNetwork!.nodes.map(n => n.id)).not.toContain('rn-f0-1')
    })

    it('floor A shortLabel does not appear on floor B', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      const f1 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-1')!
      expect(f0.shortLabel).toBe('G')
      expect(f1.shortLabel).toBe('1F')
    })
  })

  describe('12. Building A rotation does not leak to Building B', () => {
    it('building A rotation=15, building B rotation=30', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const bA = doc2.buildings.find(b => b.id === 'bld-a')!
      const bB = doc2.buildings.find(b => b.id === 'bld-b')!
      expect(bA.rotation).toBe(15)
      expect(bB.rotation).toBe(30)
    })
  })

  describe('13. Old documents missing these fields still load', () => {
    it('legacy document without routeNetwork/rotation/shortLabel loads', () => {
      const legacy = makeLegacyDocument()
      const { doc2 } = graphPipelineRoundTrip(legacy)
      const b = doc2.buildings.find(x => x.id === 'bld-legacy')!
      expect(b).toBeDefined()
      expect(b.name).toBe('Legacy Building')
      expect(b.rotation).toBeUndefined()
      expect(b.floors[0].shortLabel).toBeUndefined()
      expect(b.floors[0].visible).toBeUndefined()
      expect(b.floors[0].locked).toBeUndefined()
      expect(b.floors[0].floorPlanState).toBeUndefined()
      expect(b.floors[0].offset).toBeUndefined()
      expect(b.floors[0].rotation).toBeUndefined()
      expect(b.floors[0].height).toBe(3.5)
    })

    it('legacy document routeNetwork stays undefined', () => {
      const legacy = makeLegacyDocument()
      const { doc2 } = graphPipelineRoundTrip(legacy)
      expect(doc2.buildings[0].floors[0].routeNetwork).toBeUndefined()
    })
  })

  describe('14. No new duplicates', () => {
    it('no duplicate floor IDs after round-trip', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      for (const b of doc2.buildings) {
        const ids = b.floors.map(f => f.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
    })

    it('no duplicate building IDs after round-trip', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const ids = doc2.buildings.map(b => b.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('no duplicate routeNetwork node IDs', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors[0]
      expect(f0.routeNetwork).toBeDefined()
      const nodeIds = f0.routeNetwork!.nodes.map(n => n.id)
      expect(new Set(nodeIds).size).toBe(nodeIds.length)
    })
  })

  describe('15. No coordinate drift introduced', () => {
    it('routeNetwork node positions preserved exactly', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      const orig = docA.buildings[0].floors[0].routeNetwork!.nodes
      const after = f0.routeNetwork!.nodes
      expect(after).toHaveLength(orig.length)
      for (let i = 0; i < orig.length; i++) {
        expect(after[i].position.x).toBeCloseTo(orig[i].position.x, 4)
        expect(after[i].position.y).toBeCloseTo(orig[i].position.y, 4)
      }
    })

    it('floor offset preserved exactly', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.offset!.x).toBeCloseTo(2.5, 6)
      expect(f0.offset!.y).toBeCloseTo(1.8, 6)
    })

    it('wall coordinates preserved through floorData pass-through', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.walls).toBeDefined()
      const wall = f0.walls!.find(w => w.id === 'wall-a1')!
      expect(wall.start).toEqual({ x: 2.5, y: 1.8 })
      expect(wall.end).toEqual({ x: 12.5, y: 1.8 })
    })
  })

  describe('16. Existing walls/openings/roomAttributes remain unchanged', () => {
    it('walls survive round-trip', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const f0 = doc2.buildings.find(b => b.id === 'bld-a')!.floors.find(f => f.id === 'flr-a-g')!
      expect(f0.walls).toBeDefined()
      expect(f0.walls!).toHaveLength(1)
      expect(f0.walls![0].id).toBe('wall-a1')
      expect(f0.walls![0].thickness).toBe(0.2)
      expect(f0.walls![0].height).toBe(4.0)
    })

    it('Building B walls not leaked from A', () => {
      const { doc2 } = graphPipelineRoundTrip(docA)
      const bB = doc2.buildings.find(b => b.id === 'bld-b')!
      const walls = bB.floors[0].walls!
      expect(walls).toHaveLength(1)
      expect(walls[0].id).toBe('wall-b1')
      expect(walls.find(w => w.id === 'wall-a1')).toBeUndefined()
    })

    it('no coordinate drift across 2 cycles for walls', () => {
      const { doc2: docB } = graphPipelineRoundTrip(docA)
      const { doc2: docC } = graphPipelineRoundTrip(docB)
      const wallsB = docB.buildings.find(b => b.id === 'bld-a')!.floors[0].walls!
      const wallsC = docC.buildings.find(b => b.id === 'bld-a')!.floors[0].walls!
      expect(wallsC).toHaveLength(wallsB.length)
      for (const wB of wallsB) {
        const wC = wallsC.find(w => w.id === wB.id)!
        expect(wC.start).toEqual(wB.start)
        expect(wC.end).toEqual(wB.end)
        expect(wC.thickness).toBe(wB.thickness)
        expect(wC.height).toBe(wB.height)
      }
    })
  })
})
