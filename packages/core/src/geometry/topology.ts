import type { LatLng, LocalPolygon, LocalPolyline } from '../types'
import { polygonBBox, pointInPolygon, type BBox } from './polygon'
import { pointDistance } from './polyline'
import { GridSpatialIndex, type SpatialEntity } from './spatial-index'

// ── Topology types ──

export interface RoomAdjacency {
  roomAId: string
  roomBId: string
  sharedWallLength: number
}

export interface FloorConnectivity {
  fromFloor: number
  toFloor: number
  via: { type: 'staircase' | 'elevator'; id: string }
}

// ── Topology Engine ──

export interface TopologyEntity {
  id: string
  polygon: LocalPolygon
  floorId: string
  type: 'room' | 'hallway' | 'staircase' | 'elevator'
}

export class TopologyEngine {
  private rooms = new Map<string, TopologyEntity>()
  private hallways = new Map<string, TopologyEntity>()
  private staircases = new Map<string, { id: string; position: LatLng; floor: number; toFloor: number; buildingId: string }>()
  private elevators = new Map<string, { id: string; position: LatLng; floor: number; toFloor: number; buildingId: string }>()
  private spatialIndex = new GridSpatialIndex(10)

  // ── Data loading ──

  addRoom(id: string, polygon: LocalPolygon, floorId: string): void {
    const entity: TopologyEntity = { id, polygon, floorId, type: 'room' }
    this.rooms.set(id, entity)
    this.indexEntity(id, polygon)
  }

  addHallway(id: string, polygon: LocalPolygon, floorId: string): void {
    const entity: TopologyEntity = { id, polygon, floorId, type: 'hallway' }
    this.hallways.set(id, entity)
    this.indexEntity(id, polygon)
  }

  addStaircase(id: string, position: LatLng, floor: number, toFloor: number, buildingId: string): void {
    this.staircases.set(id, { id, position, floor, toFloor, buildingId })
  }

  addElevator(id: string, position: LatLng, floor: number, toFloor: number, buildingId: string): void {
    this.elevators.set(id, { id, position, floor, toFloor, buildingId })
  }

  private indexEntity(id: string, polygon: LocalPolygon): void {
    const bbox = polygonBBox(polygon)
    this.spatialIndex.insert({ id, bbox })
  }

  clear(): void {
    this.rooms.clear()
    this.hallways.clear()
    this.staircases.clear()
    this.elevators.clear()
    this.spatialIndex.clear()
  }

  // ── Room adjacency detection ──

  findAdjacentRooms(threshold: number = 0.5): RoomAdjacency[] {
    const adjacencies: RoomAdjacency[] = []
    const roomIds = Array.from(this.rooms.keys())

    for (let i = 0; i < roomIds.length; i++) {
      const roomA = this.rooms.get(roomIds[i])!
      const bboxA = polygonBBox(roomA.polygon)

      for (let j = i + 1; j < roomIds.length; j++) {
        const roomB = this.rooms.get(roomIds[j])!
        if (roomA.floorId !== roomB.floorId) continue
        const bboxB = polygonBBox(roomB.polygon)

        if (!bboxesOverlap(bboxA, bboxB)) continue
        const sharedWall = this.computeSharedWallLength(roomA.polygon, roomB.polygon, threshold)
        if (sharedWall > 0) {
          adjacencies.push({ roomAId: roomIds[i], roomBId: roomIds[j], sharedWallLength: sharedWall })
        }
      }
    }

    return adjacencies
  }

  private computeSharedWallLength(polyA: LocalPolygon, polyB: LocalPolygon, threshold: number): number {
    const ptsA = polyA.points
    const ptsB = polyB.points
    let totalShared = 0

    for (let i = 0; i < ptsA.length - 1; i++) {
      const a1 = ptsA[i]
      const a2 = ptsA[i + 1]
      const midAx = (a1.x + a2.x) / 2
      const midAy = (a1.y + a2.y) / 2

      for (let j = 0; j < ptsB.length - 1; j++) {
        const b1 = ptsB[j]
        const b2 = ptsB[j + 1]

        const dist = pointToSegmentDistance(
          { x: midAx, y: midAy },
          { x: b1.x, y: b1.y },
          { x: b2.x, y: b2.y },
        )

        if (dist < threshold) {
          const segLen = Math.sqrt((a2.x - a1.x) ** 2 + (a2.y - a1.y) ** 2)
          totalShared += segLen
          break
        }
      }
    }

    return totalShared
  }

  // ── Floor connectivity ──

  getFloorConnectivity(buildingId: string): FloorConnectivity[] {
    const connections: FloorConnectivity[] = []

    for (const s of this.staircases.values()) {
      if (s.buildingId === buildingId) {
        connections.push({ fromFloor: s.floor, toFloor: s.toFloor, via: { type: 'staircase', id: s.id } })
      }
    }
    for (const e of this.elevators.values()) {
      if (e.buildingId === buildingId) {
        connections.push({ fromFloor: e.floor, toFloor: e.toFloor, via: { type: 'elevator', id: e.id } })
      }
    }

    return connections
  }

  // ── Entity-at-point ──

  entityAtPoint(point: LatLng, buildingLocalOrigin: LatLng): TopologyEntity[] {
    const candidates = this.spatialIndex.queryPoint(point.lng, point.lat)
    const results: TopologyEntity[] = []

    for (const c of candidates) {
      const room = this.rooms.get(c.id)
      if (room && pointInPolygon(point, room.polygon as any)) {
        results.push(room)
        continue
      }
      const hall = this.hallways.get(c.id)
      if (hall && pointInPolygon(point, hall.polygon as any)) {
        results.push(hall)
      }
    }

    return results
  }

  // ── Overlap detection ──

  findOverlappingRooms(floorId: string): { roomAId: string; roomBId: string; overlapArea: number }[] {
    const overlaps: { roomAId: string; roomBId: string; overlapArea: number }[] = []
    const floorRooms = Array.from(this.rooms.values()).filter(r => r.floorId === floorId)

    for (let i = 0; i < floorRooms.length; i++) {
      const bboxA = polygonBBox(floorRooms[i].polygon)
      for (let j = i + 1; j < floorRooms.length; j++) {
        const bboxB = polygonBBox(floorRooms[j].polygon)
        if (!bboxesOverlap(bboxA, bboxB)) continue

        // Count vertices of A that are inside B (rough overlap heuristic)
        let insideCount = 0
        for (const pt of floorRooms[i].polygon.points) {
          if (pointInPolygon(pt, floorRooms[j].polygon as any)) insideCount++
        }
        if (insideCount > 0) {
          overlaps.push({ roomAId: floorRooms[i].id, roomBId: floorRooms[j].id, overlapArea: insideCount })
        }
      }
    }

    return overlaps
  }
}

// ── Helpers ──

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2)
}
