import { describe, it, expect } from 'vitest'
import { serializeDocument, deserializeDocument, roundTrip, SCHEMA_VERSION } from './serializer'
import type { CampusDocument, Staircase, Elevator, BuildingCategory } from '../types'

function makeBaseDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'ASU Ibajay',
      name: 'ASU Ibajay',
      description: 'Test campus',
      lastModified: new Date('2026-07-08').toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: [
      {
        id: 'bld-1',
        name: 'Main Building',
        code: 'MAIN',
        category: 'academic' as BuildingCategory,
        description: 'Main academic building',
        footprint: {
          points: [
            { lat: 33.42, lng: -111.93 },
            { lat: 33.43, lng: -111.93 },
            { lat: 33.43, lng: -111.92 },
            { lat: 33.42, lng: -111.92 },
            { lat: 33.42, lng: -111.93 },
          ],
        },
        baseElevation: 0,
        height: 15,
        floors: [
          {
            id: 'flr-0',
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
          },
          {
            id: 'flr-1',
            level: 1,
            label: 'First Floor',
            elevation: 3.5,
            height: 3.5,
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
        verticalConnectors: [],
        color: '#336699',
        aliases: [],
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeStaircase(): Staircase {
  return {
    id: 'stair-main',
    buildingId: 'bld-1',
    name: 'Stairwell A',
    type: 'enclosed',
    accessible: true,
    fromLevel: 0,
    toLevel: 2,
    levels: {
      0: {
        position: { x: 2.5, y: 1.5 },
        rotation: 0,
        polygon: {
          points: [
            { x: 2, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 2 },
            { x: 2, y: 2 },
            { x: 2, y: 1 },
          ],
        },
        drawing: {
          definitionId: 'stair',
          properties: {
            stepCount: 12,
            stepWidth: 1.2,
            stepDepth: 0.28,
            direction: 'up-north',
            preset: 'straight',
          },
        },
      },
      1: {
        position: { x: 3.5, y: 2.5 },
        rotation: 90,
        landing: {
          position: { x: 4, y: 3 },
          rotation: 180,
          polygon: {
            points: [
              { x: 3.5, y: 2.5 },
              { x: 4.5, y: 2.5 },
              { x: 4.5, y: 3.5 },
              { x: 3.5, y: 3.5 },
              { x: 3.5, y: 2.5 },
            ],
          },
        },
      },
      2: {
        position: { x: 4.5, y: 3.5 },
        rotation: 45,
        polygon: {
          points: [
            { x: 4, y: 3 },
            { x: 5, y: 3 },
            { x: 5, y: 4 },
            { x: 4, y: 4 },
            { x: 4, y: 3 },
          ],
        },
      },
    },
  }
}

function makeElevator(): Elevator {
  return {
    id: 'elev-main',
    buildingId: 'bld-1',
    name: 'Main Elevator',
    type: 'passenger',
    accessible: true,
    fromLevel: -1,
    toLevel: 2,
    levels: {
      [-1]: {
        position: { x: 10, y: 10 },
        rotation: 0,
        polygon: {
          points: [
            { x: 9.5, y: 9.5 },
            { x: 12, y: 9.5 },
            { x: 12, y: 11.5 },
            { x: 9.5, y: 11.5 },
            { x: 9.5, y: 9.5 },
          ],
        },
        drawing: {
          definitionId: 'elevator',
          properties: { width: 2.4, depth: 2.0, doorSide: 'east' },
        },
      },
      1: {
        position: { x: 11, y: 10 },
        rotation: 0,
      },
    },
  }
}

function makeFeatureDoc(): CampusDocument {
  const doc = makeBaseDoc()
  doc.schemaVersion = SCHEMA_VERSION
  doc.buildings[0].staircases = [makeStaircase()]
  doc.buildings[0].elevators = [makeElevator()]
  return doc
}

describe('serialization â€” Staircase/Elevator feature entities', () => {
  it('round-trips a 3-level staircase + elevator with every field intact', () => {
    const doc = makeFeatureDoc()
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    const srcStair = doc.buildings[0].staircases![0]
    const srcElev = doc.buildings[0].elevators![0]
    const stair = restored.buildings[0].staircases![0]
    const elev = restored.buildings[0].elevators![0]

    expect(stair).toEqual(srcStair)
    expect(elev).toEqual(srcElev)

    expect(stair.levels[0].drawing).toEqual(srcStair.levels[0].drawing)
    expect(stair.levels[1].landing).toEqual(srcStair.levels[1].landing)
    expect(stair.levels[1].landing!.polygon!.points).toHaveLength(5)
    expect(stair.levels[2].polygon).toEqual(srcStair.levels[2].polygon)
    expect(elev.levels[-1].drawing!.properties).toEqual({ width: 2.4, depth: 2.0, doorSide: 'east' })
  })

  it('mints single-level features from legacy per-floor arrays, ids preserved', () => {
    const doc = makeBaseDoc()
    const floor0 = doc.buildings[0].floors[0]
    const floor1 = doc.buildings[0].floors[1]
    floor0.staircases = [
      { id: 'stair-main-g-a', name: 'Stair A', position: { x: 1, y: 1 }, fromLevel: 0, toLevel: 1, type: 'enclosed' },
    ]
    floor1.staircases = [
      { id: 'stair-main-1-a', name: 'Stair A', position: { x: 1, y: 1 }, fromLevel: 0, toLevel: 1, type: 'open' },
    ]
    floor0.elevators = [
      { id: 'elev-main-g', name: 'Elev A', position: { x: 5, y: 5 }, fromLevel: 0, toLevel: 1 },
    ]
    floor1.elevators = [
      { id: 'elev-main-1', name: 'Elev A', position: { x: 5, y: 5 }, fromLevel: 0, toLevel: 1 },
    ]

    const restored = deserializeDocument(serializeDocument(doc))
    const bld = restored.buildings[0]

    expect(bld.staircases).toHaveLength(2)
    expect(bld.staircases![0]).toEqual({
      id: 'stair-main-g-a',
      buildingId: 'bld-1',
      name: 'Stair A',
      type: 'enclosed',
      accessible: false,
      fromLevel: 0,
      toLevel: 0,
      levels: { 0: { position: { x: 1, y: 1 }, rotation: 0 } },
    })
    expect(bld.staircases![1].id).toBe('stair-main-1-a')
    expect(bld.staircases![1].fromLevel).toBe(1)
    expect(bld.staircases![1].toLevel).toBe(1)
    expect(bld.staircases![1].type).toBe('open')

    expect(bld.elevators).toHaveLength(2)
    expect(bld.elevators![0]).toEqual({
      id: 'elev-main-g',
      buildingId: 'bld-1',
      name: 'Elev A',
      type: 'passenger',
      accessible: false,
      fromLevel: 0,
      toLevel: 0,
      levels: { 0: { position: { x: 5, y: 5 }, rotation: 0 } },
    })
    expect(bld.elevators![1].fromLevel).toBe(1)

    // Legacy floor arrays stay verbatim on read
    expect(restored.buildings[0].floors[0].staircases[0].id).toBe('stair-main-g-a')
    expect(restored.buildings[0].floors[1].elevators[0].id).toBe('elev-main-1')
  })

  it('feature arrays win when both shapes are present (legacy ignored)', () => {
    const doc = makeFeatureDoc()
    const floor0 = doc.buildings[0].floors[0]
    floor0.staircases = [
      { id: 'legacy-1', name: 'Legacy', position: { x: 9, y: 9 }, fromLevel: 0, toLevel: 0, type: 'emergency' },
    ]
    floor0.elevators = [
      { id: 'legacy-e1', name: 'Legacy Elev', position: { x: 8, y: 8 }, fromLevel: 0, toLevel: 0 },
    ]

    const restored = deserializeDocument(serializeDocument(doc))
    const bld = restored.buildings[0]

    // Features taken verbatim â€” no minted 'legacy-1' feature
    expect(bld.staircases).toHaveLength(1)
    expect(bld.staircases![0].id).toBe('stair-main')
    expect(bld.staircases![0].levels[2]).toBeDefined()
    expect(bld.elevators).toHaveLength(1)
    expect(bld.elevators![0].id).toBe('elev-main')

    // Features win: serialize regenerates the floor arrays from features
    // (authored legacy records are replaced by derived <featureId>-<level> ids)
    expect(bld.floors[0].staircases).toHaveLength(1)
    expect(bld.floors[0].staircases[0].id).toBe('stair-main-0')
    expect(bld.floors[0].staircases[0].id).not.toBe('legacy-1')
    expect(bld.floors[0].elevators).toEqual([])
  })

  it('derived legacy arrays are emitted with <featureId>-<level> ids and round-trip is stable', () => {
    const doc = makeFeatureDoc()
    const json = serializeDocument(doc)
    const parsed = JSON.parse(json) as CampusDocument

    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    const floor0 = parsed.buildings[0].floors[0]
    const floor1 = parsed.buildings[0].floors[1]

    expect(floor0.staircases).toEqual([
      {
        id: 'stair-main-0',
        name: 'Stairwell A',
        position: { x: 2.5, y: 1.5 },
        fromLevel: 0,
        toLevel: 2,
        type: 'enclosed',
      },
    ])
    expect(floor1.staircases).toEqual([
      {
        id: 'stair-main-1',
        name: 'Stairwell A',
        position: { x: 3.5, y: 2.5 },
        fromLevel: 0,
        toLevel: 2,
        type: 'enclosed',
      },
    ])
    // Elevator level -1 has no floor in this doc â†’ floor 0 derived array is empty;
    // elevator level 1 lands on floor 1, and legacy elevator records carry no type
    expect(floor0.elevators).toEqual([])
    expect(floor1.elevators).toEqual([
      {
        id: 'elev-main-1',
        name: 'Main Elevator',
        position: { x: 11, y: 10 },
        fromLevel: -1,
        toLevel: 2,
      },
    ])
    expect(floor1.elevators[0]).not.toHaveProperty('type')

    // Round-trip stability for feature docs: serialize(deserialize(x)) === x
    const restored = deserializeDocument(json)
    expect(serializeDocument(restored)).toBe(json)
    expect(restored.buildings[0].staircases).toEqual(doc.buildings[0].staircases)
    expect(restored.buildings[0].elevators).toEqual(doc.buildings[0].elevators)
  })

  it('rejects invalid feature shapes', () => {
    const missingLevels = makeFeatureDoc()
    delete (missingLevels.buildings[0].staircases![0] as Partial<Staircase>).levels
    expect(() => deserializeDocument(serializeDocument(missingLevels))).toThrow(/levels/)

    const badRange = makeFeatureDoc()
    badRange.buildings[0].staircases![0].fromLevel = 3
    badRange.buildings[0].staircases![0].toLevel = 1
    expect(() => deserializeDocument(serializeDocument(badRange))).toThrow(/fromLevel/)

    const badKeys = makeFeatureDoc()
    badKeys.buildings[0].elevators![0].levels = {
      '1': { position: { x: 11, y: 10 }, rotation: 0 },
      'one': { position: { x: 12, y: 10 }, rotation: 0 },
    } as unknown as Elevator['levels']
    expect(() => deserializeDocument(serializeDocument(badKeys))).toThrow(/non-numeric/)

    const emptyLevels = makeFeatureDoc()
    emptyLevels.buildings[0].staircases![0].levels = {} as Staircase['levels']
    expect(() => deserializeDocument(serializeDocument(emptyLevels))).toThrow(/levels/)
  })

  it('backward compat: legacy-only and unversioned docs read as before; no dual-write without features', () => {
    const doc = makeBaseDoc()
    doc.buildings[0].floors[0].staircases = [
      { id: 'st-north', name: 'North Stairs', position: { x: 2, y: 2 }, fromLevel: 0, toLevel: 2, type: 'enclosed' },
    ]
    doc.buildings[0].floors[0].elevators = [
      { id: 'el-main', name: 'Main Elevator', position: { x: 8, y: 2 }, fromLevel: -1, toLevel: 3 },
    ]

    const json = serializeDocument(doc)
    // No features â†’ no schemaVersion bump, no dual-write, no building feature arrays
    expect(JSON.parse(json).schemaVersion).toBe(1)
    expect(JSON.parse(json).buildings[0]).not.toHaveProperty('staircases')
    expect(JSON.parse(json).buildings[0].floors[0].staircases[0].id).toBe('st-north')

    const restored = deserializeDocument(json)
    expect(restored.schemaVersion).toBe(1)
    expect(restored.buildings[0].floors[0].staircases[0].id).toBe('st-north')
    expect(restored.buildings[0].floors[0].elevators[0].id).toBe('el-main')
    expect(roundTrip(doc).success).toBe(true)
  })

  it('treats unversioned docs as schemaVersion 1', () => {
    const doc = makeBaseDoc()
    const json = JSON.stringify(doc).replace(/"schemaVersion":\s*1,\s*/, '')
    const restored = deserializeDocument(json)
    expect(restored.schemaVersion).toBe(1)
  })

  // â”€â”€ P1-T1 (R2.1): per-floor offset & rotation round-trip â”€â”€

  it('per-floor offset/rotation and building rotation survive round-trip verbatim', () => {
    const doc = makeBaseDoc()
    const bld = doc.buildings[0]
    bld.rotation = 45
    bld.floors[0].offset = { x: 12.5, y: -7.25 }
    bld.floors[0].rotation = 30
    bld.floors[1].offset = { x: 0, y: 0 }

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.buildings[0].rotation).toBe(45)
    expect(restored.buildings[0].floors[0].offset).toEqual({ x: 12.5, y: -7.25 })
    expect(restored.buildings[0].floors[0].rotation).toBe(30)
    expect(restored.buildings[0].floors[1].offset).toEqual({ x: 0, y: 0 })
    expect(roundTrip(doc).success).toBe(true)
  })

  it('legacy documents without offset/rotation stay additive-absent (no rewrite, no data loss)', () => {
    const doc = makeBaseDoc()
    // strip the new fields (as a pre-P1-T1 doc would be)
    delete (doc.buildings[0] as Record<string, unknown>).rotation
    delete (doc.buildings[0].floors[0] as Record<string, unknown>).offset
    delete (doc.buildings[0].floors[0] as Record<string, unknown>).rotation

    // D12 additive: legacy docs keep fields absent â€” serialize(deserialize(x)) === x.
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    expect(serializeDocument(restored)).toBe(json)
    expect((restored.buildings[0] as Record<string, unknown>).rotation).toBeUndefined()
    expect((restored.buildings[0].floors[0] as Record<string, unknown>).offset).toBeUndefined()
    expect((restored.buildings[0].floors[0] as Record<string, unknown>).rotation).toBeUndefined()
    // no data loss: rooms/hallways intact
    expect(restored.buildings[0].floors[0].label).toBe('Ground Floor')
    expect(roundTrip(doc).success).toBe(true)
  })
})

describe('P1-T4: building-local point entities round-trip without world LatLng storage', () => {
  it('round-trips Entrance / QRCheckpoint / Panorama positions as LocalCoord (no lat/lng keys)', () => {
    const doc = makeBaseDoc()
    const floor = doc.buildings[0].floors[0]
    floor.entrances = [
      { id: 'ent-local', label: 'Main Entrance', position: { x: 12.5, y: -3.25 }, level: 0, type: 'main', hasQR: false, hasPanorama: false },
    ]
    doc.panoramas = [
      { id: 'pano-local', label: 'Lobby', position: { x: 4, y: 5 }, heading: 0, imageAssetId: '', buildingId: 'bld-1', floor: 0, hotspots: [] },
    ]
    doc.qrCheckpoints = [
      { id: 'qr-local', label: 'QR 1', position: { x: -2, y: 7.5 }, buildingId: 'bld-1', floor: 0, code: 'QR-1', metadata: {} },
    ]

    const restored = deserializeDocument(serializeDocument(doc))
    const entOut = restored.buildings[0].floors[0].entrances[0]
    expect(entOut.position).toEqual({ x: 12.5, y: -3.25 })
    expect(restored.panoramas[0].position).toEqual({ x: 4, y: 5 })
    expect(restored.qrCheckpoints[0].position).toEqual({ x: -2, y: 7.5 })
    expect(entOut.position).not.toHaveProperty('lat')
    expect(restored.panoramas[0].position).not.toHaveProperty('lat')
    expect(restored.qrCheckpoints[0].position).not.toHaveProperty('lat')
    // R15.9: every field that must survive publish is preserved
    expect(entOut.label).toBe('Main Entrance')
    expect(entOut.level).toBe(0)
    expect(restored.qrCheckpoints[0].code).toBe('QR-1')
    expect(restored.qrCheckpoints[0].buildingId).toBe('bld-1')
    expect(restored.panoramas[0].buildingId).toBe('bld-1')
    expect(restored.panoramas[0].floor).toBe(0)
    expect(roundTrip(doc).success).toBe(true)
  })
})

// â”€â”€ P1-T5 (R2.2): POIs round-trip building-local, additive-absent for legacy docs â”€â”€

describe('P1-T5: POIs', () => {
  it('round-trips Floor.pois verbatim with LocalCoord positions (no lat/lng keys)', () => {
    const doc = makeBaseDoc()
    doc.buildings[0].floors[0].pois = [
      { id: 'poi-1', name: 'Vending Machine', category: 'vending_machine', position: { x: 3.5, y: 7.25 }, metadata: { vendor: 'acme' } },
      { id: 'poi-2', name: 'Restroom', category: 'restroom', position: { x: -12.75, y: 0.5 } },
    ]

    const restored = deserializeDocument(serializeDocument(doc))
    const pois = restored.buildings[0].floors[0].pois!
    expect(pois).toEqual(doc.buildings[0].floors[0].pois)
    expect(pois[0].position).not.toHaveProperty('lat')
    expect(pois[1].position).not.toHaveProperty('lat')
    // R15.9: every field survives
    expect(pois[0].metadata).toEqual({ vendor: 'acme' })
    expect(pois[1].category).toBe('restroom')
    expect(roundTrip(doc).success).toBe(true)
  })

  it('legacy documents without pois stay additive-absent (no key injected, byte-stable)', () => {
    const doc = makeBaseDoc()
    const json = serializeDocument(doc)
    expect(JSON.parse(json).buildings[0].floors[0]).not.toHaveProperty('pois')

    const restored = deserializeDocument(json)
    expect(restored.buildings[0].floors[0]).not.toHaveProperty('pois')
    // D12 additive: serialize(deserialize(x)) === x
    expect(serializeDocument(restored)).toBe(json)
    expect(roundTrip(doc).success).toBe(true)
  })

  it('round-trips CampusDocument.pois (outdoor world geometry) verbatim', () => {
    const doc = makeBaseDoc()
    doc.pois = [
      {
        id: 'poi-guard-post',
        name: 'Guard Post',
        category: 'other',
        scope: 'outdoor',
        geometry: { type: 'point', position: { lat: 25.6328, lng: 122.9278 } },
        metadata: { shift: 'day' },
      },
      {
        id: 'poi-court',
        name: 'Court',
        category: 'other',
        scope: 'outdoor',
        geometry: {
          type: 'polygon',
          points: [
            { lat: 25.632, lng: 122.927 },
            { lat: 25.633, lng: 122.927 },
            { lat: 25.633, lng: 122.928 },
          ],
        },
        appearance: { mode: '2.5d', height: 4 },
      },
    ]

    const restored = deserializeDocument(serializeDocument(doc))
    expect(restored.pois).toEqual(doc.pois)
    const firstGeometry = restored.pois![0].geometry
    expect(firstGeometry.type).toBe('point')
    if (firstGeometry.type === 'point') expect(firstGeometry.position).toHaveProperty('lat')
    expect(restored.pois![0]).not.toHaveProperty('position')
    expect((restored.buildings[0].floors[0] as unknown as Record<string, unknown>).pois).toBeUndefined()
    expect(roundTrip(doc).success).toBe(true)
  })

  it('legacy documents without outdoor pois stay additive-absent (no key injected)', () => {
    const doc = makeBaseDoc()
    const json = serializeDocument(doc)
    expect(JSON.parse(json)).not.toHaveProperty('pois')

    const restored = deserializeDocument(json)
    expect(restored).not.toHaveProperty('pois')
    expect(serializeDocument(restored)).toBe(json)
  })

  it('rejects a non-array CampusDocument.pois on deserialize', () => {
    const json = serializeDocument(makeBaseDoc())
    const parsed = JSON.parse(json)
    parsed.pois = { id: 'poi-bad' }
    expect(() => deserializeDocument(JSON.stringify(parsed))).toThrow('pois must be an array')
  })
})

// â”€â”€ P1-T6 (R2.4/D7): RoomDoor extraction â€” Floor.doors round-trip + doorType validation â”€â”€

describe('P1-T6: doors', () => {
  it('round-trips Floor.doors verbatim (extracted shape) with LocalCoord positions', () => {
    const doc = makeBaseDoc()
    doc.buildings[0].floors[0].doors = [
      {
        id: 'door-1', roomId: 'room-1', connectedToId: 'hall-1', connectedToType: 'hallway',
        doorType: 'fire', position: { x: 5.5, y: 0.25 }, width: 1.1, metadata: { label: 'Fire exit' },
      },
      { id: 'door-2', roomId: 'room-2', doorType: 'opening', position: { x: 0, y: 4 }, width: 1.4, metadata: {} },
    ]

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    expect(restored.buildings[0].floors[0].doors).toEqual(doc.buildings[0].floors[0].doors)
    expect(restored.buildings[0].floors[0].doors![0].position).not.toHaveProperty('lat')
    // byte-stable round-trip for the new shape too
    expect(serializeDocument(restored)).toBe(json)
    expect(roundTrip(doc).success).toBe(true)
  })

  it('legacy nested roomDoors stay byte-stable and are NOT reshaped by the serializer', () => {
    const doc = makeBaseDoc() as unknown as Record<string, any>
    ;(doc.buildings[0].floors[0].rooms as Array<Record<string, unknown>>).push({
      id: 'room-9', name: 'Legacy Room', number: '109', category: 'office',
      polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] },
      roomDoors: [
        { id: 'door-nested', roomId: 'room-9', connectedToType: 'room', doorType: 'double', position: { x: 2.5, y: 0 }, width: 1.8, metadata: {} },
      ],
      metadata: {},
    })

    const json = serializeDocument(doc as never)
    const restored = deserializeDocument(json) as unknown as Record<string, any>
    const room = restored.buildings[0].floors[0].rooms.find((r: { id: string }) => r.id === 'room-9')
    expect(room.roomDoors).toHaveLength(1)
    expect(room.roomDoors[0].doorType).toBe('double')
    // D12: serializer is a pass-through â€” no hoisting, no key injection
    expect(serializeDocument(restored as never)).toBe(json)
  })

  it('rejects unknown doorType values on deserialize (nested and extracted locations)', () => {
    const doc = makeBaseDoc()
    doc.buildings[0].floors[0].doors = [
      { id: 'door-bad', roomId: 'room-1', doorType: 'revolving' as never, position: { x: 1, y: 0 }, width: 1, metadata: {} },
    ]
    expect(() => deserializeDocument(serializeDocument(doc))).toThrow(/doorType/)

    const raw = JSON.parse(serializeDocument(makeBaseDoc()))
    raw.buildings[0].floors[0].rooms = [{
      id: 'room-1', name: 'R', number: '1', category: 'office',
      polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] },
      roomDoors: [{ id: 'door-bad-nested', roomId: 'room-1', connectedToType: 'room', doorType: 'portal', position: { x: 1, y: 0 }, width: 1, metadata: {} }],
      metadata: {},
    }]
    expect(() => deserializeDocument(JSON.stringify(raw))).toThrow(/doorType/)
  })

  it('accepts every closed-enum doorType value on deserialize', () => {
    const types = ['opening', 'standard', 'fire', 'double', 'sliding']
    for (const doorType of types) {
      const doc = makeBaseDoc()
      doc.buildings[0].floors[0].doors = [
        { id: `door-${doorType}`, roomId: 'room-1', doorType: doorType as never, position: { x: 1, y: 0 }, width: 1, metadata: {} },
      ]
      const restored = deserializeDocument(serializeDocument(doc))
      expect(restored.buildings[0].floors[0].doors![0].doorType).toBe(doorType)
    }
  })

  it('legacy documents without doors stay additive-absent (byte-stable)', () => {
    const doc = makeBaseDoc()
    const json = serializeDocument(doc)
    expect(JSON.parse(json).buildings[0].floors[0]).not.toHaveProperty('doors')
    const restored = deserializeDocument(json)
    expect(restored.buildings[0].floors[0]).not.toHaveProperty('doors')
    expect(serializeDocument(restored)).toBe(json)
  })
})

// â”€â”€ P1-T7 (R2.5/D3/D10): route network as a first-class persisted entity â”€â”€

describe('P1-T7: route network', () => {
  const MIXED_NETWORK = {
    nodes: [
      { id: 'route-node-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
      { id: 'route-node-b', type: 'poi', position: { x: 4, y: 0 }, floor: 0 },
      { id: 'route-node-c', type: 'transition', position: { x: 8, y: 0 }, floor: 0 },
      { id: 'route-node-d', type: 'entrance', position: { x: 12, y: 0 }, floor: 0 },
      { id: 'route-node-e', type: 'outdoor', position: { x: 16, y: 0 }, floor: 0 },
      { id: 'route-node-f', type: 'portal', position: { x: 20, y: 0 }, floor: 0 },
    ],
    edges: [
      { id: 'route-edge-1', from: 'route-node-a', to: 'route-node-b', type: 'walk', distance: 4 },
      { id: 'route-edge-2', from: 'route-node-b', to: 'route-node-c', type: 'stairs', distance: 3 },
      { id: 'route-edge-3', from: 'route-node-c', to: 'route-node-d', type: 'elevator', distance: 4 },
      { id: 'route-edge-4', from: 'route-node-d', to: 'route-node-e', type: 'portal', distance: 10 },
    ],
  }

  it('round-trips a mixed-type network verbatim and stays byte-stable (D3)', () => {
    const doc = makeBaseDoc()
    ;(doc.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork = JSON.parse(JSON.stringify(MIXED_NETWORK))

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    const net = (restored.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork
    // Verbatim: every node/edge type survives with exact key-presence
    expect(net).toEqual(MIXED_NETWORK)
    // Byte-stable re-serialization
    expect(serializeDocument(restored)).toBe(json)
  })

  it('legacy documents without a route network stay additive-absent (byte-stable)', () => {
    const doc = makeBaseDoc()
    const json = serializeDocument(doc)
    expect(JSON.parse(json).buildings[0].floors[0]).not.toHaveProperty('routeNetwork')
    const restored = deserializeDocument(json)
    expect(restored.buildings[0].floors[0]).not.toHaveProperty('routeNetwork')
    expect(serializeDocument(restored)).toBe(json)
  })

  it('rejects unknown node types on deserialize (six-value vocabulary, D10)', () => {
    const doc = makeBaseDoc()
    ;(doc.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork = {
      nodes: [{ id: 'route-node-x', type: 'beacon', position: { x: 0, y: 0 }, floor: 0 }],
      edges: [],
    }
    expect(() => deserializeDocument(serializeDocument(doc))).toThrow(/RouteNode/i)
  })

  it('rejects unknown edge types on deserialize (walk|stairs|elevator|portal)', () => {
    const doc = makeBaseDoc()
    ;(doc.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork = {
      nodes: [
        { id: 'route-node-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'route-node-b', type: 'waypoint', position: { x: 1, y: 0 }, floor: 0 },
      ],
      edges: [{ id: 'route-edge-x', from: 'route-node-a', to: 'route-node-b', type: 'teleport', distance: 1 }],
    }
    expect(() => deserializeDocument(serializeDocument(doc))).toThrow(/RouteEdge/i)
  })

  it('accepts every vocabulary value on deserialize (6 node types Ã— 4 edge types)', () => {
    const nodeTypes = ['waypoint', 'poi', 'transition', 'entrance', 'outdoor', 'portal']
    const edgeTypes = ['walk', 'stairs', 'elevator', 'portal']
    for (const nt of nodeTypes) {
      const doc = makeBaseDoc()
      ;(doc.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork = {
        nodes: [{ id: `route-node-${nt}`, type: nt, position: { x: 0, y: 0 }, floor: 0 }],
        edges: [],
      }
      const restored = deserializeDocument(serializeDocument(doc))
      const net = (restored.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork as { nodes: Array<{ type: string }> }
      expect(net.nodes[0].type).toBe(nt)
    }
    for (const et of edgeTypes) {
      const doc = makeBaseDoc()
      ;(doc.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork = {
        nodes: [
          { id: 'route-node-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'route-node-b', type: 'waypoint', position: { x: 1, y: 0 }, floor: 0 },
        ],
        edges: [{ id: `route-edge-${et}`, from: 'route-node-a', to: 'route-node-b', type: et, distance: 1 }],
      }
      const restored = deserializeDocument(serializeDocument(doc))
      const net = (restored.buildings[0].floors[0] as unknown as Record<string, unknown>).routeNetwork as { edges: Array<{ type: string }> }
      expect(net.edges[0].type).toBe(et)
    }
  })
})

// ── P1-T9 (R2.6): stair/elevator features own cross-floor identity via levels ──

describe('P1-T9: stair/elevator levels cross-floor identity', () => {
  it('a feature with levels on F0/F2 (no F1) round-trips verbatim; absent floors stay absent (R2.6)', () => {
    const doc = makeBaseDoc()
    ;(doc.buildings[0] as unknown as Record<string, unknown>).staircases = [
      {
        id: 'stair-a', buildingId: 'bld-1', name: 'Stair A', type: 'open', accessible: true,
        fromLevel: 0, toLevel: 2,
        levels: {
          0: { position: { x: 10, y: 20 }, rotation: 0 },
          2: { position: { x: 12, y: 22 }, rotation: 90 },
        },
      },
    ]

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    const stair = (restored.buildings[0] as unknown as { staircases: Array<{ levels: Record<string, unknown> }> }).staircases[0]
    // Access floors only — F1 never zero-filled
    expect(Object.keys(stair.levels)).toEqual(['0', '2'])
    expect(stair.levels[2]).toEqual({ position: { x: 12, y: 22 }, rotation: 90 })
    // Verbatim round-trip, byte-stable re-serialization
    expect(serializeDocument(restored)).toBe(json)
  })
})
