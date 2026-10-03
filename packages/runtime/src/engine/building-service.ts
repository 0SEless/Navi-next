import { type LatLng, type BuildingEntry, distanceMeters, SpatialQueryService } from '@navi/core'
import type { LoadedPackage } from '../loader'

const CONTAINMENT_RADIUS_METERS = 100

export interface BuildingResult {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly category: string
  readonly position: LatLng
  readonly entrances: readonly string[]
  readonly floors: readonly string[]
}

export interface EntranceResult {
  readonly id: string
  readonly name: string
  readonly position: LatLng
}

export class BuildingService {
  private buildings: BuildingEntry[]
  private spatialIndex?: SpatialQueryService

  constructor(pkg: LoadedPackage) {
    this.buildings = pkg.buildingIndex?.buildings ?? []
  }

  private getSpatialIndex(): SpatialQueryService {
    if (!this.spatialIndex) {
      this.spatialIndex = new SpatialQueryService()
      this.spatialIndex.loadFromNodes(
        this.buildings.map(b => ({
          id: b.id,
          position: b.position,
          type: 'building' as const,
        })),
      )
    }
    return this.spatialIndex
  }

  get(id: string): BuildingResult | undefined {
    const entry = this.buildings.find(b => b.id === id)
    return entry ? this.mapResult(entry) : undefined
  }

  list(): BuildingResult[] {
    return this.buildings
      .map(b => this.mapResult(b))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  findNearest(position: LatLng): BuildingResult | undefined {
    if (this.buildings.length === 0) return undefined
    const idx = this.getSpatialIndex()
    const result = idx.nearestEntity(position)
    if (!result) return undefined
    const entry = this.buildings.find(b => b.id === result.entity.id)
    return entry ? this.mapResult(entry) : undefined
  }

  getEntrances(buildingId: string): EntranceResult[] {
    const building = this.buildings.find(b => b.id === buildingId)
    if (!building) return []
    return building.entrances
      .map(e => ({
        id: e.id,
        name: e.label,
        position: e.position,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  findContaining(position: LatLng): BuildingResult | undefined {
    const nearest = this.findNearest(position)
    if (!nearest) return undefined
    const entry = this.buildings.find(b => b.id === nearest.id)
    if (!entry) return undefined
    const dist = distanceMeters(position, entry.position)
    return dist <= CONTAINMENT_RADIUS_METERS ? nearest : undefined
  }

  private mapResult(entry: BuildingEntry): BuildingResult {
    return {
      id: entry.id,
      name: entry.name,
      code: entry.code,
      category: entry.category,
      position: entry.position,
      entrances: entry.entrances.map(e => e.id),
      floors: entry.floors.map(f => f.label),
    }
  }
}
