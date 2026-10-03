import { describe, it, expect } from 'vitest'
import type { CampusDocument, LocalCoord, Wall } from '@navi/core'
import { getChangesSince } from '@navi/core'
import {
  wallSplitHandler,
  wallSplitUndoHandler,
  wallCrossingSplitHandler,
  wallCrossingSplitUndoHandler,
  wallTJunctionSplitHandler,
  wallMergeHandler,
  wallMergeUndoHandler,
} from '../wall-topology-handlers'
import { wallCreateHandler } from '../wall-handlers'

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
    // Override the auto-generated ID with the test ID
    doc.buildings[0].floors[0].walls!.at(-1)!.id = w.id
  }
  return doc
}

function getWalls(doc: CampusDocument): Wall[] {
  return doc.buildings[0].floors[0].walls || []
}

function pt(x: number, y: number): LocalCoord {
  return { x, y }
}

function expectPointClose(a: LocalCoord, b: LocalCoord, eps = 1e-6) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps)
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps)
}

// ── wall.split tests ──

describe('wall.split', () => {
  it('splits a wall at an interior point', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    expect(result.success).toBe(true)
    const walls = getWalls(doc)
    expect(walls).toHaveLength(2)

    // First segment: 0,0 → 5,0
    expectPointClose(walls[0].start, pt(0, 0))
    expectPointClose(walls[0].end, pt(5, 0))
    // Second segment: 5,0 → 10,0
    expectPointClose(walls[1].start, pt(5, 0))
    expectPointClose(walls[1].end, pt(10, 0))
  })

  it('preserves wall metadata after split', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])
    // Add metadata to the wall
    doc.buildings[0].floors[0].walls![0].metadata = { loadBearing: true, fireRating: '2hr' }
    doc.buildings[0].floors[0].walls![0].thickness = 0.3
    doc.buildings[0].floors[0].walls![0].height = 4.0

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const walls = getWalls(doc)
    expect(walls).toHaveLength(2)
    // Both segments inherit metadata and properties
    expect(walls[0].thickness).toBe(0.3)
    expect(walls[0].height).toBe(4.0)
    expect(walls[0].metadata?.loadBearing).toBe(true)
    expect(walls[0].metadata?.fireRating).toBe('2hr')
    expect(walls[1].thickness).toBe(0.3)
    expect(walls[1].metadata?.loadBearing).toBe(true)
  })

  it('records sourceWallId lineage on split segments', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const walls = getWalls(doc)
    expect(walls[0].metadata?.sourceWallId).toBe('w1')
    expect(walls[1].metadata?.sourceWallId).toBe('w1')
  })

  it('fails when point is at wall endpoint', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(0, 0),
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot split')
    expect(getWalls(doc)).toHaveLength(1)
  })

  it('fails when point is off the wall', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 5),
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot split')
  })

  it('fails when wall not found', () => {
    const doc = createDoc()
    const result = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'nonexistent', point: pt(5, 0),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Wall not found')
  })

  it('records changes', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })

    const changes = getChangesSince(doc, 0)
    expect(changes.length).toBeGreaterThanOrEqual(1)
    expect(changes.some(c => c.entityType === 'wall' && c.operation === 'updated')).toBe(true)
  })
})

// ── wall.split.undo tests ──

describe('wall.split.undo', () => {
  it('restores the original wall after undo', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const splitResult = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(5, 0),
    })
    expect(getWalls(doc)).toHaveLength(2)

    const inverseCmd = wallSplitHandler.inverse!({}, splitResult)
    expect(inverseCmd).not.toBeNull()
    const undoResult = wallSplitUndoHandler.execute(doc, inverseCmd!.payload)
    expect(undoResult.success).toBe(true)

    const walls = getWalls(doc)
    expect(walls).toHaveLength(1)
    expect(walls[0].id).toBe('w1')
    expectPointClose(walls[0].start, pt(0, 0))
    expectPointClose(walls[0].end, pt(10, 0))
  })
})

// ── wall.crossingSplit tests ──

describe('wall.crossingSplit', () => {
  it('splits two crossing walls at their intersection', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 5, ex: 10, ey: 5 },   // horizontal
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 10 },   // vertical
    ])

    const result = wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w2',
    })

    expect(result.success).toBe(true)
    const walls = getWalls(doc)
    // 4 segments: 2 from each original wall
    expect(walls).toHaveLength(4)
  })

  it('produces correct geometry for crossing split', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 5, ex: 10, ey: 5 },
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 10 },
    ])

    wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w2',
    })

    const walls = getWalls(doc)
    // Horizontal wall segments
    const horizSegs = walls.filter(w => w.start.y === 5 && w.end.y === 5)
    expect(horizSegs).toHaveLength(2)
    // Vertical wall segments
    const vertSegs = walls.filter(w => w.start.x === 5 && w.end.x === 5)
    expect(vertSegs).toHaveLength(2)

    // All meet at (5,5)
    const allPoints = walls.flatMap(w => [w.start, w.end])
    const at55 = allPoints.filter(p => Math.abs(p.x - 5) < 0.001 && Math.abs(p.y - 5) < 0.001)
    expect(at55.length).toBe(4) // each segment has one endpoint at intersection
  })

  it('records sourceWallId lineage for all segments', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 5, ex: 10, ey: 5 },
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 10 },
    ])

    wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w2',
    })

    const walls = getWalls(doc)
    const fromW1 = walls.filter(w => w.metadata?.sourceWallId === 'w1')
    const fromW2 = walls.filter(w => w.metadata?.sourceWallId === 'w2')
    expect(fromW1).toHaveLength(2)
    expect(fromW2).toHaveLength(2)
  })

  it('fails when walls do not cross', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 6, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w2',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('do not cross')
  })

  it('fails when same wall is specified twice', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w1',
    })

    // Same wall — segmentIntersection may find overlap but we handle it
    expect(result.success).toBe(false)
  })
})

// ── wall.crossingSplit.undo tests ──

describe('wall.crossingSplit.undo', () => {
  it('restores both original walls after undo', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 5, ex: 10, ey: 5 },
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 10 },
    ])

    const splitResult = wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w2',
    })
    expect(getWalls(doc)).toHaveLength(4)

    const inverseCmd = wallCrossingSplitHandler.inverse!({}, splitResult)
    expect(inverseCmd).not.toBeNull()
    const undoResult = wallCrossingSplitUndoHandler.execute(doc, inverseCmd!.payload)
    expect(undoResult.success).toBe(true)

    const walls = getWalls(doc)
    expect(walls).toHaveLength(2)
    expect(walls.some(w => w.id === 'w1')).toBe(true)
    expect(walls.some(w => w.id === 'w2')).toBe(true)
  })
})

// ── wall.tJunctionSplit tests ──

describe('wall.tJunctionSplit', () => {
  it('splits the host wall at the T-junction point', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },   // host wall (horizontal)
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 10 },   // wall ending at junction
    ])

    const result = wallTJunctionSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      hostWallId: 'w1',
      junctionPoint: pt(5, 0),
    })

    expect(result.success).toBe(true)
    const walls = getWalls(doc)
    // w1 split into 2, w2 unchanged = 3 total
    expect(walls).toHaveLength(3)

    // Host wall split correctly
    const hostSegs = walls.filter(w => w.id !== 'w2')
    expect(hostSegs).toHaveLength(2)
    expectPointClose(hostSegs[0].start, pt(0, 0))
    expectPointClose(hostSegs[0].end, pt(5, 0))
    expectPointClose(hostSegs[1].start, pt(5, 0))
    expectPointClose(hostSegs[1].end, pt(10, 0))
  })

  it('records sourceWallId on split host segments', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 10 },
    ])

    wallTJunctionSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      hostWallId: 'w1',
      junctionPoint: pt(5, 0),
    })

    const walls = getWalls(doc)
    const splitHost = walls.filter(w => w.id !== 'w2')
    expect(splitHost[0].metadata?.sourceWallId).toBe('w1')
    expect(splitHost[1].metadata?.sourceWallId).toBe('w1')
  })

  it('fails when junction point is not on the host wall', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallTJunctionSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      hostWallId: 'w1',
      junctionPoint: pt(5, 5),
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot split')
  })
})

// ── wall.merge tests ──

describe('wall.merge', () => {
  it('merges two collinear walls sharing an endpoint', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    expect(result.success).toBe(true)
    const walls = getWalls(doc)
    expect(walls).toHaveLength(1)
    expect(walls[0].id).toBe('w1') // first wall's ID preserved
    expectPointClose(walls[0].start, pt(0, 0))
    expectPointClose(walls[0].end, pt(10, 0))
  })

  it('merges three collinear walls into one', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 3, ey: 0 },
      { id: 'w2', sx: 3, sy: 0, ex: 7, ey: 0 },
      { id: 'w3', sx: 7, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2', 'w3'],
    })

    expect(result.success).toBe(true)
    const walls = getWalls(doc)
    expect(walls).toHaveLength(1)
    expect(walls[0].id).toBe('w1')
    expectPointClose(walls[0].start, pt(0, 0))
    expectPointClose(walls[0].end, pt(10, 0))
  })

  it('preserves metadata from the first wall', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])
    doc.buildings[0].floors[0].walls![0].metadata = { loadBearing: true }
    doc.buildings[0].floors[0].walls![0].thickness = 0.3

    wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const walls = getWalls(doc)
    expect(walls[0].thickness).toBe(0.3)
    expect(walls[0].metadata?.loadBearing).toBe(true)
  })

  it('records sourceWallIds lineage', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])

    wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const walls = getWalls(doc)
    expect(walls[0].metadata?.sourceWallIds).toEqual(['w1', 'w2'])
  })

  it('fails when walls are not collinear', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 5, ey: 5 },
    ])

    const result = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not collinear')
  })

  it('fails when walls are collinear but disjoint', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 3, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])

    const result = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not collinear')
  })

  it('fails with fewer than 2 wall IDs', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
    ])

    const result = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1'],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('At least two')
  })

  it('records changes', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])

    wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const changes = getChangesSince(doc, 0)
    expect(changes.length).toBeGreaterThanOrEqual(1)
  })
})

// ── wall.merge.undo tests ──

describe('wall.merge.undo', () => {
  it('restores original walls after undo', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
    ])

    const mergeResult = wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })
    expect(getWalls(doc)).toHaveLength(1)

    const inverseCmd = wallMergeHandler.inverse!({}, mergeResult)
    expect(inverseCmd).not.toBeNull()
    const undoResult = wallMergeUndoHandler.execute(doc, inverseCmd!.payload)
    expect(undoResult.success).toBe(true)

    const walls = getWalls(doc)
    expect(walls).toHaveLength(2)
    expect(walls.some(w => w.id === 'w1')).toBe(true)
    expect(walls.some(w => w.id === 'w2')).toBe(true)
    expectPointClose(walls.find(w => w.id === 'w1')!.start, pt(0, 0))
    expectPointClose(walls.find(w => w.id === 'w1')!.end, pt(5, 0))
    expectPointClose(walls.find(w => w.id === 'w2')!.start, pt(5, 0))
    expectPointClose(walls.find(w => w.id === 'w2')!.end, pt(10, 0))
  })
})

// ── Diagonal wall tests ──

describe('diagonal walls', () => {
  it('splits a diagonal wall at a midpoint', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 4, ey: 4 },
    ])

    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(2, 2),
    })

    const walls = getWalls(doc)
    expect(walls).toHaveLength(2)
    expectPointClose(walls[0].start, pt(0, 0))
    expectPointClose(walls[0].end, pt(2, 2))
    expectPointClose(walls[1].start, pt(2, 2))
    expectPointClose(walls[1].end, pt(4, 4))
  })

  it('crossing split on diagonal walls', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 10 },  // diagonal /
      { id: 'w2', sx: 0, sy: 10, ex: 10, ey: 0 },  // diagonal \
    ])

    const result = wallCrossingSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIdA: 'w1', wallIdB: 'w2',
    })

    expect(result.success).toBe(true)
    const walls = getWalls(doc)
    expect(walls).toHaveLength(4)

    // All 4 segments should meet at (5,5)
    const allPoints = walls.flatMap(w => [w.start, w.end])
    const at55 = allPoints.filter(p => Math.abs(p.x - 5) < 0.001 && Math.abs(p.y - 5) < 0.001)
    expect(at55.length).toBe(4)
  })

  it('merges diagonal collinear walls', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 3, ey: 3 },
      { id: 'w2', sx: 3, sy: 3, ex: 6, ey: 6 },
    ])

    wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const walls = getWalls(doc)
    expect(walls).toHaveLength(1)
    expectPointClose(walls[0].start, pt(0, 0))
    expectPointClose(walls[0].end, pt(6, 6))
  })
})

// ── Edge cases ──

describe('edge cases', () => {
  it('split near endpoint (within epsilon) is rejected', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    // 1e-11 is within the 1e-10 epsilon — treated as endpoint
    const result = wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(1e-11, 0),
    })

    expect(result.success).toBe(false)
  })

  it('merge of only collinear chains leaves non-collinear walls intact', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 5, ey: 0 },
      { id: 'w2', sx: 5, sy: 0, ex: 10, ey: 0 },
      { id: 'w3', sx: 5, sy: 0, ex: 5, ey: 5 },
    ])

    wallMergeHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallIds: ['w1', 'w2'],
    })

    const walls = getWalls(doc)
    // w1+w2 merged, w3 stays
    expect(walls).toHaveLength(2)
    expect(walls.some(w => w.id === 'w3')).toBe(true)
  })

  it('multiple splits produce correct segment count', () => {
    const doc = createDocWithWalls([
      { id: 'w1', sx: 0, sy: 0, ex: 10, ey: 0 },
    ])

    // Split at 3
    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: 'w1', point: pt(3, 0),
    })

    let walls = getWalls(doc)
    expect(walls).toHaveLength(2)

    // Split the right segment (w1-R) at 7 (which is at x=7 on the original)
    const rightSeg = walls.find(w => w.id === 'w1-R')!
    wallSplitHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      wallId: rightSeg.id, point: pt(7, 0),
    })

    walls = getWalls(doc)
    expect(walls).toHaveLength(3)

    // Should have segments: [0,3], [3,7], [7,10]
    const starts = walls.map(w => w.start.x).sort((a, b) => a - b)
    expect(starts).toEqual([0, 3, 7])
  })
})
