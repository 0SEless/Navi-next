/**
 * Wave 1A — Document Integrity
 *
 * Verifies that a CampusDocument can always be:
 *   Create → Serialize → Deserialize → Mutate → Re-serialize → Re-deserialize
 * with zero data loss.
 *
 * This test does NOT involve the compiler, runtime, or Supabase.
 * It tests the @navi/core serialization layer exclusively.
 */
import { describe, it, expect } from 'vitest'
import { serializeDocument, deserializeDocument, roundTrip } from '@navi/core'
import type {
  CampusDocument,
  Building,
  Floor,
  Room,
  Hallway,
  LegacyStaircase,
  LegacyElevator,
  Entrance,
  Road,
  Panorama,
  QRCheckpoint,
  BuildingCategory,
} from '@navi/core'

// ─── Helper: produce a rich, realistic campus document ───

function makeRichDocument(): CampusDocument {
  const doc = {
    schemaVersion: 1,
    version: 0,
    metadata: {
      name: 'ASU Ibajay — Document Integrity Test',
      description: 'A multi-building campus with full indoor/outdoor topology for integrity testing.',
      lastModified: '2026-07-09T12:00:00.000Z',
      editorVersion: '0.1.0',
    },

    // ── Buildings ──
    buildings: [
      {
        id: 'bldg-admin',
        name: 'Admin Building',
        code: 'ADM',
        category: 'administrative' as BuildingCategory,
        description: 'Administrative offices and faculty rooms.',
        footprint: {
          points: [
            { lat: 11.8193, lng: 122.0922 },
            { lat: 11.8193, lng: 122.0928 },
            { lat: 11.8197, lng: 122.0928 },
            { lat: 11.8197, lng: 122.0922 },
            { lat: 11.8193, lng: 122.0922 },
          ],
        },
        baseElevation: 5,
        height: 12,
        color: '#3B82F6',
        aliases: ['ADM', 'Admin'],
        metadata: { built: 2005, renovated: 2020 },

        floors: [
          // ── Floor 0: Ground Floor ──
          {
            id: 'flr-adm-0',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'rm-adm-101',
                name: 'Room 101 — Registrar',
                number: '101',
                category: 'office',
                polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
                entrancePosition: { x: 5, y: 0 },
                capacity: 4,
                metadata: { department: 'Registrar' },
              },
              {
                id: 'rm-adm-102',
                name: 'Room 102 — Cashier',
                number: '102',
                category: 'office',
                polygon: { points: [{ x: 12, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 12, y: 8 }, { x: 12, y: 0 }] },
                entrancePosition: { x: 16, y: 0 },
                capacity: 3,
                metadata: {},
              },
              {
                id: 'rm-adm-103',
                name: 'IT Office',
                number: '103',
                category: 'server',
                polygon: { points: [{ x: 0, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 16 }, { x: 0, y: 16 }, { x: 0, y: 10 }] },
                capacity: 2,
                metadata: { hasServerRack: true },
              },
            ],
            hallways: [
              {
                id: 'hlw-adm-g-main',
                name: 'Main Corridor',
                polyline: { points: [{ x: 5, y: 4 }, { x: 16, y: 4 }] },
                width: 3,
                color: '#E2E8F0',
              },
              {
                id: 'hlw-adm-g-wing',
                name: 'East Wing',
                polyline: { points: [{ x: 16, y: 4 }, { x: 16, y: 13 }] },
                width: 2.5,
              },
            ],
            staircases: [
              {
                id: 'stc-adm-g-main',
                name: 'Main Staircase',
                position: { x: 10, y: 4 },
                fromLevel: 0,
                toLevel: 1,
                type: 'open',
              },
              {
                id: 'stc-adm-g-fire',
                name: 'Fire Escape',
                position: { x: 22, y: 13 },
                fromLevel: 0,
                toLevel: 1,
                type: 'emergency',
              },
            ],
            elevators: [
              {
                id: 'elv-adm-g',
                name: 'Main Elevator',
                position: { x: 10, y: 8 },
                fromLevel: 0,
                toLevel: 2,
              },
            ],
            entrances: [
              {
                id: 'ent-adm-main',
                label: 'Main Entrance',
                position: { lat: 11.8195, lng: 122.0925 },
                level: 0,
                type: 'main',
                hasQR: true,
                hasPanorama: true,
              },
              {
                id: 'ent-adm-side',
                label: 'Side Entrance',
                position: { lat: 11.8193, lng: 122.0925 },
                level: 0,
                type: 'side',
                hasQR: false,
                hasPanorama: false,
              },
            ],
            metadata: { occupancy: '8am-5pm' },
          },

          // ── Floor 1: Second Floor ──
          {
            id: 'flr-adm-1',
            level: 1,
            label: 'Second Floor',
            elevation: 4,
            rooms: [
              {
                id: 'rm-adm-201',
                name: 'Room 201 — VP Office',
                number: '201',
                category: 'office',
                polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
                capacity: 2,
                metadata: {},
              },
              {
                id: 'rm-adm-202',
                name: 'Room 202 — Conference Room',
                number: '202',
                category: 'meeting',
                polygon: { points: [{ x: 12, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 0 }] },
                capacity: 20,
                metadata: { hasProjector: true },
              },
            ],
            hallways: [
              {
                id: 'hlw-adm-1-main',
                name: 'Second Floor Corridor',
                polyline: { points: [{ x: 5, y: 4 }, { x: 18, y: 4 }] },
                width: 3,
              },
            ],
            staircases: [
              {
                id: 'stc-adm-1-main',
                name: 'Main Staircase 2F',
                position: { x: 10, y: 4 },
                fromLevel: 0,
                toLevel: 1,
                type: 'open',
              },
            ],
            elevators: [
              {
                id: 'elv-adm-1',
                name: 'Main Elevator 2F',
                position: { x: 10, y: 8 },
                fromLevel: 0,
                toLevel: 2,
              },
            ],
            entrances: [],
            metadata: {},
          },
        ],
      },

      {
        id: 'bldg-library',
        name: 'Library',
        code: 'LIB',
        category: 'library' as BuildingCategory,
        description: 'University library and learning resource center.',
        footprint: {
          points: [
            { lat: 11.8198, lng: 122.0927 },
            { lat: 11.8198, lng: 122.0933 },
            { lat: 11.8202, lng: 122.0933 },
            { lat: 11.8202, lng: 122.0927 },
            { lat: 11.8198, lng: 122.0927 },
          ],
        },
        baseElevation: 5,
        height: 8,
        color: '#10B981',
        aliases: ['LIB'],
        metadata: {},

        floors: [
          {
            id: 'flr-lib-0',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'rm-lib-reading',
                name: 'Main Reading Area',
                number: 'R001',
                category: 'lobby',
                polygon: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: 0, y: 15 }, { x: 0, y: 0 }] },
                capacity: 80,
                metadata: { silent: true },
              },
              {
                id: 'rm-lib-stacks',
                name: 'Book Stacks',
                number: 'R002',
                category: 'other',
                polygon: { points: [{ x: 0, y: 15 }, { x: 20, y: 15 }, { x: 20, y: 22 }, { x: 0, y: 22 }, { x: 0, y: 15 }] },
                metadata: {},
              },
            ],
            hallways: [],
            staircases: [
              {
                id: 'stc-lib-g',
                name: 'Library Stairs',
                position: { x: 18, y: 12 },
                fromLevel: 0,
                toLevel: 1,
                type: 'enclosed',
              },
            ],
            elevators: [],
            entrances: [
              {
                id: 'ent-lib-main',
                label: 'Library Entrance',
                position: { lat: 11.8200, lng: 122.0930 },
                level: 0,
                type: 'main',
                hasQR: true,
                hasPanorama: true,
                connectorRoadId: 'road-lib-plaza',
              },
            ],
            metadata: {},
          },
        ],
      },

      {
        id: 'bldg-canteen',
        name: 'Canteen',
        code: 'CAN',
        category: 'dining' as BuildingCategory,
        description: 'University cafeteria.',
        footprint: {
          points: [
            { lat: 11.8201, lng: 122.0918 },
            { lat: 11.8201, lng: 122.0922 },
            { lat: 11.8203, lng: 122.0922 },
            { lat: 11.8203, lng: 122.0918 },
            { lat: 11.8201, lng: 122.0918 },
          ],
        },
        baseElevation: 5,
        height: 4,
        color: '#EF4444',
        aliases: ['Cafeteria', 'Food Court'],
        metadata: { hours: '7am-8pm' },

        floors: [
          {
            id: 'flr-can-0',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'rm-can-counter',
                name: 'Food Counter',
                number: 'C001',
                category: 'other',
                polygon: { points: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }, { x: 2, y: 2 }] },
                metadata: {},
              },
              {
                id: 'rm-can-seating',
                name: 'Seating Area',
                number: 'C002',
                category: 'other',
                polygon: { points: [{ x: 8, y: 2 }, { x: 16, y: 2 }, { x: 16, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 2 }] },
                capacity: 60,
                metadata: {},
              },
            ],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [
              {
                id: 'ent-can-main',
                label: 'Canteen Entrance',
                position: { lat: 11.8202, lng: 122.0920 },
                level: 0,
                type: 'main',
                hasQR: false,
                hasPanorama: false,
                connectorRoadId: 'road-canteen-plaza',
              },
            ],
            metadata: {},
          },
        ],
      },
    ],

    // ── Roads ──
    roads: [
      {
        id: 'road-main-gate-plaza',
        name: 'Main Gate to Plaza',
        polyline: { points: [{ lat: 11.8188, lng: 122.0918 }, { lat: 11.8195, lng: 122.0920 }, { lat: 11.8198, lng: 122.0920 }] },
        width: 6,
        surface: 'paved',
        type: 'arterial',
        metadata: { lit: true },
      },
      {
        id: 'road-plaza-admin',
        name: 'Plaza to Admin',
        polyline: { points: [{ lat: 11.8198, lng: 122.0920 }, { lat: 11.8195, lng: 122.0925 }] },
        width: 4,
        surface: 'brick',
        type: 'connector',
        metadata: {},
      },
      {
        id: 'road-plaza-lib',
        name: 'Plaza to Library',
        polyline: { points: [{ lat: 11.8198, lng: 122.0920 }, { lat: 11.8200, lng: 122.0930 }] },
        width: 4,
        surface: 'paved',
        type: 'connector',
        metadata: {},
      },
      {
        id: 'road-lib-plaza',
        name: 'Library Connector',
        polyline: { points: [{ lat: 11.8200, lng: 122.0930 }, { lat: 11.8198, lng: 122.0920 }] },
        width: 4,
        surface: 'paved',
        type: 'connector',
        metadata: {},
      },
      {
        id: 'road-canteen-plaza',
        name: 'Canteen Connector',
        polyline: { points: [{ lat: 11.8202, lng: 122.0920 }, { lat: 11.8198, lng: 122.0920 }] },
        width: 3,
        surface: 'concrete',
        type: 'connector',
        metadata: {},
      },
      {
        id: 'road-parking-academic',
        name: 'Parking Access',
        polyline: { points: [{ lat: 11.8195, lng: 122.0910 }, { lat: 11.8193, lng: 122.0915 }, { lat: 11.8190, lng: 122.0915 }] },
        width: 5,
        surface: 'paved',
        type: 'service',
        metadata: {},
      },
    ],

    // ── Panoramas ──
    panoramas: [
      {
        id: 'pano-admin-entrance',
        label: 'Admin Building Entrance',
        position: { lat: 11.8195, lng: 122.0925 },
        heading: 180,
        imageAssetId: 'pano_adm_entrance_001',
        buildingId: 'bldg-admin',
        floor: 0,
        hotspots: [
          {
            target: { type: 'room', targetId: 'rm-adm-101' },
            position: { pitch: -10, yaw: 45 },
            label: 'Registrar Office',
          },
          {
            target: { type: 'room', targetId: 'rm-adm-102' },
            position: { pitch: -5, yaw: 120 },
            label: 'Cashier',
          },
        ],
      },
      {
        id: 'pano-lib-entrance',
        label: 'Library Entrance',
        position: { lat: 11.8200, lng: 122.0930 },
        heading: 270,
        imageAssetId: 'pano_lib_entrance_001',
        buildingId: 'bldg-library',
        floor: 0,
        hotspots: [
          {
            target: { type: 'panorama', targetId: 'pano-admin-entrance' },
            position: { pitch: 0, yaw: 180 },
            label: 'View Admin Building',
          },
        ],
      },
    ],

    // ── QR Checkpoints ──
    qrCheckpoints: [
      {
        id: 'qr-admin-entrance',
        label: 'Admin Entrance QR',
        position: { lat: 11.8195, lng: 122.0925 },
        floor: 0,
        buildingId: 'bldg-admin',
        code: 'navi://asu-ibajay/bldg-admin/entrance',
        metadata: { type: 'entrance' },
      },
      {
        id: 'qr-lib-entrance',
        label: 'Library Entrance QR',
        position: { lat: 11.8200, lng: 122.0930 },
        floor: 0,
        buildingId: 'bldg-library',
        code: 'navi://asu-ibajay/bldg-library/entrance',
        metadata: { type: 'entrance' },
      },
      {
        id: 'qr-plaza',
        label: 'Campus Plaza QR',
        position: { lat: 11.8198, lng: 122.0920 },
        floor: 0,
        buildingId: 'bldg-admin',
        code: 'navi://asu-ibajay/plaza',
        metadata: { type: 'waypoint' },
      },
    ],
  }

  const typedDoc = doc as unknown as CampusDocument
  for (const bld of typedDoc.buildings) {
    const bldRecord = bld as unknown as Record<string, unknown>
    bldRecord.verticalConnectors = []
    for (const flr of bld.floors) {
      const flrRecord = flr as unknown as Record<string, unknown>
      flrRecord.connectorStops = []
      for (const rm of flr.rooms) {
        const rmRecord = rm as unknown as Record<string, unknown>
        rmRecord.roomDoors = []
      }
    }
  }

  return typedDoc
}

// ─── Deep structural equality helpers ───

function deepEqual<T>(a: T, b: T, path: string = ''): string | null {
  if (a === b) return null
  if (a == null || b == null) return `Mismatch at ${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  if (typeof a !== typeof b) return `Type mismatch at ${path}: ${typeof a} vs ${typeof b}`

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `Array length mismatch at ${path}: ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const err = deepEqual(a[i], b[i], `${path}[${i}]`)
      if (err) return err
    }
    return null
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as Record<string, unknown>)
    const keysB = Object.keys(b as Record<string, unknown>)

    // Check for extra/missing keys
    for (const k of keysA) {
      if (!(k in (b as Record<string, unknown>))) {
        return `Missing key in B at ${path}.${k}`
      }
    }
    for (const k of keysB) {
      if (!(k in (a as Record<string, unknown>))) {
        return `Missing key in A at ${path}.${k}`
      }
    }

    for (const k of keysA) {
      const err = deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      )
      if (err) return err
    }
    return null
  }

  if (a !== b) return `Value mismatch at ${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  return null
}

// ─── Tests ───

describe('Wave 1A — Document Integrity', () => {
  // ── 1. Rich document round-trip ──

  it('rich document round-trips successfully', () => {
    const doc = makeRichDocument()
    const result = roundTrip(doc)
    expect(result.success).toBe(true)
  })

  it('rich document survives serialize → deserialize with structural equality', () => {
    const doc = makeRichDocument()

    // Pass 1: legacy floor records are minted into building-level feature
    // entities (T0.2). Pass 2: dual-write regenerates the floor arrays from
    // features. Pass 3: the document is stable (structural fixed point).
    const first = deserializeDocument(serializeDocument(doc))
    const second = deserializeDocument(serializeDocument(first))
    const third = deserializeDocument(serializeDocument(second))

    expect(deepEqual(second, third)).toBeNull()

    // Minted feature entities: Admin has 3 staircases + 2 elevators across
    // its two stair floors; Library has 1 staircase; Canteen (empty arrays)
    // gets none.
    const admin = first.buildings[0]
    expect(admin.staircases).toHaveLength(3)
    expect(admin.elevators).toHaveLength(2)
    expect(first.buildings[1].staircases).toHaveLength(1)
    expect(first.buildings[2].staircases).toBeUndefined()

    // Legacy ids preserved; fromLevel === toLevel === owning floor level
    const minted = admin.staircases!.find((s) => s.id === 'stc-adm-g-main')!
    expect(minted).toBeDefined()
    expect(minted.fromLevel).toBe(0)
    expect(minted.toLevel).toBe(0)
    expect(minted.levels['0'].position).toEqual({ x: 10, y: 4 })
    const elevator = admin.elevators!.find((e) => e.id === 'elv-adm-1')!
    expect(elevator.fromLevel).toBe(1)
    expect(elevator.toLevel).toBe(1)
    expect(elevator.type).toBe('passenger')

    // Dual-write: floor arrays are regenerated with derived <featureId>-<level>
    // ids and the feature's (single-level) range; serialization emits v2.
    const floorStairs = second.buildings[0].floors[0].staircases
    expect(floorStairs.map((s) => s.id)).toEqual(['stc-adm-g-main-0', 'stc-adm-g-fire-0'])
    expect(floorStairs[0].fromLevel).toBe(0)
    expect(floorStairs[0].toLevel).toBe(0)
    expect(second.schemaVersion).toBe(2)
  })

  it('produces identical JSON after the canonicalization pass', () => {
    const doc = makeRichDocument()
    const first = serializeDocument(doc)
    const restored = deserializeDocument(first)
    const second = serializeDocument(restored)

    // First pass canonicalizes the legacy doc (mint + v2 + derived floor
    // arrays); the second pass must be byte-identical (fixed point).
    const again = deserializeDocument(second)
    const third = serializeDocument(again)

    expect(second).toBe(third)
  })

  it('counts all entities through round-trip', () => {
    const doc = makeRichDocument()
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    // Buildings: Admin(3 floors) + Library(1 floor) + Canteen(1 floor)
    expect(restored.buildings).toHaveLength(3)

    const totalFloors = restored.buildings.reduce((sum, b) => sum + b.floors.length, 0)
    expect(totalFloors).toBe(4)

    // Rooms: Admin G(3) + Admin 1F(2) + Lib G(2) + Canteen(2) = 9
    const totalRooms = restored.buildings.reduce(
      (sum, b) => sum + b.floors.reduce((s, f) => s + f.rooms.length, 0),
      0,
    )
    expect(totalRooms).toBe(9)

    // Hallways: Admin G(2) + Admin 1F(1) = 3
    const totalHallways = restored.buildings.reduce(
      (sum, b) => sum + b.floors.reduce((s, f) => s + f.hallways.length, 0),
      0,
    )
    expect(totalHallways).toBe(3)

    // Staircases: Admin G(2) + Admin 1F(1) + Lib(1) = 4
    const totalStairs = restored.buildings.reduce(
      (sum, b) => sum + b.floors.reduce((s, f) => s + f.staircases.length, 0),
      0,
    )
    expect(totalStairs).toBe(4)

    // Elevators: Admin G(1) + Admin 1F(1) = 2
    const totalElevators = restored.buildings.reduce(
      (sum, b) => sum + b.floors.reduce((s, f) => s + f.elevators.length, 0),
      0,
    )
    expect(totalElevators).toBe(2)

    // Entrances: Admin G(2) + Lib G(1) + Canteen(1) = 4
    const totalEntrances = restored.buildings.reduce(
      (sum, b) => sum + b.floors.reduce((s, f) => s + f.entrances.length, 0),
      0,
    )
    expect(totalEntrances).toBe(4)

    // Top-level
    expect(restored.roads).toHaveLength(6)
    expect(restored.panoramas).toHaveLength(2)
    expect(restored.qrCheckpoints).toHaveLength(3)
  })

  // ── 2. Edge cases ──

  it('empty document round-trips', () => {
    const doc: CampusDocument = {
      schemaVersion: 1,
      version: 0,
      metadata: { campusId: 'Empty', name: 'Empty', description: '', lastModified: new Date().toISOString(), editorVersion: '0.1.0' },
      buildings: [],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    }
    const result = roundTrip(doc)
    expect(result.success).toBe(true)
    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings).toEqual([])
    expect(restored.roads).toEqual([])
    expect(restored.panoramas).toEqual([])
    expect(restored.qrCheckpoints).toEqual([])
  })

  it('handles special characters in names', () => {
    const doc = makeRichDocument()
    doc.buildings[0].name = 'Ünivérsity — Câfétéria (Floor 1/2) & More!'
    doc.buildings[0].floors[0].rooms[0].name = 'Room #101 — "Main Office" <Test>'
    const result = roundTrip(doc)
    expect(result.success).toBe(true)
    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].name).toBe(doc.buildings[0].name)
    expect(restored.buildings[0].floors[0].rooms[0].name).toBe(doc.buildings[0].floors[0].rooms[0].name)
  })

  it('preserves metadata fields (arbitrary JSON)', () => {
    const doc = makeRichDocument()
    doc.buildings[0].metadata = {
      string: 'hello',
      number: 42,
      boolean: true,
      null: null,
      nested: { a: [1, 2, 3], b: { c: 'deep' } },
    }
    const result = roundTrip(doc)
    expect(result.success).toBe(true)
    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].metadata).toEqual(doc.buildings[0].metadata)
  })

  it('preserves optional connectorRoadId on entrances', () => {
    const doc = makeRichDocument()
    // ent-lib-main has connectorRoadId = 'road-lib-plaza'
    const entrance = doc.buildings[1].floors[0].entrances[0]
    expect(entrance.connectorRoadId).toBe('road-lib-plaza')

    const restored = deserializeDocument(serializeDocument(doc))
    const restoredEntrance = restored.buildings[1].floors[0].entrances[0]
    expect(restoredEntrance.connectorRoadId).toBe('road-lib-plaza')
  })

  it('skipped optional fields remain absent', () => {
    // Some entrances have no connectorRoadId
    const doc = makeRichDocument()
    const entrance = doc.buildings[0].floors[0].entrances[1] // side entrance
    expect(entrance.connectorRoadId).toBeUndefined()

    const restored = deserializeDocument(serializeDocument(doc))
    const restoredEntrance = restored.buildings[0].floors[0].entrances[1]
    expect(restoredEntrance.connectorRoadId).toBeUndefined()
  })

  it('preserves panorama hotspots through round-trip', () => {
    const doc = makeRichDocument()
    const hotspots = doc.panoramas[0].hotspots
    expect(hotspots).toHaveLength(2)

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.panoramas[0].hotspots).toHaveLength(2)
    expect(restored.panoramas[0].hotspots[0].target.type).toBe('room')
    expect(restored.panoramas[0].hotspots[0].target.targetId).toBe('rm-adm-101')
    expect(restored.panoramas[0].hotspots[0].position.pitch).toBe(-10)
    expect(restored.panoramas[0].hotspots[0].position.yaw).toBe(45)
  })

  it('validates document structure on deserialize', () => {
    expect(() => deserializeDocument('null')).toThrow()
    expect(() => deserializeDocument('{}')).toThrow('version')
    expect(() => deserializeDocument('{"schemaVersion":1,"version":0,"metadata":{},"buildings":null,"roads":[],"panoramas":[],"qrCheckpoints":[]}')).toThrow('buildings')
    expect(() => deserializeDocument('garbage')).toThrow()
  })

  it('treats unversioned legacy documents as schemaVersion 1 (T0.2)', () => {
    const unversioned =
      '{"version":0,"metadata":{"name":"x","description":"","lastModified":"","editorVersion":""},"buildings":[],"roads":[],"panoramas":[],"qrCheckpoints":[]}'
    const doc = deserializeDocument(unversioned)
    expect(doc.schemaVersion).toBe(1)
  })

  // ── 3. Mutation tests ──

  it('rename a building survives round-trip', () => {
    const doc = makeRichDocument()
    const original = serializeDocument(doc)

    doc.buildings[0].name = 'Renamed Admin Building'
    doc.metadata.lastModified = new Date().toISOString()
    const mutated = serializeDocument(doc)

    // Mutated JSON differs from original
    expect(mutated).not.toBe(original)

    // Round-trip preserves the rename
    const restored = deserializeDocument(mutated)
    expect(restored.buildings[0].name).toBe('Renamed Admin Building')
    expect(restored.buildings[0].id).toBe('bldg-admin') // ID unchanged
  })

  it('add a room survives round-trip', () => {
    const doc = makeRichDocument()
    const newRoom: Room = {
      id: 'rm-adm-104',
      name: 'Room 104 — New Office',
      number: '104',
      category: 'office',
      polygon: { points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }, { x: 0, y: 0 }] },
      capacity: 2,
      roomDoors: [],
      metadata: {},
    }
    doc.buildings[0].floors[0].rooms.push(newRoom)
    expect(doc.buildings[0].floors[0].rooms).toHaveLength(4)

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].floors[0].rooms).toHaveLength(4)
    expect(restored.buildings[0].floors[0].rooms[3].id).toBe('rm-adm-104')
    expect(restored.buildings[0].floors[0].rooms[3].name).toBe('Room 104 — New Office')
  })

  it('add a floor survives round-trip', () => {
    const doc = makeRichDocument()
    const newFloor: Floor = {
      id: 'flr-adm-2',
      level: 2,
      label: 'Third Floor',
      elevation: 8,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      entrances: [],
      connectorStops: [],
      metadata: {},
    }
    doc.buildings[0].floors.push(newFloor)
    expect(doc.buildings[0].floors).toHaveLength(3)

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].floors).toHaveLength(3)
    expect(restored.buildings[0].floors[2].level).toBe(2)
    expect(restored.buildings[0].floors[2].label).toBe('Third Floor')
  })

  it('delete a room survives round-trip', () => {
    const doc = makeRichDocument()
    const originalCount = doc.buildings[0].floors[0].rooms.length
    doc.buildings[0].floors[0].rooms.splice(0, 1) // Remove first room

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].floors[0].rooms).toHaveLength(originalCount - 1)
    expect(restored.buildings[0].floors[0].rooms.find(r => r.id === 'rm-adm-101')).toBeUndefined()
  })

  it('delete entire building survives round-trip', () => {
    const doc = makeRichDocument()
    expect(doc.buildings).toHaveLength(3)
    doc.buildings.splice(1, 1) // Remove Library

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings).toHaveLength(2)
    expect(restored.buildings.find(b => b.id === 'bldg-library')).toBeUndefined()
    expect(restored.buildings.find(b => b.id === 'bldg-admin')).toBeDefined()
    expect(restored.buildings.find(b => b.id === 'bldg-canteen')).toBeDefined()
  })

  it('duplicate a floor (with new ID) survives round-trip', () => {
    const doc = makeRichDocument()
    const sourceFloor = doc.buildings[0].floors[0]
    const duplicatedFloor: Floor = {
      ...sourceFloor,
      id: 'flr-adm-0-dupe',
      rooms: sourceFloor.rooms.map(r => ({
        ...r,
        id: `rm-${r.id}-dupe`,
        name: `${r.name} (Copy)`,
      })),
      hallways: sourceFloor.hallways.map(h => ({ ...h, id: `hlw-${h.id}-dupe` })),
      staircases: sourceFloor.staircases.map(s => ({ ...s, id: `stc-${s.id}-dupe` })),
      elevators: sourceFloor.elevators.map(e => ({ ...e, id: `elv-${e.id}-dupe` })),
      entrances: sourceFloor.entrances.map(e => ({ ...e, id: `ent-${e.id}-dupe` })),
      metadata: {},
    }
    doc.buildings[0].floors.push(duplicatedFloor)

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    expect(restored.buildings[0].floors).toHaveLength(3)
    const dupe = restored.buildings[0].floors.find(f => f.id === 'flr-adm-0-dupe')
    expect(dupe).toBeDefined()
    expect(dupe!.rooms).toHaveLength(sourceFloor.rooms.length)
    expect(dupe!.rooms[0].id).toBe('rm-rm-adm-101-dupe')
    expect(dupe!.rooms[0].polygon.points).toEqual(sourceFloor.rooms[0].polygon.points)
  })

  it('delete all buildings (except one) and verify ID of remaining', () => {
    const doc = makeRichDocument()
    // Keep only the first building
    doc.buildings.splice(1, 2)
    expect(doc.buildings).toHaveLength(1)

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings).toHaveLength(1)
    expect(restored.buildings[0].id).toBe('bldg-admin')
    expect(restored.buildings[0].floors[0].rooms[0].id).toBe('rm-adm-101')
  })

  it('change building color and verify it persists', () => {
    const doc = makeRichDocument()
    doc.buildings[0].color = '#FF0000'

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].color).toBe('#FF0000')
  })

  it('change elevation of a floor and verify', () => {
    const doc = makeRichDocument()
    doc.buildings[0].floors[0].elevation = 2.5

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].floors[0].elevation).toBe(2.5)
  })

  it('panorama hotspots target references survive round-trip', () => {
    const doc = makeRichDocument()
    // Add a hotspot that references a room
    doc.panoramas[0].hotspots.push({
      target: { type: 'url', targetId: 'https://example.com/campus-map' },
      position: { pitch: 20, yaw: 90 },
      label: 'Online Map',
    })

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.panoramas[0].hotspots).toHaveLength(3)
    const urlHotspot = restored.panoramas[0].hotspots[2]
    expect(urlHotspot.target.type).toBe('url')
    expect(urlHotspot.target.targetId).toBe('https://example.com/campus-map')
  })

  // ── 4. Schema version compatibility ──
  //
  // FINDING: The current deserializer only checks that schemaVersion is a number.
  // It does NOT validate that the version matches what the editor supports.
  // This means schema v2, v-1, v999 all pass deserialization silently.
  // A version compatibility check (major version match) would be a future improvement.

  it('accepts any numeric schema version (no range check — documented gap)', () => {
    // schemaVersion: 2 passes — the validator only checks typeof === 'number'
    const doc = deserializeDocument(
      '{"schemaVersion":2,"version":0,"metadata":{"name":"x","description":"","lastModified":"","editorVersion":""},"buildings":[],"roads":[],"panoramas":[],"qrCheckpoints":[]}'
    )
    expect(doc.schemaVersion).toBe(2)
  })

  it('schema version -1 passes deserialization (validated as number only)', () => {
    const doc = deserializeDocument(
      '{"schemaVersion":-1,"version":0,"metadata":{"name":"x","description":"","lastModified":"","editorVersion":""},"buildings":[],"roads":[],"panoramas":[],"qrCheckpoints":[]}'
    )
    expect(doc.schemaVersion).toBe(-1)
  })

  // ── 5. Coordinate type integrity ──

  it('LatLng coordinates survive round-trip with correct keys', () => {
    const doc = makeRichDocument()
    const restored = deserializeDocument(serializeDocument(doc))

    // Building footprint uses LatLng
    const point = restored.buildings[0].footprint.points[0]
    expect(point).toHaveProperty('lat')
    expect(point).toHaveProperty('lng')
    expect(point).not.toHaveProperty('x')
  })

  it('LocalCoord coordinates survive round-trip with correct keys', () => {
    const doc = makeRichDocument()
    const restored = deserializeDocument(serializeDocument(doc))

    // Room polygon uses LocalCoord
    const point = restored.buildings[0].floors[0].rooms[0].polygon.points[0]
    expect(point).toHaveProperty('x')
    expect(point).toHaveProperty('y')
    expect(point).not.toHaveProperty('lat')
  })
})
