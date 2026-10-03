import type { LatLng, LocalCoord } from '../types'
import { pointDistance, polylineLength } from './polyline'
import { polygonBBox } from './polygon'
import { nearestPointOnPolyline, lineIntersection, type Line } from './extensions'
import { latLngToEuclidean, euclideanToLatLng } from './project'

// ── Snap target types ──

export interface SnapTarget {
  position: LatLng
  type: 'vertex' | 'midpoint' | 'edge' | 'endpoint' | 'entrance' | 'nav_node' | 'grid' | 'center'
  entityId?: string
  distance: number  // meters (world space)
}

// ── Snap configuration ──

export interface SnapConfig {
  enabled: boolean
  gridSize: number           // meters, 0 = disabled
  vertex: boolean
  midpoint: boolean
  edge: boolean
  endpoint: boolean
  entrance: boolean
  center: boolean
  maxSnapDistance: number    // meters
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  gridSize: 5,
  vertex: true,
  midpoint: true,
  edge: true,
  endpoint: true,
  entrance: true,
  center: true,
  maxSnapDistance: 10,
}

// ── Snap engine ──

export interface SnapVertex {
  position: LatLng
  entityId: string
  type: SnapTarget['type']
}

export interface SnapEdge {
  a: LatLng
  b: LatLng
  entityId: string
}

export class SnapEngine {
  private vertices: SnapVertex[] = []
  private edges: SnapEdge[] = []
  private entrances: SnapVertex[] = []

  clear(): void {
    this.vertices = []
    this.edges = []
    this.entrances = []
  }

  addVertex(position: LatLng, entityId: string, type: SnapTarget['type'] = 'vertex'): void {
    this.vertices.push({ position, entityId, type })
  }

  addEdge(a: LatLng, b: LatLng, entityId: string): void {
    this.edges.push({ a, b, entityId })
  }

  addEntrance(position: LatLng, entityId: string): void {
    this.entrances.push({ position, entityId, type: 'entrance' })
  }

  // ── Find best snap target ──

  findSnap(point: LatLng, config: SnapConfig = DEFAULT_SNAP_CONFIG): SnapTarget | null {
    if (!config.enabled) return null

    const candidates: SnapTarget[] = []
    const { x, y } = latLngToEuclidean(point)

    // Grid snap
    if (config.gridSize > 0) {
      const gx = Math.round(x / config.gridSize) * config.gridSize
      const gy = Math.round(y / config.gridSize) * config.gridSize
      const d = Math.sqrt((gx - x) ** 2 + (gy - y) ** 2)
      if (d < config.maxSnapDistance) {
        candidates.push({ position: euclideanToLatLng(gx, gy), type: 'grid', distance: d })
      }
    }

    // Vertex snap
    if (config.vertex) {
      for (const v of this.vertices) {
        const d = this.distance(point, v.position)
        if (d < config.maxSnapDistance) {
          candidates.push({ position: v.position, type: v.type, entityId: v.entityId, distance: d })
        }
      }
    }

    // Endpoint snap (vertices at end of edges)
    if (config.endpoint) {
      for (const e of this.edges) {
        const da = this.distance(point, e.a)
        const db = this.distance(point, e.b)
        if (da < config.maxSnapDistance) {
          candidates.push({ position: e.a, type: 'endpoint', entityId: e.entityId, distance: da })
        }
        if (db < config.maxSnapDistance) {
          candidates.push({ position: e.b, type: 'endpoint', entityId: e.entityId, distance: db })
        }
      }
    }

    // Midpoint snap
    if (config.midpoint) {
      for (const e of this.edges) {
        const mid: LatLng = {
          lat: (e.a.lat + e.b.lat) / 2,
          lng: (e.a.lng + e.b.lng) / 2,
        }
        const d = this.distance(point, mid)
        if (d < config.maxSnapDistance) {
          candidates.push({ position: mid, type: 'midpoint', entityId: e.entityId, distance: d })
        }
      }
    }

    // Edge snap (nearest point on any edge segment)
    if (config.edge) {
      for (const e of this.edges) {
        const nearest = nearestPointOnSegment(point, e.a, e.b)
        if (!nearest) continue
        const d = this.distance(point, nearest)
        if (d < config.maxSnapDistance) {
          candidates.push({ position: nearest, type: 'edge', entityId: e.entityId, distance: d })
        }
      }
    }

    // Entrance snap
    if (config.entrance) {
      for (const v of this.entrances) {
        const d = this.distance(point, v.position)
        if (d < config.maxSnapDistance) {
          candidates.push({ position: v.position, type: 'entrance', entityId: v.entityId, distance: d })
        }
      }
    }

    // Return closest
    candidates.sort((a, b) => a.distance - b.distance)
    return candidates[0] || null
  }

  // ── Find all snaps within radius (for multi-snap indicators) ──

  findAllSnaps(point: LatLng, config: SnapConfig = DEFAULT_SNAP_CONFIG): SnapTarget[] {
    if (!config.enabled) return []

    const candidates: SnapTarget[] = []

    const { x, y } = latLngToEuclidean(point)

    // Grid
    if (config.gridSize > 0) {
      const gx = Math.round(x / config.gridSize) * config.gridSize
      const gy = Math.round(y / config.gridSize) * config.gridSize
      const d = Math.sqrt((gx - x) ** 2 + (gy - y) ** 2)
      if (d < config.maxSnapDistance) {
        candidates.push({ position: euclideanToLatLng(gx, gy), type: 'grid', distance: d })
      }
    }

    // All vertices
    if (config.vertex) {
      for (const v of this.vertices) {
        const d = this.distance(point, v.position)
        if (d < config.maxSnapDistance) {
          candidates.push({ position: v.position, type: v.type, entityId: v.entityId, distance: d })
        }
      }
    }

    // All entrances
    if (config.entrance) {
      for (const v of this.entrances) {
        const d = this.distance(point, v.position)
        if (d < config.maxSnapDistance) {
          candidates.push({ position: v.position, type: 'entrance', entityId: v.entityId, distance: d })
        }
      }
    }

    candidates.sort((a, b) => a.distance - b.distance)
    return candidates
  }

  private distance(a: LatLng, b: LatLng): number {
    const dlat = a.lat - b.lat
    const dlng = a.lng - b.lng
    return Math.sqrt(dlat * dlat + dlng * dlng) * 111320
  }
}

function nearestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng | null {
  const ap = latLngToEuclidean(p)
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
