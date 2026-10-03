import { describe, expect, it } from 'vitest'
import type { CampusDocument, LocalCoord, RoomAttributes, Wall } from '@navi/core'
import { deriveRooms } from '../geometry/room-derivation'
import { wallsToSegments } from '../geometry/wall-to-segment'
import { wallJunctionUpdateHandler } from './wall-junction-handlers'

function wall(id: string, start: LocalCoord, end: LocalCoord): Wall {
  return { id, start, end, thickness: 0.15, height: 3.5 }
}

function squareWalls(): Wall[] {
  return [
    wall('north', { x: 0, y: 0 }, { x: 10, y: 0 }),
    wall('east', { x: 10, y: 0 }, { x: 10, y: 10 }),
    wall('south', { x: 10, y: 10 }, { x: 0, y: 10 }),
    wall('west', { x: 0, y: 10 }, { x: 0, y: 0 }),
  ]
}

function createDoc(walls = squareWalls(), roomAttributes?: RoomAttributes[]): CampusDocument {
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
        walls, roomAttributes, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {},
      }],
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function squareFaceId(walls: Wall[]): string {
  const room = deriveRooms(wallsToSegments(walls), [])[0]
  expect(room?.faceId).toBeDefined()
  return room!.faceId!
}

describe('wall junction update command', () => {
  it('updates all supplied incident endpoints as one atomic mutation', () => {
    const doc = createDoc()

    const result = wallJunctionUpdateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      patches: [
        { wallId: 'north', patch: { end: { x: 11, y: -1 } } },
        { wallId: 'east', patch: { start: { x: 11, y: -1 } } },
      ],
    })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].walls?.find((candidate) => candidate.id === 'north')?.end).toEqual({ x: 11, y: -1 })
    expect(doc.buildings[0].floors[0].walls?.find((candidate) => candidate.id === 'east')?.start).toEqual({ x: 11, y: -1 })
    expect(doc.buildings[0].floors[0].rooms).toEqual([])
  })

  it('rejects a zero-length result without partially mutating the document', () => {
    const doc = createDoc([wall('north', { x: 0, y: 0 }, { x: 10, y: 0 })])
    const before = structuredClone(doc.buildings[0].floors[0].walls)

    const result = wallJunctionUpdateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      patches: [{ wallId: 'north', patch: { start: { x: 10, y: 0 } } }],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('non-zero length')
    expect(doc.buildings[0].floors[0].walls).toEqual(before)
  })

  it('keeps semantic RoomAttributes attached when wall IDs preserve the face topology', () => {
    const walls = squareWalls()
    const faceId = squareFaceId(walls)
    const attributes: RoomAttributes[] = [{ faceId, roomId: 'room-1', name: '101', searchable: true }]
    const doc = createDoc(walls, attributes)

    const result = wallJunctionUpdateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      patches: [
        { wallId: 'north', patch: { end: { x: 11, y: -1 } } },
        { wallId: 'east', patch: { start: { x: 11, y: -1 } } },
      ],
    })

    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].roomAttributes).toEqual(attributes)
    expect(squareFaceId(doc.buildings[0].floors[0].walls!)).toBe(faceId)
  })

  it('rejects an edit that would detach an assigned semantic face', () => {
    const walls = squareWalls()
    const faceId = squareFaceId(walls)
    const doc = createDoc(walls, [{ faceId, roomId: 'room-1', name: '101', searchable: true }])
    const before = structuredClone(doc.buildings[0].floors[0].walls)

    const result = wallJunctionUpdateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      patches: [{ wallId: 'east', patch: { start: { x: 10, y: 1 } } }],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('semantic Room')
    expect(doc.buildings[0].floors[0].walls).toEqual(before)
    expect(doc.buildings[0].floors[0].roomAttributes).toEqual([{ faceId, roomId: 'room-1', name: '101', searchable: true }])
  })

  it('returns an inverse command that restores the complete endpoint snapshot', () => {
    const doc = createDoc()
    const result = wallJunctionUpdateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      patches: [{ wallId: 'north', patch: { start: { x: -1, y: 0 }, end: { x: 11, y: 0 } } }],
    })

    const inverse = wallJunctionUpdateHandler.inverse?.({
      buildingId: 'bld-1',
      floorId: 'flr-1',
      patches: [{ wallId: 'north', patch: { start: { x: -1, y: 0 }, end: { x: 11, y: 0 } } }],
    }, result)

    expect(inverse).toEqual({
      id: 'wall.junction.update',
      label: 'Undo Move Wall Junction',
      payload: {
        buildingId: 'bld-1',
        floorId: 'flr-1',
        patches: [{ wallId: 'north', patch: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } }],
      },
    })
  })
})
