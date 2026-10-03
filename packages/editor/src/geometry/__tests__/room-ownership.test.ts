import { describe, expect, it } from 'vitest'
import { SEMANTIC_ROOM_ID_PREFIX } from '@navi/core'
import { collectFloorRoomOwnershipPolygons, resolveUniqueRoomOwner } from '../room-ownership'
import { deriveRooms } from '../room-derivation'
import { wallsToSegments } from '../wall-to-segment'

const square = (id: string, minX: number, maxX: number) => ({
  id,
  points: [{ x: minX, y: 0 }, { x: maxX, y: 0 }, { x: maxX, y: 10 }, { x: minX, y: 10 }],
})

const enclosureWalls = () => [
  { id: 'w1', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15, height: 3 },
  { id: 'w2', start: { x: 4, y: 0 }, end: { x: 4, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'w3', start: { x: 4, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'w4', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3 },
]

const derivedFaceId = (): string => {
  const faceId = deriveRooms(wallsToSegments(enclosureWalls()), [])[0]?.faceId
  if (!faceId) throw new Error('fixture did not derive an enclosed face')
  return faceId
}

const adjacentEnclosureWalls = () => [
  { id: 'a1', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15, height: 3 },
  { id: 'a2', start: { x: 4, y: 0 }, end: { x: 4, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'a3', start: { x: 4, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'a4', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3 },
  { id: 'b1', start: { x: 4, y: 0 }, end: { x: 8, y: 0 }, thickness: 0.15, height: 3 },
  { id: 'b2', start: { x: 8, y: 0 }, end: { x: 8, y: 4 }, thickness: 0.15, height: 3 },
  { id: 'b3', start: { x: 8, y: 4 }, end: { x: 4, y: 4 }, thickness: 0.15, height: 3 },
]

const centroidX = (points: Array<{ x: number; y: number }>): number =>
  points.reduce((sum, point) => sum + point.x, 0) / points.length

/** Two adjacent 4 m x 4 m semantic rooms sharing the wall at x = 4. */
const adjacentSemanticFloor = () => {
  const walls = adjacentEnclosureWalls()
  const derived = deriveRooms(wallsToSegments(walls), [])
  const roomA = derived.find(room => centroidX(room.polygon.points) < 4)
  const roomB = derived.find(room => centroidX(room.polygon.points) > 4)
  if (!roomA?.faceId || !roomB?.faceId) throw new Error('fixture did not derive two adjacent faces')
  return {
    rooms: [],
    walls,
    roomAttributes: [
      { faceId: roomA.faceId, roomId: 'room-a', name: 'Room A', searchable: true },
      { faceId: roomB.faceId, roomId: 'room-b', name: 'Room B', searchable: true },
    ],
  }
}

describe('reusable room ownership contract', () => {
  it('assigns exactly one containing room', () => {
    expect(resolveUniqueRoomOwner({ x: 2, y: 5 }, [square('a', 0, 4), square('b', 6, 10)])).toEqual({ status: 'assigned', roomId: 'a' })
  })

  it('returns explicit unassigned outside all rooms', () => {
    expect(resolveUniqueRoomOwner({ x: 5, y: 5 }, [square('a', 0, 4), square('b', 6, 10)])).toEqual({ status: 'unassigned' })
  })

  it('does not silently choose when containment is ambiguous', () => {
    expect(resolveUniqueRoomOwner({ x: 3, y: 5 }, [square('a', 0, 5), square('b', 2, 7)])).toEqual({ status: 'ambiguous', candidateRoomIds: ['a', 'b'] })
  })

  it('uses semantic Room identities from wall-derived faces', () => {
    const floor = {
      rooms: [],
      walls: [
        { id: 'w1', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15, height: 3 },
        { id: 'w2', start: { x: 4, y: 0 }, end: { x: 4, y: 4 }, thickness: 0.15, height: 3 },
        { id: 'w3', start: { x: 4, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.15, height: 3 },
        { id: 'w4', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3 },
      ],
      roomAttributes: [{ faceId: 'placeholder', roomId: 'semantic-room', name: 'Lab', searchable: true }],
    }
    const withoutIdentity = collectFloorRoomOwnershipPolygons(floor)
    expect(withoutIdentity).toEqual([])

    const fallbackId = collectFloorRoomOwnershipPolygons({ ...floor, roomAttributes: undefined }, true)[0]?.id
    floor.roomAttributes[0].faceId = fallbackId!.replace(SEMANTIC_ROOM_ID_PREFIX, '')
    expect(resolveUniqueRoomOwner({ x: 2, y: 2 }, collectFloorRoomOwnershipPolygons(floor))).toEqual({ status: 'assigned', roomId: 'semantic-room' })
  })

  it('uses the prefixed canonical id for attributes without a roomId', () => {
    const walls = enclosureWalls()
    const faceId = derivedFaceId()
    const floor = {
      rooms: [],
      walls,
      roomAttributes: [{ faceId, name: 'Open Lab', searchable: false }],
    }

    const polygons = collectFloorRoomOwnershipPolygons(floor)

    expect(polygons).toHaveLength(1)
    expect(polygons[0].id).toBe(`${SEMANTIC_ROOM_ID_PREFIX}${faceId}`)
  })

  it('keeps legacy room ids when the floor has no semantic geometry', () => {
    const polygons = collectFloorRoomOwnershipPolygons({
      rooms: [square('legacy-a', 0, 4), square('legacy-b', 6, 10)].map(room => ({
        id: room.id,
        polygon: { points: room.points },
      })),
    })

    expect(polygons.map(polygon => polygon.id)).toEqual(['legacy-a', 'legacy-b'])
  })

  it('uses the prefixed canonical fallback for unassigned derived faces when requested', () => {
    const faceId = derivedFaceId()

    const polygons = collectFloorRoomOwnershipPolygons({ rooms: [], walls: enclosureWalls() }, true)

    expect(polygons).toHaveLength(1)
    expect(polygons[0].id).toBe(`${SEMANTIC_ROOM_ID_PREFIX}${faceId}`)
    expect(polygons[0].id).not.toBe(faceId)
  })
})

describe('degenerate ring edges', () => {
  it('assigns a point clearly inside one of two adjacent semantic rooms to exactly that room', () => {
    const polygons = collectFloorRoomOwnershipPolygons(adjacentSemanticFloor())

    expect(polygons).toHaveLength(2)
    expect(resolveUniqueRoomOwner({ x: 2, y: 2 }, polygons)).toEqual({ status: 'assigned', roomId: 'room-a' })
    expect(resolveUniqueRoomOwner({ x: 6, y: 2 }, polygons)).toEqual({ status: 'assigned', roomId: 'room-b' })
  })

  it('keeps ambiguity for a point exactly on the shared non-degenerate wall', () => {
    const polygons = collectFloorRoomOwnershipPolygons(adjacentSemanticFloor())

    expect(resolveUniqueRoomOwner({ x: 4, y: 2 }, polygons)).toEqual({
      status: 'ambiguous',
      candidateRoomIds: ['room-a', 'room-b'],
    })
  })

  it('still detects a shared corner through the adjacent non-degenerate edges', () => {
    const polygons = collectFloorRoomOwnershipPolygons(adjacentSemanticFloor())

    expect(resolveUniqueRoomOwner({ x: 4, y: 4 }, polygons)).toEqual({
      status: 'ambiguous',
      candidateRoomIds: ['room-a', 'room-b'],
    })
  })

  it('does not contain a far point through a repeated closing vertex', () => {
    const closedRing = {
      id: 'closed-ring',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }],
    }

    expect(resolveUniqueRoomOwner({ x: 25, y: -19 }, [closedRing])).toEqual({ status: 'unassigned' })
  })
})
