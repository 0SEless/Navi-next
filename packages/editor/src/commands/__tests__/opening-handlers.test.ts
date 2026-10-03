import { describe, it, expect } from 'vitest'
import type { CampusDocument, LocalCoord, Wall, Opening } from '@navi/core'
import { getChangesSince, serializeDocument, deserializeDocument } from '@navi/core'
import { openingCreateHandler, openingDeleteHandler } from '../feature-handlers'
import { wallCreateHandler } from '../wall-handlers'
import { wallSplitHandler, wallSplitUndoHandler, wallMergeHandler, wallMergeUndoHandler } from '../wall-topology-handlers'
import { deriveOpeningPosition, computeOffsetFromPosition } from '../../geometry/opening-position'

// ── Test helpers ──

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

// ── Position derivation tests ──

describe('opening position derivation', () => {
  it('derives position from wall geometry and offset', () => {
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 3.5, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    expect(pos.x).toBeCloseTo(3.5)
    expect(pos.y).toBeCloseTo(0)
  })

  it('derives position on diagonal wall', () => {
    // Wall length = sqrt(10^2 + 10^2) = sqrt(200) ≈ 14.14m
    // At offset 5: t = 5 / 14.14 ≈ 0.354 → position ≈ (3.54, 3.54)
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 5, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    const len = Math.sqrt(200)
    const expectedX = (10 / len) * 5
    expect(pos.x).toBeCloseTo(expectedX)
    expect(pos.y).toBeCloseTo(expectedX)
  })

  it('returns wall start when offset is 0', () => {
    const wall: Wall = { id: 'w1', start: { x: 2, y: 3 }, end: { x: 12, y: 3 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 0, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    expect(pos.x).toBeCloseTo(2)
    expect(pos.y).toBeCloseTo(3)
  })

  it('returns wall end when offset equals wall length', () => {
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 10, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    expect(pos.x).toBeCloseTo(10)
    expect(pos.y).toBeCloseTo(0)
  })

  it('handles degenerate wall (zero length)', () => {
    const wall: Wall = { id: 'w1', start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, thickness: 0.15, height: 3.5 }
    const opening: Opening = { id: 'o1', type: 'door', wallId: 'w1', offset: 3, width: 0.9 }

    const pos = deriveOpeningPosition(opening, wall)
    expect(pos.x).toBeCloseTo(5)
    expect(pos.y).toBeCloseTo(5)
  })

  it('computeOffsetFromPosition recovers offset', () => {
    const wall: Wall = { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }
    const position = { x: 4, y: 0 }

    const offset = computeOffsetFromPosition(position, wall)
    expect(offset).toBeCloseTo(4)
  })
})

// ── Opening creation tests ──

describe('opening.create', () => {
  it('creates an opening on a wall', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 3.5, width: 0.9 },
    })

    expect(result.success).toBe(true)
    expect(result.entityId).toBeDefined()
    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].id).toBe(result.entityId)
    expect(openings[0].type).toBe('door')
    expect(openings[0].wallId).toBe('w1')
    expect(openings[0].offset).toBe(3.5)
    expect(openings[0].width).toBe(0.9)
  })

  it('retains a finite authored door orientation', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 3.5, width: 0.9, orientation: -45 },
    })

    expect(result.success).toBe(true)
    expect(getOpenings(doc)[0].orientation).toBe(-45)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '45'])('rejects invalid orientation %s', orientation => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 3.5, width: 0.9, orientation },
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/orientation/i)
    expect(getOpenings(doc)).toHaveLength(0)
  })

  it('creates an opening with type window', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'window', wallId: 'w1', offset: 5, width: 1.2, sillHeight: 0.9 },
    })

    expect(result.success).toBe(true)
    const openings = getOpenings(doc)
    expect(openings[0].type).toBe('window')
    expect(openings[0].sillHeight).toBe(0.9)
  })

  it('rejects invalid opening type', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'skylight', wallId: 'w1', offset: 5, width: 1 },
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/type/i)
    expect(getOpenings(doc)).toHaveLength(0)
  })

  it('rejects missing wallId', () => {
    const doc = createDoc()
    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', offset: 5, width: 0.9 },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/wallId/i)
  })

  it('rejects negative offset', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: -1, width: 0.9 },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/offset/i)
  })

  it('rejects unknown building/floor', () => {
    const doc = createDoc()
    expect(openingCreateHandler.execute(doc, {
      buildingId: 'nope', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 0, width: 0.9 },
    }).success).toBe(false)
    expect(openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'nope',
      opening: { type: 'door', wallId: 'w1', offset: 0, width: 0.9 },
    }).success).toBe(false)
  })

  it('defaults width to 0.9 when omitted', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 5 },
    })
    expect(getOpenings(doc)[0].width).toBe(0.9)
  })

  it('records changes', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 5, width: 0.9 },
    })
    const changes = getChangesSince(doc, 0)
    expect(changes.some(c => c.entityType === 'opening' && c.operation === 'created')).toBe(true)
  })

  it('inverse creates the delete command', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    const result = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { type: 'door', wallId: 'w1', offset: 5, width: 0.9 },
    })
    const inverse = openingCreateHandler.inverse!({}, result)
    expect(inverse).not.toBeNull()
    expect(inverse!.id).toBe('opening.delete')
  })
})

// ── Opening deletion tests ──

describe('opening.delete', () => {
  it('deletes an opening', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 5, width: 0.9 },
    })
    expect(getOpenings(doc)).toHaveLength(1)

    const result = openingDeleteHandler.execute(doc, { openingId: 'o1' })
    expect(result.success).toBe(true)
    expect(getOpenings(doc)).toHaveLength(0)
  })

  it('fails for unknown opening', () => {
    const doc = createDoc()
    const result = openingDeleteHandler.execute(doc, { openingId: 'ghost' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('inverse re-creates the opening verbatim', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    const createRes = openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'window', wallId: 'w1', offset: 5, width: 1.2, orientation: 135, sillHeight: 0.9, metadata: { label: 'big' } },
    })
    const delRes = openingDeleteHandler.execute(doc, { openingId: 'o1' })
    expect(getOpenings(doc)).toHaveLength(0)

    const inverse = openingDeleteHandler.inverse!({}, delRes)
    expect(inverse).not.toBeNull()
    const undoRes = openingCreateHandler.execute(doc, inverse!.payload)
    expect(undoRes.success).toBe(true)
    const restored = getOpenings(doc)[0]
    expect(restored.id).toBe('o1')
    expect(restored.type).toBe('window')
    expect(restored.wallId).toBe('w1')
    expect(restored.offset).toBe(5)
    expect(restored.width).toBe(1.2)
    expect(restored.orientation).toBe(135)
    expect(restored.sillHeight).toBe(0.9)
    expect(restored.metadata).toEqual({ label: 'big' })
  })
})

// ── Opening migration on wall split ──

describe('opening migration on wall split', () => {
  it('opening on left segment stays on left child', () => {
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

  it('opening on right segment migrates with rebased offset', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 7, width: 0.9, orientation: 30 },
    })

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].wallId).toBe('w1-R')
    expect(openings[0].offset).toBeCloseTo(2) // 7 - 5 = 2
    expect(openings[0].orientation).toBe(30)
  })

  it('opening at split point is removed', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 5, width: 0.9 },
    })

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    expect(getOpenings(doc)).toHaveLength(0)
  })

  it('openings on other walls are unaffected', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
      { id: 'w2', sx: 0, sy: 5, ex: 10, ey: 5 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 3, width: 0.9 },
    })
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o2', type: 'window', wallId: 'w2', offset: 5, width: 1.2 },
    })

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(2)
    // o2 on w2 unaffected
    expect(openings.find(o => o.id === 'o2')!.wallId).toBe('w2')
  })

  it('split undo restores openings', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 7, width: 0.9, orientation: -90 },
    })

    const splitResult = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })
    // Opening migrated to w1-R
    expect(getOpenings(doc)[0].wallId).toBe('w1-R')

    // Undo the split
    const inverse = wallSplitHandler.inverse!({}, splitResult)
    wallSplitUndoHandler.execute(doc, inverse!.payload)

    // Opening restored to original wall
    const openings = getOpenings(doc)
    expect(openings).toHaveLength(1)
    expect(openings[0].wallId).toBe('w1')
    expect(openings[0].offset).toBe(7)
    expect(openings[0].orientation).toBe(-90)
  })
})

// ── Opening migration on wall merge ──

describe('opening migration on wall merge', () => {
  it('openings from both walls are preserved after merge', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 2, width: 0.9, orientation: 15 },
    })
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o2', type: 'window', wallId: 'w2', offset: 2, width: 1.2 },
    })

    wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(2)
    // Both openings now reference the merged wall (w1's ID)
    expect(openings[0].wallId).toBe('w1')
    expect(openings[1].wallId).toBe('w1')
    expect(openings[0].orientation).toBe(15)
  })

  it('merge undo restores openings', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 2, width: 0.9, orientation: 75 },
    })
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o2', type: 'window', wallId: 'w2', offset: 2, width: 1.2 },
    })

    const mergeResult = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const inverse = wallMergeHandler.inverse!({}, mergeResult)
    wallMergeUndoHandler.execute(doc, inverse!.payload)

    const openings = getOpenings(doc)
    expect(openings).toHaveLength(2)
    expect(openings[0].wallId).toBe('w1')
    expect(openings[1].wallId).toBe('w2')
    expect(openings[0].orientation).toBe(75)
  })
})

// ── Persistence round-trip ──

describe('opening persistence', () => {
  it('openings survive serialization round-trip', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o1', type: 'door', wallId: 'w1', offset: 5, width: 0.9, orientation: 42.5 },
    })
    openingCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      opening: { id: 'o2', type: 'window', wallId: 'w1', offset: 8, width: 1.2, sillHeight: 0.9 },
    })

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    const openings = restored.buildings[0].floors[0].openings
    expect(openings).toBeDefined()
    expect(openings).toHaveLength(2)
    expect(openings![0].id).toBe('o1')
    expect(openings![0].type).toBe('door')
    expect(openings![0].wallId).toBe('w1')
    expect(openings![0].offset).toBe(5)
    expect(openings![0].orientation).toBe(42.5)
    expect(openings![1].id).toBe('o2')
    expect(openings![1].type).toBe('window')
    expect(openings![1].sillHeight).toBe(0.9)
  })

  it('backward compat: old floors without openings are unaffected', () => {
    const doc = createDoc()
    // No openings set
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    // openings should be absent (additive optional, D12)
    expect(restored.buildings[0].floors[0].openings).toBeUndefined()
  })
})
