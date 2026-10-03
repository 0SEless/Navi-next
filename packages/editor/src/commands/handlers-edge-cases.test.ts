import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { buildingCreateHandler, buildingRenameHandler, buildingDeleteHandler } from './building-handlers'
import { floorCreateHandler, floorRenameHandler, floorDeleteHandler, floorDuplicateHandler } from './floor-handlers'
import { roomCreateHandler, roomRenameHandler, roomDeleteHandler } from './room-handlers'
import { hallwayCreateHandler, hallwayRenameHandler, hallwayDeleteHandler } from './hallway-handlers'
import { staircaseCreateHandler, staircaseDeleteHandler } from './staircase-handlers'
import { elevatorCreateHandler, elevatorDeleteHandler } from './elevator-handlers'
import { entranceCreateHandler, entranceDeleteHandler } from './entrance-handlers'
import { roadCreateHandler, roadRenameHandler, roadDeleteHandler } from './road-handlers'
import { panoramaCreateHandler, panoramaDeleteHandler } from './panorama-handlers'
import { qrCreateHandler, qrDeleteHandler } from './qr-handlers'

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

describe('building edge cases', () => {
  it('creates a building with default footprint and empty name', () => {
    const doc = createDoc()
    const result = buildingCreateHandler.execute(doc, { name: '', code: 'X' })
    expect(result.success).toBe(true)
    expect(doc.buildings).toHaveLength(2)
    expect(doc.buildings[1].name).toBe('')
    expect(doc.buildings[1].code).toBe('X')
    expect(doc.buildings[1].floors).toEqual([])
  })

  it('creates a building with custom footprint', () => {
    const doc = createDoc()
    const footprint = { points: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 1 }, { lat: 1, lng: 1 }] }
    const result = buildingCreateHandler.execute(doc, { name: 'B', code: 'B', footprint })
    expect(result.success).toBe(true)
    expect(doc.buildings[1].footprint).toEqual(footprint)
  })

  it('creates a building with specified id', () => {
    const doc = createDoc()
    const result = buildingCreateHandler.execute(doc, { id: 'bld-special', name: 'Special', code: 'S' })
    expect(result.success).toBe(true)
    expect(doc.buildings[1].id).toBe('bld-special')
  })

  it('renames a building', () => {
    const doc = createDoc()
    const result = buildingRenameHandler.execute(doc, { buildingId: 'bld-1', name: 'Renamed' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].name).toBe('Renamed')
  })

  it('fails renaming non-existent building', () => {
    const doc = createDoc()
    const result = buildingRenameHandler.execute(doc, { buildingId: 'nope', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('deletes a building', () => {
    const doc = createDoc()
    const result = buildingDeleteHandler.execute(doc, { buildingId: 'bld-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings).toHaveLength(0)
  })

  it('fails deleting non-existent building', () => {
    const doc = createDoc()
    const result = buildingDeleteHandler.execute(doc, { buildingId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('floor edge cases', () => {
  it('fails renaming non-existent floor', () => {
    const doc = createDoc()
    const result = floorRenameHandler.execute(doc, { floorId: 'nope', label: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent floor', () => {
    const doc = createDoc()
    const result = floorDeleteHandler.execute(doc, { floorId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails duplicating non-existent floor', () => {
    const doc = createDoc()
    const result = floorDuplicateHandler.execute(doc, { floorId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('adds floor to building with no floors', () => {
    const doc = createDoc()
    buildingCreateHandler.execute(doc, { id: 'bld-empty', name: 'Empty', code: 'E' })
    const result = floorCreateHandler.execute(doc, { buildingId: 'bld-empty', label: 'First' })
    expect(result.success).toBe(true)
    const bld = doc.buildings.find(b => b.id === 'bld-empty')!
    expect(bld.floors).toHaveLength(1)
    expect(bld.floors[0].label).toBe('First')
  })

  it('creates floor with auto-generated label when label is empty', () => {
    const doc = createDoc()
    const result = floorCreateHandler.execute(doc, { buildingId: 'bld-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[1].label).toContain('Floor')
  })

  it('creates floor with custom level', () => {
    const doc = createDoc()
    const result = floorCreateHandler.execute(doc, { buildingId: 'bld-1', label: 'Top', level: 10 })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[1].level).toBe(10)
    expect(doc.buildings[0].floors[1].label).toBe('Top')
  })

  it('duplicates a floor with rooms and hallways', () => {
    const doc = createDoc()
    const flr = doc.buildings[0].floors[0]
    flr.rooms.push({ id: 'rm-1', name: 'R1', number: '101', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, metadata: {} })
    flr.hallways.push({ id: 'hw-1', name: 'H1', polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, width: 3 })
    const result = floorDuplicateHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors).toHaveLength(2)
    expect(doc.buildings[0].floors[1].rooms).toHaveLength(1)
    expect(doc.buildings[0].floors[1].hallways).toHaveLength(1)
  })

  it('duplicates a floor with staircases', () => {
    const doc = createDoc()
    doc.buildings[0].floors[0].staircases.push({ id: 'st-1', name: 'S1', position: { x: 5, y: 5 }, fromLevel: 0, toLevel: 1, type: 'enclosed' })
    const result = floorDuplicateHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[1].staircases).toHaveLength(1)
    expect(doc.buildings[0].floors[1].staircases[0].id).not.toBe('st-1')
  })

  it('duplicates a floor with elevators', () => {
    const doc = createDoc()
    doc.buildings[0].floors[0].elevators.push({ id: 'el-1', name: 'E1', position: { x: 5, y: 5 }, fromLevel: 0, toLevel: 1 })
    const result = floorDuplicateHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[1].elevators).toHaveLength(1)
    expect(doc.buildings[0].floors[1].elevators[0].id).not.toBe('el-1')
  })

  it('duplicates a floor with entrances', () => {
    const doc = createDoc()
    doc.buildings[0].floors[0].entrances.push({ id: 'ent-1', label: 'Door', position: { lat: 0, lng: 0 } as any, level: 0, type: 'side', hasQR: true, hasPanorama: false })
    const result = floorDuplicateHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[1].entrances).toHaveLength(1)
    expect(doc.buildings[0].floors[1].entrances[0].id).not.toBe('ent-1')
  })

  it('duplicates a floor with all five entity types', () => {
    const doc = createDoc()
    const flr = doc.buildings[0].floors[0]
    flr.rooms.push({ id: 'rm-a', name: 'A', number: '1', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, metadata: {} })
    flr.hallways.push({ id: 'hw-a', name: 'A', polyline: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, width: 3 })
    flr.staircases.push({ id: 'st-a', name: 'A', position: { x: 0, y: 0 }, fromLevel: 0, toLevel: 1, type: 'enclosed' })
    flr.elevators.push({ id: 'el-a', name: 'A', position: { x: 0, y: 0 }, fromLevel: 0, toLevel: 1 })
    flr.entrances.push({ id: 'ent-a', label: 'A', position: { lat: 0, lng: 0 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false })
    const result = floorDuplicateHandler.execute(doc, { floorId: 'flr-1' })
    expect(result.success).toBe(true)
    const dup = doc.buildings[0].floors[1]
    expect(dup.rooms).toHaveLength(1)
    expect(dup.hallways).toHaveLength(1)
    expect(dup.staircases).toHaveLength(1)
    expect(dup.elevators).toHaveLength(1)
    expect(dup.entrances).toHaveLength(1)
  })

  it('deleting floor cascades its rooms and hallways', () => {
    const doc = createDoc()
    doc.buildings[0].floors[0].rooms.push({ id: 'rm-x', name: 'X', number: '', category: 'other', polygon: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, metadata: {} })
    doc.buildings[0].floors[0].hallways.push({ id: 'hw-x', name: 'X', polyline: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, width: 3 })
    floorDeleteHandler.execute(doc, { floorId: 'flr-1' })
    expect(doc.buildings[0].floors).toHaveLength(0)
  })
})

describe('room edge cases', () => {
  it('creates a room with exactly 3 points', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Tri', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms[0].polygon.points).toHaveLength(3)
  })

  it('fails when buildingId is valid but floorId is wrong', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'nope', name: 'X', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails when buildingId is wrong', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-1', name: 'X', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails renaming non-existent room', () => {
    const doc = createDoc()
    const result = roomRenameHandler.execute(doc, { roomId: 'nope', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent room', () => {
    const doc = createDoc()
    const result = roomDeleteHandler.execute(doc, { roomId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('renames a room with empty name', () => {
    const doc = createDoc()
    roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Old', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })
    const roomId = doc.buildings[0].floors[0].rooms[0].id
    const result = roomRenameHandler.execute(doc, { roomId, name: '' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms[0].name).toBe('')
  })

  it('fails with undefined points', () => {
    const doc = createDoc()
    const result = roomCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('at least 3 points')
  })
})

describe('hallway edge cases', () => {
  it('fails when building/floor not found', () => {
    const doc = createDoc()
    const result = hallwayCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails when buildingId valid but floorId wrong', () => {
    const doc = createDoc()
    const result = hallwayCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'nope', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('creates with exactly 2 points', () => {
    const doc = createDoc()
    const result = hallwayCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Min', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].hallways[0].polyline.points).toHaveLength(2)
  })

  it('fails renaming non-existent hallway', () => {
    const doc = createDoc()
    const result = hallwayRenameHandler.execute(doc, { hallwayId: 'nope', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent hallway', () => {
    const doc = createDoc()
    const result = hallwayDeleteHandler.execute(doc, { hallwayId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('staircase edge cases', () => {
  it('fails with invalid building/floor', () => {
    const doc = createDoc()
    const result = staircaseCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-1', name: 'X', position: { x: 0, y: 0 } })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent staircase', () => {
    const doc = createDoc()
    const result = staircaseDeleteHandler.execute(doc, { staircaseId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('creates with custom type', () => {
    const doc = createDoc()
    const result = staircaseCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Open', position: { x: 5, y: 5 }, type: 'open' })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].staircases[0].type).toBe('open')
  })

  it('creates with custom fromLevel and toLevel', () => {
    const doc = createDoc()
    const result = staircaseCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Multi', position: { x: 5, y: 5 }, fromLevel: 0, toLevel: 3 })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].staircases[0].fromLevel).toBe(0)
    expect(doc.buildings[0].floors[0].staircases[0].toLevel).toBe(3)
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = staircaseCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Staircase position')
  })
})

describe('elevator edge cases', () => {
  it('fails with invalid building/floor', () => {
    const doc = createDoc()
    const result = elevatorCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-1', name: 'X', position: { x: 0, y: 0 } })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent elevator', () => {
    const doc = createDoc()
    const result = elevatorDeleteHandler.execute(doc, { elevatorId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = elevatorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Elevator position')
  })

  it('creates with custom levels', () => {
    const doc = createDoc()
    const result = elevatorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', name: 'Fast', position: { x: 1, y: 1 }, fromLevel: 0, toLevel: 5 })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].elevators[0].fromLevel).toBe(0)
    expect(doc.buildings[0].floors[0].elevators[0].toLevel).toBe(5)
  })
})

describe('entrance edge cases', () => {
  it('fails with invalid building/floor', () => {
    const doc = createDoc()
    const result = entranceCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-1', label: 'X', position: { lat: 0, lng: 0 } as any })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent entrance', () => {
    const doc = createDoc()
    const result = entranceDeleteHandler.execute(doc, { entranceId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = entranceCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', label: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Entrance position')
  })

  it('creates with custom type, hasQR and hasPanorama', () => {
    const doc = createDoc()
    const result = entranceCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', label: 'Main', position: { lat: 0, lng: 0 } as any, type: 'main', hasQR: false, hasPanorama: true })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].entrances[0].type).toBe('main')
    expect(doc.buildings[0].floors[0].entrances[0].hasQR).toBe(false)
    expect(doc.buildings[0].floors[0].entrances[0].hasPanorama).toBe(true)
  })
})

describe('road edge cases', () => {
  it('creates a road with empty name', () => {
    const doc = createDoc()
    const result = roadCreateHandler.execute(doc, { name: '', points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] })
    expect(result.success).toBe(true)
    expect(doc.roads[0].name).toBe('')
  })

  it('creates a road with custom width and surface', () => {
    const doc = createDoc()
    const result = roadCreateHandler.execute(doc, { name: 'Dirt', points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }], width: 3, surface: 'unpaved', type: 'walkway' })
    expect(result.success).toBe(true)
    expect(doc.roads[0].width).toBe(3)
    expect(doc.roads[0].surface).toBe('unpaved')
    expect(doc.roads[0].type).toBe('walkway')
  })

  it('fails renaming non-existent road', () => {
    const doc = createDoc()
    const result = roadRenameHandler.execute(doc, { roadId: 'nope', name: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails deleting non-existent road', () => {
    const doc = createDoc()
    const result = roadDeleteHandler.execute(doc, { roadId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('panorama edge cases', () => {
  it('creates with buildingId and floor', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: 'View', position: { x: 0, y: 0 }, imageAssetId: 'img-1', buildingId: 'bld-1', floor: 1 })
    expect(result.success).toBe(true)
    expect(doc.panoramas[0].buildingId).toBe('bld-1')
    expect(doc.panoramas[0].floor).toBe(1)
  })

  it('creates without buildingId and floor defaults', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: 'NoBld', position: { lat: 0, lng: 0 } as any, imageAssetId: 'img-2' })
    expect(result.success).toBe(true)
    expect(doc.panoramas[0].buildingId).toBeUndefined()
    expect(doc.panoramas[0].floor).toBe(0)
  })

  it('creates with empty label', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: '', position: { lat: 0, lng: 0 } as any, imageAssetId: 'img-3' })
    expect(result.success).toBe(true)
    expect(doc.panoramas[0].label).toBe('')
  })

  it('creates with custom heading', () => {
    const doc = createDoc()
    const result = panoramaCreateHandler.execute(doc, { label: 'North', position: { lat: 0, lng: 0 } as any, imageAssetId: 'img-4', heading: 180 })
    expect(result.success).toBe(true)
    expect(doc.panoramas[0].heading).toBe(180)
  })

  it('fails deleting non-existent panorama', () => {
    const doc = createDoc()
    const result = panoramaDeleteHandler.execute(doc, { panoramaId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('qr checkpoint edge cases', () => {
  // P1-T13 (R10.1/D16/Q5): opaque payloads — code derived from id.
  it('creates with buildingId', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'Entrance', position: { lat: 0, lng: 0 } as any, buildingId: 'bld-1' })
    expect(result.success).toBe(true)
    expect(doc.qrCheckpoints[0].buildingId).toBe('bld-1')
    expect(doc.qrCheckpoints[0].code).toMatch(/^navi\.app\/q\//)
  })

  it('creates without buildingId (empty string)', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'Generic', position: { lat: 0, lng: 0 } as any })
    expect(result.success).toBe(true)
    expect(doc.qrCheckpoints[0].buildingId).toBe('')
  })

  it('creates with custom floor', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'L1', position: { lat: 0, lng: 0 } as any, floor: 1 })
    expect(result.success).toBe(true)
    expect(doc.qrCheckpoints[0].floor).toBe(1)
  })

  it('fails deleting non-existent QR', () => {
    const doc = createDoc()
    const result = qrDeleteHandler.execute(doc, { qrId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails without position', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'X' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('QR checkpoint position')
  })

  it('rejects non-opaque supplied codes (coordinates/legacy)', () => {
    const doc = createDoc()
    const result = qrCreateHandler.execute(doc, { label: 'X', position: { lat: 0, lng: 0 } as any, code: 'navi://x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('opaque')
  })
})

describe('cross-entity id uniqueness', () => {
  it('rename looks across all buildings for room', () => {
    const doc = createDoc()
    buildingCreateHandler.execute(doc, { id: 'bld-2', name: 'Second', code: 'S' })
    floorCreateHandler.execute(doc, { buildingId: 'bld-2', label: 'F1' })
    roomCreateHandler.execute(doc, { buildingId: 'bld-2', floorId: doc.buildings[1].floors[0].id, name: 'Cross', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })
    const roomId = doc.buildings[1].floors[0].rooms[0].id
    const result = roomRenameHandler.execute(doc, { roomId, name: 'CrossRenamed' })
    expect(result.success).toBe(true)
    expect(doc.buildings[1].floors[0].rooms[0].name).toBe('CrossRenamed')
  })

  it('delete looks across all buildings for hallway', () => {
    const doc = createDoc()
    buildingCreateHandler.execute(doc, { id: 'bld-2', name: 'Second', code: 'S' })
    floorCreateHandler.execute(doc, { buildingId: 'bld-2', label: 'F1' })
    const flrId = doc.buildings[1].floors[0].id
    hallwayCreateHandler.execute(doc, { buildingId: 'bld-2', floorId: flrId, name: 'Cross', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    const hwId = doc.buildings[1].floors[0].hallways[0].id
    const result = hallwayDeleteHandler.execute(doc, { hallwayId: hwId })
    expect(result.success).toBe(true)
    expect(doc.buildings[1].floors[0].hallways).toHaveLength(0)
  })
})
