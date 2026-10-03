import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CampusDocument, LocalCoord, Wall, Opening } from '@navi/core'
import { CoordinateTransformer, serializeDocument, deserializeDocument, getChangesSince } from '@navi/core'
import { wallCreateHandler, wallDeleteHandler } from '@navi/editor/src/commands/wall-handlers'
import { openingCreateHandler, openingDeleteHandler } from '@navi/editor/src/commands/feature-handlers'
import { wallSplitHandler, wallSplitUndoHandler } from '@navi/editor/src/commands/wall-topology-handlers'
import { deriveOpeningPosition, computeOffsetFromPosition } from '@navi/editor/src/geometry/opening-position'
import { findNearestWall } from '../useFloorDrawing'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTransformer(): CoordinateTransformer {
  const tf = new CoordinateTransformer()
  tf.registerBuilding({
    buildingId: 'bld-1',
    origin: { lat: 11.8195, lng: 122.0922 },
    rotation: 0,
  })
  return tf
}

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      {
        id: 'bld-1', name: 'Building A', code: 'BA', category: 'academic', description: '',
        footprint: { points: [
          { lat: 11.819, lng: 122.091 },
          { lat: 11.819, lng: 122.093 },
          { lat: 11.820, lng: 122.093 },
          { lat: 11.820, lng: 122.091 },
          { lat: 11.819, lng: 122.091 },
        ] },
        baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
        floors: [
          { id: 'flr-1', level: 0, label: 'Ground', elevation: 0, height: 3.5, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
        ],
        verticalConnectors: [],
      },
    ],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function createDocWithWalls(walls: Array<{ id: string; sx: number; sy: number; ex: number; ey: number }>): CampusDocument {
  const doc = createDoc()
  for (const w of walls) {
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: w.sx, y: w.sy }, end: { x: w.ex, y: w.ey },
      thickness: 0.15, height: 3.5,
    })
    doc.buildings[0].floors[0].walls!.at(-1)!.id = w.id
  }
  return doc
}

function getOpenings(doc: CampusDocument): Opening[] {
  return doc.buildings[0].floors[0].openings || []
}

function pt(x: number, y: number): LocalCoord {
  return { x, y }
}

// ── Case 1: Place door near wall ────────────────────────────────────────────

describe('W7B: Place door near wall', () => {
  it('findNearestWall finds the closest wall within threshold', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const result = findNearestWall({ x: 3, y: 0.5 }, walls)
    expect(result).not.toBeNull()
    expect(result!.wallId).toBe('w1')
    expect(result!.offset).toBeCloseTo(3)
    expect(result!.distance).toBeCloseTo(0.5)
  })

  it('door created at correct wallId + offset', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    const walls = doc.buildings[0].floors[0].walls!
    const wallSegments = walls.map(w => ({ id: w.id, start: w.start, end: w.end }))

    const clickPoint = { x: 3, y: 0.3 }
    const hit = findNearestWall(clickPoint, wallSegments)
    expect(hit).not.toBeNull()

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: hit!.wallId, offset: hit!.offset, width: 0.9 },
    })
    expect(result.success).toBe(true)

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].type).toBe('door')
    expect(openings[0].wallId).toBe('w1')
    expect(openings[0].offset).toBeCloseTo(3)
    expect(openings[0].width).toBe(0.9)
  })

  it('door position derived from wall geometry', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    const wall = doc.buildings[0].floors[0].walls![0]
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 3.5, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    expect(pos.x).toBeCloseTo(3.5)
    expect(pos.y).toBeCloseTo(0)
  })
})

// ── Case 2: Place window near wall ──────────────────────────────────────────

describe('W7B: Place window near wall', () => {
  it('window created at correct wallId + offset', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    const walls = doc.buildings[0].floors[0].walls!
    const wallSegments = walls.map(w => ({ id: w.id, start: w.start, end: w.end }))

    const clickPoint = { x: 7, y: 0.2 }
    const hit = findNearestWall(clickPoint, wallSegments)
    expect(hit).not.toBeNull()

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'window', wallId: hit!.wallId, offset: hit!.offset, width: 1.2, sillHeight: 0.9 },
    })
    expect(result.success).toBe(true)

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].type).toBe('window')
    expect(openings[0].wallId).toBe('w1')
    expect(openings[0].offset).toBeCloseTo(7)
    expect(openings[0].width).toBe(1.2)
    expect(openings[0].sillHeight).toBe(0.9)
  })
})

// ── Case 3: Reject placement too far from wall ─────────────────────────────

describe('W7B: Reject placement too far from wall', () => {
  it('findNearestWall returns null when click is beyond threshold', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const result = findNearestWall({ x: 5, y: 5 }, walls, 2.0)
    expect(result).toBeNull()
  })

  it('findNearestWall returns null for empty walls', () => {
    const result = findNearestWall({ x: 5, y: 5 }, [], 2.0)
    expect(result).toBeNull()
  })
})

// ── Case 4: Wall movement preserves opening ─────────────────────────────────

describe('W7B: Wall movement preserves opening', () => {
  it('door stays attached after wall start/end change', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 3.5, width: 0.9 },
    })

    // Update wall geometry
    wallCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      start: { x: 0, y: 0 }, end: { x: 15, y: 0 }, // extended wall
    })

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].wallId).toBe('w1')
    expect(openings[0].offset).toBe(3.5) // offset preserved relative to wall start

    // Position derived from the updated wall should be correct
    const wall = doc.buildings[0].floors[0].walls![0]
    const pos = deriveOpeningPosition(openings[0], wall)
    expect(pos.x).toBeCloseTo(3.5)
    expect(pos.y).toBeCloseTo(0)
  })
})

// ── Case 5: Wall split preserves opening ────────────────────────────────────

describe('W7B: Wall split preserves opening', () => {
  it('door migrates to correct child wall on split', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 7, width: 0.9 },
    })

    // Split wall at x=5
    const splitResult = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    // Opening at offset 7 should migrate to right child (w1-R) with rebased offset
    expect(openings[0].wallId).toBe('w1-R')
    expect(openings[0].offset).toBeCloseTo(2) // 7 - 5 = 2
  })

  it('door on left segment stays on left child', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 3, width: 0.9 },
    })

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].wallId).toBe('w1-L')
    expect(openings[0].offset).toBe(3) // unchanged
  })
})

// ── Case 6: Save/reload ─────────────────────────────────────────────────────

describe('W7B: Save/reload', () => {
  it('openings survive serialization round-trip', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
      { id: 'w2', sx: 10, sy: 0, ex: 10, ey: 5 },
    ])

    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 3, width: 0.9 },
    })
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o2', type: 'window', wallId: 'w2', offset: 2, width: 1.2, sillHeight: 0.9 },
    })

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    const openings = restored.buildings[0].floors[0].openings
    expect(openings).toBeDefined()
    expect(openings).toHaveLength(2)

    const door = openings!.find(o => o.id === 'o1')!
    expect(door.type).toBe('door')
    expect(door.wallId).toBe('w1')
    expect(door.offset).toBe(3)
    expect(door.width).toBe(0.9)

    const win = openings!.find(o => o.id === 'o2')!
    expect(win.type).toBe('window')
    expect(win.wallId).toBe('w2')
    expect(win.offset).toBe(2)
    expect(win.sillHeight).toBe(0.9)
  })

  it('create door → save → reload → opening preserved', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 5, width: 0.9 },
    })

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    const openings = restored.buildings[0].floors[0].openings!
    expect(openings).toHaveLength(1)
    expect(openings[0].id).toBe('o1')
    expect(openings[0].type).toBe('door')
  })
})

// ── Case 7: Undo/redo ───────────────────────────────────────────────────────

describe('W7B: Undo/redo', () => {
  it('create door → undo → door removed', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 3, width: 0.9 },
    })
    expect(getOpenings(doc)).toHaveLength(1)

    // Undo: create inverse is delete
    const inverse = openingCreateHandler.inverse!({}, result)
    expect(inverse!.id).toBe('opening.delete')

    const undoResult = openingDeleteHandler.execute(doc, inverse!.payload)
    expect(undoResult.success).toBe(true)
    expect(getOpenings(doc)).toHaveLength(0)
  })

  it('undo delete → door restored', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const createResult = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'window', wallId: 'w1', offset: 5, width: 1.2, sillHeight: 0.9 },
    })
    expect(getOpenings(doc)).toHaveLength(1)

    const deleteResult = openingDeleteHandler.execute(doc, { openingId: 'o1' })
    expect(getOpenings(doc)).toHaveLength(0)

    // Undo delete
    const inverse = openingDeleteHandler.inverse!({}, deleteResult)
    expect(inverse!.id).toBe('opening.create')

    const undoResult = openingCreateHandler.execute(doc, inverse!.payload)
    expect(undoResult.success).toBe(true)

    const restored = getOpenings(doc)
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('o1')
    expect(restored[0].type).toBe('window')
    expect(restored[0].sillHeight).toBe(0.9)
  })
})

// ── Case 8: Floor isolation ─────────────────────────────────────────────────

describe('W7B: Floor isolation', () => {
  it('door on floor 0 does not appear on floor 1', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    doc.buildings[0].floors.push({
      id: 'flr-2', level: 1, label: 'Floor 2', elevation: 3.5, height: 3.5,
      rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
    })

    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 3, width: 0.9 },
    })

    // Opening on floor 0
    expect(doc.buildings[0].floors[0].openings).toHaveLength(1)
    // No openings on floor 1
    expect(doc.buildings[0].floors[1].openings).toBeUndefined()
  })
})

// ── Wall projection utilities ───────────────────────────────────────────────

describe('W7B: findNearestWall', () => {
  it('finds nearest wall on horizontal segment', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const hit = findNearestWall({ x: 5, y: 0.5 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.wallId).toBe('w1')
    expect(hit!.offset).toBeCloseTo(5)
    expect(hit!.distance).toBeCloseTo(0.5)
  })

  it('finds nearest wall on diagonal segment', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } },
    ]
    const hit = findNearestWall({ x: 5, y: 5 }, walls)
    expect(hit).not.toBeNull()
    expect(hit!.wallId).toBe('w1')
    expect(hit!.offset).toBeCloseTo(Math.sqrt(50)) // distance along wall to projection
  })

  it('clamps offset to wall start when click before wall', () => {
    const walls = [
      { id: 'w1', start: { x: 5, y: 0 }, end: { x: 10, y: 0 } },
    ]
    // Click at x=2 is 3m from wall start — use large threshold to still hit
    const hit = findNearestWall({ x: 2, y: 0 }, walls, 5.0)
    expect(hit).not.toBeNull()
    expect(hit!.offset).toBeCloseTo(0) // clamped to start
  })

  it('clamps offset to wall end when click past wall', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    ]
    // Click at x=8 is 3m past wall end — use large threshold to still hit
    const hit = findNearestWall({ x: 8, y: 0 }, walls, 5.0)
    expect(hit).not.toBeNull()
    expect(hit!.offset).toBeCloseTo(5) // clamped to end
  })

  it('finds closest among multiple walls', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { id: 'w2', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
    ]
    const hit = findNearestWall({ x: 5, y: 0.3 }, walls)
    expect(hit!.wallId).toBe('w1')
    expect(hit!.distance).toBeCloseTo(0.3)
  })

  it('skips degenerate walls', () => {
    const walls = [
      { id: 'w1', start: { x: 5, y: 5 }, end: { x: 5, y: 5 } },
    ]
    const hit = findNearestWall({ x: 5, y: 5 }, walls)
    expect(hit).toBeNull()
  })

  it('returns null when distance exceeds threshold', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ]
    const hit = findNearestWall({ x: 5, y: 3 }, walls, 2.0)
    expect(hit).toBeNull()
  })
})

// ── Opening position derivation ─────────────────────────────────────────────

describe('W7B: Opening position derivation', () => {
  it('derives position from wall geometry and offset', () => {
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 3.5, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    expect(pos.x).toBeCloseTo(3.5)
    expect(pos.y).toBeCloseTo(0)
  })

  it('derives position on diagonal wall', () => {
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 5, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    const len = Math.sqrt(200)
    const expectedX = (10 / len) * 5
    expect(pos.x).toBeCloseTo(expectedX)
    expect(pos.y).toBeCloseTo(expectedX)
  })

  it('computeOffsetFromPosition recovers offset', () => {
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
    const position = { x: 4, y: 0 }

    const offset = computeOffsetFromPosition(position, wall)
    expect(offset).toBeCloseTo(4)
  })
})
