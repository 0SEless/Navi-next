/**
 * Phase 3 — Canonical Connectivity Semantics Tests
 *
 * 17 mandatory semantic tests for the connectivity contract.
 * These tests define the authoritative behavior of the contract.
 */
import { describe, expect, it } from 'vitest'
import type { CampusDocument, Road, RoadJunction, SeparatedCrossing } from '@navi/core'
import {
  extractConnectivitySemantics,
  areRoadsConnected,
  areRoadsSeparated,
  junctionsForRoad,
  CONNECTIVITY_CONTRACT_VERSION,
} from '@navi/core'
import type { ConnectivitySemantics } from '@navi/core'

// ── Test Helpers ────────────────────────────────────────────────

function makeRoad(id: string, points?: Array<{ lat: number; lng: number }>): Road {
  return {
    id,
    name: id,
    polyline: { points: points ?? [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }] },
    width: 8,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
  }
}

function makeJunction(id: string, roadIds: string[], source?: 'authored' | 'legacy-inferred'): RoadJunction {
  return {
    id,
    position: { lat: 0, lng: 0 },
    roadIds,
    source,
  }
}

function makeSeparated(
  id: string,
  roadIds: [string, string],
  position: { lat: number; lng: number } = { lat: 0, lng: 0 },
): SeparatedCrossing {
  return {
    id,
    position,
    roadIds,
  }
}

function makeDocument(
  roads: Road[],
  junctions?: RoadJunction[],
  separatedCrossings?: SeparatedCrossing[],
): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: '',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: junctions,
    separatedCrossings,
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: Two-road junction
// ═══════════════════════════════════════════════════════════════

describe('Connectivity Semantics Contract', () => {
  it('Test 1: two-road junction produces one canonical junction with stable ID', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')],
      [makeJunction('j-1', ['road-a', 'road-b'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].id).toBe('j-1')
    expect(semantics.junctions[0].roadIds).toEqual(['road-a', 'road-b'])
    expect(semantics.junctions[0].source).toBe('authored')
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 2: Three-road shared junction
  // ═══════════════════════════════════════════════════════════════

  it('Test 2: three-road junction produces ONE shared semantic junction', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b'), makeRoad('road-c')],
      [makeJunction('j-shared', ['road-a', 'road-b', 'road-c'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].id).toBe('j-shared')
    expect(semantics.junctions[0].roadIds).toHaveLength(3)
    expect(semantics.junctions[0].roadIds).toEqual(expect.arrayContaining(['road-a', 'road-b', 'road-c']))
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(true)
    expect(areRoadsConnected(semantics, 'road-b', 'road-c')).toBe(true)
    expect(areRoadsConnected(semantics, 'road-a', 'road-c')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 3: Four-road shared junction
  // ═══════════════════════════════════════════════════════════════

  it('Test 3: four-road junction has stable deterministic participation', () => {
    const doc = makeDocument(
      [makeRoad('a'), makeRoad('b'), makeRoad('c'), makeRoad('d')],
      [makeJunction('j-4way', ['a', 'b', 'c', 'd'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].roadIds).toHaveLength(4)
    // All pairs connected
    expect(areRoadsConnected(semantics, 'a', 'b')).toBe(true)
    expect(areRoadsConnected(semantics, 'a', 'c')).toBe(true)
    expect(areRoadsConnected(semantics, 'a', 'd')).toBe(true)
    expect(areRoadsConnected(semantics, 'b', 'c')).toBe(true)
    expect(areRoadsConnected(semantics, 'b', 'd')).toBe(true)
    expect(areRoadsConnected(semantics, 'c', 'd')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 4: Close distinct junctions remain distinct
  // ═══════════════════════════════════════════════════════════════

  it('Test 4: close distinct junctions remain distinct by stable ID', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b'), makeRoad('road-c')],
      [
        makeJunction('j-near-1', ['road-a', 'road-b'], 'authored'),
        makeJunction('j-near-2', ['road-a', 'road-c'], 'authored'),
      ],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(2)
    const ids = semantics.junctions.map(j => j.id)
    expect(ids).toContain('j-near-1')
    expect(ids).toContain('j-near-2')
    // They are distinct
    expect(ids[0]).not.toBe(ids[1])
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 5: Navigation-only road participant
  // ═══════════════════════════════════════════════════════════════

  it('Test 5: navigation-only road is valid junction participant', () => {
    const navRoad = makeRoad('road-nav')
    navRoad.displayMode = 'navigation-only'
    const doc = makeDocument(
      [navRoad, makeRoad('road-vis')],
      [makeJunction('j-nav', ['road-nav', 'road-vis'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].roadIds).toEqual(expect.arrayContaining(['road-nav', 'road-vis']))
    expect(areRoadsConnected(semantics, 'road-nav', 'road-vis')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 6: Deleted road reference — junction survives with remaining roads
  // ═══════════════════════════════════════════════════════════════

  it('Test 6: junction with deleted road reference survives with remaining valid roads', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')], // road-c is deleted
      [makeJunction('j-mixed', ['road-a', 'road-c', 'road-b'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    // Junction should survive with [road-a, road-b] after road-c is removed
    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].roadIds).toEqual(expect.arrayContaining(['road-a', 'road-b']))
    expect(semantics.junctions[0].roadIds).not.toContain('road-c')
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 7: Invalid junction — all roads deleted
  // ═══════════════════════════════════════════════════════════════

  it('Test 7: junction with all roads deleted is excluded', () => {
    const doc = makeDocument(
      [makeRoad('road-x')], // road-a and road-b are deleted
      [makeJunction('j-dead', ['road-a', 'road-b'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(0)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 8: Duplicate road IDs normalized
  // ═══════════════════════════════════════════════════════════════

  it('Test 8: duplicate road IDs are deduplicated', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')],
      [makeJunction('j-dup', ['road-a', 'road-a', 'road-b'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].roadIds).toEqual(['road-a', 'road-b'])
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 9: Separated crossing preserved
  // ═══════════════════════════════════════════════════════════════

  it('Test 9: separated crossing is explicit negative connectivity preserved', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')],
      undefined,
      [makeSeparated('sc-1', ['road-a', 'road-b'])],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.separatedCrossings).toHaveLength(1)
    expect(semantics.separatedCrossings[0].id).toBe('sc-1')
    expect(areRoadsSeparated(semantics, 'road-a', 'road-b')).toBe(true)
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(false)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 10: Multiple separated crossings
  // ═══════════════════════════════════════════════════════════════

  it('Test 10: multiple separated crossings preserve all stable identities', () => {
    const doc = makeDocument(
      [makeRoad('a'), makeRoad('b'), makeRoad('c')],
      undefined,
      [
        makeSeparated('sc-ab', ['a', 'b']),
        makeSeparated('sc-ac', ['a', 'c']),
      ],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.separatedCrossings).toHaveLength(2)
    const ids = semantics.separatedCrossings.map(sc => sc.id)
    expect(ids).toContain('sc-ab')
    expect(ids).toContain('sc-ac')
    expect(areRoadsSeparated(semantics, 'a', 'b')).toBe(true)
    expect(areRoadsSeparated(semantics, 'a', 'c')).toBe(true)
  })

  it('Test 10b: the same road pair preserves separated crossings at distinct positions', () => {
    const p1 = { lat: 14.0005, lng: 121.00025 }
    const p2 = { lat: 14.0005, lng: 121.00075 }
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')],
      undefined,
      [
        makeSeparated('sc-p1', ['road-a', 'road-b'], p1),
        makeSeparated('sc-p2', ['road-a', 'road-b'], p2),
      ],
    )

    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.separatedCrossings).toHaveLength(2)
    expect(semantics.separatedCrossings.map(sc => sc.id)).toEqual(['sc-p1', 'sc-p2'])
    expect(semantics.separatedCrossings.map(sc => sc.position)).toEqual([p1, p2])
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 11: Junction vs Separation conflict — separation wins
  // ═══════════════════════════════════════════════════════════════

  it('Test 11: SeparatedCrossing wins over RoadJunction for same road pair', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')],
      [makeJunction('j-conflict', ['road-a', 'road-b'], 'authored')],
      [makeSeparated('sc-conflict', ['road-a', 'road-b'])],
    )
    const semantics = extractConnectivitySemantics(doc)

    // Separation wins — junction is excluded
    expect(semantics.junctions).toHaveLength(0)
    expect(semantics.separatedCrossings).toHaveLength(1)
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(false)
    expect(areRoadsSeparated(semantics, 'road-a', 'road-b')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 12: Geometric crossing without explicit semantics
  // ═══════════════════════════════════════════════════════════════

  it('Test 12: geometric crossing with no explicit semantics produces empty result', () => {
    // Roads that cross geometrically but have no junction/separation records
    const doc = makeDocument([
      makeRoad('road-a', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }]),
      makeRoad('road-b', [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }]),
    ])
    const semantics = extractConnectivitySemantics(doc)

    // No explicit semantics → no junctions, no separations
    expect(semantics.junctions).toHaveLength(0)
    expect(semantics.separatedCrossings).toHaveLength(0)
    // Geometric crossing alone does NOT imply connectivity
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(false)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 13: Repeated normalization is stable/deterministic
  // ═══════════════════════════════════════════════════════════════

  it('Test 13: repeated normalization produces identical results', () => {
    const doc = makeDocument(
      [makeRoad('a'), makeRoad('b'), makeRoad('c')],
      [makeJunction('j-1', ['a', 'b'], 'authored')],
      [makeSeparated('sc-1', ['b', 'c'])],
    )
    const first = extractConnectivitySemantics(doc)
    const second = extractConnectivitySemantics(doc)

    expect(first.junctions).toEqual(second.junctions)
    expect(first.separatedCrossings).toEqual(second.separatedCrossings)
    expect(first.version).toBe(second.version)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 14: Input order does not change result
  // ═══════════════════════════════════════════════════════════════

  it('Test 14: reordering roads and records does not change semantic topology', () => {
    const roads1 = [makeRoad('a'), makeRoad('b'), makeRoad('c')]
    const roads2 = [makeRoad('c'), makeRoad('a'), makeRoad('b')]
    const junctions1 = [makeJunction('j-2', ['a', 'b'], 'authored'), makeJunction('j-1', ['b', 'c'], 'authored')]
    const junctions2 = [makeJunction('j-1', ['b', 'c'], 'authored'), makeJunction('j-2', ['a', 'b'], 'authored')]

    const doc1 = makeDocument(roads1, junctions1)
    const doc2 = makeDocument(roads2, junctions2)

    const s1 = extractConnectivitySemantics(doc1)
    const s2 = extractConnectivitySemantics(doc2)

    expect(s1.junctions).toEqual(s2.junctions)
    expect(s1.separatedCrossings).toEqual(s2.separatedCrossings)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 15: Phase 1 persistence regression
  // ═══════════════════════════════════════════════════════════════

  it('Test 15: extractConnectivitySemantics works with persisted junction source', () => {
    const doc = makeDocument(
      [makeRoad('road-a'), makeRoad('road-b')],
      [makeJunction('j-persisted', ['road-a', 'road-b'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.version).toBe(CONNECTIVITY_CONTRACT_VERSION)
    expect(semantics.campusId).toBe('test-campus')
    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].source).toBe('authored')
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 16: Phase 2 preview/commit parity
  // ═══════════════════════════════════════════════════════════════

  it('Test 16: query helpers agree with raw semantics', () => {
    const doc = makeDocument(
      [makeRoad('a'), makeRoad('b'), makeRoad('c')],
      [makeJunction('j-1', ['a', 'b'], 'authored')],
      [makeSeparated('sc-1', ['b', 'c'])],
    )
    const semantics = extractConnectivitySemantics(doc)

    // areRoadsConnected matches junction list
    expect(areRoadsConnected(semantics, 'a', 'b')).toBe(true)
    expect(areRoadsConnected(semantics, 'a', 'c')).toBe(false)

    // areRoadsSeparated matches crossing list
    expect(areRoadsSeparated(semantics, 'b', 'c')).toBe(true)
    expect(areRoadsSeparated(semantics, 'a', 'b')).toBe(false)

    // junctionsForRoad matches junction list
    const aJunctions = junctionsForRoad(semantics, 'a')
    expect(aJunctions).toHaveLength(1)
    expect(aJunctions[0].id).toBe('j-1')

    const cJunctions = junctionsForRoad(semantics, 'c')
    expect(cJunctions).toHaveLength(0)
  })

  // ═══════════════════════════════════════════════════════════════
  // TEST 17: Junction with only one valid road is excluded
  // ═══════════════════════════════════════════════════════════════

  it('Test 17: junction with only one valid road remaining is excluded', () => {
    const doc = makeDocument(
      [makeRoad('road-a')], // road-b is deleted
      [makeJunction('j-single', ['road-a', 'road-b'], 'authored')],
    )
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(0)
  })

  // ═══════════════════════════════════════════════════════════════
  // Edge case: multi-road junction with some roads separated
  // ═══════════════════════════════════════════════════════════════

  it('Edge case: multi-road junction with one separated pair is excluded', () => {
    const doc = makeDocument(
      [makeRoad('a'), makeRoad('b'), makeRoad('c')],
      [makeJunction('j-abc', ['a', 'b', 'c'], 'authored')],
      [makeSeparated('sc-ab', ['a', 'b'])],
    )
    const semantics = extractConnectivitySemantics(doc)

    // The junction connects a-b (separated), b-c, a-c
    // Since a-b pair is separated, the entire junction is excluded
    expect(semantics.junctions).toHaveLength(0)
    expect(areRoadsConnected(semantics, 'a', 'b')).toBe(false)
    expect(areRoadsConnected(semantics, 'b', 'c')).toBe(false) // junction excluded entirely
  })

  // ═══════════════════════════════════════════════════════════════
  // Edge case: empty document
  // ═══════════════════════════════════════════════════════════════

  it('Edge case: empty document produces empty semantics', () => {
    const doc = makeDocument([])
    const semantics = extractConnectivitySemantics(doc)

    expect(semantics.junctions).toHaveLength(0)
    expect(semantics.separatedCrossings).toHaveLength(0)
    expect(semantics.version).toBe(CONNECTIVITY_CONTRACT_VERSION)
  })
})
