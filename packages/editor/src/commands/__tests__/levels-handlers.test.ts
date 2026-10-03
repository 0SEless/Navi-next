import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building, Staircase, Elevator } from '@navi/core'
import {
  featureLevelUpdateHandler,
  featureLevelCopyHandler,
} from '../levels-handlers'

// P1-T9 (R2.6/R8.4/D19): stair/elevator features own cross-floor identity via
// `levels`. Per-floor placement commands touch ONLY the targeted floor's
// `levels` entry — moving a stair on F0 never auto-moves F1/F2 (no silent
// auto-sync, Q10). The copy/align tool is the EXPLICIT convenience, with
// undo support.

function makeStairFeature(): Staircase {
  return {
    id: 'stair-a',
    buildingId: 'bld-1',
    name: 'Stair A',
    type: 'open',
    accessible: true,
    fromLevel: 0,
    toLevel: 2,
    levels: {
      0: { position: { x: 10, y: 20 }, rotation: 0 },
      1: { position: { x: 10, y: 21 }, rotation: 0 },
      2: { position: { x: 11, y: 22 }, rotation: 90 },
    },
  }
}

function makeElevatorFeature(): Elevator {
  return {
    id: 'elev-a',
    buildingId: 'bld-1',
    name: 'Elev A',
    type: 'passenger',
    accessible: true,
    fromLevel: 0,
    toLevel: 1,
    levels: {
      0: { position: { x: 30, y: 20 }, rotation: 0 },
      1: { position: { x: 30, y: 21 }, rotation: 0 },
    },
  }
}

function createTestDoc(): CampusDocument {
  const building: Building = {
    id: 'bld-1',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    description: '',
    footprint: { points: [{ lat: 33.42, lng: -111.93 }, { lat: 33.421, lng: -111.93 }, { lat: 33.421, lng: -111.929 }, { lat: 33.42, lng: -111.929 }, { lat: 33.42, lng: -111.93 }] },
    baseElevation: 0,
    height: 20,
    floors: [
      { id: 'flr-0', level: 0, label: 'Ground', elevation: 0, height: 4, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
      { id: 'flr-1', level: 1, label: 'Floor 1', elevation: 4, height: 4, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
      { id: 'flr-2', level: 2, label: 'Floor 2', elevation: 8, height: 4, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} },
    ],
    verticalConnectors: [],
    aliases: [],
    color: '#ff0000',
    metadata: {},
  }
  building.staircases = [makeStairFeature()]
  building.elevators = [makeElevatorFeature()]
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'test-campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function getStair(doc: CampusDocument): Staircase {
  return doc.buildings[0].staircases![0]
}

describe('P1-T9: feature level placement handlers (R2.6/R8.4)', () => {
  // ── move per-level placement ──

  it('moving a stair placement on F0 changes ONLY F0; F1/F2 entries untouched (no auto-sync)', () => {
    const doc = createTestDoc()
    const before = JSON.parse(JSON.stringify(getStair(doc).levels))

    const result = featureLevelUpdateHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', floor: 0,
      patch: { position: { x: 99, y: 99 } },
    })
    expect(result.success).toBe(true)
    const levels = getStair(doc).levels
    expect(levels[0].position).toEqual({ x: 99, y: 99 })
    // F1/F2 byte-identical
    expect(levels[1]).toEqual(before[1])
    expect(levels[2]).toEqual(before[2])
  })

  it('update also patches rotation and validates LocalCoord positions', () => {
    const doc = createTestDoc()
    const ok = featureLevelUpdateHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', floor: 1,
      patch: { position: { x: 5, y: 6 }, rotation: 45 },
    })
    expect(ok.success).toBe(true)
    expect(getStair(doc).levels[1]).toEqual({ position: { x: 5, y: 6 }, rotation: 45 })

    const bad = featureLevelUpdateHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', floor: 1,
      patch: { position: { x: 'a' } as never },
    })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/position/i)
  })

  it('update inverse restores the F0 entry verbatim', () => {
    const doc = createTestDoc()
    const before = JSON.parse(JSON.stringify(getStair(doc).levels))
    const moved = featureLevelUpdateHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', floor: 0,
      patch: { position: { x: 99, y: 99 }, rotation: 180 },
    })
    const inverse = featureLevelUpdateHandler.inverse?.(
      { featureId: 'stair-a', featureType: 'staircase', floor: 0 }, moved,
    ) ?? null
    expect(inverse).not.toBeNull()
    const undone = featureLevelUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getStair(doc).levels))).toEqual(before)
  })

  it('update on a floor with no placement fails /not found/i and leaves the feature untouched', () => {
    const doc = createTestDoc()
    // levels has no floor 3
    const before = JSON.stringify(getStair(doc).levels)
    const missing = featureLevelUpdateHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', floor: 3,
      patch: { position: { x: 0, y: 0 } },
    })
    expect(missing.success).toBe(false)
    expect(missing.error).toMatch(/not found/i)
    expect(JSON.stringify(getStair(doc).levels)).toBe(before)
  })

  it('unknown feature / elevators addressed by featureType fail /not found/i', () => {
    const doc = createTestDoc()
    const ghost = featureLevelUpdateHandler.execute(doc, {
      featureId: 'stair-ghost', featureType: 'staircase', floor: 0,
      patch: { position: { x: 0, y: 0 } },
    })
    expect(ghost.success).toBe(false)
    expect(ghost.error).toMatch(/not found/i)

    // elevator addressed with correct type works; wrong type fails
    const wrongType = featureLevelUpdateHandler.execute(doc, {
      featureId: 'elev-a', featureType: 'staircase', floor: 0,
      patch: { position: { x: 0, y: 0 } },
    })
    expect(wrongType.success).toBe(false)
    expect(wrongType.error).toMatch(/not found/i)

    const elevOk = featureLevelUpdateHandler.execute(doc, {
      featureId: 'elev-a', featureType: 'elevator', floor: 0,
      patch: { position: { x: 31, y: 20 } },
    })
    expect(elevOk.success).toBe(true)
    expect(doc.buildings[0].elevators![0].levels[0].position).toEqual({ x: 31, y: 20 })
  })

  // ── copy / align-to-other-floor (explicit tool, D19/Q10) ──

  it('copy/align duplicates fromFloor onto a new floor; nothing else touched; undo removes it', () => {
    const doc = createTestDoc()
    const f0 = JSON.parse(JSON.stringify(getStair(doc).levels[0]))

    const copied = featureLevelCopyHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', fromFloor: 0, toFloor: 2,
    })
    expect(copied.success).toBe(true)
    const levels = getStair(doc).levels
    // levels[2] was already occupied → overwritten verbatim by the copy
    expect(levels[2]).toEqual(f0)
    expect(levels[0]).toEqual(f0)

    const inverse = featureLevelCopyHandler.inverse?.(
      { featureId: 'stair-a', featureType: 'staircase', fromFloor: 0, toFloor: 2 }, copied,
    ) ?? null
    expect(inverse).not.toBeNull()
    const undone = featureLevelCopyHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    // Prior F2 entry restored verbatim
    expect(getStair(doc).levels[2]).toEqual({ position: { x: 11, y: 22 }, rotation: 90 })
  })

  it('copy onto an ABSENT floor creates it; undo restores absence (key removed)', () => {
    const doc = createTestDoc()
    const before = JSON.parse(JSON.stringify(getStair(doc).levels))
    const copied = featureLevelCopyHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', fromFloor: 0, toFloor: 4,
    })
    expect(copied.success).toBe(true)
    expect(getStair(doc).levels[4]).toEqual(before[0])

    const inverse = featureLevelCopyHandler.inverse?.(
      { featureId: 'stair-a', featureType: 'staircase', fromFloor: 0, toFloor: 4 }, copied,
    ) ?? null
    const undone = featureLevelCopyHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getStair(doc).levels))).toEqual(before)
  })

  it('copy from a floor with no placement fails /not found/i', () => {
    const doc = createTestDoc()
    const before = JSON.stringify(getStair(doc).levels)
    const bad = featureLevelCopyHandler.execute(doc, {
      featureId: 'stair-a', featureType: 'staircase', fromFloor: 9, toFloor: 4,
    })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/not found/i)
    expect(JSON.stringify(getStair(doc).levels)).toBe(before)
  })
})