import type { LocalCoord, LocalPolygon, RoomCategory } from '@navi/core'
import type { Point2D } from '../canvas/viewport'
import type { WallSegment } from './wall-topology'
import { stableFaceIdFromTopology, stableFaceTopologyKey } from './face-identity'

export interface DoorInput {
  readonly id: string
  readonly position: Point2D
  readonly width: number
}

export interface GraphVertex {
  readonly point: Point2D
  readonly id: number
}

export interface GraphHalfEdge {
  readonly id: number
  readonly from: GraphVertex
  readonly to: GraphVertex
  readonly sourceWallId: string
}

export interface Graph {
  readonly vertices: GraphVertex[]
  readonly halfEdges: GraphHalfEdge[]
  readonly adjacency: Map<number, GraphHalfEdge[]>
}

export interface Region {
  readonly vertices: Point2D[]
  readonly area: number
  readonly winding: 'cw' | 'ccw'
  /** Source authored wall IDs traversed by the face boundary. */
  readonly boundaryWallIds?: string[]
  /** Coordinate-independent canonical topology key for this face. */
  readonly topologyKey?: string
}

export interface ClassifiedRegion extends Region {
  readonly category: RoomCategory
}

export interface DerivedRoom {
  readonly id: string
  /** Stable identity derived from the source-wall boundary topology. */
  readonly faceId?: string
  readonly boundaryWallIds?: string[]
  readonly topologyKey?: string
  readonly name: string
  readonly number: string
  readonly category: RoomCategory
  readonly polygon: LocalPolygon
  readonly roomDoors: []
  readonly metadata: Record<string, unknown>
}

const EPSILON = 1e-10
const MIN_ROOM_AREA = 1.0
const MAX_SHAFT_AREA = 4.0

function cross2d(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x
}

function sub(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y }
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

function pointKey(p: Point2D): string {
  return `${p.x.toFixed(10)},${p.y.toFixed(10)}`
}

function segmentIntersection(
  a: WallSegment,
  b: WallSegment,
): { point: Point2D; tA: number; tB: number } | null {
  const r = sub(a.end, a.start)
  const s = sub(b.end, b.start)
  const d = sub(b.start, a.start)
  const rxs = cross2d(r, s)

  if (Math.abs(rxs) < EPSILON) return null

  const t = cross2d(d, s) / rxs
  const u = cross2d(d, r) / rxs

  if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
    return { point: { x: a.start.x + t * r.x, y: a.start.y + t * r.y }, tA: t, tB: u }
  }
  return null
}

function splitWallAtPoint(wall: WallSegment, point: Point2D): [WallSegment, WallSegment] | null {
  if (pointsEqual(point, wall.start) || pointsEqual(point, wall.end)) return null

  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < EPSILON * EPSILON) return null

  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lenSq
  if (t < EPSILON || t > 1 - EPSILON) return null

  return [
    { id: `${wall.id}-L`, sourceWallId: wall.sourceWallId ?? wall.id, start: wall.start, end: point },
    { id: `${wall.id}-R`, sourceWallId: wall.sourceWallId ?? wall.id, start: point, end: wall.end },
  ]
}

function splitWallsAtIntersections(walls: WallSegment[]): WallSegment[] {
  let current = [...walls]
  let changed = true

  while (changed) {
    changed = false
    const newWalls: WallSegment[] = []

    for (let i = 0; i < current.length; i++) {
      let splitThisWall = false

      for (let j = 0; j < current.length; j++) {
        if (i === j) continue
        const hit = segmentIntersection(current[i], current[j])
        if (hit) {
          const split = splitWallAtPoint(current[i], hit.point)
          if (split) {
            newWalls.push(split[0], split[1])
            splitThisWall = true
            changed = true
            break
          }
        }
      }

      if (!splitThisWall) {
        newWalls.push(current[i])
      }
    }

    current = newWalls
  }

  return current
}

function buildGraph(segments: WallSegment[]): Graph {
  const vertices: GraphVertex[] = []
  const halfEdges: GraphHalfEdge[] = []
  const vertexMap = new Map<string, GraphVertex>()
  const adjacency = new Map<number, GraphHalfEdge[]>()
  let nextId = 0

  function getOrCreateVertex(p: Point2D): GraphVertex {
    const key = pointKey(p)
    const existing = vertexMap.get(key)
    if (existing) return existing
    const v: GraphVertex = { point: p, id: nextId++ }
    vertexMap.set(key, v)
    vertices.push(v)
    adjacency.set(v.id, [])
    return v
  }

  for (const seg of segments) {
    const from = getOrCreateVertex(seg.start)
    const to = getOrCreateVertex(seg.end)
    if (from.id === to.id) continue
    const sourceWallId = seg.sourceWallId ?? seg.id
    const he1: GraphHalfEdge = { id: halfEdges.length, from, to, sourceWallId }
    halfEdges.push(he1)
    adjacency.get(from.id)!.push(he1)
    const he2: GraphHalfEdge = { id: halfEdges.length, from: to, to: from, sourceWallId }
    halfEdges.push(he2)
    adjacency.get(to.id)!.push(he2)
  }

  for (const v of vertices) {
    const edges = adjacency.get(v.id)!
    edges.sort((a, b) => {
      const aa = Math.atan2(a.to.point.y - v.point.y, a.to.point.x - v.point.x)
      const ab = Math.atan2(b.to.point.y - v.point.y, b.to.point.x - v.point.x)
      return aa - ab
    })
  }

  return { vertices, halfEdges, adjacency }
}

function findNextEdge(
  incoming: GraphHalfEdge,
  adj: Map<number, GraphHalfEdge[]>,
  excludedEdges?: ReadonlySet<number>,
): GraphHalfEdge | null {
  const vertex = incoming.to
  const edges = adj.get(vertex.id)
  if (!edges || edges.length === 0) return null

  const fromDir = Math.atan2(
    incoming.from.point.y - vertex.point.y,
    incoming.from.point.x - vertex.point.x,
  )
  let bestIdx = -1
  let bestAngle = Infinity

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.from.id !== vertex.id) continue
    if (e.to.id === incoming.from.id) continue
    if (excludedEdges?.has(e.id)) continue

    const eAngle = Math.atan2(e.to.point.y - vertex.point.y, e.to.point.x - vertex.point.x)
    let rel = eAngle - fromDir
    while (rel < -EPSILON) rel += 2 * Math.PI
    while (rel >= 2 * Math.PI - EPSILON) rel -= 2 * Math.PI

    if (rel < bestAngle) {
      bestAngle = rel
      bestIdx = i
    }
  }

  return bestIdx >= 0 ? edges[bestIdx] : null
}

interface TracedFace {
  points: Point2D[]
  boundaryWallIds: string[]
  edgeIds: number[]
  closed: boolean
}

function traceFace(
  start: GraphHalfEdge,
  adj: Map<number, GraphHalfEdge[]>,
  excludedEdges?: ReadonlySet<number>,
): TracedFace {
  const points: Point2D[] = [start.from.point]
  const boundaryWallIds: string[] = []
  const edgeIds: number[] = []
  const traversed = new Set<number>()
  let current: GraphHalfEdge | null = start

  for (let safety = 0; safety < 10000; safety++) {
    if (!current || traversed.has(current.id)) break

    traversed.add(current.id)
    edgeIds.push(current.id)
    boundaryWallIds.push(current.sourceWallId)
    points.push(current.to.point)

    const next = findNextEdge(current, adj, excludedEdges)
    if (!next) break
    if (next.id === start.id) {
      return { points, boundaryWallIds, edgeIds, closed: true }
    }
    if (traversed.has(next.id)) break

    current = next
  }

  return { points, boundaryWallIds, edgeIds, closed: false }
}

function isSimpleClosedCycle(points: Point2D[]): boolean {
  if (points.length < 4 || !pointsEqual(points[0], points[points.length - 1])) return false

  const seen = new Set<string>()
  for (let i = 0; i < points.length - 1; i++) {
    const key = pointKey(points[i])
    if (seen.has(key)) return false
    seen.add(key)
  }

  return true
}

function computeSignedArea(pts: Point2D[]): number {
  const n = pts.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n - 1; i++) {
    area += pts[i].x * pts[i + 1].y
    area -= pts[i + 1].x * pts[i].y
  }
  return area / 2
}

function computeBBox(pts: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * Identify undirected bridge edges (edges whose removal increases the connected
 * component count) and return the IDs of BOTH half-edges belonging to each
 * bridge.
 *
 * A bridge belongs to no cycle, so it cannot bound a bounded planar face.
 * Face traversal ignores bridge half-edges; the authored wall graph itself is
 * unchanged. Tarjan low-link DFS with parent-edge tracking, O(V + E).
 *
 * `buildGraph` emits half-edges in reverse pairs, so `id ^ 1` is the paired
 * reverse half-edge and `id >> 1` identifies the undirected edge.
 */
function findBridgeHalfEdgeIds(graph: Graph): Set<number> {
  const discovery = new Map<number, number>()
  const low = new Map<number, number>()
  const bridges = new Set<number>()
  let clock = 0

  function visit(vertexId: number, parentEdgeId: number): void {
    discovery.set(vertexId, ++clock)
    low.set(vertexId, clock)

    for (const edge of graph.adjacency.get(vertexId) ?? []) {
      const edgeId = edge.id >> 1
      if (edgeId === parentEdgeId) continue

      const neighborId = edge.to.id
      if (!discovery.has(neighborId)) {
        visit(neighborId, edgeId)
        low.set(vertexId, Math.min(low.get(vertexId)!, low.get(neighborId)!))
        if (low.get(neighborId)! > discovery.get(vertexId)!) {
          bridges.add(edge.id)
          bridges.add(edge.id ^ 1)
        }
      } else {
        low.set(vertexId, Math.min(low.get(vertexId)!, discovery.get(neighborId)!))
      }
    }
  }

  for (const vertex of graph.vertices) {
    if (!discovery.has(vertex.id)) visit(vertex.id, -1)
  }

  return bridges
}

export function findEnclosedRegions(graph: Graph): Region[] {
  // Bridges are non-face edges: they belong to no cycle and cannot bound a
  // bounded face. Excluding their half-edges here prevents a dangling authored
  // wall from diverting or terminating a valid bounded face walk. The graph
  // itself (and therefore the authored wall data) is unchanged.
  const bridgeHalfEdgeIds = findBridgeHalfEdgeIds(graph)
  const visited = new Set<number>()
  const regions: Region[] = []

  for (const he of graph.halfEdges) {
    if (bridgeHalfEdgeIds.has(he.id)) continue
    if (visited.has(he.id)) continue

    const traced = traceFace(he, graph.adjacency, bridgeHalfEdgeIds)
    for (const edgeId of traced.edgeIds) visited.add(edgeId)

    const facePoints = traced.points
    if (!traced.closed || !isSimpleClosedCycle(facePoints)) continue

    const signedArea = computeSignedArea(facePoints)
    // The right-face traversal emits bounded interiors clockwise and the
    // unbounded exterior counter-clockwise. Keep only the bounded winding so
    // an exterior walk can never become a synthetic room polygon.
    if (signedArea >= -EPSILON) continue

    const winding: 'cw' | 'ccw' = signedArea < 0 ? 'cw' : 'ccw'
    const region: Region = {
      vertices: facePoints,
      area: Math.abs(signedArea),
      winding,
      boundaryWallIds: traced.boundaryWallIds,
      topologyKey: stableFaceTopologyKey(traced.boundaryWallIds),
    }
    regions.push(region)
  }

  return regions
}

export function classifyRegion(region: Region): RoomCategory {
  if (region.area < MIN_ROOM_AREA) return 'utility'
  if (region.area <= MAX_SHAFT_AREA) return 'utility'

  const bbox = computeBBox(region.vertices)
  const aspectRatio = Math.max(bbox.width, bbox.height) / Math.max(Math.min(bbox.width, bbox.height), EPSILON)

  if (aspectRatio > 5) return 'utility'

  return 'other'
}

export function createRoomEntities(regions: ClassifiedRegion[]): DerivedRoom[] {
  return regions.filter((region) => isSimpleClosedCycle(region.vertices)).map((region, i) => {
    const points: LocalCoord[] = region.vertices.map((p) => ({ x: p.x, y: p.y }))

    return {
      id: `room-${i}`,
      ...(region.boundaryWallIds && region.boundaryWallIds.length > 0
        ? {
            faceId: stableFaceIdFromTopology(region.boundaryWallIds),
            boundaryWallIds: [...region.boundaryWallIds],
            topologyKey: region.topologyKey ?? stableFaceTopologyKey(region.boundaryWallIds),
          }
        : {}),
      name: `Room ${i}`,
      number: `${i + 1}`,
      category: region.category,
      polygon: { points },
      roomDoors: [],
      metadata: {},
    }
  })
}

export function buildPlanarGraph(walls: WallSegment[]): Graph {
  const segments = splitWallsAtIntersections(walls)
  return buildGraph(segments)
}

export function deriveRooms(walls: WallSegment[], _doors: DoorInput[]): DerivedRoom[] {
  if (walls.length === 0) return []

  const segments = splitWallsAtIntersections(walls)
  const graph = buildGraph(segments)
  const regions = findEnclosedRegions(graph)

  const classified: ClassifiedRegion[] = []
  const seenTopology = new Set<string>()
  for (const region of regions) {
    if (region.area < EPSILON) continue
    // Duplicate bounded traversals can still arise from split segments or
    // repeated source-wall IDs; keep one stable topology cycle.
    const topologyKey = region.topologyKey ?? stableFaceTopologyKey(region.boundaryWallIds ?? [])
    if (seenTopology.has(topologyKey)) continue
    seenTopology.add(topologyKey)
    classified.push({
      ...region,
      topologyKey,
      category: classifyRegion(region),
    })
  }

  const rooms = classified.filter((r) => r.category !== 'utility')
  return createRoomEntities(rooms)
}
