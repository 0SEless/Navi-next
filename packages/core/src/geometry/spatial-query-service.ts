/**
 * SpatialQueryService — centralized spatial reasoning for NAVI Studio.
 *
 * Provides pure query methods over an R-tree spatial index. Every method
 * is a pure query — it never modifies the document or external state.
 *
 * @see 02 Engineering/spatial-system.md for architecture.
 */

import type { LatLng } from '../types'
import { RBushSpatialIndex, type SpatialEntity } from './rbush-spatial-index'
import { polygonBBox, pointInPolygon, type BBox } from './polygon'
import { haversine } from '../coordinates/crs'
import { latLngToEuclidean, euclideanToLatLng } from './project'

// ── Types ───────────────────────────────────────────────────────────────────

export type EntityType =
  | 'building' | 'room' | 'hallway' | 'staircase' | 'elevator'
  | 'entrance' | 'road' | 'asset' | 'qr' | 'panorama'
  | 'intersection'

export interface EntityRef {
  id: string
  type: EntityType
  buildingId?: string
  floorId?: string
  position?: LatLng
  /** For sampled road points: the real road ID (stored separately to avoid collision with buildingId) */
  roadId?: string
}

export interface NearestResult {
  entity: EntityRef
  distance: number
  point: LatLng
}

export interface QueryOptions {
  maxDistance?: number
  floorId?: string
  buildingId?: string
  type?: EntityType | EntityType[]
  exclude?: string[]
}

// ── SpatialQueryService ─────────────────────────────────────────────────────

export class SpatialQueryService {
  private index = new RBushSpatialIndex()
  private entityMap = new Map<string, EntityRef>()

  // ── Index Management ──────────────────────────────────────────────────────

  clear(): void {
    this.index.clear()
    this.entityMap.clear()
  }

  insertEntity(ref: EntityRef, bbox: BBox): void {
    // Convert bbox to Euclidean (Web Mercator) space for consistent indexing
    const minXY = latLngToEuclidean({ lat: bbox.minY, lng: bbox.minX })
    const maxXY = latLngToEuclidean({ lat: bbox.maxY, lng: bbox.maxX })
    const mercatorBBox: BBox = {
      minX: Math.min(minXY.x, maxXY.x),
      minY: Math.min(minXY.y, maxXY.y),
      maxX: Math.max(minXY.x, maxXY.x),
      maxY: Math.max(minXY.y, maxXY.y),
    }
    const entity: SpatialEntity = { id: ref.id, bbox: mercatorBBox }
    this.index.insert(entity)
    this.entityMap.set(ref.id, ref)
  }

  removeEntity(id: string): void {
    this.index.remove(id)
    this.entityMap.delete(id)
  }

  updateEntity(ref: EntityRef, bbox: BBox): void {
    this.removeEntity(ref.id)
    this.insertEntity(ref, bbox)
  }

  /**
   * Load entities from an array of NavNode-like objects.
   * Useful for consumers that work with pre-parsed node arrays
   * rather than a full CampusDocument.
   *
   * Each node is indexed by a small bbox around its position.
   */
  loadFromNodes(
    nodes: Array<{
      id: string
      position: LatLng
      type?: string
      floor?: number
      buildingId?: string
      [key: string]: unknown
    }>,
  ): void {
    for (const node of nodes) {
      const ref: EntityRef = {
        id: node.id,
        type: (node.type as EntityType) ?? 'room',
        floorId: node.floor !== undefined ? String(node.floor) : undefined,
        buildingId: node.buildingId,
        position: node.position,
      }
      // Small bbox around the point (approx 2m in Web Mercator)
      const bbox: BBox = {
        minX: node.position.lng - 0.00002,
        maxX: node.position.lng + 0.00002,
        minY: node.position.lat - 0.00002,
        maxY: node.position.lat + 0.00002,
      }
      this.insertEntity(ref, bbox)
    }
  }

  /**
   * Load roads into the spatial index using multiple points along each polyline.
   *
   * This is critical for accurate nearest-road queries. A road's centroid
   * can be far from the actual nearest segment. By indexing multiple points
   * along the polyline, the spatial index finds the closest segment.
   *
   * Each indexed point gets a unique ID (e.g., "road-1:0", "road-1:1") but
   * the same road ID is stored in the entity, so nearestEntity returns
   * the correct road with the distance to the nearest segment.
   *
   * @param roads - Array of road-like objects with id and polyline
   * @param sampleInterval - Approximate distance between sample points in meters (default: 10m)
   */
  loadFromRoads(
    roads: Array<{
      id: string
      polyline: { points: LatLng[] }
      [key: string]: unknown
    }>,
    sampleInterval: number = 10,
  ): void {
    for (const road of roads) {
      const points = road.polyline?.points
      if (!points || points.length < 2) {
        // Degenerate road — index as single point
        if (points?.length === 1) {
          this.insertEntity(
            { id: road.id, type: 'road', position: points[0] },
            {
              minX: points[0].lng - 0.00002,
              maxX: points[0].lng + 0.00002,
              minY: points[0].lat - 0.00002,
              maxY: points[0].lat + 0.00002,
            },
          )
        }
        continue
      }

      // Sample points along the polyline
      const sampledPoints = this.samplePolyline(points, sampleInterval)

      // Index each sampled point with a unique ID but the same road ID
      for (let i = 0; i < sampledPoints.length; i++) {
        const pt = sampledPoints[i]
        const uniqueId = `${road.id}:${i}`
        this.insertEntity(
          { id: uniqueId, type: 'road', position: pt, roadId: road.id },
          {
            minX: pt.lng - 0.00002,
            maxX: pt.lng + 0.00002,
            minY: pt.lat - 0.00002,
            maxY: pt.lat + 0.00002,
          },
        )
      }
    }
  }

  /**
   * Sample points along a polyline at approximately equal intervals.
   * Includes the first and last points, plus intermediate samples.
   */
  private samplePolyline(points: LatLng[], intervalMeters: number): LatLng[] {
    if (points.length <= 2) return points

    const result: LatLng[] = [points[0]]
    let accumulatedDistance = 0

    for (let i = 1; i < points.length; i++) {
      const segDist = this.haversineMeters(points[i - 1], points[i])
      accumulatedDistance += segDist

      // Add intermediate samples if segment is long enough
      if (segDist > intervalMeters * 1.5) {
        const numSamples = Math.floor(segDist / intervalMeters)
        for (let s = 1; s < numSamples; s++) {
          const t = s / numSamples
          result.push({
            lat: points[i - 1].lat + t * (points[i].lat - points[i - 1].lat),
            lng: points[i - 1].lng + t * (points[i].lng - points[i - 1].lng),
          })
        }
      }

      result.push(points[i])
    }

    return result
  }

  /**
   * Haversine distance in meters between two LatLng points.
   */
  private haversineMeters(a: LatLng, b: LatLng): number {
    return haversine(a, b)
  }

  // ── Nearest-Entity Queries ────────────────────────────────────────────────

  /**
   * Find the nearest entity to the given position.
   * O(log n + k) where k = candidates examined.
   */
  nearestEntity(
    position: LatLng,
    options: QueryOptions = {},
  ): NearestResult | null {
    const { maxDistance = Infinity, exclude = [], type, floorId, buildingId } = options

    // Convert maxDistance from meters to approximate Web Mercator units
    const searchRadius = maxDistance * 1.2 // Add 20% buffer for bbox search
    const { x, y } = latLngToEuclidean(position)
    const candidates = this.index.queryNearest(x, y, searchRadius, 20)

    let best: NearestResult | null = null

    for (const candidate of candidates) {
      const ref = this.entityMap.get(candidate.id)
      if (!ref) continue

      // For sampled road points (id like "road-1:0"), extract the real road ID
      const realId = ref.roadId ?? ref.id
      if (exclude.includes(realId)) continue

      if (type) {
        const types = Array.isArray(type) ? type : [type]
        if (!types.includes(ref.type)) continue
      }
      if (floorId && ref.floorId !== floorId) continue
      if (buildingId && ref.buildingId !== buildingId) continue

      // Compute exact distance
      const dist = this.distanceMeters(position, ref.position ?? this.bboxCenter(candidate.bbox))
      if (dist > maxDistance) continue
      if (!best || dist < best.distance) {
        best = {
          entity: { ...ref, id: realId },
          distance: dist,
          point: ref.position ?? this.bboxCenter(candidate.bbox),
        }
      }
    }

    return best
  }

  /**
   * Find the nearest node to the given position.
   */
  nearestNode(
    position: LatLng,
    options: QueryOptions = {},
  ): NearestResult | null {
    return this.nearestEntity(position, { ...options, type: ['entrance', 'staircase', 'elevator'] })
  }

  /**
   * Find the nearest road to the given position.
   */
  nearestRoad(
    position: LatLng,
    options: QueryOptions = {},
  ): NearestResult | null {
    return this.nearestEntity(position, { ...options, type: 'road' })
  }

  /**
   * Find the nearest room to the given position.
   */
  nearestRoom(
    position: LatLng,
    options: QueryOptions = {},
  ): NearestResult | null {
    return this.nearestEntity(position, { ...options, type: 'room' })
  }

  /**
   * Find the nearest entrance to the given position.
   */
  nearestEntrance(
    position: LatLng,
    options: QueryOptions = {},
  ): NearestResult | null {
    return this.nearestEntity(position, { ...options, type: 'entrance' })
  }

  /**
   * Find the nearest hallway to the given position.
   */
  nearestHallway(
    position: LatLng,
    options: QueryOptions = {},
  ): NearestResult | null {
    return this.nearestEntity(position, { ...options, type: 'hallway' })
  }

  // ── Point Queries ─────────────────────────────────────────────────────────

  /**
   * Find all entities at the given point.
   * Returns entities ordered by layer priority (room > building > road).
   */
  entitiesAtPoint(
    point: LatLng,
    options: QueryOptions = {},
  ): EntityRef[] {
    const { x, y } = latLngToEuclidean(point)
    const candidates = this.index.queryPoint(x, y)

    const results: EntityRef[] = []
    for (const candidate of candidates) {
      const ref = this.entityMap.get(candidate.id)
      if (!ref) continue
      if (options.buildingId && ref.buildingId !== options.buildingId) continue
      if (options.floorId && ref.floorId !== options.floorId) continue
      if (options.type) {
        const types = Array.isArray(options.type) ? options.type : [options.type]
        if (!types.includes(ref.type)) continue
      }
      results.push(ref)
    }

    return results
  }

  /**
   * Find the top entity at the given point (highest priority).
   */
  entityAtPoint(
    point: LatLng,
    options: QueryOptions = {},
  ): EntityRef | null {
    const entities = this.entitiesAtPoint(point, options)
    return entities[0] ?? null
  }

  // ── Proximity Queries ─────────────────────────────────────────────────────

  /**
   * Find all entities within the given radius.
   */
  entitiesInRadius(
    position: LatLng,
    radiusMeters: number,
    options: QueryOptions = {},
  ): NearestResult[] {
    const { exclude = [], type, floorId, buildingId } = options

    const searchRadius = radiusMeters * 1.2
    const { x, y } = latLngToEuclidean(position)
    const candidates = this.index.queryNearest(x, y, searchRadius, 100)

    const results: NearestResult[] = []

    for (const candidate of candidates) {
      const ref = this.entityMap.get(candidate.id)
      if (!ref) continue
      if (exclude.includes(ref.id)) continue
      if (type) {
        const types = Array.isArray(type) ? type : [type]
        if (!types.includes(ref.type)) continue
      }
      if (floorId && ref.floorId !== floorId) continue
      if (buildingId && ref.buildingId !== buildingId) continue

      const dist = this.distanceMeters(position, ref.position ?? this.bboxCenter(candidate.bbox))
      if (dist <= radiusMeters) {
        results.push({
          entity: ref,
          distance: dist,
          point: ref.position ?? this.bboxCenter(candidate.bbox),
        })
      }
    }

    return results.sort((a, b) => a.distance - b.distance)
  }

  /**
   * Find all entities within the given bounding box.
   */
  entitiesInBounds(bounds: BBox): EntityRef[] {
    const candidates = this.index.queryBBox(bounds)
    return candidates
      .map(c => this.entityMap.get(c.id))
      .filter(Boolean) as EntityRef[]
  }

  /**
   * Find all entities on a specific floor.
   */
  componentsOnFloor(floorId: string): EntityRef[] {
    const results: EntityRef[] = []
    for (const ref of this.entityMap.values()) {
      if (ref.floorId === floorId) {
        results.push(ref)
      }
    }
    return results
  }

  // ── Geometry Queries ──────────────────────────────────────────────────────

  /**
   * Compute the nearest point on a polyline to the given point.
   * O(n) where n = number of segments.
   */
  nearestPointOnPolyline(point: LatLng, polyline: LatLng[]): LatLng | null {
    if (polyline.length < 2) return null

    let best: LatLng | null = null
    let bestDist = Infinity

    for (let i = 0; i < polyline.length - 1; i++) {
      const nearest = this.nearestPointOnSegment(point, polyline[i], polyline[i + 1])
      if (!nearest) continue
      const dist = this.distanceMeters(point, nearest)
      if (dist < bestDist) {
        bestDist = dist
        best = nearest
      }
    }

    return best
  }

  /**
   * Compute the nearest point on a line segment to the given point.
   * O(1).
   */
  nearestPointOnSegment(point: LatLng, a: LatLng, b: LatLng): LatLng {
    const ap = latLngToEuclidean(point)
    const aa = latLngToEuclidean(a)
    const ab = latLngToEuclidean(b)

    const dx = ab.x - aa.x
    const dy = ab.y - aa.y
    const len2 = dx * dx + dy * dy

    if (len2 === 0) return a

    let t = ((ap.x - aa.x) * dx + (ap.y - aa.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))

    return euclideanToLatLng(aa.x + t * dx, aa.y + t * dy)
  }

  /**
   * Compute the haversine distance between two points.
   * O(1).
   */
  distance(a: LatLng, b: LatLng): number {
    return haversine(a, b)
  }

  /**
   * Compute approximate distance in meters (faster than haversine).
   * O(1).
   */
  distanceMeters(a: LatLng, b: LatLng): number {
    const dlat = b.lat - a.lat
    const dlng = b.lng - a.lng
    return Math.sqrt(dlat * dlat + dlng * dlng) * 111320
  }

  /**
   * Check if a point is inside a polygon.
   * O(n) where n = number of polygon vertices.
   */
  pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
    return pointInPolygon(point, { points: polygon })
  }

  /**
   * Find the intersection point of two line segments.
   * O(1).
   */
  lineIntersection(
    l1: [LatLng, LatLng],
    l2: [LatLng, LatLng],
  ): LatLng | null {
    const [p1, p2] = l1
    const [p3, p4] = l2

    const r = { x: p2.lng - p1.lng, y: p2.lat - p1.lat }
    const s = { x: p4.lng - p3.lng, y: p4.lat - p3.lat }
    const rs = r.x * s.y - r.y * s.x

    if (Math.abs(rs) < 1e-10) return null // Parallel

    const d = { x: p3.lng - p1.lng, y: p3.lat - p1.lat }
    const t = (d.x * s.y - d.y * s.x) / rs
    const u = (d.x * r.y - d.y * r.x) / rs

    if (t < 0 || t > 1 || u < 0 || u > 1) return null

    return {
      lng: p1.lng + t * r.x,
      lat: p1.lat + t * r.y,
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get size(): number {
    return this.index.size
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private bboxCenter(bbox: BBox): LatLng {
    return {
      lat: (bbox.minY + bbox.maxY) / 2,
      lng: (bbox.minX + bbox.maxX) / 2,
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: SpatialQueryService | null = null

export function getSpatialQueryService(): SpatialQueryService {
  if (!_instance) {
    _instance = new SpatialQueryService()
  }
  return _instance
}
