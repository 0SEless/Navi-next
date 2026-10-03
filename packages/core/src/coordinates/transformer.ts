import type { LatLng, LocalCoord } from '../types'
import { wgs84ToWebMercator, webMercatorToWgs84, EARTH_RADIUS } from './crs'

// ── Building local system ──
export interface BuildingLocalSystem {
  buildingId: string
  origin: LatLng           // building reference point (footprint centroid)
  rotation: number         // degrees from north (clockwise)
}

// ── Per-floor local system (P1-T1) ──
// D4/R3.1 chain: floor-local (meters) → + floor.offset → building-local (meters).
// `offset` is the floor's origin expressed in building-local meters; `rotation`
// rotates the floor's axes relative to the building's axes (degrees clockwise,
// same convention as BuildingLocalSystem.rotation). A floor with no registered
// system behaves as identity (offset {0,0}, rotation 0) — legacy documents load
// with defaults, no migration prompt (R2.1).
export interface FloorLocalSystem {
  offset: LocalCoord
  rotation: number
}

// ── Camera state for screen transforms ──
export interface CameraState {
  center: LatLng
  zoom: number
  bearing: number          // degrees from north
  pitch: number            // degrees from horizontal
  viewportWidth: number    // pixels
  viewportHeight: number   // pixels
}

// ── CoordinateTransformer ──
export class CoordinateTransformer {
  private buildingSystems = new Map<string, BuildingLocalSystem>()
  // P1-T1: per-floor systems keyed by `${buildingId}:${level}`. A floor with no
  // registered system falls back to identity (offset {0,0}, rotation 0).
  private floorSystems = new Map<string, FloorLocalSystem>()

  registerBuilding(system: BuildingLocalSystem): void {
    this.buildingSystems.set(system.buildingId, system)
  }

  getBuildingSystem(buildingId: string): BuildingLocalSystem | undefined {
    return this.buildingSystems.get(buildingId)
  }

  // ── Per-floor registration (P1-T1) ──

  registerFloor(buildingId: string, level: number, system: FloorLocalSystem): void {
    this.floorSystems.set(`${buildingId}:${level}`, system)
  }

  getFloorSystem(buildingId: string, level: number): FloorLocalSystem | undefined {
    return this.floorSystems.get(`${buildingId}:${level}`)
  }

  // ── World ↔ Campus ──

  worldToCampus(latlng: LatLng): { x: number; y: number } {
    return wgs84ToWebMercator(latlng)
  }

  campusToWorld(x: number, y: number): LatLng {
    return webMercatorToWgs84(x, y)
  }

  // ── Campus ↔ Building-local ──

  campusToBuildingLocal(campus: { x: number; y: number }, buildingId: string): LocalCoord | null {
    const sys = this.buildingSystems.get(buildingId)
    if (!sys) return null
    const campusOrigin = wgs84ToWebMercator(sys.origin)
    const dx = campus.x - campusOrigin.x
    const dy = campus.y - campusOrigin.y
    const rad = (-sys.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    }
  }

  buildingLocalToCampus(local: LocalCoord, buildingId: string): { x: number; y: number } | null {
    const sys = this.buildingSystems.get(buildingId)
    if (!sys) return null
    const rad = (sys.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const x = local.x * cos - local.y * sin
    const y = local.x * sin + local.y * cos
    const campusOrigin = wgs84ToWebMercator(sys.origin)
    return { x: campusOrigin.x + x, y: campusOrigin.y + y }
  }

  buildingLocalToWorld(local: LocalCoord, buildingId: string): LatLng | null {
    const campus = this.buildingLocalToCampus(local, buildingId)
    if (!campus) return null
    return this.campusToWorld(campus.x, campus.y)
  }

  worldToBuildingLocal(latlng: LatLng, buildingId: string): LocalCoord | null {
    const campus = this.worldToCampus(latlng)
    return this.campusToBuildingLocal(campus, buildingId)
  }

  // ── Floor-local ↔ Building-local (P1-T1, D4) ──
  // Chain: floor-local (meters) → + floor.offset → building-local (meters).
  // Rotation convention matches BuildingLocalSystem.rotation (degrees
  // clockwise). Unregistered floor → identity (legacy default).

  floorLocalToBuildingLocal(local: LocalCoord, buildingId: string, level: number): LocalCoord | null {
    if (!this.buildingSystems.has(buildingId)) return null
    const sys = this.floorSystems.get(`${buildingId}:${level}`)
    if (!sys) return { x: local.x, y: local.y }
    const rad = (sys.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return {
      x: local.x * cos - local.y * sin + sys.offset.x,
      y: local.x * sin + local.y * cos + sys.offset.y,
    }
  }

  buildingLocalToFloorLocal(local: LocalCoord, buildingId: string, level: number): LocalCoord | null {
    if (!this.buildingSystems.has(buildingId)) return null
    const sys = this.floorSystems.get(`${buildingId}:${level}`)
    if (!sys) return { x: local.x, y: local.y }
    const dx = local.x - sys.offset.x
    const dy = local.y - sys.offset.y
    const rad = (-sys.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    }
  }

  floorLocalToWorld(local: LocalCoord, buildingId: string, level: number): LatLng | null {
    const buildingLocal = this.floorLocalToBuildingLocal(local, buildingId, level)
    if (!buildingLocal) return null
    return this.buildingLocalToWorld(buildingLocal, buildingId)
  }

  worldToFloorLocal(latlng: LatLng, buildingId: string, level: number): LocalCoord | null {
    const buildingLocal = this.worldToBuildingLocal(latlng, buildingId)
    if (!buildingLocal) return null
    return this.buildingLocalToFloorLocal(buildingLocal, buildingId, level)
  }

  // ── Screen ↔ World ──
  // Simplified — assumes pitch=0, bearing=0 for V1

  screenToWorld(screenX: number, screenY: number, camera: CameraState): LatLng {
    const tileSize = 256
    const scale = Math.pow(2, camera.zoom)
    const worldSize = tileSize * scale

    const cx = screenX - camera.viewportWidth / 2
    const cy = screenY - camera.viewportHeight / 2
    const centerMerc = wgs84ToWebMercator(camera.center)

    const metersPerPixel = (2 * Math.PI * EARTH_RADIUS) / worldSize
    const x = centerMerc.x + cx * metersPerPixel
    const y = centerMerc.y - cy * metersPerPixel

    return webMercatorToWgs84(x, y)
  }

  worldToScreen(latlng: LatLng, camera: CameraState): { x: number; y: number } {
    const tileSize = 256
    const scale = Math.pow(2, camera.zoom)
    const worldSize = tileSize * scale

    const centerMerc = wgs84ToWebMercator(camera.center)
    const pointMerc = wgs84ToWebMercator(latlng)

    const metersPerPixel = (2 * Math.PI * EARTH_RADIUS) / worldSize
    const cx = (pointMerc.x - centerMerc.x) / metersPerPixel
    const cy = (centerMerc.y - pointMerc.y) / metersPerPixel

    return {
      x: cx + camera.viewportWidth / 2,
      y: cy + camera.viewportHeight / 2,
    }
  }
}
