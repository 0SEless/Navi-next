import { describe, it, expect } from 'vitest'
import {
  deriveRooms,
  buildPlanarGraph,
  findEnclosedRegions,
  classifyRegion,
  createRoomEntities,
  type DoorInput,
} from '../room-derivation'
import type { WallSegment } from '../wall-topology'

function wall(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey } }
}

function door(id: string, x: number, y: number, width: number): DoorInput {
  return { id, position: { x, y }, width }
}

describe('deriveRooms', () => {
  it('derives a room from 4 walls forming a rectangle', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ]

    const rooms = deriveRooms(walls, [])
    expect(rooms.length).toBeGreaterThanOrEqual(1)

    const room = rooms[0]
    expect(room.polygon.points.length).toBeGreaterThanOrEqual(4)
    expect(room.polygon.points[0]).toEqual(room.polygon.points[room.polygon.points.length - 1])
  })

  it('returns empty for open walls (no closed face)', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
    ]

    const rooms = deriveRooms(walls, [])
    expect(rooms).toHaveLength(0)
  })

  it('returns empty for empty wall list', () => {
    expect(deriveRooms([], [])).toHaveLength(0)
  })

  it('filters out very small regions', () => {
    const walls = [
      wall('w1', 0, 0, 0.5, 0),
      wall('w2', 0.5, 0, 0.5, 0.5),
      wall('w3', 0.5, 0.5, 0, 0.5),
      wall('w4', 0, 0.5, 0, 0),
    ]

    const rooms = deriveRooms(walls, [])
    expect(rooms).toHaveLength(0)
  })

  it('derives rooms with door gaps (open walls form no face where door is)', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ]
    const doors = [door('d1', 5, 0, 0.9)]

    const rooms = deriveRooms(walls, doors)
    expect(rooms.length).toBeGreaterThanOrEqual(1)
  })
})

describe('classifyRegion', () => {
  it('classifies a large region as other (default)', () => {
    const region = {
      vertices: [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 },
      ],
      area: 80,
      winding: 'cw' as const,
    }
    expect(classifyRegion(region)).toBe('other')
  })

  it('classifies a tiny region as utility', () => {
    const region = {
      vertices: [
        { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }, { x: 0, y: 0 },
      ],
      area: 0.25,
      winding: 'cw' as const,
    }
    expect(classifyRegion(region)).toBe('utility')
  })

  it('classifies a narrow region as utility', () => {
    const region = {
      vertices: [
        { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0.5 }, { x: 0, y: 0.5 }, { x: 0, y: 0 },
      ],
      area: 25,
      winding: 'cw' as const,
    }
    expect(classifyRegion(region)).toBe('utility')
  })
})

describe('createRoomEntities', () => {
  it('creates rooms from classified regions', () => {
    const regions = [
      {
        vertices: [
          { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 },
        ],
        area: 80,
        winding: 'cw' as const,
        category: 'other' as const,
      },
    ]

    const rooms = createRoomEntities(regions)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].id).toBe('room-0')
    expect(rooms[0].name).toBe('Room 0')
    expect(rooms[0].number).toBe('1')
    expect(rooms[0].category).toBe('other')
    expect(rooms[0].polygon.points).toHaveLength(5)
    expect(rooms[0].polygon.points[0]).toEqual(rooms[0].polygon.points[4])
  })

  it('numbers rooms sequentially', () => {
    const regions = [
      {
        vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }],
        area: 25, winding: 'cw' as const, category: 'other' as const,
      },
      {
        vertices: [{ x: 6, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 0 }],
        area: 25, winding: 'cw' as const, category: 'other' as const,
      },
    ]

    const rooms = createRoomEntities(regions)
    expect(rooms).toHaveLength(2)
    expect(rooms[0].number).toBe('1')
    expect(rooms[1].number).toBe('2')
  })
})

describe('findEnclosedRegions via buildPlanarGraph', () => {
  it('builds a planar graph from wall segments', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ]

    const graph = buildPlanarGraph(walls)
    expect(graph.vertices.length).toBeGreaterThanOrEqual(4)
    expect(graph.halfEdges.length).toBeGreaterThanOrEqual(4)
  })

  it('finds enclosed regions from a closed loop', () => {
    const walls = [
      wall('w1', 0, 0, 10, 0),
      wall('w2', 10, 0, 10, 8),
      wall('w3', 10, 8, 0, 8),
      wall('w4', 0, 8, 0, 0),
    ]

    const graph = buildPlanarGraph(walls)
    const regions = findEnclosedRegions(graph)
    expect(regions.length).toBeGreaterThanOrEqual(1)
    expect(regions[0].area).toBeGreaterThan(0)
  })

  it('finds two regions for two rooms sharing a wall', () => {
    const walls = [
      wall('w1', 0, 0, 20, 0),
      wall('w2', 20, 0, 20, 10),
      wall('w3', 20, 10, 0, 10),
      wall('w4', 0, 10, 0, 0),
      wall('w5', 10, 0, 10, 10),
    ]

    const graph = buildPlanarGraph(walls)
    const regions = findEnclosedRegions(graph)
    const totalArea = 20 * 10
    const roomRegions = regions.filter(
      (r) => r.area > 1.0 && r.area < totalArea - 1.0,
    )
    expect(roomRegions.length).toBe(2)
  })

  it('splits at T-junctions', () => {
    const walls = [
      wall('w1', 0, 0, 20, 0),
      wall('w2', 20, 0, 20, 10),
      wall('w3', 20, 10, 0, 10),
      wall('w4', 0, 10, 0, 0),
      wall('w5', 10, 0, 10, 5),
    ]

    const graph = buildPlanarGraph(walls)
    expect(graph.vertices.length).toBeGreaterThanOrEqual(5)
  })
})
