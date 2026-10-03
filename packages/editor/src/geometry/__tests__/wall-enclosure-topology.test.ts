import { describe, expect, it } from 'vitest'
import { deserializeDocument, serializeDocument } from '@navi/core'
import type { CampusDocument, Wall } from '@navi/core'
import { buildPlanarGraph, createRoomEntities, deriveRooms, findEnclosedRegions } from '../room-derivation'
import { wallsToSegments } from '../wall-to-segment'
import type { WallSegment } from '../wall-topology'

function wall(id: string, sx: number, sy: number, ex: number, ey: number): WallSegment {
  return { id, start: { x: sx, y: sy }, end: { x: ex, y: ey } }
}

function isClosed(points: Array<{ x: number; y: number }>): boolean {
  if (points.length < 2) return false
  const first = points[0]
  const last = points[points.length - 1]
  return first.x === last.x && first.y === last.y
}

const OCTAGON = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 14, y: 3 },
  { x: 14, y: 7 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
  { x: -4, y: 7 },
  { x: -4, y: 3 },
]

const OUTER_WALLS = OCTAGON.map((point, index) => {
  const next = OCTAGON[(index + 1) % OCTAGON.length]
  return wall(`outer-${index}`, point.x, point.y, next.x, next.y)
})

const INTERIOR_WALLS = [
  wall('partition-0-2', 0, 0, 14, 3),
  wall('partition-0-3', 0, 0, 14, 7),
  wall('partition-0-4', 0, 0, 10, 10),
  wall('partition-0-5', 0, 0, 0, 10),
  wall('partition-0-6', 0, 0, -4, 7),
]

describe('wall enclosure topology regression', () => {
  it('does not turn an open dangling traversal into a derived enclosure', () => {
    const walls = [
      wall('south-west', 0, 0, 5, 0),
      wall('south-east', 5, 0, 10, 0),
      wall('east', 10, 0, 10, 10),
      wall('north', 10, 10, 0, 10),
      wall('west', 0, 10, 0, 0),
      wall('dangling-partition', 5, 0, 5, -4),
    ]

    const graph = buildPlanarGraph(walls)
    const regions = findEnclosedRegions(graph)
    const rooms = deriveRooms(walls, [])
    expect(regions).toHaveLength(1)
    expect(regions.every((region) => isClosed(region.vertices))).toBe(true)
    expect(rooms).toHaveLength(1)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })

  it('keeps equivalent exterior-first and interior-first wall layouts equivalent', () => {
    const exteriorFirst = [...OUTER_WALLS, ...INTERIOR_WALLS]
    const interiorFirst = [...INTERIOR_WALLS, ...OUTER_WALLS]
    const roomsA = deriveRooms(exteriorFirst, [])
    const roomsB = deriveRooms(interiorFirst, [])
    const graphA = buildPlanarGraph(exteriorFirst)
    const graphB = buildPlanarGraph(interiorFirst)

    expect(roomsA).toHaveLength(6)
    expect(roomsB).toHaveLength(6)
    expect(graphA.vertices).toHaveLength(graphB.vertices.length)
    expect(graphA.halfEdges).toHaveLength(graphB.halfEdges.length)
    expect(graphA.vertices.map((vertex) => `${vertex.point.x},${vertex.point.y}`).sort()).toEqual(
      graphB.vertices.map((vertex) => `${vertex.point.x},${vertex.point.y}`).sort(),
    )
    expect(new Set(roomsA.map((room) => room.topologyKey))).toEqual(new Set(roomsB.map((room) => room.topologyKey)))
  })

  it('keeps bounded faces when authored wall directions are reversed', () => {
    const reversed = [...OUTER_WALLS, ...INTERIOR_WALLS].map((segment) =>
      wall(segment.id, segment.end.x, segment.end.y, segment.start.x, segment.start.y),
    )

    const rooms = deriveRooms(reversed, [])

    expect(rooms).toHaveLength(6)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })

  it('does not manufacture a closing chord for an invalid open region', () => {
    const rooms = createRoomEntities([{
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      area: 50,
      winding: 'cw',
      category: 'other',
    }])

    expect(rooms).toHaveLength(0)
  })

  it('keeps authored crossing walls as legitimate bounded face boundaries', () => {
    const outer = [
      wall('outer-south', 0, 0, 20, 0),
      wall('outer-east', 20, 0, 20, 10),
      wall('outer-north', 20, 10, 0, 10),
      wall('outer-west', 0, 10, 0, 0),
    ]
    const crossing = [
      wall('crossing-a', 0, 0, 20, 10),
      wall('crossing-b', 0, 10, 20, 0),
    ]

    const rooms = deriveRooms([...outer, ...crossing], [])

    expect(rooms).toHaveLength(4)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })

  it('recomputes bounded faces after an authored partition is deleted', () => {
    const outer = [
      wall('outer-south', 0, 0, 20, 0),
      wall('outer-east', 20, 0, 20, 10),
      wall('outer-north', 20, 10, 0, 10),
      wall('outer-west', 0, 10, 0, 0),
    ]
    const divider = wall('divider', 10, 0, 10, 10)

    expect(deriveRooms([...outer, divider], [])).toHaveLength(2)
    expect(deriveRooms(outer, [])).toHaveLength(1)
  })
})

// ── Phase 1: persistence boundary, boundary provenance, dangling-bridge contract ──

const AUTH_TOL = 1e-6

function isPointOnSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  if (Math.abs(cross) > AUTH_TOL) return false
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  return dot >= -AUTH_TOL && dot <= lenSq + AUTH_TOL
}

function authoredSegmentFor(
  a: { x: number; y: number },
  b: { x: number; y: number },
  authored: WallSegment[],
): WallSegment | undefined {
  return authored.find(
    (w) => isPointOnSegment(a, w.start, w.end) && isPointOnSegment(b, w.start, w.end),
  )
}

function createPersistenceDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      {
        id: 'bld-1', name: 'Building A', code: 'BA', category: 'academic', description: '',
        footprint: { points: [
          { lat: 11.819, lng: 122.091 },
          { lat: 11.819, lng: 122.093 },
          { lat: 11.820, lng: 122.093 },
          { lat: 11.820, lng: 122.091 },
          { lat: 11.819, lng: 122.091 },
        ] },
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

const SHELL_WALLS = [
  wall('shell-south-west', 0, 0, 5, 0),
  wall('shell-south-east', 5, 0, 10, 0),
  wall('shell-east', 10, 0, 10, 10),
  wall('shell-north', 10, 10, 0, 10),
  wall('shell-west', 0, 10, 0, 0),
]

describe('wall enclosure persistence boundary', () => {
  it('persists authored walls only and treats derived rooms as a pure computed layer', () => {
    const doc = createPersistenceDoc()
    const floor = doc.buildings[0].floors[0]
    const authoredWalls: Wall[] = OUTER_WALLS.map((segment) => ({
      id: segment.id,
      start: { ...segment.start },
      end: { ...segment.end },
      thickness: 0.2,
      height: 3.5,
    }))
    floor.walls = authoredWalls

    const serializedBefore = serializeDocument(doc)
    const derived = deriveRooms(wallsToSegments(authoredWalls), [])
    expect(derived).toHaveLength(1)

    // Derivation is computed-only: no persisted document state may change.
    const serializedAfter = serializeDocument(doc)
    expect(serializedAfter).toBe(serializedBefore)

    // Authored walls serialize normally...
    const reloaded = deserializeDocument(serializedAfter)
    const reloadedFloor = reloaded.buildings[0].floors[0]
    expect(reloadedFloor.walls).toHaveLength(authoredWalls.length)
    expect(
      reloadedFloor.walls!.map((w) => ({ id: w.id, start: w.start, end: w.end })),
    ).toEqual(authoredWalls.map((w) => ({ id: w.id, start: w.start, end: w.end })))

    // ...and no persistent Room/wall topology receives derived output.
    expect(reloadedFloor.rooms).toHaveLength(0)
    expect(serializedAfter).not.toContain('boundaryWallIds')
    expect(serializedAfter).not.toContain('topologyKey')
    expect(serializedAfter).not.toContain('faceId')
    expect(serializedAfter).not.toContain('floor-derived-rooms')
  })
})

describe('wall enclosure boundary provenance', () => {
  it('sources every accepted boundary edge from authored wall geometry after legitimate splitting', () => {
    const walls = [...OUTER_WALLS, ...INTERIOR_WALLS]
    const authoredIds = new Set(walls.map((w) => w.id))
    const regions = findEnclosedRegions(buildPlanarGraph(walls))

    expect(regions).toHaveLength(6)
    for (const region of regions) {
      const points = region.vertices
      expect(isClosed(points)).toBe(true)
      expect(points.length - 1).toBeGreaterThanOrEqual(3)
      expect(region.boundaryWallIds).toBeDefined()
      expect(region.boundaryWallIds).toHaveLength(points.length - 1)
      for (const id of region.boundaryWallIds!) {
        expect(authoredIds.has(id)).toBe(true)
      }
      for (let i = 0; i < points.length - 1; i++) {
        expect(authoredSegmentFor(points[i], points[i + 1], walls)).toBeDefined()
      }
    }
  })
})

describe('wall enclosure octagon provenance', () => {
  it('produces exactly six closed, fully-authored faces with no synthetic interior partition', () => {
    const walls = [...OUTER_WALLS, ...INTERIOR_WALLS]
    const authoredIds = new Set(walls.map((w) => w.id))
    const regions = findEnclosedRegions(buildPlanarGraph(walls))
    const rooms = deriveRooms(walls, [])

    expect(rooms).toHaveLength(6)
    expect(regions).toHaveLength(6)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
    expect(new Set(regions.map((region) => region.topologyKey)).size).toBe(6)

    for (const region of regions) {
      // Every boundary portion must be a consecutive portion of an authored wall.
      const points = region.vertices
      for (let i = 0; i < points.length - 1; i++) {
        expect(authoredSegmentFor(points[i], points[i + 1], walls)).toBeDefined()
      }
      // No synthetic partition may enter an accepted face.
      for (const id of region.boundaryWallIds!) {
        expect(authoredIds.has(id)).toBe(true)
      }
    }
  })
})

describe('wall enclosure dangling-versus-divider contract', () => {
  it('preserves a valid shell enclosure when an authored wall dangles inside it', () => {
    const walls = [...SHELL_WALLS, wall('inward-dangling', 5, 0, 5, 4)]
    const graph = buildPlanarGraph(walls)
    const regions = findEnclosedRegions(graph)
    const rooms = deriveRooms(walls, [])

    // The authored dangling wall remains part of wall topology data.
    expect(graph.halfEdges.some((he) => he.sourceWallId === 'inward-dangling')).toBe(true)

    // It must not destroy the shell enclosure or create a second face.
    // (RED as of Phase 1: the current derivation returns 0 regions / 0 rooms.)
    expect({ regions: regions.length, rooms: rooms.length }).toEqual({ regions: 1, rooms: 1 })

    // The dangling wall must never be used to invent a closing boundary.
    expect(regions.every((region) => isClosed(region.vertices))).toBe(true)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })

  it('produces exactly two enclosures when the interior wall connects two valid boundary points', () => {
    const walls = [...SHELL_WALLS, wall('full-divider', 5, 0, 5, 10)]
    const regions = findEnclosedRegions(buildPlanarGraph(walls))
    const rooms = deriveRooms(walls, [])

    expect(regions).toHaveLength(2)
    expect(rooms).toHaveLength(2)
    expect(regions.every((region) => isClosed(region.vertices))).toBe(true)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })

  it('keeps the enclosure intact when an authored tree dangles inside the shell', () => {
    const walls = [
      ...SHELL_WALLS,
      wall('tree-stem', 5, 0, 5, 5),
      wall('tree-branch-a', 5, 5, 8, 5),
      wall('tree-branch-b', 5, 5, 5, 8),
    ]
    const graph = buildPlanarGraph(walls)
    const regions = findEnclosedRegions(graph)
    const rooms = deriveRooms(walls, [])

    // Every authored tree wall remains part of the topology graph...
    for (const id of ['tree-stem', 'tree-branch-a', 'tree-branch-b']) {
      expect(graph.halfEdges.some((he) => he.sourceWallId === id)).toBe(true)
    }
    // ...but the tree neither subdivides nor destroys the shell enclosure.
    expect({ regions: regions.length, rooms: rooms.length }).toEqual({ regions: 1, rooms: 1 })
    expect(regions.every((region) => isClosed(region.vertices))).toBe(true)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })

  it('promotes an unfinished branch to a divider only once it connects two boundary points', () => {
    const unfinished = [...SHELL_WALLS, wall('partial-divider', 5, 0, 5, 5)]
    expect(deriveRooms(unfinished, [])).toHaveLength(1)

    const completed = [...unfinished, wall('divider-connector', 5, 5, 10, 5)]
    const regions = findEnclosedRegions(buildPlanarGraph(completed))
    const rooms = deriveRooms(completed, [])

    expect(regions).toHaveLength(2)
    expect(rooms).toHaveLength(2)
    expect(regions.every((region) => isClosed(region.vertices))).toBe(true)
    expect(rooms.every((room) => isClosed(room.polygon.points))).toBe(true)
  })
})
