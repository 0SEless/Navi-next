import { describe, expect, it } from 'vitest'
import { deriveRooms } from '../room-derivation'
import type { WallSegment } from '../wall-topology'

function wall(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey } }
}

describe('derived face identity for semantic Rooms', () => {
  it('is stable when the same wall topology is reordered, reversed, or translated', () => {
    const initial = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ]

    const first = deriveRooms(initial, [])[0]
    const recomputed = deriveRooms([
      wall('w3', 100, 108, 110, 108),
      wall('w1', 100, 100, 110, 100),
      wall('w4', 100, 100, 100, 108),
      wall('w2', 110, 100, 110, 108),
    ], [])[0]

    expect(first.faceId).toMatch(/^face-/)
    expect(recomputed.faceId).toBe(first.faceId)
    expect(recomputed.boundaryWallIds).toEqual(expect.arrayContaining(['w1', 'w2', 'w3', 'w4']))
  })

  it('keeps the same face ID for a reasonable wall edit', () => {
    const before = deriveRooms([
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ], [])[0]
    const after = deriveRooms([
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8.2),
      wall('w3', 10, 8.2, 0, 8.2),
      wall('w4', 0, 8.2, 0, 0),
    ], [])[0]

    expect(after.faceId).toBe(before.faceId)
    expect(after.polygon.points).not.toEqual(before.polygon.points)
  })
})
