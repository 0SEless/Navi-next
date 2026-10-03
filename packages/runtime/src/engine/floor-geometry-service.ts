import type { FloorGeometryArtifact, FloorGeometryBuilding, FloorGeometryFloor, FloorGeometryFeature, LocalCoord, LocalPolygon, LocalPolyline } from '@navi/core'
import type { LoadedPackage } from '../loader'

// ── Floor Geometry Service ──
// Read-only access to building-local indoor geometry from the floor-geometry artifact.
// All coordinates are building-local meters — callers derive world positions
// via the building anchor (origin LatLng + rotation).

export interface FloorBuilding {
  readonly id: string
  readonly name: string
  readonly anchor: { readonly origin: { readonly lat: number; readonly lng: number }; readonly rotation: number }
  readonly floorLevels: readonly number[]
}

export interface FloorResult {
  readonly level: number
  readonly label: string
  readonly elevation: number
  readonly offset: LocalCoord
}

export interface RoomResult {
  readonly id: string
  readonly name: string
  readonly number: string
  readonly polygon: LocalPolygon
}

export interface HallwayResult {
  readonly id: string
  readonly name: string
  readonly polyline: LocalPolyline
}

export interface DoorResult {
  readonly id: string
  readonly roomId: string
  readonly doorType: string
  readonly position: LocalCoord
  readonly width: number
}

export interface WallSegment {
  readonly from: LocalCoord
  readonly to: LocalCoord
}

export interface POIResult {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly position: LocalCoord
}

export interface QRCheckpointResult {
  readonly id: string
  readonly label: string
  readonly code: string
  readonly position: LocalCoord
}

export class FloorGeometryService {
  private readonly artifact?: FloorGeometryArtifact

  constructor(pkg: LoadedPackage) {
    this.artifact = pkg.floorGeometry
  }

  /** Whether the package includes floor geometry data. */
  get available(): boolean {
    return this.artifact !== undefined
  }

  getCampusId(): string | undefined {
    return this.artifact?.campusId
  }

  /** List all buildings with floor geometry. */
  listBuildings(): FloorBuilding[] {
    if (!this.artifact) return []
    return this.artifact.buildings.map(b => ({
      id: b.id,
      name: b.name,
      anchor: { origin: { lat: b.anchor.origin.lat, lng: b.anchor.origin.lng }, rotation: b.anchor.rotation },
      floorLevels: b.floors.map(f => f.level),
    }))
  }

  /** Get a single building's geometry metadata. */
  getBuilding(buildingId: string): FloorBuilding | undefined {
    if (!this.artifact) return undefined
    const b = this.artifact.buildings.find(b => b.id === buildingId)
    if (!b) return undefined
    return {
      id: b.id,
      name: b.name,
      anchor: { origin: { lat: b.anchor.origin.lat, lng: b.anchor.origin.lng }, rotation: b.anchor.rotation },
      floorLevels: b.floors.map(f => f.level),
    }
  }

  /** Get floor metadata for a specific building and level. */
  getFloor(buildingId: string, level: number): FloorResult | undefined {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return undefined
    return {
      level: floor.level,
      label: floor.label,
      elevation: floor.elevation,
      offset: { x: floor.offset.x, y: floor.offset.y },
    }
  }

  /** Get rooms for a specific building and level. */
  getRooms(buildingId: string, level: number): RoomResult[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.rooms.map(r => ({
      id: r.id,
      name: r.name,
      number: r.number,
      polygon: { points: r.polygon.points.map(p => ({ x: p.x, y: p.y })) },
    }))
  }

  /** Get walls derived from room polygon edges for a specific building and level. */
  getWalls(buildingId: string, level: number): WallSegment[] {
    const rooms = this.getRooms(buildingId, level)
    const walls: WallSegment[] = []
    for (const room of rooms) {
      const pts = room.polygon.points
      for (let i = 0; i < pts.length; i++) {
        const from = pts[i]
        const to = pts[(i + 1) % pts.length]
        walls.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } })
      }
    }
    return walls
  }

  /** Get doors for a specific building and level. */
  getDoors(buildingId: string, level: number): DoorResult[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.doors.map(d => ({
      id: d.id,
      roomId: d.roomId,
      doorType: d.doorType,
      position: { x: d.position.x, y: d.position.y },
      width: d.width,
    }))
  }

  /** Get staircases for a specific building and level. */
  getStaircases(buildingId: string, level: number): FloorGeometryFeature[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.staircases.map(s => ({
      id: s.id,
      name: s.name,
      position: { x: s.position.x, y: s.position.y },
      rotation: s.rotation,
      polygon: s.polygon ? { points: s.polygon.points.map(p => ({ x: p.x, y: p.y })) } : undefined,
    }))
  }

  /** Get elevators for a specific building and level. */
  getElevators(buildingId: string, level: number): FloorGeometryFeature[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.elevators.map(e => ({
      id: e.id,
      name: e.name,
      position: { x: e.position.x, y: e.position.y },
      rotation: e.rotation,
      polygon: e.polygon ? { points: e.polygon.points.map(p => ({ x: p.x, y: p.y })) } : undefined,
    }))
  }

  /** Get hallways for a specific building and level. */
  getHallways(buildingId: string, level: number): HallwayResult[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.hallways.map(h => ({
      id: h.id,
      name: h.name,
      polyline: { points: h.polyline.points.map(p => ({ x: p.x, y: p.y })) },
    }))
  }

  /** Get POIs for a specific building and level. */
  getPOIs(buildingId: string, level: number): POIResult[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.pois.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      position: { x: p.position.x, y: p.position.y },
    }))
  }

  /** Get QR checkpoints for a specific building and level. */
  getQRCheckpoints(buildingId: string, level: number): QRCheckpointResult[] {
    const floor = this.findFloor(buildingId, level)
    if (!floor) return []
    return floor.qrCheckpoints.map(q => ({
      id: q.id,
      label: q.label,
      code: q.code,
      position: { x: q.position.x, y: q.position.y },
    }))
  }

  private findFloor(buildingId: string, level: number): FloorGeometryFloor | undefined {
    if (!this.artifact) return undefined
    const building = this.artifact.buildings.find(b => b.id === buildingId)
    if (!building) return undefined
    return building.floors.find(f => f.level === level)
  }
}
