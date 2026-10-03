import { describe, it, expect } from 'vitest'
import { extractRooms } from '../primitives/room-extractor'
import { extractDoors } from '../primitives/door-extractor'
import { extractAnchors } from '../primitives/anchor-extractor'
import { extractConnectors } from '../primitives/connector-extractor'
import { extractEntrances } from '../primitives/entrance-extractor'
import type { NormalizedDocument, GenerationContext } from '../types'

const ctx: GenerationContext = { nodeInterval: 10, mergeThreshold: 0.5 }

function makeNormalizedDoc(overrides?: Partial<NormalizedDocument>): NormalizedDocument {
  return {
    buildings: [],
    roads: [],
    ...overrides,
  }
}

function makeBuilding(overrides?: Record<string, unknown>): NormalizedDocument['buildings'][number] {
  return {
    id: 'b1',
    name: 'Building A',
    code: 'BA',
    category: 'academic',
    position: { lat: 14.0, lng: 121.0 },
    baseElevation: 0,
    height: 10,
    floors: [],
    ...overrides,
  } as any
}

function makeFloor(overrides?: Partial<NormalizedDocument['buildings'][number]['floors'][number]>): NormalizedDocument['buildings'][number]['floors'][number] {
  return {
    id: 'b1-0',
    level: 0,
    label: 'Ground',
    elevation: 0,
    buildingId: 'b1',
    rooms: [],
    hallways: [],
    connectorStops: [],
    entrances: [],
    anchors: [],
    ...overrides,
  } as any
}

function makeRoom(overrides?: Record<string, unknown>): NormalizedDocument['buildings'][number]['floors'][number]['rooms'][number] {
  return {
    id: 'r1',
    name: 'Room 101',
    number: '101',
    category: 'classroom',
    polygon: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }],
    centroid: { lat: 14.0005, lng: 121.0005 },
    floorId: 'b1-0',
    floorLevel: 0,
    buildingId: 'b1',
    doors: [],
    ...overrides,
  } as any
}

describe('RoomExtractor', () => {
  it('creates a POI node for each room', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor({ rooms: [makeRoom({ id: 'r1', name: 'Room 101', number: '101' })] })] })],
    })
    const result = extractRooms(doc, ctx)
    expect(result.nodes).toBeDefined()
    expect(result.nodes!.length).toBe(1)
    expect(result.nodes![0]!.kind).toBe('poi')
    expect(result.nodes![0]!.poiCategory).toBe('room')
    expect(result.nodes![0]!.source.entityType).toBe('room')
    expect(result.nodes![0]!.source.generatorId).toBe('builtin:room-extractor')
  })

  it('emits ROOM_NO_DOOR diagnostic when room has no doors', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor({ rooms: [makeRoom({ doors: [] })] })] })],
    })
    const result = extractRooms(doc, ctx)
    expect(result.diagnostics!.length).toBe(1)
    expect(result.diagnostics![0]!.code).toBe('ROOM_NO_DOOR')
    expect(result.diagnostics![0]!.severity).toBe('info')
  })

  it('does NOT emit ROOM_NO_DOOR when room has doors', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor({ rooms: [makeRoom({ doors: [{ id: 'd1', roomId: 'r1', position: { lat: 14.0, lng: 121.0 } }] })] })] })],
    })
    const result = extractRooms(doc, ctx)
    expect(result.diagnostics!.length).toBe(0)
  })

  it('does not depend on other extractors (works with only rooms)', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor({ rooms: [makeRoom()] })] })],
    })
    const result = extractRooms(doc, ctx)
    expect(result.nodes!.length).toBe(1)
  })
})

describe('DoorExtractor', () => {
  it('produces DoorSpec records for every room door', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          rooms: [makeRoom({
            doors: [{ id: 'd1', roomId: 'r1', position: { lat: 14.0, lng: 121.0 }, width: 1.2 }],
          })],
        })],
      })],
    })
    const result = extractDoors(doc, ctx)
    expect(result.doorSpecs).toBeDefined()
    expect(result.doorSpecs!.length).toBe(1)
    expect(result.doorSpecs![0]!.doorId).toBe('d1')
    expect(result.doorSpecs![0]!.roomId).toBe('r1')
    expect(result.doorSpecs![0]!.width).toBe(1.2)
  })

  it('produces no doorSpecs when rooms have no doors', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          rooms: [makeRoom({ doors: [] })],
        })],
      })],
    })
    const result = extractDoors(doc, ctx)
    expect(result.nodes).toBeUndefined()
    expect(result.doorSpecs!.length).toBe(0)
  })

  it('does not depend on any other extractor', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          rooms: [makeRoom({
            doors: [{ id: 'd1', roomId: 'r1', position: { lat: 14.0, lng: 121.0 } }],
          })],
        })],
      })],
    })
    const result = extractDoors(doc, ctx)
    expect(result.doorSpecs!.length).toBe(1)
  })
})

describe('AnchorExtractor', () => {
  it('creates POI nodes for panorama anchors', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          anchors: [{ id: 'a1', type: 'panorama', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', label: 'Panorama View', properties: { imageAssetId: 'img1' } }],
        })],
      })],
    })
    const result = extractAnchors(doc, ctx)
    expect(result.nodes!.length).toBe(1)
    expect(result.nodes![0]!.kind).toBe('poi')
    expect(result.nodes![0]!.poiCategory).toBe('panorama')
    expect(result.nodes![0]!.source.generatorId).toBe('builtin:anchor-extractor')
  })

  it('creates POI nodes for QR marker anchors', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          anchors: [{ id: 'a2', type: 'qr_marker', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', label: 'QR Spot', properties: { code: 'qr-code-123' } }],
        })],
      })],
    })
    const result = extractAnchors(doc, ctx)
    expect(result.nodes!.length).toBe(1)
    expect(result.nodes![0]!.poiCategory).toBe('qr_marker')
  })

  it('produces no nodes when there are no anchors', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor()] })],
    })
    const result = extractAnchors(doc, ctx)
    expect(result.nodes!.length).toBe(0)
  })

  it('does not depend on any other extractor', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          anchors: [{ id: 'a1', type: 'panorama', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', label: 'View', properties: { imageAssetId: 'img1' } }],
        })],
      })],
    })
    const result = extractAnchors(doc, ctx)
    expect(result.nodes!.length).toBe(1)
  })
})

describe('ConnectorExtractor', () => {
  it('creates transition nodes from connector stops', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          connectorStops: [{ id: 'cs1', connectorId: 'vc1', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', behavior: 'stairs', accessible: true, baseCost: 15 }],
        })],
      })],
    })
    const result = extractConnectors(doc, ctx)
    expect(result.nodes!.length).toBe(1)
    expect(result.nodes![0]!.kind).toBe('transition')
    expect(result.nodes![0]!.connectorId).toBe('vc1')
    expect(result.nodes![0]!.behavior).toBe('stairs')
    expect(result.nodes![0]!.source.generatorId).toBe('builtin:connector-extractor')
  })

  it('maps elevator behavior correctly', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          connectorStops: [{ id: 'cs2', connectorId: 'vc2', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', behavior: 'elevator', accessible: true, baseCost: 20 }],
        })],
      })],
    })
    const result = extractConnectors(doc, ctx)
    expect(result.nodes!.length).toBe(1)
    expect(result.nodes![0]!.behavior).toBe('elevator')
    expect(result.nodes![0]!.baseCost).toBe(20)
  })

  it('produces no nodes when no connector stops', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor()] })],
    })
    const result = extractConnectors(doc, ctx)
    expect(result.nodes!.length).toBe(0)
  })

  it('does not depend on any other extractor', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          connectorStops: [{ id: 'cs1', connectorId: 'vc1', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', behavior: 'stairs', accessible: true, baseCost: 15 }],
        })],
      })],
    })
    const result = extractConnectors(doc, ctx)
    expect(result.nodes!.length).toBe(1)
  })
})

describe('EntranceExtractor', () => {
  it('creates entrance_portal nodes from normalized entrances', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          entrances: [{ id: 'e1', label: 'Main Entrance', outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.001, lng: 121.001 }, level: 0, buildingId: 'b1', accessible: true }],
        })],
      })],
    })
    const result = extractEntrances(doc, ctx)
    expect(result.nodes!.length).toBe(1)
    expect(result.nodes![0]!.kind).toBe('entrance_portal')
    expect(result.nodes![0]!.entranceId).toBe('e1')
    expect(result.nodes![0]!.outdoorPosition).toEqual({ lat: 14.0, lng: 121.0 })
    expect(result.nodes![0]!.indoorPosition).toEqual({ lat: 14.001, lng: 121.001 })
    expect(result.nodes![0]!.source.generatorId).toBe('builtin:entrance-extractor')
  })

  it('computes midpoint position from outdoor and indoor', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          entrances: [{ id: 'e1', label: 'Main', outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.01, lng: 121.01 }, level: 0, buildingId: 'b1', accessible: true }],
        })],
      })],
    })
    const result = extractEntrances(doc, ctx)
    expect(result.nodes![0]!.position.lat).toBeCloseTo(14.005, 5)
    expect(result.nodes![0]!.position.lng).toBeCloseTo(121.005, 5)
  })

  it('produces no nodes when no entrances', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({ floors: [makeFloor()] })],
    })
    const result = extractEntrances(doc, ctx)
    expect(result.nodes!.length).toBe(0)
  })

  it('does not depend on any other extractor', () => {
    const doc = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          entrances: [{ id: 'e1', label: 'Ent', outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.001, lng: 121.001 }, level: 0, buildingId: 'b1', accessible: true }],
        })],
      })],
    })
    const result = extractEntrances(doc, ctx)
    expect(result.nodes!.length).toBe(1)
  })
})

describe('Extractor independence', () => {
  it('room extractor produces same result regardless of other data', () => {
    const doc1 = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          rooms: [makeRoom({ id: 'r1' })],
        })],
      })],
    })
    const doc2 = makeNormalizedDoc({
      buildings: [makeBuilding({
        floors: [makeFloor({
          rooms: [makeRoom({ id: 'r1' })],
          connectorStops: [{ id: 'cs1', connectorId: 'vc1', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', behavior: 'stairs', accessible: true, baseCost: 15 }],
          anchors: [{ id: 'a1', type: 'panorama', position: { lat: 14.0, lng: 121.0 }, floor: 0, buildingId: 'b1', label: 'View', properties: { imageAssetId: 'img1' } }],
          entrances: [{ id: 'e1', label: 'Ent', outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.001, lng: 121.001 }, level: 0, buildingId: 'b1', accessible: true }],
        })],
      })],
    })
    const r1 = extractRooms(doc1, ctx)
    const r2 = extractRooms(doc2, ctx)
    expect(r1.nodes!.length).toBe(r2.nodes!.length)
  })
})
