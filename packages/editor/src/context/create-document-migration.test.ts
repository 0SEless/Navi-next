import { describe, it, expect } from 'vitest'
import { createDocument } from './create-editor-context'
import { CoordinateTransformer, serializeDocument, deserializeDocument } from '@navi/core'

// ── P0 T0.3 migration tests ──
// Legacy per-floor records (floor.staircases / floor.elevators /
// floor.parametricComponents) must be minted into building-level feature
// entities by createDocument: one feature per record, single-level, id
// preserved, fromLevel/toLevel per record, and (for parametric records) a
// drawing + resolved polygon via the T0.4 bridge.

interface RawFloorRecord {
  level: number
  staircases?: Array<{
    id: string
    name?: string
    position?: { x: number; y: number }
    fromLevel?: number
    toLevel?: number
    type?: string
  }>
  elevators?: Array<{
    id: string
    name?: string
    position?: { x: number; y: number }
    fromLevel?: number
    toLevel?: number
  }>
  parametricComponents?: Array<{
    id?: string
    definitionId?: string
    position?: { x: number; y: number }
    rotation?: number
    properties?: Record<string, unknown>
  }>
  rooms?: Array<{ id: string; name?: string; number?: string; polygon?: { points: Array<{ x: number; y: number }> } }>
  hallways?: Array<{ id: string; name?: string; polyline?: { points: Array<{ x: number; y: number }> }; width?: number; color?: string }>
  entrances?: Array<{ id: string; name?: string; position?: { lat: number; lng: number }; type?: string }>
  pois?: Array<{ id: string; name?: string; category?: string; position?: { x: number; y: number }; metadata?: Record<string, unknown> }>
  doors?: Array<{ id: string; roomId: string; connectedToId?: string; connectedToType?: 'room' | 'hallway'; doorType?: string; position?: { x: number; y: number }; width?: number; metadata?: Record<string, unknown> }>
  routeNetwork?: {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; floor: number }>
    edges: Array<{ id: string; from: string; to: string; type: string; distance: number }>
  }
}

function makeGraph(floors: RawFloorRecord[], buildingExtras: Record<string, unknown> = {}): {
  campusId: string
  name: string
  buildings: Array<Record<string, unknown>>
  components: unknown[]
  nodes: unknown[]
  edges: unknown[]
  traces: unknown[]
} {
  return {
    campusId: 'c1',
    name: 'Test Campus',
    buildings: [
      {
        id: 'b1',
        name: 'Building 1',
        code: 'B1',
        category: 'academic',
        description: 'desc',
        baseElevation: 3,
        height: 24,
        footprint: { points: [{ lat: 33.42, lng: -111.93 }, { lat: 33.4201, lng: -111.93 }, { lat: 33.4201, lng: -111.9299 }, { lat: 33.42, lng: -111.9299 }] },
        floors,
        ...buildingExtras,
      },
    ],
    components: [],
    nodes: [],
    edges: [],
    traces: [],
  }
}

describe('createDocument — T0.3 migration: legacy staircases → features', () => {
  it('mints one feature per legacy record, one level each, ids preserved, fromLevel/toLevel and position carried', () => {
    const graph = makeGraph([
      {
        level: 0,
        staircases: [
          { id: 'stair-main-g-a', name: 'Main Stairs A', position: { x: 10, y: 20 }, fromLevel: 0, toLevel: 1, type: 'open' },
        ],
      },
      {
        level: 1,
        staircases: [
          { id: 'stair-main-1-a', name: 'Main Stairs A', position: { x: 10, y: 21 }, fromLevel: 0, toLevel: 1, type: 'open' },
        ],
      },
    ])
    const doc = createDocument(graph)
    const features = doc.buildings[0].staircases!
    expect(features).toHaveLength(2)

    const f0 = features.find((f) => f.id === 'stair-main-g-a')!
    expect(f0.buildingId).toBe('b1')
    expect(f0.name).toBe('Main Stairs A')
    expect(f0.type).toBe('open')
    expect(f0.accessible).toBe(false)
    expect(f0.fromLevel).toBe(0)
    expect(f0.toLevel).toBe(1)
    expect(Object.keys(f0.levels)).toEqual(['0'])
    expect(f0.levels[0]).toEqual({ position: { x: 10, y: 20 }, rotation: 0 })

    const f1 = features.find((f) => f.id === 'stair-main-1-a')!
    expect(f1.fromLevel).toBe(0)
    expect(f1.toLevel).toBe(1)
    expect(Object.keys(f1.levels)).toEqual(['1'])
    expect(f1.levels[1]).toEqual({ position: { x: 10, y: 21 }, rotation: 0 })
  })

  it('mints features from graph components of type stair (component id → feature id, range → from/to)', () => {
    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'b1', origin: { lat: 33.42, lng: -111.93 }, rotation: 0 })
    const graph = makeGraph([{ level: 0 }])
    graph.components = [
      { id: 'comp-stair-1', type: 'stair', name: 'North Stairs', buildingId: 'b1', floor: 0, position: { lat: 33.420005, lng: -111.93 }, range: { from: 0, to: 2 }, metadata: { type: 'open' } },
    ]
    const doc = createDocument(graph, transformer)
    const features = doc.buildings[0].staircases!
    expect(features).toHaveLength(1)
    const f = features[0]
    expect(f.id).toBe('comp-stair-1')
    expect(f.buildingId).toBe('b1')
    expect(f.name).toBe('North Stairs')
    expect(f.type).toBe('open')
    expect(f.fromLevel).toBe(0)
    expect(f.toLevel).toBe(2)
    expect(Object.keys(f.levels)).toEqual(['0'])
    expect(f.levels[0].position).toEqual(transformer.worldToBuildingLocal({ lat: 33.420005, lng: -111.93 }, 'b1'))
    expect(f.levels[0].rotation).toBe(0)
  })
})

describe('createDocument — T0.3 migration: legacy elevators → features', () => {
  it('mints one feature per legacy elevator record with from/to carried', () => {
    const graph = makeGraph([
      {
        level: 0,
        elevators: [
          { id: 'elev-main-g', name: 'Main Elevator', position: { x: 30, y: 40 }, fromLevel: 0, toLevel: 3 },
        ],
      },
    ])
    const doc = createDocument(graph)
    const features = doc.buildings[0].elevators!
    expect(features).toHaveLength(1)
    const f = features[0]
    expect(f.id).toBe('elev-main-g')
    expect(f.buildingId).toBe('b1')
    expect(f.name).toBe('Main Elevator')
    expect(f.type).toBe('passenger')
    expect(f.accessible).toBe(false)
    expect(f.fromLevel).toBe(0)
    expect(f.toLevel).toBe(3)
    expect(Object.keys(f.levels)).toEqual(['0'])
    expect(f.levels[0]).toEqual({ position: { x: 30, y: 40 }, rotation: 0 })
  })

  it('uses the floor level for both ends when the legacy elevator lacks from/to', () => {
    const graph = makeGraph([
      { level: 2, elevators: [{ id: 'elev-no-range', name: 'Elev No Range', position: { x: 1, y: 2 } }] },
    ])
    const doc = createDocument(graph)
    const f = doc.buildings[0].elevators![0]
    expect(f.id).toBe('elev-no-range')
    expect(f.fromLevel).toBe(2)
    expect(f.toLevel).toBe(2)
    expect(Object.keys(f.levels)).toEqual(['2'])
  })
})

describe('createDocument — T0.3 migration: parametric components → features with drawing + resolved polygon', () => {
  it('mints a stair feature with drawing and the exact resolved polygon (matches T0.4 math)', () => {
    const graph = makeGraph([
      {
        level: 0,
        parametricComponents: [
          {
            id: 'pc-stair-0',
            definitionId: 'stair',
            position: { x: 10, y: 20 },
            rotation: 0,
            properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' },
          },
        ],
      },
    ])
    const doc = createDocument(graph)
    const features = doc.buildings[0].staircases!
    expect(features).toHaveLength(1)
    const f = features[0]
    expect(f.id).toBe('pc-stair-0')
    expect(f.buildingId).toBe('b1')
    expect(f.type).toBe('open')
    expect(f.fromLevel).toBe(0)
    expect(f.toLevel).toBe(0)
    expect(f.levels[0].position).toEqual({ x: 10, y: 20 })
    expect(f.levels[0].rotation).toBe(0)
    expect(f.levels[0].drawing).toEqual({
      definitionId: 'stair',
      properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' },
    })
    // stepWidth 2, stepCount*stepDepth 2 → 2x2 rect at (10,20), rotation 0
    expect(f.levels[0].polygon).toEqual({
      points: [
        { x: 11, y: 21 },
        { x: 9, y: 21 },
        { x: 9, y: 19 },
        { x: 11, y: 19 },
        { x: 11, y: 21 },
      ],
    })
  })

  it('mints an elevator feature with drawing and the resolved polygon', () => {
    const graph = makeGraph([
      {
        level: 0,
        parametricComponents: [
          {
            id: 'pc-elev-0',
            definitionId: 'elevator',
            position: { x: 5, y: 5 },
            rotation: 0,
            properties: { width: 1.5, depth: 1.5, doorSide: 'front' },
          },
        ],
      },
    ])
    const doc = createDocument(graph)
    const features = doc.buildings[0].elevators!
    expect(features).toHaveLength(1)
    const f = features[0]
    expect(f.id).toBe('pc-elev-0')
    expect(f.type).toBe('passenger')
    expect(f.levels[0].drawing).toEqual({
      definitionId: 'elevator',
      properties: { width: 1.5, depth: 1.5, doorSide: 'front' },
    })
    expect(f.levels[0].polygon).toEqual({
      points: [
        { x: 5.75, y: 5.75 },
        { x: 4.25, y: 5.75 },
        { x: 4.25, y: 4.25 },
        { x: 5.75, y: 4.25 },
        { x: 5.75, y: 5.75 },
      ],
    })
  })

  it('honors the parametric rotation when deriving the polygon', () => {
    const graph = makeGraph([
      {
        level: 0,
        parametricComponents: [
          {
            id: 'pc-stair-rot',
            definitionId: 'stair',
            position: { x: 10, y: 20 },
            rotation: 90,
            properties: { stepCount: 4, stepWidth: 2, stepDepth: 0.5, direction: 'east', preset: 'straight' },
          },
        ],
      },
    ])
    const doc = createDocument(graph)
    const f = doc.buildings[0].staircases![0]
    expect(f.levels[0].polygon).toEqual({
      points: [
        { x: 9, y: 21 },
        { x: 9, y: 19 },
        { x: 11, y: 19 },
        { x: 11, y: 21 },
        { x: 9, y: 21 },
      ],
    })
  })

  it('skips parametric records with unknown definitionIds', () => {
    const graph = makeGraph([
      {
        level: 0,
        parametricComponents: [{ id: 'pc-weird', definitionId: 'ramp', position: { x: 0, y: 0 }, rotation: 0, properties: {} }],
      },
    ])
    const doc = createDocument(graph)
    expect(doc.buildings[0].staircases ?? []).toHaveLength(0)
    expect(doc.buildings[0].elevators ?? []).toHaveLength(0)
  })
})

describe('createDocument — T0.3 migration: new-shape input wins', () => {
  it('uses new-shape features verbatim and does not mint from legacy arrays', () => {
    const newStair = {
      id: 'new-stair-1',
      buildingId: 'b1',
      name: 'New Stair',
      type: 'open',
      accessible: true,
      fromLevel: 0,
      toLevel: 2,
      levels: {
        0: { position: { x: 1, y: 1 }, rotation: 0 },
        2: { position: { x: 2, y: 2 }, rotation: 0 },
      },
    }
    const graph = makeGraph([
      { level: 0, staircases: [{ id: 'legacy-stair-x', name: 'Legacy', position: { x: 9, y: 9 }, fromLevel: 0, toLevel: 1, type: 'open' }] },
    ], { staircases: [newStair] })
    const doc = createDocument(graph)
    const features = doc.buildings[0].staircases!
    expect(features).toHaveLength(1)
    expect(features[0]).toEqual(newStair)
    expect(features[0].id).toBe('new-stair-1')
  })

  it('uses new-shape elevators verbatim and does not mint from legacy arrays', () => {
    const newElev = {
      id: 'new-elev-1',
      buildingId: 'b1',
      name: 'New Elev',
      type: 'passenger',
      accessible: true,
      fromLevel: 0,
      toLevel: 1,
      levels: { 0: { position: { x: 3, y: 3 }, rotation: 0 } },
    }
    const graph = makeGraph([
      { level: 0, elevators: [{ id: 'legacy-elev-x', name: 'Legacy', position: { x: 9, y: 9 }, fromLevel: 0, toLevel: 1 }] },
    ], { elevators: [newElev] })
    const doc = createDocument(graph)
    const features = doc.buildings[0].elevators!
    expect(features).toHaveLength(1)
    expect(features[0]).toEqual(newElev)
    expect(features[0].id).toBe('new-elev-1')
  })
})

describe('createDocument — T0.3 migration: zero data loss', () => {
  it('leaves rooms/hallways/entrances/floors/building fields untouched while minting features', () => {
    const graph = makeGraph([
      {
        level: 0,
        rooms: [{ id: 'rm-101', name: 'Room 101', number: '101', polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 0 }] } }],
        hallways: [{ id: 'hw-main', name: 'Main Hall', polyline: { points: [{ x: 0, y: 2 }, { x: 10, y: 2 }] }, width: 3, color: '#fff' }],
        entrances: [{ id: 'ent-1', name: 'Main Entrance', position: { lat: 33.42, lng: -111.93 }, type: 'main' }],
        staircases: [{ id: 'stair-a', name: 'Stair A', position: { x: 2, y: 2 }, fromLevel: 0, toLevel: 1, type: 'open' }],
      },
    ])
    const doc = createDocument(graph)
    const b = doc.buildings[0]
    expect(b.id).toBe('b1')
    expect(b.name).toBe('Building 1')
    expect(b.code).toBe('B1')
    expect(b.category).toBe('academic')
    expect(b.description).toBe('desc')
    expect(b.baseElevation).toBe(3)
    expect(b.height).toBe(24)
    expect(b.floors).toHaveLength(1)
    const floor = b.floors[0]
    expect(floor.rooms.map((r) => r.id)).toEqual(['rm-101'])
    expect(floor.hallways.map((h) => h.id)).toEqual(['hw-main'])
    expect(floor.entrances.map((e) => e.id)).toEqual(['ent-1'])
    expect(floor.staircases.map((s) => s.id)).toEqual(['stair-a'])
    // nothing new writes parametricComponents
    expect(floor.parametricComponents).toEqual([])
    expect(b.staircases!.map((s) => s.id)).toEqual(['stair-a'])
  })

  it('is deterministic across reloads — same graph yields identical features', () => {
    const graph = makeGraph([
      {
        level: 0,
        staircases: [{ id: 'stair-x', name: 'X', position: { x: 1, y: 1 }, fromLevel: 0, toLevel: 1, type: 'open' }],
        elevators: [{ id: 'elev-x', name: 'X', position: { x: 2, y: 2 }, fromLevel: 0, toLevel: 2 }],
        parametricComponents: [
          { id: 'pc-x', definitionId: 'stair', position: { x: 3, y: 3 }, rotation: 0, properties: { stepCount: 4, stepWidth: 1.2, stepDepth: 0.3, direction: 'east', preset: 'straight' } },
        ],
      },
    ])
    const a = createDocument(graph)
    const b = createDocument(graph)
    expect(JSON.parse(JSON.stringify(a.buildings[0].staircases))).toEqual(JSON.parse(JSON.stringify(b.buildings[0].staircases)))
    expect(JSON.parse(JSON.stringify(a.buildings[0].elevators))).toEqual(JSON.parse(JSON.stringify(b.buildings[0].elevators)))
  })
})

describe('createDocument — P1-T4: world-stored entrances/QRs/panoramas → building-local', () => {
  // Centroid of the makeGraph footprint (33.42/-111.93 → 33.4201/-111.9299)
  const ORIGIN = { lat: 33.42005, lng: -111.92995 }

  function makeTransformer(): CoordinateTransformer {
    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'b1', origin: ORIGIN, rotation: 0 })
    return transformer
  }

  it('converts floor-record entrances from world LatLng to building-local LocalCoord (D9)', () => {
    const transformer = makeTransformer()
    const graph = makeGraph([
      { level: 0, entrances: [{ id: 'ent-1', name: 'Main Entrance', position: { lat: 33.42, lng: -111.93 }, type: 'main' }] },
    ])
    const doc = createDocument(graph, transformer)
    const entrance = doc.buildings[0].floors[0].entrances[0]
    expect(entrance.id).toBe('ent-1')
    expect(entrance.label).toBe('Main Entrance')
    expect(entrance.type).toBe('main')
    expect(entrance.level).toBe(0)
    expect(entrance.position).toEqual(transformer.worldToBuildingLocal({ lat: 33.42, lng: -111.93 }, 'b1'))
    expect(entrance.position).not.toHaveProperty('lat')
    expect(entrance.position).not.toHaveProperty('lng')
  })

  it('falls back to centroid-based equirect conversion when no transformer is given (R15.8)', () => {
    const graph = makeGraph([
      { level: 0, entrances: [{ id: 'ent-2', name: 'Side Entrance', position: { lat: 33.42, lng: -111.93 }, type: 'side' }] },
    ])
    const doc = createDocument(graph)
    const entrance = doc.buildings[0].floors[0].entrances[0]
    // equirect inverse about the footprint centroid (matches compiler math)
    const METER_PER_DEG = 111320
    const expectedX = (-111.93 - ORIGIN.lng) * METER_PER_DEG * Math.cos((ORIGIN.lat * Math.PI) / 180)
    const expectedY = (33.42 - ORIGIN.lat) * METER_PER_DEG
    expect(entrance.position.x).toBeCloseTo(expectedX, 6)
    expect(entrance.position.y).toBeCloseTo(expectedY, 6)
    expect(entrance.position).not.toHaveProperty('lat')
    // fields carried verbatim
    expect(entrance.label).toBe('Side Entrance')
    expect(entrance.type).toBe('side')
  })

  it('converts world-stored QR checkpoint nodes to building-local positions', () => {
    const transformer = makeTransformer()
    const graph = makeGraph([{ level: 0 }])
    graph.nodes = [
      { id: 'n-qr-1', type: 'qr_marker', hasQr: true, buildingId: 'b1', floor: 0, position: { lat: 33.4201, lng: -111.9299 }, metadata: { qrId: 'qr-1', qrCode: 'QR-1' } },
    ]
    const doc = createDocument(graph, transformer)
    expect(doc.qrCheckpoints).toHaveLength(1)
    const qr = doc.qrCheckpoints[0]
    expect(qr.id).toBe('qr-1')
    expect(qr.code).toBe('QR-1')
    expect(qr.buildingId).toBe('b1')
    expect(qr.floor).toBe(0)
    expect(qr.position).toEqual(transformer.worldToBuildingLocal({ lat: 33.4201, lng: -111.9299 }, 'b1'))
    expect(qr.position).not.toHaveProperty('lat')
  })

  it('converts world-stored panorama nodes to building-local positions', () => {
    const transformer = makeTransformer()
    const graph = makeGraph([{ level: 0 }])
    graph.nodes = [
      { id: 'n-pano-1', hasPanorama: true, buildingId: 'b1', floor: 0, position: { lat: 33.42, lng: -111.93 }, label: 'Panorama: Main Lobby', metadata: { panoramaId: 'pano-1' } },
    ]
    const doc = createDocument(graph, transformer)
    expect(doc.panoramas).toHaveLength(1)
    const pano = doc.panoramas[0]
    expect(pano.id).toBe('pano-1')
    expect(pano.label).toBe('Main Lobby')
    expect(pano.buildingId).toBe('b1')
    expect(pano.position).toEqual(transformer.worldToBuildingLocal({ lat: 33.42, lng: -111.93 }, 'b1'))
    expect(pano.position).not.toHaveProperty('lat')
  })

  it('re-serializes the migrated document building-local without data loss (R15.8)', () => {
    const transformer = makeTransformer()
    const graph = makeGraph([
      { level: 0, entrances: [{ id: 'ent-1', name: 'Main Entrance', position: { lat: 33.42, lng: -111.93 }, type: 'main' }] },
    ])
    graph.nodes = [
      { id: 'n-qr-1', type: 'qr_marker', hasQr: true, buildingId: 'b1', floor: 0, position: { lat: 33.4201, lng: -111.9299 }, metadata: { qrId: 'qr-1', qrCode: 'QR-1' } },
    ]
    const doc = createDocument(graph, transformer)
    const parsed = deserializeDocument(serializeDocument(doc))
    const entrance = parsed.buildings[0].floors[0].entrances[0]
    expect(entrance.position).toEqual(transformer.worldToBuildingLocal({ lat: 33.42, lng: -111.93 }, 'b1'))
    expect(entrance.position).not.toHaveProperty('lat')
    expect(entrance.label).toBe('Main Entrance')
    expect(parsed.qrCheckpoints[0].position).not.toHaveProperty('lat')
    expect(parsed.qrCheckpoints[0].code).toBe('QR-1')
    expect(parsed.qrCheckpoints).toHaveLength(1)
    expect(parsed.buildings[0].floors[0].entrances).toHaveLength(1)
  })
})

// ── P1-T5 (R2.2): POIs pass through the forward adapter verbatim ──

describe('createDocument — P1-T5 migration: Floor.pois pass-through', () => {
  it('carries pois verbatim (building-local positions preserved, metadata intact)', () => {
    const graph = makeGraph([
      {
        level: 0,
        pois: [
          { id: 'poi-vm-1', name: 'Vending Machine', category: 'vending_machine', position: { x: 3.5, y: 7.25 }, metadata: { vendor: 'acme' } },
        ],
      },
    ])
    const doc = createDocument(graph)
    const pois = doc.buildings[0].floors[0].pois
    expect(pois).toHaveLength(1)
    // R15.9: every field survives the adapter
    expect(pois![0]).toEqual({
      id: 'poi-vm-1', name: 'Vending Machine', category: 'vending_machine',
      position: { x: 3.5, y: 7.25 }, metadata: { vendor: 'acme' },
    })
    // building-local in → building-local out (no world conversion applied)
    expect(pois![0].position).not.toHaveProperty('lat')
  })

  it('keeps pois absent when the source floor has none (D12 additive-absent)', () => {
    const graph = makeGraph([{ level: 0 }])
    const doc = createDocument(graph)
    expect(doc.buildings[0].floors[0]).not.toHaveProperty('pois')
  })
})

// ── P1-T6 (R2.4/D7): nested RoomDoor data is extracted to Floor.doors ──

describe('createDocument — P1-T6 migration: nested RoomDoor hoisting', () => {
  it('hoists room.roomDoors to floor.doors verbatim and empties the nested arrays (no dual source, R15.2/R15.9)', () => {
    const door = {
      id: 'door-legacy-1',
      roomId: 'room-1',
      connectedToId: 'hall-1',
      connectedToType: 'hallway' as const,
      doorType: 'fire',
      position: { x: 5.5, y: 0.25 },
      width: 1.1,
      metadata: { label: 'Fire exit' },
    }
    const graph = makeGraph([
      {
        level: 0,
        rooms: [
          { id: 'room-1', name: 'Room One', number: '101' },
          { id: 'room-2', name: 'Room Two', number: '102' },
        ],
      },
    ])
    // Attach nested legacy doors to the raw rooms (raw records pass through
    // untyped in the adapter, so we graft them onto the first room).
    const rawFloor = (graph.buildings[0].floors as Array<Record<string, unknown>>)[0]
    const rawRooms = rawFloor.rooms as Array<Record<string, unknown>>
    rawRooms[0].roomDoors = [door]
    rawRooms[1].roomDoors = [
      { id: 'door-legacy-2', roomId: 'room-2', doorType: 'opening', position: { x: 0, y: 4 }, width: 1.4, metadata: {} },
    ]

    const doc = createDocument(graph)
    const floor = doc.buildings[0].floors[0]

    // Extracted: every nested door now lives at floor.doors with ALL fields intact
    expect(floor.doors).toHaveLength(2)
    expect(floor.doors![0]).toEqual(door)
    expect(floor.doors![1]).toEqual({
      id: 'door-legacy-2', roomId: 'room-2', doorType: 'opening',
      position: { x: 0, y: 4 }, width: 1.4, metadata: {},
    })
    // Moved, not copied: nested arrays are emptied (single geometry source)
    for (const room of floor.rooms) {
      expect(room.roomDoors).toHaveLength(0)
    }
  })

  it('keeps doors absent when the source has none anywhere (D12 additive-absent)', () => {
    const graph = makeGraph([
      { level: 0, rooms: [{ id: 'room-1' }] },
    ])
    const doc = createDocument(graph)
    expect(doc.buildings[0].floors[0]).not.toHaveProperty('doors')
  })

  it('passes new-shape floor.doors through verbatim; flat wins on id conflicts with nested leftovers', () => {
    const graph = makeGraph([
      {
        level: 0,
        doors: [
          { id: 'door-flat-1', roomId: 'room-1', doorType: 'sliding', position: { x: 2, y: 0 }, width: 1.6, metadata: {} },
        ],
        rooms: [{ id: 'room-1' }],
      },
    ])
    const rawFloor = (graph.buildings[0].floors as Array<Record<string, unknown>>)[0]
    ;(rawFloor.rooms as Array<Record<string, unknown>>)[0].roomDoors = [
      // Same id as the flat one → flat (new shape) must win; different id → kept
      { id: 'door-flat-1', roomId: 'room-1', doorType: 'standard', position: { x: 9, y: 9 }, width: 9, metadata: {} },
      { id: 'door-nested-2', roomId: 'room-1', doorType: 'double', position: { x: 3, y: 0 }, width: 1.8, metadata: {} },
    ]

    const doc = createDocument(graph)
    const doors = doc.buildings[0].floors[0].doors!
    expect(doors).toHaveLength(2)
    expect(doors.find(d => d.id === 'door-flat-1')!.doorType).toBe('sliding')
    expect(doors.find(d => d.id === 'door-flat-1')!.width).toBe(1.6)
    expect(doors.find(d => d.id === 'door-nested-2')).toBeDefined()
  })
})

describe('createDocument - P1-T7 migration: route network passthrough', () => {
  it('passes floor.routeNetwork through verbatim (D3/D12 — first-class persisted entity)', () => {
    const network = {
      nodes: [
        { id: 'route-node-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'route-node-b', type: 'poi', position: { x: 4, y: 2 }, floor: 0 },
        { id: 'route-node-c', type: 'portal', position: { x: 9, y: 2 }, floor: 0 },
      ],
      edges: [
        { id: 'route-edge-1', from: 'route-node-a', to: 'route-node-b', type: 'walk', distance: 4.47213595499958 },
        { id: 'route-edge-2', from: 'route-node-b', to: 'route-node-c', type: 'portal', distance: 5 },
      ],
    }
    const graph = makeGraph([{ level: 0, routeNetwork: network }])
    const doc = createDocument(graph)
    const floor = doc.buildings[0].floors[0] as unknown as Record<string, unknown>
    expect(floor.routeNetwork).toEqual(network)
  })

  it('keeps routeNetwork absent when the source has none (D12 additive-absent)', () => {
    const graph = makeGraph([{ level: 0, rooms: [{ id: 'room-1' }] }])
    const doc = createDocument(graph)
    const floor = doc.buildings[0].floors[0] as unknown as Record<string, unknown>
    expect(floor).not.toHaveProperty('routeNetwork')
  })
})

describe('createDocument - P1-T9 migration: levels-based stair/elevator features', () => {
  it('building-level staircases (levels-based) pass through verbatim (new-shape wins, R2.6)', () => {
    const feature = {
      id: 'stair-a', buildingId: 'b1', name: 'Stair A', type: 'open', accessible: true,
      fromLevel: 0, toLevel: 2,
      levels: {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        2: { position: { x: 12, y: 22 }, rotation: 90 },
      },
    }
    const graph = makeGraph(
      [{ level: 0, staircases: [] }, { level: 1, staircases: [] }, { level: 2, staircases: [] }],
      { staircases: [feature] },
    )
    const doc = createDocument(graph)
    expect(doc.buildings[0].staircases).toEqual([feature])
  })

  it('building-level elevators with levels pass through verbatim (absent floors absent)', () => {
    const feature = {
      id: 'elev-a', buildingId: 'b1', name: 'Elev A', type: 'passenger', accessible: true,
      fromLevel: 0, toLevel: 1,
      levels: {
        0: { position: { x: 30, y: 20 }, rotation: 0 },
        1: { position: { x: 30, y: 21 }, rotation: 0 },
      },
    }
    const graph = makeGraph(
      [{ level: 0, elevators: [] }, { level: 1, elevators: [] }],
      { elevators: [feature] },
    )
    const doc = createDocument(graph)
    expect(doc.buildings[0].elevators).toEqual([feature])
  })
})
