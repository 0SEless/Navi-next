import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { getChangesSince } from '@navi/core'
import { roomCreateHandler, roomRenameHandler, roomDeleteHandler } from './room-handlers'
import { hallwayCreateHandler, hallwayRenameHandler, hallwayDeleteHandler } from './hallway-handlers'
import { staircaseCreateHandler, staircaseDeleteHandler } from './staircase-handlers'
import { elevatorCreateHandler, elevatorDeleteHandler } from './elevator-handlers'
import { entranceCreateHandler, entranceDeleteHandler } from './entrance-handlers'
import { roadCreateHandler, roadRenameHandler, roadDeleteHandler } from './road-handlers'
import { panoramaCreateHandler, panoramaDeleteHandler } from './panorama-handlers'
import { qrCreateHandler, qrDeleteHandler } from './qr-handlers'
import { floorCreateHandler, floorRenameHandler, floorDeleteHandler, floorDuplicateHandler, floorReorderHandler } from './floor-handlers'
import { entityUpdateHandler } from './entity-update-handler'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Test', code: 'T', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      floors: [{
        id: 'flr-1', level: 0, label: 'Ground', elevation: 0, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {},
      }],
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('room handlers', () => {
  it('creates a room', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: '101', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms).toHaveLength(1)
    expect(doc.buildings[0].floors[0].rooms[0].name).toBe('101')
  })

  it('fails when building/floor not found', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-1', name: 'X', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails with fewer than 3 points', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('at least 3 points')
  })

  it('renames a room', () => {
    const doc = createDoc()
    roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Old', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })
    const roomId = doc.buildings[0].floors[0].rooms[0].id
    const result = roomRenameHandler.execute(doc, { roomId, name: 'New' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms[0].name).toBe('New')
  })

  it('deletes a room', () => {
    const doc = createDoc()
    roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })
    const roomId = doc.buildings[0].floors[0].rooms[0].id
    const result = roomDeleteHandler.execute(doc, { roomId })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms).toHaveLength(0)
  })
})

describe('hallway handlers', () => {
  it('creates a hallway', () => {
    const doc = createDoc()
    const result = hallwayCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Main Hall', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].hallways).toHaveLength(1)
    expect(doc.buildings[0].floors[0].hallways[0].name).toBe('Main Hall')
    expect(doc.buildings[0].floors[0].hallways[0].width).toBe(3)
  })

  it('fails with fewer than 2 points', () => {
    const doc = createDoc()
    const result = hallwayCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', points: [{ x: 0, y: 0 }] })
    expect(result.success).toBe(false)
  })

  it('renames a hallway', () => {
    const doc = createDoc()
    hallwayCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Old', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    const hwId = doc.buildings[0].floors[0].hallways[0].id
    const result = hallwayRenameHandler.execute(doc, { hallwayId: hwId, name: 'New' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].hallways[0].name).toBe('New')
  })

  it('deletes a hallway', () => {
    const doc = createDoc()
    hallwayCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    const hwId = doc.buildings[0].floors[0].hallways[0].id
    const result = hallwayDeleteHandler.execute(doc, { hallwayId: hwId })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].hallways).toHaveLength(0)
  })
})

describe('staircase handlers', () => {
  it('creates a staircase', () => {
    const doc = createDoc()
    const result = staircaseCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Stair A', position: { x: 5, y: 5 } })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].staircases).toHaveLength(1)
    expect(doc.buildings[0].floors[0].staircases[0].type).toBe('enclosed')
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = staircaseCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X' })
    expect(result.success).toBe(false)
  })

  it('deletes a staircase', () => {
    const doc = createDoc()
    staircaseCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X', position: { x: 5, y: 5 } })
    const stId = doc.buildings[0].floors[0].staircases[0].id
    const result = staircaseDeleteHandler.execute(doc, { staircaseId: stId })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].staircases).toHaveLength(0)
  })
})

describe('elevator handlers', () => {
  it('creates an elevator', () => {
    const doc = createDoc()
    const result = elevatorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Elev A', position: { x: 10, y: 10 } })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].elevators).toHaveLength(1)
  })

  it('deletes an elevator', () => {
    const doc = createDoc()
    elevatorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X', position: { x: 10, y: 10 } })
    const elId = doc.buildings[0].floors[0].elevators[0].id
    const result = elevatorDeleteHandler.execute(doc, { elevatorId: elId })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].elevators).toHaveLength(0)
  })
})

describe('entrance handlers', () => {
  it('creates an entrance', () => {
    const doc = createDoc()
    const result = entranceCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', label: 'Main Door', position: { lat: 0.001, lng: 0.001 } as any })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].entrances).toHaveLength(1)
    expect(doc.buildings[0].floors[0].entrances[0].type).toBe('side')
  })

  it('deletes an entrance', () => {
    const doc = createDoc()
    entranceCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', label: 'X', position: { lat: 0.001, lng: 0.001 } as any })
    const entId = doc.buildings[0].floors[0].entrances[0].id
    const result = entranceDeleteHandler.execute(doc, { entranceId: entId })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].entrances).toHaveLength(0)
  })
})

describe('road handlers', () => {
  it('creates a road', () => {
    const doc = createDoc()
    const result = roadCreateHandler.execute(doc, { name: 'Main Road', points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] })
    expect(result.success).toBe(true)
    expect(doc.roads).toHaveLength(1)
    expect(doc.roads[0].name).toBe('Main Road')
    expect(doc.roads[0].surface).toBe('paved')
  })

  it('persists an explicit navigation-only display mode', () => {
    const doc = createDoc()
    const result = roadCreateHandler.execute(doc, {
      name: 'Invisible Connector',
      points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }],
      displayMode: 'navigation-only',
    })
    expect(result.success).toBe(true)
    expect((doc.roads[0] as any).displayMode).toBe('navigation-only')
  })

  it('does not move a new road endpoint or create topology from 10 cm proximity', () => {
    const doc = createDoc()
    doc.roads.push({
      id: 'existing-road',
      name: 'Existing',
      polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
      width: 8,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    })
    const authoredStart = { lat: 0.0000009, lng: 0 }

    const result = roadCreateHandler.execute(doc, {
      id: 'nearby-road',
      name: 'Nearby',
      points: [authoredStart, { lat: 0.001, lng: 0 }],
    })

    expect(result.success).toBe(true)
    expect(doc.roads.find(road => road.id === 'nearby-road')?.polyline.points[0]).toEqual(authoredStart)
    expect(doc.roadJunctions).toBeUndefined()
    expect(result.data?.snapCount).toBe(0)
  })

  it('fails with fewer than 2 points', () => {
    const doc = createDoc()
    const result = roadCreateHandler.execute(doc, { points: [{ lat: 0, lng: 0 }] })
    expect(result.success).toBe(false)
  })

  it('renames a road', () => {
    const doc = createDoc()
    roadCreateHandler.execute(doc, { name: 'Old', points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] })
    const rdId = doc.roads[0].id
    const result = roadRenameHandler.execute(doc, { roadId: rdId, name: 'New' })
    expect(result.success).toBe(true)
    expect(doc.roads[0].name).toBe('New')
  })

  it('deletes a road', () => {
    const doc = createDoc()
    roadCreateHandler.execute(doc, { name: 'X', points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] })
    const rdId = doc.roads[0].id
    const result = roadDeleteHandler.execute(doc, { roadId: rdId })
    expect(result.success).toBe(true)
    expect(doc.roads).toHaveLength(0)
  })
})

describe('panorama handlers', () => {
  it('creates a panorama', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: 'Entrance View', position: { lat: 0, lng: 0 } as any, imageAssetId: 'img-1' })
    expect(result.success).toBe(true)
    expect(doc.panoramas).toHaveLength(1)
    expect(doc.panoramas[0].label).toBe('Entrance View')
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: 'X', imageAssetId: 'img-1' })
    expect(result.success).toBe(false)
  })

  it('fails without imageAssetId', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: 'X', position: { lat: 0, lng: 0 } })
    expect(result.success).toBe(false)
  })

  it('deletes a panorama', () => {
    const doc = createDoc()
    panoramaCreateHandler.execute(doc, { label: 'X', position: { lat: 0, lng: 0 } as any, imageAssetId: 'img-1' })
    const panId = doc.panoramas[0].id
    const result = panoramaDeleteHandler.execute(doc, { panoramaId: panId })
    expect(result.success).toBe(true)
    expect(doc.panoramas).toHaveLength(0)
  })
})

describe('qr checkpoint handlers', () => {
  // P1-T13 (R10.1/D16/Q5): QR payloads are opaque — code is derived from the
  // id (navi.app/q/{id}); coordinates/legacy schemes are rejected.
  it('creates a QR checkpoint with a derived opaque code', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'QR-1', position: { lat: 0, lng: 0 } as any })
    expect(result.success).toBe(true)
    expect(doc.qrCheckpoints).toHaveLength(1)
    expect(doc.qrCheckpoints[0].code).toMatch(/^navi\.app\/q\//)
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'X' })
    expect(result.success).toBe(false)
  })

  it('rejects a supplied code that is not the opaque form of the id', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'X', position: { lat: 0, lng: 0 }, code: 'navi://x' })
    expect(result.success).toBe(false)
  })

  it('deletes a QR checkpoint', () => {
    const doc = createDoc()
    qrCreateHandler.execute(doc, { label: 'X', position: { lat: 0, lng: 0 } as any })
    const qrId = doc.qrCheckpoints[0].id
    const result = qrDeleteHandler.execute(doc, { qrId })
    expect(result.success).toBe(true)
    expect(doc.qrCheckpoints).toHaveLength(0)
  })
})

describe('floor handlers', () => {
  it('creates a floor', () => {
    const doc = createDoc()
    const result = floorCreateHandler.execute(doc, { buildingId: 'bld-1', label: 'Second Floor' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors).toHaveLength(2)
    expect(doc.buildings[0].floors[1].label).toBe('Second Floor')
  })

  it('fails when building not found', () => {
    const doc = createDoc()
    const result = floorCreateHandler.execute(doc, { buildingId: 'nope' })
    expect(result.success).toBe(false)
  })

  it('renames a floor', () => {
    const doc = createDoc()
    const result = floorRenameHandler.execute(doc, { floorId: 'flr-1', label: 'Renamed' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].label).toBe('Renamed')
  })

  it('deletes a floor', () => {
    const doc = createDoc()
    floorCreateHandler.execute(doc, { buildingId: 'bld-1' })
    expect(doc.buildings[0].floors).toHaveLength(2)
    const result = floorDeleteHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors).toHaveLength(1)
  })

  it('reorders floors through a command and normalizes their levels', () => {
    const doc = createDoc()
    floorCreateHandler.execute(doc, { buildingId: 'bld-1', id: 'flr-2', label: 'Second Floor' })

    const result = floorReorderHandler.execute(doc, {
      buildingId: 'bld-1',
      floorIds: ['flr-2', 'flr-1'],
    })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors.map(floor => floor.id)).toEqual(['flr-2', 'flr-1'])
    expect(doc.buildings[0].floors.map(floor => floor.level)).toEqual([0, 1])
  })

  it('duplicates a floor with new entity IDs', () => {
    const doc = createDoc()
    const srcFloor = doc.buildings[0].floors[0]
    srcFloor.rooms.push({ id: 'rm-1', name: 'R1', number: '101', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, metadata: {} })
    const result = floorDuplicateHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors).toHaveLength(2)
    expect(doc.buildings[0].floors[1].rooms).toHaveLength(1)
    expect(doc.buildings[0].floors[1].rooms[0].id).not.toBe('rm-1')
    expect(doc.buildings[0].floors[1].label).toContain('copy')
  })
})

describe('change recording', () => {
  it('records change on room creation', () => {
    const doc = createDoc()
    roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: '101', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'room', operation: 'created' })
  })

  it('records change on road creation', () => {
    const doc = createDoc()
    roadCreateHandler.execute(doc, { name: 'Main Rd', points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'road', operation: 'created' })
  })

  it('records change on floor creation', () => {
    const doc = createDoc()
    floorCreateHandler.execute(doc, { buildingId: 'bld-1', label: 'Second' })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'floor', operation: 'created' })
  })

  it('records change on entity update', () => {
    const doc = createDoc()
    entityUpdateHandler.execute(doc, { entityId: 'bld-1', changes: { name: 'Renamed' } })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'building', operation: 'updated' })
  })
})
