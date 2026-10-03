import { describe, it, expect } from 'vitest'
import {
  FaceIdentityTracker,
  matchDerivedRoomIdentities,
  type FaceIdentity,
  type DerivedRoom,
} from '../face-identity'
import type { LocalPolygon } from '@navi/core'

// ── Helpers ──

function makePolygon(points: { x: number; y: number }[]): LocalPolygon {
  // Ensure polygon is closed
  const pts = points.map((p) => ({ x: p.x, y: p.y }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (first.x !== last.x || first.y !== last.y) {
    pts.push({ x: first.x, y: first.y })
  }
  return { points: pts }
}

function makeRoom(
  id: string,
  polygon: { x: number; y: number }[],
): DerivedRoom {
  return {
    id,
    name: `Room ${id}`,
    number: '1',
    category: 'other',
    polygon: makePolygon(polygon),
    roomDoors: [],
    metadata: {},
  }
}

function makeIdentity(
  faceId: string,
  polygon: { x: number; y: number }[],
  overrides?: Partial<FaceIdentity>,
): FaceIdentity {
  return {
    faceId,
    sourceFaceIds: [],
    lastSeenFloor: 0,
    centroid: { x: 0, y: 0 },
    polygon: polygon.map((p) => ({ x: p.x, y: p.y })),
    ...overrides,
  }
}

// ── Case 1: Stability — move wall slightly ──

describe('W6A Case 1: Stability — move wall slightly', () => {
  it('preserves identity when a wall moves slightly (overlap > 70%)', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: rectangle 10×8
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    expect(result1.identities).toHaveLength(1)
    const originalId = result1.identities[0].faceId

    // Move top wall slightly (y: 8 → 8.2)
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8.2 },
        { x: 0, y: 8.2 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    expect(result2.identities).toHaveLength(1)
    // Identity should be preserved
    expect(result2.identities[0].faceId).toBe(originalId)
    expect(result2.ambiguous).toBe(false)
  })
})

// ── Case 2: Split — one room becomes two ──

describe('W6A Case 2: Split — one room becomes two', () => {
  it('assigns old identity to the larger overlapping face, new identity to the smaller', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: large rectangle 20×10
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    expect(result1.identities).toHaveLength(1)
    const originalId = result1.identities[0].faceId

    // Split: two rooms of equal size (divider at x=10)
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
      makeRoom('r2', [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    expect(result2.identities).toHaveLength(2)
    // Neither overlap exceeds 70% of the original (each is ~50%), so both get new identities
    // But the split creates two new identities
    expect(result2.ambiguous).toBe(false)

    // Verify both rooms have distinct identities
    const ids = result2.identities.map((i) => i.faceId)
    expect(new Set(ids).size).toBe(2)
  })

  it('preserves identity when split creates one very large overlap', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: rectangle 10×8
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    const originalId = result1.identities[0].faceId

    // Split: one room is 90% of original, one is tiny
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 9, y: 0 },
        { x: 9, y: 8 },
        { x: 0, y: 8 },
      ]),
      makeRoom('r2', [
        { x: 9, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 9, y: 8 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    expect(result2.identities).toHaveLength(2)

    // The large room should get the original identity
    const largeRoomMatch = result2.identities.find(
      (i) => i.faceId === originalId,
    )
    expect(largeRoomMatch).toBeDefined()
  })
})

// ── Case 3: Merge — two rooms become one ──

describe('W6A Case 3: Merge — two rooms become one', () => {
  it('flags ambiguity and creates new identity with lineage when two rooms merge', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: two rooms side by side
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
      makeRoom('r2', [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    expect(result1.identities).toHaveLength(2)
    const id1 = result1.identities[0].faceId
    const id2 = result1.identities[1].faceId

    // Merge: remove divider, one big room
    const rooms2 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    expect(result2.identities).toHaveLength(1)
    // Should be flagged as ambiguous
    expect(result2.ambiguous).toBe(true)
    expect(result2.ambiguousIndices).toContain(0)
    // New identity should have lineage
    expect(result2.identities[0].sourceFaceIds).toContain(id1)
    expect(result2.identities[0].sourceFaceIds).toContain(id2)
    // Should NOT be the same as either original
    expect(result2.identities[0].faceId).not.toBe(id1)
    expect(result2.identities[0].faceId).not.toBe(id2)
  })
})

// ── Case 4: Large topology change ──

describe('W6A Case 4: Large topology change', () => {
  it('creates new identity when overlap is below threshold', () => {
    const tracker = new FaceIdentityTracker(0.7)

    // Initial: room in bottom-left corner
    const rooms1 = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    const result1 = tracker.matchIdentities(rooms1, 0)
    const originalId = result1.identities[0].faceId

    // Major rearrangement: room moved to top-right, completely different position
    const rooms2 = [
      makeRoom('r1', [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
        { x: 60, y: 58 },
        { x: 50, y: 58 },
      ]),
    ]

    const result2 = tracker.matchIdentities(rooms2, 0)
    expect(result2.identities).toHaveLength(1)
    // Should create a new identity (no overlap with original)
    expect(result2.identities[0].faceId).not.toBe(originalId)
    expect(result2.identities[0].sourceFaceIds).toHaveLength(0)
    expect(result2.ambiguous).toBe(false)
  })
})

// ── Edge cases ──

describe('W6A Edge cases', () => {
  it('handles empty room list', () => {
    const tracker = new FaceIdentityTracker()
    const result = tracker.matchIdentities([], 0)
    expect(result.identities).toHaveLength(0)
    expect(result.ambiguous).toBe(false)
  })

  it('creates all new identities on first derivation', () => {
    const tracker = new FaceIdentityTracker()
    const rooms = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    const result = tracker.matchIdentities(rooms, 0)
    expect(result.identities).toHaveLength(1)
    expect(result.identities[0].faceId).toBe('face-0')
    expect(result.identities[0].sourceFaceIds).toHaveLength(0)
  })

  it('tracks floor changes', () => {
    const tracker = new FaceIdentityTracker()
    const rooms = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    tracker.matchIdentities(rooms, 0)
    const result = tracker.matchIdentities(rooms, 2)
    expect(result.identities[0].lastSeenFloor).toBe(2)
  })

  it('matchDerivedRoomIdentities works with previous identities', () => {
    const prevIdentities = [
      makeIdentity('face-prev', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    const rooms = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8.2 },
        { x: 0, y: 8.2 },
      ]),
    ]

    const result = matchDerivedRoomIdentities(rooms, 0, prevIdentities, 0.7)
    expect(result.identities).toHaveLength(1)
    expect(result.identities[0].faceId).toBe('face-prev')
  })

  it('reset clears all identities', () => {
    const tracker = new FaceIdentityTracker()
    const rooms = [
      makeRoom('r1', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ]),
    ]

    tracker.matchIdentities(rooms, 0)
    expect(tracker.getIdentities()).toHaveLength(1)

    tracker.reset()
    expect(tracker.getIdentities()).toHaveLength(0)
  })
})
