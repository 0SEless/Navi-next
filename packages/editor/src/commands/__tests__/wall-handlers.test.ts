import { describe, it, expect } from 'vitest'
import type { CampusDocument, LocalCoord } from '@navi/core'
import { getChangesSince } from '@navi/core'
import { wallCreateHandler, wallUpdateHandler, wallDeleteHandler } from '../wall-handlers'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      {
        id: 'bld-1', name: 'Building A', code: 'BA', category: 'academic', description: '',
        footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
        baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
        floors: [
          { id: 'flr-1', level: 0, label: 'Ground', elevation: 0, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
        ],
        verticalConnectors: [],
      },
      {
        id: 'bld-2', name: 'Building B', code: 'BB', category: 'academic', description: '',
        footprint: { points: [{ lat: 0.01, lng: 0 }, { lat: 0.01, lng: 0.001 }, { lat: 0.011, lng: 0.001 }, { lat: 0.011, lng: 0 }, { lat: 0.01, lng: 0 }] },
        baseElevation: 0, height: 15, color: '#D94A4A', aliases: [], metadata: {},
        floors: [
          { id: 'flr-2', level: 0, label: 'Ground', elevation: 0, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
        ],
        verticalConnectors: [],
      },
    ],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function createDocWithTwoFloors(): CampusDocument {
  const doc = createDoc()
  doc.buildings[0].floors.push({
    id: 'flr-1b', level: 1, label: 'Floor 2', elevation: 3.5, height: 3.5,
    rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
  })
  return doc
}

function getWall(doc: CampusDocument, buildingId: string, floorId: string, wallId: string) {
  const building = doc.buildings.find(b => b.id === buildingId)
  if (!building) throw new Error(`Building not found: ${buildingId}`)
  const floor = building.floors.find(f => f.id === floorId)
  if (!floor) throw new Error(`Floor not found: ${floorId}`)
  if (!floor.walls) throw new Error(`No walls on floor: ${floorId}`)
  const wall = floor.walls.find(w => w.id === wallId)
  if (!wall) throw new Error(`Wall not found: ${wallId}`)
  return wall
}

describe('wall.create', () => {
  it('creates a wall on a floor', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      thickness: 0.2,
      height: 3.5,
    })
    expect(result.success).toBe(true)
    expect(result.entityId).toBeDefined()

    const floor = doc.buildings[0].floors[0]
    expect(floor.walls).toHaveLength(1)
    expect(floor.walls![0].start).toEqual({ x: 0, y: 0 })
    expect(floor.walls![0].end).toEqual({ x: 10, y: 0 })
    expect(floor.walls![0].thickness).toBe(0.2)
    expect(floor.walls![0].height).toBe(3.5)
  })

  it('uses default thickness and height when omitted', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    expect(result.success).toBe(true)
    const wall = doc.buildings[0].floors[0].walls![0]
    expect(wall.thickness).toBe(0.15)
    expect(wall.height).toBe(3.5)
  })

  it('creates a wall with metadata', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      metadata: { loadBearing: true },
    })
    expect(result.success).toBe(true)
    const wall = doc.buildings[0].floors[0].walls![0]
    expect(wall.metadata).toEqual({ loadBearing: true })
  })

  it('fails when building not found', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'nope',
      floorId: 'flr-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Building not found')
  })

  it('fails when floor not found', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'nope',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Floor not found')
  })

  it('fails when start or end missing', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('required')
  })

  it('records a change', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entityType: 'wall', operation: 'created' })
  })

  it('inverse returns wall.delete', () => {
    const doc = createDoc()
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    const inverse = wallCreateHandler.inverse!(
      { buildingId: 'bld-1', floorId: 'flr-1' },
      result,
    )
    expect(inverse).not.toBeNull()
    expect(inverse!.id).toBe('wall.delete')
  })
})

describe('wall.update', () => {
  it('updates wall start and end', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    const result = wallUpdateHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
      patch: { start: { x: 5, y: 5 }, end: { x: 15, y: 5 } },
    })
    expect(result.success).toBe(true)
    const wall = doc.buildings[0].floors[0].walls![0]
    expect(wall.start).toEqual({ x: 5, y: 5 })
    expect(wall.end).toEqual({ x: 15, y: 5 })
  })

  it('updates thickness and height', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    const result = wallUpdateHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
      patch: { thickness: 0.3, height: 4.0 },
    })
    expect(result.success).toBe(true)
    const wall = doc.buildings[0].floors[0].walls![0]
    expect(wall.thickness).toBe(0.3)
    expect(wall.height).toBe(4.0)
  })

  it('updates metadata', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    const result = wallUpdateHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
      patch: { metadata: { fireRating: '2hr' } },
    })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].walls![0].metadata).toEqual({ fireRating: '2hr' })
  })

  it('fails when wall not found', () => {
    const doc = createDoc()
    // Floor has no walls yet, so error is "No walls on floor"
    const result = wallUpdateHandler.execute(doc, {
      wallId: 'wall-ghost', buildingId: 'bld-1', floorId: 'flr-1',
      patch: { start: { x: 0, y: 0 } },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No walls')
  })

  it('fails when wall not found on a floor with walls', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const result = wallUpdateHandler.execute(doc, {
      wallId: 'wall-ghost', buildingId: 'bld-1', floorId: 'flr-1',
      patch: { start: { x: 0, y: 0 } },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Wall not found')
  })

  it('fails when patch missing', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id
    const result = wallUpdateHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('patch')
  })

  it('inverse restores snapshot', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15,
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    const result = wallUpdateHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
      patch: { start: { x: 99, y: 99 }, thickness: 0.5 },
    })

    const inverse = wallUpdateHandler.inverse!(
      { wallId, buildingId: 'bld-1', floorId: 'flr-1' },
      result,
    )
    expect(inverse).not.toBeNull()
    expect(inverse!.id).toBe('wall.update')

    const undone = wallUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    const wall = doc.buildings[0].floors[0].walls![0]
    expect(wall.start).toEqual({ x: 0, y: 0 })
    expect(wall.thickness).toBe(0.15)
  })

  it('records a change', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    wallUpdateHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
      patch: { end: { x: 20, y: 0 } },
    })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(2) // create + update
    expect(changes[1]).toMatchObject({ entityType: 'wall', operation: 'updated' })
  })
})

describe('wall.delete', () => {
  it('deletes a wall from the correct floor', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    const result = wallDeleteHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
    })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].walls).toHaveLength(0)
  })

  it('fails when wall not found', () => {
    const doc = createDoc()
    // Floor has no walls yet, so error is "No walls on floor"
    const result = wallDeleteHandler.execute(doc, {
      wallId: 'wall-ghost', buildingId: 'bld-1', floorId: 'flr-1',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No walls')
  })

  it('fails when wall not found on a floor with walls', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const result = wallDeleteHandler.execute(doc, {
      wallId: 'wall-ghost', buildingId: 'bld-1', floorId: 'flr-1',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Wall not found')
  })

  it('fails when floor has no walls', () => {
    const doc = createDoc()
    const result = wallDeleteHandler.execute(doc, {
      wallId: 'wall-1', buildingId: 'bld-1', floorId: 'flr-1',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No walls')
  })

  it('inverse restores the deleted wall', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2,
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    const result = wallDeleteHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
    })
    expect(doc.buildings[0].floors[0].walls).toHaveLength(0)

    const inverse = wallDeleteHandler.inverse!(
      { wallId, buildingId: 'bld-1', floorId: 'flr-1' },
      result,
    )
    expect(inverse).not.toBeNull()
    expect(inverse!.id).toBe('wall.create')

    const undone = wallCreateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(doc.buildings[0].floors[0].walls).toHaveLength(1)
    expect(doc.buildings[0].floors[0].walls![0].start).toEqual({ x: 0, y: 0 })
    expect(doc.buildings[0].floors[0].walls![0].thickness).toBe(0.2)
  })

  it('records a change', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    const wallId = doc.buildings[0].floors[0].walls![0].id

    wallDeleteHandler.execute(doc, {
      wallId, buildingId: 'bld-1', floorId: 'flr-1',
    })
    const changes = getChangesSince(doc, 0)
    expect(changes).toHaveLength(2) // create + delete
    expect(changes[1]).toMatchObject({ entityType: 'wall', operation: 'deleted' })
  })
})

describe('floor isolation', () => {
  it('wall on Floor 1 does not appear on Floor 2', () => {
    const doc = createDocWithTwoFloors()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })

    const floor1 = doc.buildings[0].floors.find(f => f.id === 'flr-1')!
    const floor2 = doc.buildings[0].floors.find(f => f.id === 'flr-1b')!

    expect(floor1.walls).toHaveLength(1)
    expect(floor2.walls).toBeUndefined()
  })

  it('walls on different floors are independent', () => {
    const doc = createDocWithTwoFloors()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1b',
      start: { x: 5, y: 5 }, end: { x: 15, y: 5 },
    })

    const floor1 = doc.buildings[0].floors.find(f => f.id === 'flr-1')!
    const floor2 = doc.buildings[0].floors.find(f => f.id === 'flr-1b')!

    expect(floor1.walls).toHaveLength(1)
    expect(floor2.walls).toHaveLength(1)
    expect(floor1.walls![0].start).toEqual({ x: 0, y: 0 })
    expect(floor2.walls![0].start).toEqual({ x: 5, y: 5 })
  })
})

describe('building isolation', () => {
  it('wall in Building A does not mutate Building B', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })

    expect(doc.buildings[0].floors[0].walls).toHaveLength(1)
    expect(doc.buildings[1].floors[0].walls).toBeUndefined()
  })

  it('walls in separate buildings are independent', () => {
    const doc = createDoc()
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-2', floorId: 'flr-2',
      start: { x: 5, y: 5 }, end: { x: 15, y: 5 },
    })

    expect(doc.buildings[0].floors[0].walls).toHaveLength(1)
    expect(doc.buildings[1].floors[0].walls).toHaveLength(1)

    wallDeleteHandler.execute(doc, {
      wallId: doc.buildings[0].floors[0].walls![0].id,
      buildingId: 'bld-1', floorId: 'flr-1',
    })

    expect(doc.buildings[0].floors[0].walls).toHaveLength(0)
    expect(doc.buildings[1].floors[0].walls).toHaveLength(1)
  })
})

describe('backward compatibility', () => {
  it('CampusDocument without walls still works', () => {
    const doc = createDoc()
    expect(doc.buildings[0].floors[0].walls).toBeUndefined()

    // Existing operations still work
    const result = wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].walls).toHaveLength(1)
  })

  it('updating a floor without walls array initializes it', () => {
    const doc = createDoc()
    expect(doc.buildings[0].floors[0].walls).toBeUndefined()

    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
    })
    expect(doc.buildings[0].floors[0].walls).toBeDefined()
    expect(doc.buildings[0].floors[0].walls).toHaveLength(1)
  })
})
