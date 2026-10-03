/**
 * Phase 2 — Road Preview / Commit Parity Tests
 *
 * Characterization tests that PROVE the existing discrepancy between
 * the commit path (snapRoadEndpoints / snapPoint) and the shared
 * service (findConnectivityCandidates) used by the preview path.
 *
 * FAILING tests = assert what parity SHOULD look like (broken today)
 * PASSING tests = document the current broken behavior
 *
 * Root cause:
 *   road-snap.ts snapRoadEndpoints()  → passes `undefined` for junctions
 *   road-snap.ts snapPoint()          → passes `undefined` for junctions
 *   findConnectivityCandidates()      → accepts junctions, snaps to them
 *
 * Once fixed, the failing tests should pass and the passing tests
 * may need updating to reflect the corrected behavior.
 */
import { describe, expect, it } from 'vitest'
import type { Road, RoadJunction } from '@navi/core'
import {
  snapRoadEndpoints,
  snapPoint,
  findConnectivityCandidates,
} from '../commands/road-snap'

// ── Test Data ─────────────────────────────────────────────────

/**
 * Geometry:
 *
 *   Road A: east-west at lat 0, from lng -0.001 to lng 0.001 (~222m)
 *   Road B: parallel at lat 0.001 (~111m north)
 *
 *   Junction j-1: at (0.00001, 0.0003) — ~1.1m NORTH of Road A, ~33m east.
 *   This junction is OFF Road A's polyline (1.1m north).
 *
 *   Cursor at (0.000008, 0.0003):
 *     - Distance to junction j-1: ~0.22m
 *     - Distance to Road A segment: ~0.89m
 *     - Junction clearly wins — no ambiguity
 *
 *   Road segment snap: (0, 0.0003) — on Road A at lat 0
 *   Junction snap:     (0.00001, 0.0003) — at junction, 1.1m north
 *
 *   These positions differ by ~1.1m — enough to distinguish in tests.
 */

const ROAD_A: Road = {
  id: 'road-a',
  name: 'Road A',
  polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

const ROAD_B: Road = {
  id: 'road-b',
  name: 'Road B',
  polyline: { points: [{ lat: 0.001, lng: -0.001 }, { lat: 0.001, lng: 0.001 }] },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

const JUNCTION: RoadJunction = {
  id: 'j-1',
  position: { lat: 0.00001, lng: 0.0003 },
  roadIds: ['road-a', 'road-b'],
}

// ══════════════════════════════════════════════════════════════
// SUITE 1: Junction parity — commit path uses junctions
// ══════════════════════════════════════════════════════════════

describe('Suite 1 — Junction parity', () => {
  it('[PASSING] findConnectivityCandidates snaps to junction (preview path works)', () => {
    // Preview path: findConnectivityCandidates WITH junctions.
    // This is the correct behavior — junctions are considered.
    const cursor = { lat: 0.000008, lng: 0.0003 }
    const result = findConnectivityCandidates(cursor, {
      roads: [ROAD_A],
      junctions: [JUNCTION],
    })
    expect(result.best).not.toBeNull()
    expect(result.best!.kind).toBe('existing-junction')
    expect(result.best!.junctionId).toBe('j-1')
    expect(result.best!.position).toEqual(JUNCTION.position)
  })

  it('[FIXED] snapRoadEndpoints should snap to junction when junctions exist', () => {
    // FIX: snapRoadEndpoints now accepts junctions parameter.
    // With junctions passed, it snaps to the junction position.
    const points = [
      { lat: 0.000008, lng: 0.0003 },
      { lat: 0.0005, lng: 0.001 },
    ]
    const result = snapRoadEndpoints(points, [ROAD_A], [JUNCTION])

    // With junctions forwarded, snap should be at junction position
    expect(result.snapped).toBe(true)
    expect(result.points[0]).toEqual(JUNCTION.position)
  })

  it('[FIXED] snapPoint should snap to junction when junctions exist', () => {
    // FIX: snapPoint now accepts junctions parameter.
    // With junctions passed, it snaps to the junction position.
    const cursor = { lat: 0.000008, lng: 0.0003 }
    const result = snapPoint(cursor, [ROAD_A], [JUNCTION])

    // With junctions forwarded, snap should be at junction position
    expect(result).toEqual(JUNCTION.position)
  })

  it('[PASSING] snapRoadEndpoints without junctions snaps to road segment (documents bug)', () => {
    // Documents current broken state: junctions are invisible.
    // The cursor is equidistant from junction and road, but junction wins
    // in findConnectivityCandidates due to priority boost.
    // In snapRoadEndpoints, junctions aren't passed, so road segment wins.
    const points = [
      { lat: 0.000008, lng: 0.0003 },
      { lat: 0.0005, lng: 0.001 },
    ]
    const result = snapRoadEndpoints(points, [ROAD_A])

    if (result.snapped) {
      // Current behavior: snaps to road segment at lat ~0
      expect(result.points[0].lat).toBeCloseTo(0, 5)
      // NOT at junction (lat ~0.00001)
      expect(result.points[0].lat).not.toBeCloseTo(0.00001, 5)
    }
  })
})

// ══════════════════════════════════════════════════════════════
// SUITE 2: Simple road snap parity
// ══════════════════════════════════════════════════════════════

describe('Suite 2 — Simple road snap parity', () => {
  it('[PASSING] snapRoadEndpoints and findConnectivityCandidates agree on simple snap', () => {
    // No junctions involved — both paths should produce the same result.
    const cursor = { lat: 0.000004, lng: 0 }
    const farPoint = { lat: 0.0005, lng: 0.001 }

    const snapResult = snapRoadEndpoints([cursor, farPoint], [ROAD_A])
    const candidateResult = findConnectivityCandidates(cursor, {
      roads: [ROAD_A],
    })

    expect(snapResult.snapped).toBe(true)
    expect(candidateResult.best).not.toBeNull()

    if (snapResult.snapped && candidateResult.best) {
      expect(snapResult.points[0].lat).toBeCloseTo(
        candidateResult.best.position.lat,
        6,
      )
      expect(snapResult.points[0].lng).toBeCloseTo(
        candidateResult.best.position.lng,
        6,
      )
    }
  })

  it('[PASSING] snapPoint and findConnectivityCandidates agree on simple snap', () => {
    const cursor = { lat: 0.000004, lng: 0 }

    const snapped = snapPoint(cursor, [ROAD_A])
    const candidate = findConnectivityCandidates(cursor, {
      roads: [ROAD_A],
    })

    expect(candidate.best).not.toBeNull()
    if (candidate.best) {
      expect(snapped.lat).toBeCloseTo(candidate.best.position.lat, 6)
      expect(snapped.lng).toBeCloseTo(candidate.best.position.lng, 6)
    }
  })
})

// ══════════════════════════════════════════════════════════════
// SUITE 3: Alt bypass parity
// ══════════════════════════════════════════════════════════════

describe('Suite 3 — Alt bypass parity', () => {
  it('[PASSING] findConnectivityCandidates bypass returns original', () => {
    const point = { lat: 0.000004, lng: 0 }
    const result = findConnectivityCandidates(point, {
      roads: [ROAD_A],
      bypass: true,
    })
    expect(result.bypassed).toBe(true)
    expect(result.position).toEqual(point)
    expect(result.candidates).toHaveLength(0)
  })

  it('[PASSING] snapRoadEndpoints with no roads returns original', () => {
    const points = [
      { lat: 0.000004, lng: 0 },
      { lat: 0.0005, lng: 0.001 },
    ]
    const result = snapRoadEndpoints(points, [])
    expect(result.snapped).toBe(false)
    expect(result.points).toEqual(points)
  })

  it('[PASSING] snapPoint with no roads returns original', () => {
    const point = { lat: 0.000004, lng: 0 }
    expect(snapPoint(point, [])).toEqual(point)
  })

  it('[PASSING] snapPoint snaps when not bypassed, findConnectivityCandidates returns original when bypassed', () => {
    const point = { lat: 0.000004, lng: 0 }

    const snapped = snapPoint(point, [ROAD_A])
    const candidate = findConnectivityCandidates(point, {
      roads: [ROAD_A],
      bypass: true,
    })

    expect(candidate.bypassed).toBe(true)
    expect(candidate.position).toEqual(point)
    // snapPoint without bypass should snap
    expect(snapped.lat).not.toBe(point.lat)
  })
})

// ══════════════════════════════════════════════════════════════
// SUITE 4: Ambiguity parity
// ══════════════════════════════════════════════════════════════

describe('Suite 4 — Ambiguity parity', () => {
  const ROAD_C: Road = {
    ...ROAD_A,
    id: 'road-c',
    name: 'Road C',
  }

  it('[PASSING] findConnectivityCandidates flags ambiguous', () => {
    const cursor = { lat: 0.000004, lng: 0 }
    const result = findConnectivityCandidates(cursor, {
      roads: [ROAD_A, ROAD_C],
    })
    expect(result.ambiguous).toBe(true)
    expect(result.position).toEqual(cursor)
  })

  it('[PASSING] snapPoint returns original when ambiguous', () => {
    const cursor = { lat: 0.000004, lng: 0 }
    expect(snapPoint(cursor, [ROAD_A, ROAD_C])).toEqual(cursor)
  })

  it('[PASSING] snapRoadEndpoints does not snap when ambiguous', () => {
    const points = [
      { lat: 0.000004, lng: 0 },
      { lat: 0.0005, lng: 0.001 },
    ]
    const result = snapRoadEndpoints(points, [ROAD_A, ROAD_C])
    expect(result.points[0]).toEqual(points[0])
  })
})

// ══════════════════════════════════════════════════════════════
// SUITE 5: No candidate parity
// ══════════════════════════════════════════════════════════════

describe('Suite 5 — No candidate parity', () => {
  it('[PASSING] findConnectivityCandidates returns original when no road near', () => {
    const far = { lat: 0.005, lng: 0.005 }
    const result = findConnectivityCandidates(far, { roads: [ROAD_A] })
    expect(result.best).toBeNull()
    expect(result.position).toEqual(far)
  })

  it('[PASSING] snapRoadEndpoints returns original when no road near', () => {
    const far = { lat: 0.005, lng: 0.005 }
    const result = snapRoadEndpoints([far, { lat: 0.005, lng: 0.006 }], [ROAD_A])
    expect(result.snapped).toBe(false)
    expect(result.points).toEqual([far, { lat: 0.005, lng: 0.006 }])
  })

  it('[PASSING] snapPoint returns original when no road near', () => {
    const far = { lat: 0.005, lng: 0.005 }
    expect(snapPoint(far, [ROAD_A])).toEqual(far)
  })

  it('[PASSING] both paths agree: no snap when far from all roads', () => {
    const far = { lat: 0.005, lng: 0.005 }
    expect(snapPoint(far, [ROAD_A])).toEqual(far)
    const candidate = findConnectivityCandidates(far, { roads: [ROAD_A] })
    expect(candidate.best).toBeNull()
    expect(candidate.position).toEqual(far)
  })
})

// ══════════════════════════════════════════════════════════════
// SUITE 6: Core parity — preview vs commit disagree
// ══════════════════════════════════════════════════════════════

describe('Suite 6 — Core parity gap', () => {
  it('[PASSING] findConnectivityCandidates prefers junction (preview works)', () => {
    const cursor = { lat: 0.000008, lng: 0.0003 }
    const result = findConnectivityCandidates(cursor, {
      roads: [ROAD_A],
      junctions: [JUNCTION],
    })
    expect(result.best!.kind).toBe('existing-junction')
    expect(result.best!.position).toEqual(JUNCTION.position)
  })

  it('[FIXED] snapPoint should prefer junction when junctions are passed', () => {
    // FIX: snapPoint now accepts junctions, so it sees both Road A and the junction.
    // Preview (findConnectivityCandidates): snaps to junction at (0.00001, 0.0003)
    // Commit (snapPoint with junctions): also snaps to junction at (0.00001, 0.0003)
    const cursor = { lat: 0.000008, lng: 0.0003 }

    const snapped = snapPoint(cursor, [ROAD_A], [JUNCTION])
    const candidate = findConnectivityCandidates(cursor, {
      roads: [ROAD_A],
      junctions: [JUNCTION],
    })

    // PREVIEW says: snap to junction
    expect(candidate.best!.position).toEqual(JUNCTION.position)

    // COMMIT also says: snap to junction (parity achieved)
    expect(snapped).toEqual(JUNCTION.position)
  })

  it('[FAILING] snapRoadEndpoints should forward junctions to findConnectivityCandidates', () => {
    // After fix, snapRoadEndpoints should accept junctions and forward them.
    // This test will fail until the API is updated.
    const points = [
      { lat: 0.000008, lng: 0.0003 },
      { lat: 0.0005, lng: 0.001 },
    ]

    // FIXED API: snapRoadEndpoints(points, roads, junctions, radiusMeters)
    // Now junctions can be passed — this should snap to JUNCTION.position.

    const result = snapRoadEndpoints(points, [ROAD_A], [JUNCTION])

    // With junctions forwarded, snap should be at junction position
    expect(result.points[0]).toEqual(JUNCTION.position)
  })

  it('[PASSING] both paths agree when no junctions exist (parity holds for road-only snap)', () => {
    // When no junctions are involved, both paths produce the same result.
    // This proves the algorithm itself is consistent — the gap is ONLY about
    // junction forwarding.
    const cursor = { lat: 0.000004, lng: 0 }

    const snapped = snapPoint(cursor, [ROAD_A])
    const candidate = findConnectivityCandidates(cursor, {
      roads: [ROAD_A],
      // No junctions — same as what snapPoint sees
    })

    expect(candidate.best).not.toBeNull()
    expect(snapped.lat).toBeCloseTo(candidate.best!.position.lat, 6)
    expect(snapped.lng).toBeCloseTo(candidate.best!.position.lng, 6)
  })
})
