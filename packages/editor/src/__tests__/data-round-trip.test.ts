import { describe, it, expect } from 'vitest'
import { CoordinateTransformer, serializeDocument, deserializeDocument, roundTrip } from '@navi/core'
import type { CampusDocument, Building, Floor, Room, Hallway, LegacyStaircase, LegacyElevator, Entrance, Road, Panorama, QRCheckpoint, LatLng, Wall, Window } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'

function makeFullDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 42,
    metadata: {
      campusId: 'ASU Polytechnic',
      name: 'ASU Polytechnic',
      description: 'Main campus for testing',
      lastModified: '2026-07-15T10:30:00.000Z',
      editorVersion: '1.0.0',
    },
    buildings: [
      {
        id: 'bld-eng',
        name: 'Engineering Building',
        code: 'ENG',
        category: 'academic',
        description: 'Houses CS and EE departments',
        department: 'Engineering',
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
        height: 25,
        color: '#336699',
        aliases: ['Eng', 'Engineering'],
        verticalConnectors: [],
        metadata: { built: 1998 },
        floors: [
          {
            id: 'flr-g',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            planImageId: 'plan-g-001',
            textureId: 'tex-concrete',
            svgOverlayId: 'svg-floor-g',
            metadata: { wing: 'east' },
            rooms: [
              {
                id: 'rm-101',
                name: 'Room 101',
                number: '101',
                category: 'classroom',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 8 },
                    { x: 0, y: 8 },
                    { x: 0, y: 0 },
                  ],
                },
                entrancePosition: { x: 5, y: 0 },
                capacity: 40,
                roomDoors: [],
                metadata: { projector: true, seats: 40 },
              },
            ],
            hallways: [
              {
                id: 'hw-main',
                name: 'Main Hallway',
                polyline: {
                  points: [
                    { x: 0, y: 4 },
                    { x: 10, y: 4 },
                  ],
                },
                width: 3,
                color: '#e0e0e0',
              },
            ],
            staircases: [
              {
                id: 'st-north',
                name: 'North Stairs',
                position: { x: 2, y: 2 },
                fromLevel: 0,
                toLevel: 2,
                type: 'enclosed',
              },
            ],
            elevators: [
              {
                id: 'el-main',
                name: 'Main Elevator',
                position: { x: 8, y: 2 },
                fromLevel: -1,
                toLevel: 3,
              },
            ],
            entrances: [
              {
                id: 'ent-main',
                label: 'Main Entrance',
                // Legacy world position (P1-T4: dual-mode tolerance)
                position: { lat: 33.4205, lng: -111.9295 } as any,
                level: 0,
                type: 'main',
                hasQR: true,
                hasPanorama: true,
                connectorRoadId: 'road-main',
              },
            ],
            connectorStops: [],
          },
        ],
      },
    ],
    roads: [
      {
        id: 'road-main',
        name: 'Main Road',
        polyline: {
          points: [
            { lat: 33.42, lng: -111.93 },
            { lat: 33.421, lng: -111.929 },
          ],
        },
        width: 5,
        surface: 'paved',
        type: 'arterial',
        connectorEntranceId: 'ent-main',
        metadata: { lanes: 2 },
      },
    ],
    panoramas: [
      {
        id: 'pano-front',
        label: 'Front Gate View',
        // Legacy world position (P1-T4: dual-mode tolerance)
        position: { lat: 33.42, lng: -111.93 } as any,
        heading: 180,
        imageAssetId: 'asset-pano-front-001',
        buildingId: 'bld-eng',
        floor: 0,
        hotspots: [
          {
            target: { type: 'entrance', targetId: 'ent-main' },
            position: { pitch: -10, yaw: 45 },
            label: 'Main Entrance',
          },
        ],
      },
    ],
    qrCheckpoints: [
      {
        id: 'qr-entrance',
        label: 'Engineering QR',
        // Legacy world position (P1-T4: dual-mode tolerance)
        position: { lat: 33.4205, lng: -111.9295 } as any,
        floor: 0,
        buildingId: 'bld-eng',
        code: 'https://navi.app/checkin/eng',
        metadata: { scanner: 'v2' },
      },
    ],
  }
}

describe('S-001: Data round-trip integrity', () => {
  // ── Phase 1: Pure JSON serialization (no GraphAdapter) ──
  describe('JSON serialization round-trip', () => {
    it('survives roundTrip() equality check', () => {
      const doc = makeFullDocument()
      const result = roundTrip(doc)
      expect(result.success).toBe(true)
    })

    it('strips _changeJournal from serialized output', () => {
      const doc = makeFullDocument()
      doc._changeJournal = [
        { entityId: 'rm-101', entityType: 'room', operation: 'created' },
      ]
      doc.version = 43
      const json = serializeDocument(doc)
      const parsed = JSON.parse(json)
      expect(parsed._changeJournal).toBeUndefined()
      expect(parsed.version).toBe(43)
    })

    it('preserves all top-level fields', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      expect(restored.schemaVersion).toBe(1)
      expect(restored.version).toBe(42)
      expect(restored.metadata.name).toBe('ASU Polytechnic')
      expect(restored.metadata.editorVersion).toBe('1.0.0')
    })

    it('preserves building fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const b = restored.buildings[0]
      expect(b.id).toBe('bld-eng')
      expect(b.name).toBe('Engineering Building')
      expect(b.code).toBe('ENG')
      expect(b.category).toBe('academic')
      expect(b.description).toBe('Houses CS and EE departments')
      expect(b.department).toBe('Engineering')
      expect(b.footprint.points).toHaveLength(5)
      expect(b.baseElevation).toBe(0)
      expect(b.height).toBe(25)
      expect(b.color).toBe('#336699')
      expect(b.aliases).toEqual(['Eng', 'Engineering'])
      expect(b.metadata).toEqual({ built: 1998 })
    })

    it('preserves floor fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const f = restored.buildings[0].floors[0]
      expect(f.id).toBe('flr-g')
      expect(f.level).toBe(0)
      expect(f.label).toBe('Ground Floor')
      expect(f.elevation).toBe(0)
      expect(f.planImageId).toBe('plan-g-001')
      expect(f.textureId).toBe('tex-concrete')
      expect(f.svgOverlayId).toBe('svg-floor-g')
      expect(f.metadata).toEqual({ wing: 'east' })
    })

    it('preserves room fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const r = restored.buildings[0].floors[0].rooms[0]
      expect(r.id).toBe('rm-101')
      expect(r.name).toBe('Room 101')
      expect(r.number).toBe('101')
      expect(r.category).toBe('classroom')
      expect(r.polygon.points).toHaveLength(5)
      expect(r.polygon.points[0]).toEqual({ x: 0, y: 0 })
      expect(r.entrancePosition).toEqual({ x: 5, y: 0 })
      expect(r.capacity).toBe(40)
      expect(r.metadata).toEqual({ projector: true, seats: 40 })
    })

    it('preserves hallway fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const h = restored.buildings[0].floors[0].hallways[0]
      expect(h.id).toBe('hw-main')
      expect(h.name).toBe('Main Hallway')
      expect(h.polyline.points).toHaveLength(2)
      expect(h.width).toBe(3)
      expect(h.color).toBe('#e0e0e0')
    })

    it('preserves staircase fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const s = restored.buildings[0].floors[0].staircases[0]
      expect(s.id).toBe('st-north')
      expect(s.name).toBe('North Stairs')
      expect(s.position).toEqual({ x: 2, y: 2 })
      expect(s.fromLevel).toBe(0)
      expect(s.toLevel).toBe(2)
      expect(s.type).toBe('enclosed')
    })

    it('preserves elevator fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const e = restored.buildings[0].floors[0].elevators[0]
      expect(e.id).toBe('el-main')
      expect(e.name).toBe('Main Elevator')
      expect(e.position).toEqual({ x: 8, y: 2 })
      expect(e.fromLevel).toBe(-1)
      expect(e.toLevel).toBe(3)
    })

    it('preserves entrance fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const e = restored.buildings[0].floors[0].entrances[0]
      expect(e.id).toBe('ent-main')
      expect(e.label).toBe('Main Entrance')
      expect(e.position).toEqual({ lat: 33.4205, lng: -111.9295 })
      expect(e.level).toBe(0)
      expect(e.type).toBe('main')
      expect(e.hasQR).toBe(true)
      expect(e.hasPanorama).toBe(true)
      expect(e.connectorRoadId).toBe('road-main')
    })

    it('preserves road fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const r = restored.roads[0]
      expect(r.id).toBe('road-main')
      expect(r.name).toBe('Main Road')
      expect(r.polyline.points).toHaveLength(2)
      expect(r.width).toBe(5)
      expect(r.surface).toBe('paved')
      expect(r.type).toBe('arterial')
      expect(r.connectorEntranceId).toBe('ent-main')
      expect(r.metadata).toEqual({ lanes: 2 })
    })

    it('preserves panorama fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const p = restored.panoramas[0]
      expect(p.id).toBe('pano-front')
      expect(p.label).toBe('Front Gate View')
      expect(p.position).toEqual({ lat: 33.42, lng: -111.93 })
      expect(p.heading).toBe(180)
      expect(p.imageAssetId).toBe('asset-pano-front-001')
      expect(p.buildingId).toBe('bld-eng')
      expect(p.floor).toBe(0)
      expect(p.hotspots).toHaveLength(1)
      expect(p.hotspots[0].target).toEqual({ type: 'entrance', targetId: 'ent-main' })
    })

    it('preserves QR checkpoint fields through serialization', () => {
      const doc = makeFullDocument()
      const json = serializeDocument(doc)
      const restored = deserializeDocument(json)
      const q = restored.qrCheckpoints[0]
      expect(q.id).toBe('qr-entrance')
      expect(q.label).toBe('Engineering QR')
      expect(q.position).toEqual({ lat: 33.4205, lng: -111.9295 })
      expect(q.floor).toBe(0)
      expect(q.buildingId).toBe('bld-eng')
      expect(q.code).toBe('https://navi.app/checkin/eng')
      expect(q.metadata).toEqual({ scanner: 'v2' })
    })
  })

  // ── Phase 2: Full pipeline round-trip (CampusDocument → GraphAdapter → createDocument) ──
  describe('GraphAdapter pipeline round-trip', () => {
    it('sync + createDocument preserves building identity', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      // Register building so coordinate transforms work
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const b1 = doc.buildings[0]
      const b2 = doc2.buildings.find(b => b.id === 'bld-eng')!
      expect(b2).toBeDefined()
      expect(b2.name).toBe(b1.name)
      expect(b2.code).toBe(b1.code)
      expect(b2.category).toBe(b1.category)
      expect(b2.description).toBe(b1.description)
      expect(b2.department).toBe(b1.department)
      expect(b2.baseElevation).toBe(b1.baseElevation)
      expect(b2.height).toBe(b1.height)
      expect(b2.color).toBe(b1.color)
      expect(b2.aliases).toEqual(b1.aliases)
      expect(b2.footprint.points).toEqual(b1.footprint.points)
      expect(b2.metadata).toEqual(b1.metadata)
    })

    it('sync + createDocument preserves floor identity', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const f1 = doc.buildings[0].floors[0]
      const f2 = doc2.buildings[0].floors.find(f => f.id === 'flr-g')!
      expect(f2).toBeDefined()
      expect(f2.level).toBe(f1.level)
      expect(f2.label).toBe(f1.label)
      expect(f2.elevation).toBe(f1.elevation)
      expect(f2.planImageId).toBe(f1.planImageId)
      expect(f2.textureId).toBe(f1.textureId)
      expect(f2.svgOverlayId).toBe(f1.svgOverlayId)
      expect(f2.metadata).toEqual(f1.metadata)
    })

    it('sync + createDocument preserves room id and metadata', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const r1 = doc.buildings[0].floors[0].rooms[0]
      const r2 = doc2.buildings[0].floors[0].rooms.find(r => r.id === 'rm-101')!
      expect(r2).toBeDefined()
      expect(r2.name).toBe(r1.name)
      expect(r2.number).toBe(r1.number)
      expect(r2.category).toBe(r1.category)
      expect(r2.capacity).toBe(r1.capacity)
      expect(r2.metadata).toEqual(r1.metadata)
      // Room polygon is rebuilt from world→local coords — may have precision drift
      expect(r2.polygon.points).toHaveLength(r1.polygon.points.length)
    })

    it('sync + createDocument preserves hallway id and metadata', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const h1 = doc.buildings[0].floors[0].hallways[0]
      const h2 = doc2.buildings[0].floors[0].hallways.find(h => h.id === 'hw-main')!
      expect(h2).toBeDefined()
      expect(h2.name).toBe(h1.name)
      expect(h2.width).toBe(h1.width)
      expect(h2.color).toBe(h1.color)
      expect(h2.polyline.points).toHaveLength(h1.polyline.points.length)
    })

    it('sync + createDocument preserves staircase id and metadata', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const s1 = doc.buildings[0].floors[0].staircases[0]
      const s2 = doc2.buildings[0].floors[0].staircases.find(s => s.id === 'st-north')!
      expect(s2).toBeDefined()
      expect(s2.name).toBe(s1.name)
      expect(s2.fromLevel).toBe(s1.fromLevel)
      expect(s2.toLevel).toBe(s1.toLevel)
      expect(s2.type).toBe(s1.type)
    })

    it('sync + createDocument preserves elevator id and metadata', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const e1 = doc.buildings[0].floors[0].elevators[0]
      const e2 = doc2.buildings[0].floors[0].elevators.find(e => e.id === 'el-main')!
      expect(e2).toBeDefined()
      expect(e2.name).toBe(e1.name)
      expect(e2.fromLevel).toBe(e1.fromLevel)
      expect(e2.toLevel).toBe(e1.toLevel)
    })

    it('sync + createDocument preserves entrance identity', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const e1 = doc.buildings[0].floors[0].entrances[0]
      const e2 = doc2.buildings[0].floors[0].entrances.find(e => e.id === 'ent-main')!
      expect(e2).toBeDefined()
      expect(e2.label).toBe(e1.label)
      expect(e2.type).toBe(e1.type)
      expect(e2.hasQR).toBe(e1.hasQR)
      expect(e2.hasPanorama).toBe(e1.hasPanorama)
    })

    it('sync + createDocument preserves roads', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const r1 = doc.roads[0]
      const r2 = doc2.roads.find(r => r.id === 'road-main')!
      expect(r2).toBeDefined()
      expect(r2.name).toBe(r1.name)
      expect(r2.width).toBe(r1.width)
      expect(r2.polyline.points).toEqual(r1.polyline.points)
    })

    it('sync + createDocument preserves panorama identity', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const p1 = doc.panoramas[0]
      const p2 = doc2.panoramas.find(p => p.id === 'pano-front')!
      expect(p2).toBeDefined()
      expect(p2.label).toBe(p1.label)
      // P1-T4: stored positions are building-local; the pipeline round-trips world→local
      expect(p2.position).toEqual(transformer.worldToBuildingLocal(p1.position as LatLng, 'bld-eng'))
      expect(p2.buildingId).toBe(p1.buildingId)
      expect(p2.floor).toBe(p1.floor)
    })

    it('sync + createDocument preserves QR checkpoint identity', () => {
      const doc = makeFullDocument()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({
        buildingId: 'bld-eng',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const q1 = doc.qrCheckpoints[0]
      const q2 = doc2.qrCheckpoints.find(q => q.id === 'qr-entrance')!
      expect(q2).toBeDefined()
      expect(q2.label).toBe(q1.label)
      // P1-T4: stored positions are building-local; the pipeline round-trips world→local
      expect(q2.position).toEqual(transformer.worldToBuildingLocal(q1.position as LatLng, 'bld-eng'))
      expect(q2.floor).toBe(q1.floor)
      expect(q2.buildingId).toBe(q1.buildingId)
      expect(q2.code).toBe(q1.code)
    })
  })

  // ── Phase 3: Wall/Window persistence round-trip (W2) ──
  describe('W2: Wall/Window persistence round-trip', () => {
    function makeDocWithWalls(): CampusDocument {
      const wallA: Wall = {
        id: 'wall-a1',
        start: { x: 1, y: 2 },
        end: { x: 10, y: 2 },
        thickness: 0.15,
        height: 3.5,
        metadata: { material: 'concrete' },
      }
      const wallA2: Wall = {
        id: 'wall-a2',
        start: { x: 10, y: 2 },
        end: { x: 10, y: 8 },
        thickness: 0.2,
        height: 3.0,
      }
      const wallB: Wall = {
        id: 'wall-b1',
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        thickness: 0.15,
        height: 3.5,
      }
      const winA: Window = {
        id: 'win-a1',
        wallId: 'wall-a1',
        offset: 2.5,
        width: 1.2,
        sillHeight: 0.8,
        metadata: { type: 'casement' },
      }

      return {
        schemaVersion: 1,
        version: 42,
        metadata: {
          campusId: 'wall-test',
          name: 'Wall Test Campus',
          lastModified: '2026-08-24T00:00:00.000Z',
        },
        buildings: [
          {
            id: 'bld-a',
            name: 'Building A',
            code: 'A',
            category: 'academic',
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
            color: '#111111',
            metadata: {},
            floors: [
              {
                id: 'flr-a1',
                level: 0,
                label: 'Ground Floor',
                elevation: 0,
                rooms: [],
                hallways: [],
                staircases: [],
                elevators: [],
                entrances: [],
                connectorStops: [],
                parametricComponents: [],
                metadata: {},
                walls: [wallA, wallA2],
                windows: [winA],
              },
              {
                id: 'flr-a2',
                level: 1,
                label: 'Second Floor',
                elevation: 3.5,
                rooms: [],
                hallways: [],
                staircases: [],
                elevators: [],
                entrances: [],
                connectorStops: [],
                parametricComponents: [],
                metadata: {},
                walls: [],
                windows: [],
              },
            ],
          },
          {
            id: 'bld-b',
            name: 'Building B',
            code: 'B',
            category: 'admin',
            footprint: {
              points: [
                { lat: 33.43, lng: -111.94 },
                { lat: 33.431, lng: -111.94 },
                { lat: 33.431, lng: -111.939 },
                { lat: 33.43, lng: -111.939 },
                { lat: 33.43, lng: -111.94 },
              ],
            },
            baseElevation: 0,
            height: 15,
            color: '#222222',
            metadata: {},
            floors: [
              {
                id: 'flr-b1',
                level: 0,
                label: 'Ground Floor',
                elevation: 0,
                rooms: [],
                hallways: [],
                staircases: [],
                elevators: [],
                entrances: [],
                connectorStops: [],
                parametricComponents: [],
                metadata: {},
                walls: [wallB],
                windows: [],
              },
            ],
          },
        ],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }
    }

    it('Walls survive full pipeline round-trip (id, start, end, thickness, height, metadata)', () => {
      const doc = makeDocWithWalls()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({ buildingId: 'bld-a', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      transformer.registerBuilding({ buildingId: 'bld-b', origin: { lat: 33.4305, lng: -111.9395 }, rotation: 0 })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const bA = doc2.buildings.find(b => b.id === 'bld-a')!
      const fA1 = bA.floors.find(f => f.id === 'flr-a1')!

      expect(fA1.walls).toBeDefined()
      expect(fA1.walls).toHaveLength(2)

      const w1 = fA1.walls!.find(w => w.id === 'wall-a1')!
      expect(w1.start).toEqual({ x: 1, y: 2 })
      expect(w1.end).toEqual({ x: 10, y: 2 })
      expect(w1.thickness).toBe(0.15)
      expect(w1.height).toBe(3.5)
      expect(w1.metadata).toEqual({ material: 'concrete' })

      const w2 = fA1.walls!.find(w => w.id === 'wall-a2')!
      expect(w2.thickness).toBe(0.2)
      expect(w2.height).toBe(3.0)
      expect(w2.metadata).toBeUndefined()
    })

    it('Windows survive round-trip', () => {
      const doc = makeDocWithWalls()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({ buildingId: 'bld-a', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      transformer.registerBuilding({ buildingId: 'bld-b', origin: { lat: 33.4305, lng: -111.9395 }, rotation: 0 })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const bA = doc2.buildings.find(b => b.id === 'bld-a')!
      const fA1 = bA.floors.find(f => f.id === 'flr-a1')!

      expect(fA1.windows).toBeDefined()
      expect(fA1.windows).toHaveLength(1)

      const win = fA1.windows![0]
      expect(win.id).toBe('win-a1')
      expect(win.wallId).toBe('wall-a1')
      expect(win.offset).toBe(2.5)
      expect(win.width).toBe(1.2)
      expect(win.sillHeight).toBe(0.8)
      expect(win.metadata).toEqual({ type: 'casement' })
    })

    it('Floor 1 Walls do not appear on Floor 2', () => {
      const doc = makeDocWithWalls()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({ buildingId: 'bld-a', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      transformer.registerBuilding({ buildingId: 'bld-b', origin: { lat: 33.4305, lng: -111.9395 }, rotation: 0 })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const bA = doc2.buildings.find(b => b.id === 'bld-a')!
      const fA2 = bA.floors.find(f => f.id === 'flr-a2')!

      // Floor 2 has walls array but it's empty — no Floor 1 walls leaked
      expect(fA2.walls).toBeDefined()
      expect(fA2.walls).toHaveLength(0)
    })

    it('Building A Walls do not appear in Building B', () => {
      const doc = makeDocWithWalls()
      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({ buildingId: 'bld-a', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      transformer.registerBuilding({ buildingId: 'bld-b', origin: { lat: 33.4305, lng: -111.9395 }, rotation: 0 })
      new GraphAdapter(graph, transformer).sync(doc)
      const doc2 = createDocument(graph, transformer)

      const bB = doc2.buildings.find(b => b.id === 'bld-b')!
      const fB1 = bB.floors.find(f => f.id === 'flr-b1')!

      expect(fB1.walls).toBeDefined()
      expect(fB1.walls).toHaveLength(1)
      expect(fB1.walls![0].id).toBe('wall-b1')

      // Building A's wall-a1 should NOT appear in Building B
      const leaked = fB1.walls!.find(w => w.id === 'wall-a1')
      expect(leaked).toBeUndefined()
    })

    it('Legacy documents without Walls still load', () => {
      // A document with no walls/windows fields at all
      const legacyDoc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: {
          campusId: 'legacy',
          name: 'Legacy Campus',
          lastModified: '2026-01-01T00:00:00.000Z',
        },
        buildings: [
          {
            id: 'bld-old',
            name: 'Old Building',
            code: 'OLD',
            category: 'admin',
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
            height: 10,
            color: '#999999',
            metadata: {},
            floors: [
              {
                id: 'flr-old',
                level: 0,
                label: 'Ground',
                elevation: 0,
                rooms: [],
                hallways: [],
                staircases: [],
                elevators: [],
                entrances: [],
                connectorStops: [],
                parametricComponents: [],
                metadata: {},
                // deliberately no walls/windows
              },
            ],
          },
        ],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }

      const graph = new Graph()
      const transformer = new CoordinateTransformer()
      transformer.registerBuilding({ buildingId: 'bld-old', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      new GraphAdapter(graph, transformer).sync(legacyDoc)
      const doc2 = createDocument(graph, transformer)

      const f = doc2.buildings[0].floors[0]
      // Walls may be undefined or empty — both are acceptable
      expect(f.walls === undefined || (Array.isArray(f.walls) && f.walls.length === 0)).toBe(true)
      expect(f.windows === undefined || (Array.isArray(f.windows) && f.windows.length === 0)).toBe(true)
    })
  })

  // ── Phase 4: Idempotency (save → reload → save → reload) ──
  describe('W2: Wall/Window idempotency', () => {
    it('save → reload → save → reload produces identical Walls', () => {
      const wall: Wall = {
        id: 'wall-idem',
        start: { x: 0, y: 0 },
        end: { x: 8, y: 0 },
        thickness: 0.15,
        height: 3.5,
        metadata: { tag: 'exterior' },
      }
      const win: Window = {
        id: 'win-idem',
        wallId: 'wall-idem',
        offset: 3.0,
        width: 1.5,
        sillHeight: 0.9,
        metadata: {},
      }

      const doc1: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: { campusId: 'idem', name: 'Idem Test', lastModified: '2026-08-24T00:00:00.000Z' },
        buildings: [
          {
            id: 'bld-idem',
            name: 'Idem Building',
            code: 'ID',
            category: 'academic',
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
            height: 10,
            color: '#aaaaaa',
            metadata: {},
            floors: [
              {
                id: 'flr-idem',
                level: 0,
                label: 'G',
                elevation: 0,
                rooms: [],
                hallways: [],
                staircases: [],
                elevators: [],
                entrances: [],
                connectorStops: [],
                parametricComponents: [],
                metadata: {},
                walls: [wall],
                windows: [win],
              },
            ],
          },
        ],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }

      // Round 1: save → reload
      const graph1 = new Graph()
      const t1 = new CoordinateTransformer()
      t1.registerBuilding({ buildingId: 'bld-idem', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      new GraphAdapter(graph1, t1).sync(doc1)
      const doc2 = createDocument(graph1, t1)

      // Round 2: save doc2 → reload again
      const graph2 = new Graph()
      const t2 = new CoordinateTransformer()
      t2.registerBuilding({ buildingId: 'bld-idem', origin: { lat: 33.4205, lng: -111.9295 }, rotation: 0 })
      new GraphAdapter(graph2, t2).sync(doc2)
      const doc3 = createDocument(graph2, t2)

      // Compare doc2 vs doc3 — Walls should be identical
      const walls2 = doc2.buildings[0].floors[0].walls!
      const walls3 = doc3.buildings[0].floors[0].walls!

      expect(walls3).toHaveLength(walls2.length)
      expect(walls3[0].id).toBe(walls2[0].id)
      expect(walls3[0].start).toEqual(walls2[0].start)
      expect(walls3[0].end).toEqual(walls2[0].end)
      expect(walls3[0].thickness).toBe(walls2[0].thickness)
      expect(walls3[0].height).toBe(walls2[0].height)
      expect(walls3[0].metadata).toEqual(walls2[0].metadata)

      // Compare windows
      const wins2 = doc2.buildings[0].floors[0].windows!
      const wins3 = doc3.buildings[0].floors[0].windows!

      expect(wins3).toHaveLength(wins2.length)
      expect(wins3[0].id).toBe(wins2[0].id)
      expect(wins3[0].wallId).toBe(wins2[0].wallId)
      expect(wins3[0].offset).toBe(wins2[0].offset)
      expect(wins3[0].width).toBe(wins2[0].width)
      expect(wins3[0].sillHeight).toBe(wins2[0].sillHeight)
    })
  })

  it('preserves a split route junction and door connection byte-exact', () => {
    const doc = makeFullDocument()
    const floor = doc.buildings[0].floors[0]
    floor.routeNetwork = {
      nodes: [
        { id: 'n-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'j-1', type: 'waypoint', position: { x: 4, y: 0 }, floor: 0 },
        { id: 'n-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
        { id: 'door-anchor', type: 'portal', position: { x: 2, y: 2 }, floor: 0 },
      ],
      edges: [
        { id: 'e-a-j', from: 'n-a', to: 'j-1', type: 'walk', distance: 4 },
        { id: 'e-j-b', from: 'j-1', to: 'n-b', type: 'walk', distance: 6 },
        { id: 'e-connector', from: 'door-anchor', to: 'j-1', type: 'walk', distance: Math.hypot(2, 2) },
      ],
    }
    floor.doors = [{
      id: 'door-1', name: 'Test Door', doorType: 'standard',
      position: { x: 2, y: 2 }, width: 1, depth: 1, rotation: 0,
      routeConnection: { anchorNodeId: 'door-anchor', targetRouteNodeId: 'j-1', connectorEdgeId: 'e-connector' },
      geometry: { type: 'rectangle', min: { x: 1.5, y: 1.5 }, max: { x: 2.5, y: 2.5 }, rotation: 0 },
      metadata: {},
    }] as unknown as typeof floor.doors
    const expectedNetwork = JSON.parse(JSON.stringify(floor.routeNetwork))
    const expectedConnection = JSON.parse(JSON.stringify(floor.doors?.[0]?.routeConnection))

    const revived = deserializeDocument(serializeDocument(doc))
    const revivedFloor = revived.buildings[0].floors[0]

    expect(revivedFloor.routeNetwork).toEqual(expectedNetwork)
    expect(revivedFloor.doors?.[0]?.routeConnection).toEqual(expectedConnection)
  })
})
