import { describe, expect, it } from 'vitest'
import type { CampusDocument, Wall } from '@navi/core'
import { deriveRooms } from '../../geometry/room-derivation'
import { wallsToSegments } from '../../geometry/wall-to-segment'
import {
  semanticRoomDeclareHandler,
  semanticRoomUpdateHandler,
  semanticRoomUnassignHandler,
} from '../semantic-room-handlers'

const walls: Wall[] = [
  { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 },
  { id: 'w2', start: { x: 10, y: 0 }, end: { x: 10, y: 8 }, thickness: 0.15, height: 3.5 },
  { id: 'w3', start: { x: 10, y: 8 }, end: { x: 0, y: 8 }, thickness: 0.15, height: 3.5 },
  { id: 'w4', start: { x: 0, y: 8 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3.5 },
]

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
        walls: walls.map((wall) => ({ ...wall, start: { ...wall.start }, end: { ...wall.end } })),
        rooms: [{
          id: 'legacy-room', name: 'Legacy Room', number: 'L-1', category: 'other',
          polygon: { points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }] },
          roomDoors: [], metadata: {},
        }],
        hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
      }],
      verticalConnectors: [],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function faceIdFor(doc: CampusDocument): string {
  const floor = doc.buildings[0].floors[0]
  const faceId = deriveRooms(wallsToSegments(floor.walls ?? []), [])[0]?.faceId
  if (!faceId) throw new Error('Test fixture did not produce a derived face ID')
  return faceId
}

describe('semantic Room command handlers', () => {
  it('declares canonical Room properties and defaults new Rooms to searchable', () => {
    const doc = createDoc()
    const faceId = faceIdFor(doc)

    const result = semanticRoomDeclareHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1', faceId,
      name: 'Computer Laboratory', type: 'laboratory', code: 'CL-101',
      description: 'A room for computing classes',
    })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].roomAttributes?.[0]).toMatchObject({
      faceId,
      roomId: result.entityId,
      name: 'Computer Laboratory',
      type: 'laboratory',
      code: 'CL-101',
      description: 'A room for computing classes',
      searchable: true,
    })
  })

  it('declares attributes for a derived face without creating a legacy polygon Room', () => {
    const doc = createDoc()
    const faceId = faceIdFor(doc)
    const originalWalls = JSON.stringify(doc.buildings[0].floors[0].walls)

    const result = semanticRoomDeclareHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1', faceId,
      name: 'Computer Laboratory', number: 'CL-101', category: 'laboratory', searchable: true,
    })

    expect(result.success).toBe(true)
    expect(result.entityId).toBeDefined()
    const floor = doc.buildings[0].floors[0]
    expect(floor.roomAttributes).toHaveLength(1)
    expect(floor.roomAttributes?.[0]).toMatchObject({ faceId, roomId: result.entityId, name: 'Computer Laboratory', number: 'CL-101', category: 'laboratory', searchable: true })
    expect(floor.rooms).toHaveLength(1)
    expect(floor.rooms[0].id).toBe('legacy-room')
    expect(JSON.stringify(floor.walls)).toBe(originalWalls)
  })

  it('updates semantic metadata and preserves identity fields', () => {
    const doc = createDoc()
    const faceId = faceIdFor(doc)
    const declared = semanticRoomDeclareHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', faceId, name: 'Old', searchable: false })
    const roomId = declared.entityId!

    const result = semanticRoomUpdateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1', roomId,
      changes: { name: 'New', number: 'N-2', category: 'office', searchable: true },
    })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].roomAttributes?.[0]).toMatchObject({ roomId, faceId, name: 'New', number: 'N-2', category: 'office', searchable: true })
  })

  it('updates canonical Room properties and preserves the derived geometry authority', () => {
    const doc = createDoc()
    const faceId = faceIdFor(doc)
    const originalWalls = JSON.stringify(doc.buildings[0].floors[0].walls)
    const declared = semanticRoomDeclareHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1', faceId, name: 'Old', searchable: true,
    })

    const result = semanticRoomUpdateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1', roomId: declared.entityId,
      changes: {
        name: 'Science Lab', type: 'laboratory', code: 'SCI-204',
        description: 'Chemistry and physics workspace', searchable: false,
      },
    })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].roomAttributes?.[0]).toMatchObject({
      roomId: declared.entityId,
      faceId,
      name: 'Science Lab',
      type: 'laboratory',
      code: 'SCI-204',
      description: 'Chemistry and physics workspace',
      searchable: false,
    })
    expect(JSON.stringify(doc.buildings[0].floors[0].walls)).toBe(originalWalls)
    expect(doc.buildings[0].floors[0].rooms).toHaveLength(1)
  })

  it('unassigns semantic metadata while leaving the derived wall face and legacy Rooms intact', () => {
    const doc = createDoc()
    const faceId = faceIdFor(doc)
    const declared = semanticRoomDeclareHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', faceId, name: 'Room', searchable: false })

    const result = semanticRoomUnassignHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', roomId: declared.entityId })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].roomAttributes ?? []).toHaveLength(0)
    expect(doc.buildings[0].floors[0].rooms).toHaveLength(1)
    expect(deriveRooms(wallsToSegments(doc.buildings[0].floors[0].walls ?? []), [])).toHaveLength(1)
  })

  it('rejects invalid or duplicate face declarations without mutating the document', () => {
    const doc = createDoc()
    const invalid = semanticRoomDeclareHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', faceId: 'face-invalid', name: 'Nope' })
    expect(invalid.success).toBe(false)
    expect(doc.buildings[0].floors[0].roomAttributes).toBeUndefined()

    const faceId = faceIdFor(doc)
    const first = semanticRoomDeclareHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', faceId, name: 'First' })
    const duplicate = semanticRoomDeclareHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', faceId, name: 'Second' })
    expect(first.success).toBe(true)
    expect(duplicate.success).toBe(false)
    expect(doc.buildings[0].floors[0].roomAttributes).toHaveLength(1)
    expect(doc.buildings[0].floors[0].roomAttributes?.[0].name).toBe('First')
  })
})
