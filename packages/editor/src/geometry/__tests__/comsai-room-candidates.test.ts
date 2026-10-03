import { describe, expect, it } from 'vitest'
import {
  buildPlanarGraph,
  classifyRegion,
  deriveRooms,
  findEnclosedRegions,
} from '../room-derivation'
import { findIntersections, type WallSegment } from '../wall-topology'
import { snapPoint, type SnapConfig } from '../snapping'
import { wallsToSegments } from '../wall-to-segment'
import {
  COMSAI_FLOOR_0_ROOM_ATTRIBUTES,
  COMSAI_FLOOR_0_WALLS,
} from './fixtures/comsai-floor-0'

function wall(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey } }
}

function stageCounts(walls: WallSegment[]) {
  const uniqueAuthoredVertices = new Set(
    walls.flatMap((candidate) => [candidate.start, candidate.end])
      .map((point) => `${point.x.toFixed(10)},${point.y.toFixed(10)}`),
  ).size
  const intersections = findIntersections(walls)
  const graph = buildPlanarGraph(walls)
  const rawFaces = findEnclosedRegions(graph)
  const validFaces = rawFaces.filter((region) => classifyRegion(region) !== 'utility')
  const candidates = deriveRooms(walls, [])
  const renderedCandidates = candidates.filter(
    (candidate) => candidate.faceId && candidate.polygon.points.length >= 3,
  )

  return {
    authoredWalls: walls.length,
    uniqueAuthoredVertices,
    graphIntersections: intersections.length,
    normalizedSegments: graph.halfEdges.length / 2,
    graphVertices: graph.vertices.length,
    graphEdges: graph.halfEdges.length / 2,
    rawFaces: rawFaces.length,
    exteriorFacesRemoved: 1,
    invalidFacesRemoved: rawFaces.length - validFaces.length,
    validRoomCandidates: candidates.length,
    renderedCandidates: renderedCandidates.length,
    clickableCandidates: renderedCandidates.filter((candidate) => candidate.faceId).length,
    areas: rawFaces.map((region) => region.area),
    faceIds: candidates.map((candidate) => candidate.faceId),
  }
}

describe('Comsai GF Room candidates', () => {
  it('preserves the exact current server fixture before deriving anything', () => {
    expect(comsaiFloorSnapshot()).toEqual({
      wallIds: [
        'wall-2-1c76', 'wall-3-ouxl', 'wall-4-snic', 'wall-5-6ejo',
        'wall-7-88hi', 'wall-9-axn5', 'wall-10-uqrc',
      ],
      wallCount: 7,
      roomAttributeCount: 2,
    })
  })

  it('proves the unchanged server geometry loses two faces before candidate rendering', () => {
    const counts = stageCounts(wallsToSegments(COMSAI_FLOOR_0_WALLS))

    expect(counts).toMatchObject({
      authoredWalls: 7,
      uniqueAuthoredVertices: 10,
      graphIntersections: 7,
      normalizedSegments: 13,
      graphVertices: 13,
      graphEdges: 13,
      rawFaces: 2,
      exteriorFacesRemoved: 1,
      invalidFacesRemoved: 0,
      validRoomCandidates: 2,
      renderedCandidates: 2,
      clickableCandidates: 2,
    })
    expect(counts.areas[0]).toBeCloseTo(42.85599541162787, 10)
    expect(counts.areas[1]).toBeCloseTo(255.6591144819364, 10)
    expect(counts.faceIds).toEqual(['face-shxuk2', 'face-1x8o5ck'])
  })

  it('turns the same divider clicks into four faces when Wall authoring snaps to wall bodies', () => {
    const snappedWalls = snapComsaiDividerClicks()
    const candidates = deriveRooms(wallsToSegments(snappedWalls), [])
    const counts = stageCounts(wallsToSegments(snappedWalls))

    expect(candidates).toHaveLength(4)
    expect(counts).toMatchObject({
      authoredWalls: 7,
      uniqueAuthoredVertices: 10,
      graphIntersections: 10,
      normalizedSegments: 13,
      graphVertices: 10,
      graphEdges: 13,
      rawFaces: 4,
      exteriorFacesRemoved: 1,
      invalidFacesRemoved: 0,
      validRoomCandidates: 4,
      renderedCandidates: 4,
      clickableCandidates: 4,
    })
    expect(counts.faceIds).toEqual([
      'face-shxuk2', 'face-fen8kz', 'face-1cdg185', 'face-19jhj0h',
    ])
    expect(counts.areas[0]).toBeCloseTo(42.85594488393067, 10)
    expect(counts.areas[1]).toBeCloseTo(85.316821938927, 10)
    expect(counts.areas[2]).toBeCloseTo(85.0063564271946, 10)
    expect(counts.areas[3]).toBeCloseTo(85.33598664351203, 10)
  })

  it('keeps a simple rectangle and adjacent shared-wall rooms valid', () => {
    const rectangle = [
      wall('bottom', 0, 0, 10, 0), wall('right', 10, 0, 10, 8),
      wall('top', 10, 8, 0, 8), wall('left', 0, 8, 0, 0),
    ]
    const adjacent = [...rectangle, wall('divider', 5, 0, 5, 8)]

    expect(deriveRooms(rectangle, [])).toHaveLength(1)
    expect(deriveRooms(adjacent, [])).toHaveLength(2)
  })

  it('supports a valid T-junction layout and rejects an intentional tiny gap', () => {
    const tJunction = [
      wall('bottom', 0, 0, 10, 0), wall('right', 10, 0, 10, 8),
      wall('top', 10, 8, 0, 8), wall('left', 0, 8, 0, 0),
      wall('divider', 5, 0, 5, 8),
    ]
    const openByOneCentimeter = [
      wall('bottom', 0, 0, 10, 0), wall('right', 10, 0, 10, 8),
      wall('top', 10, 8, 0, 8), wall('left', 0, 7.99, 0, 0),
    ]

    expect(deriveRooms(tJunction, [])).toHaveLength(2)
    expect(deriveRooms(openByOneCentimeter, [])).toHaveLength(0)
  })

  it('preserves the exact malformed fixture and semantic attributes through serialization', () => {
    const saved = JSON.stringify({
      walls: COMSAI_FLOOR_0_WALLS,
      roomAttributes: COMSAI_FLOOR_0_ROOM_ATTRIBUTES,
    })
    const reloaded = JSON.parse(saved) as {
      walls: typeof COMSAI_FLOOR_0_WALLS
      roomAttributes: typeof COMSAI_FLOOR_0_ROOM_ATTRIBUTES
    }

    expect(deriveRooms(wallsToSegments(reloaded.walls), [])).toHaveLength(2)
    expect(reloaded.roomAttributes).toEqual(COMSAI_FLOOR_0_ROOM_ATTRIBUTES)
  })

  it('keeps all four authoring-corrected faces through save/reload serialization', () => {
    const saved = JSON.stringify({ walls: snapComsaiDividerClicks() })
    const reloaded = JSON.parse(saved) as { walls: typeof COMSAI_FLOOR_0_WALLS }

    expect(deriveRooms(wallsToSegments(reloaded.walls), [])).toHaveLength(4)
  })
})

function snapComsaiDividerClicks() {
  const snapConfig: SnapConfig = {
    gridSize: 1,
    endpointSnap: 0.5,
    gridSnap: 0,
    orthogonalSnap: false,
    angle45Snap: false,
  }
  const boundaries = wallsToSegments([
    COMSAI_FLOOR_0_WALLS[0],
    COMSAI_FLOOR_0_WALLS[1],
    COMSAI_FLOOR_0_WALLS[2],
    COMSAI_FLOOR_0_WALLS[6],
  ])

  return COMSAI_FLOOR_0_WALLS.map((candidate, index) => {
    if (index < 3 || index === 6) return candidate
    const start = snapPoint(candidate.start, snapConfig, [], undefined, boundaries)
    const end = snapPoint(candidate.end, snapConfig, [], start.position, boundaries)
    expect(start.snapType).toBe('segment')
    expect(end.snapType).toBe('segment')
    return { ...candidate, start: start.position, end: end.position }
  })
}

function comsaiFloorSnapshot() {
  return {
    wallIds: COMSAI_FLOOR_0_WALLS.map((candidate) => candidate.id),
    wallCount: COMSAI_FLOOR_0_WALLS.length,
    roomAttributeCount: COMSAI_FLOOR_0_ROOM_ATTRIBUTES.length,
  }
}
