import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import {
  findBuilding,
  findFloorByLevel,
  findFloorById,
  getBuildingFloors,
  getBuildingFloorCount,
  getFloorEntities,
  findRoom,
  findEntity,
  findComponent,
} from './selectors'

function makeDoc(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '2024-01-01', editorVersion: '1.0.0' },
    buildings: [
      {
        id: 'bld-1',
        name: 'Building A',
        code: 'A',
        category: 'academic',
        description: '',
        footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }, { lat: 0, lng: 1 }] },
        baseElevation: 0,
        height: 10,
        color: '#1C6BEB',
        aliases: [],
        metadata: {},
        floors: [
          {
            id: 'flr-g',
            level: 0,
            label: 'Ground',
            elevation: 0,
            rooms: [
              { id: 'room-101', name: 'Room 101', number: '101', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, capacity: 30, metadata: {} },
            ],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
            metadata: {},
          },
          {
            id: 'flr-1',
            level: 1,
            label: 'First',
            elevation: 4,
            rooms: [
              { id: 'room-201', name: 'Room 201', number: '201', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, capacity: 30, metadata: {} },
            ],
            hallways: [
              { id: 'hall-1', name: 'Main Hallway', polyline: { points: [{ x: 0, y: 5 }, { x: 20, y: 5 }] }, width: 3 },
            ],
              staircases: [
              { id: 'stairs-1', name: 'Stair A', position: { x: 0, y: 0 }, fromLevel: 0, toLevel: 1, type: 'open' },
            ],
            elevators: [
              { id: 'elev-1', name: 'Elevator A', position: { x: 15, y: 15 }, fromLevel: 0, toLevel: 2 },
            ],
            entrances: [
              { id: 'ent-1', label: 'Main Entrance', position: { lat: 0.5, lng: 0.5 } as any, level: 1, type: 'main', hasQR: false, hasPanorama: false },
            ],
            metadata: {},
          },
        ],
      },
    ],
    roads: [{ id: 'road-1', name: 'Main Road', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} }],
    panoramas: [{ id: 'pano-1', label: 'Entrance View', position: { lat: 0.5, lng: 0.5 } as any, heading: 0, imageAssetId: 'img-1', hotspots: [] }],
    qrCheckpoints: [{ id: 'qr-1', label: 'Checkpoint A', position: { lat: 0.5, lng: 0.5 } as any, floor: 0, buildingId: 'bld-1', code: 'QR001', metadata: {} }],
    ...overrides,
  }
}

describe('findBuilding', () => {
  it('returns building by id', () => {
    const doc = makeDoc()
    const b = findBuilding(doc, 'bld-1')
    expect(b).toBeDefined()
    expect(b!.name).toBe('Building A')
  })

  it('returns undefined for missing building', () => {
    expect(findBuilding(makeDoc(), 'bld-missing')).toBeUndefined()
  })
})

describe('findFloorByLevel', () => {
  it('returns floor by building id and level', () => {
    const doc = makeDoc()
    const f = findFloorByLevel(doc, 'bld-1', 0)
    expect(f).toBeDefined()
    expect(f!.label).toBe('Ground')
  })

  it('returns undefined for missing floor level', () => {
    expect(findFloorByLevel(makeDoc(), 'bld-1', 99)).toBeUndefined()
  })

  it('returns undefined for missing building', () => {
    expect(findFloorByLevel(makeDoc(), 'bld-x', 0)).toBeUndefined()
  })
})

describe('findFloorById', () => {
  it('returns floor by building id and floor id', () => {
    const doc = makeDoc()
    const f = findFloorById(doc, 'bld-1', 'flr-1')
    expect(f).toBeDefined()
    expect(f!.level).toBe(1)
  })

  it('returns undefined for missing floor id', () => {
    expect(findFloorById(makeDoc(), 'bld-1', 'flr-x')).toBeUndefined()
  })
})

describe('getBuildingFloors', () => {
  it('returns all floors for a building', () => {
    const doc = makeDoc()
    expect(getBuildingFloors(doc, 'bld-1')).toHaveLength(2)
  })

  it('returns empty array for missing building', () => {
    expect(getBuildingFloors(makeDoc(), 'bld-x')).toEqual([])
  })
})

describe('getBuildingFloorCount', () => {
  it('returns floor count', () => {
    expect(getBuildingFloorCount(makeDoc(), 'bld-1')).toBe(2)
  })

  it('returns 0 for missing building', () => {
    expect(getBuildingFloorCount(makeDoc(), 'bld-x')).toBe(0)
  })
})

describe('getFloorEntities', () => {
  it('returns all entities on a floor', () => {
    const doc = makeDoc()
    const entities = getFloorEntities(doc, 'bld-1', 1)
    expect(entities.rooms).toHaveLength(1)
    expect(entities.hallways).toHaveLength(1)
    expect(entities.staircases).toHaveLength(1)
    expect(entities.elevators).toHaveLength(1)
    expect(entities.entrances).toHaveLength(1)
  })

  it('returns empty for missing floor', () => {
    const entities = getFloorEntities(makeDoc(), 'bld-1', 99)
    expect(entities.rooms).toEqual([])
    expect(entities.hallways).toEqual([])
  })
})

describe('findRoom', () => {
  it('returns room by id within building and floor', () => {
    const doc = makeDoc()
    const r = findRoom(doc, 'bld-1', 0, 'room-101')
    expect(r).toBeDefined()
    expect(r!.name).toBe('Room 101')
  })

  it('returns undefined for missing room', () => {
    expect(findRoom(makeDoc(), 'bld-1', 0, 'room-x')).toBeUndefined()
  })
})

describe('findEntity', () => {
  it('finds a building', () => {
    const result = findEntity(makeDoc(), 'bld-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('building')
  })

  it('finds a floor', () => {
    const result = findEntity(makeDoc(), 'flr-g')
    expect(result).toBeDefined()
    expect(result!.type).toBe('floor')
    expect(result!.path).toHaveLength(2)
  })

  it('finds a room', () => {
    const result = findEntity(makeDoc(), 'room-101')
    expect(result).toBeDefined()
    expect(result!.type).toBe('room')
  })

  it('finds a hallway', () => {
    const result = findEntity(makeDoc(), 'hall-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('hallway')
  })

  it('finds a staircase', () => {
    const result = findEntity(makeDoc(), 'stairs-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('staircase')
  })

  it('finds an elevator', () => {
    const result = findEntity(makeDoc(), 'elev-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('elevator')
  })

  it('finds an entrance', () => {
    const result = findEntity(makeDoc(), 'ent-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('entrance')
  })

  it('finds a road', () => {
    const result = findEntity(makeDoc(), 'road-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('road')
  })

  it('finds a panorama', () => {
    const result = findEntity(makeDoc(), 'pano-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('panorama')
  })

  it('finds a QR checkpoint', () => {
    const result = findEntity(makeDoc(), 'qr-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('qr')
  })

  it('returns undefined for missing entity', () => {
    expect(findEntity(makeDoc(), 'nonexistent')).toBeUndefined()
  })
})

describe('findComponent', () => {
  it('finds a room component', () => {
    const result = findComponent(makeDoc(), 'room-101')
    expect(result).toBeDefined()
    expect(result!.type).toBe('room')
  })

  it('finds a hallway component', () => {
    const result = findComponent(makeDoc(), 'hall-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('hallway')
  })

  it('finds a staircase component', () => {
    const result = findComponent(makeDoc(), 'stairs-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('staircase')
  })

  it('finds an elevator component', () => {
    const result = findComponent(makeDoc(), 'elev-1')
    expect(result).toBeDefined()
    expect(result!.type).toBe('elevator')
  })

  it('returns undefined for non-component entity', () => {
    expect(findComponent(makeDoc(), 'bld-1')).toBeUndefined()
  })

  it('returns undefined for missing component', () => {
    expect(findComponent(makeDoc(), 'missing')).toBeUndefined()
  })
})
