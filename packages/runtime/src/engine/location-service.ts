import type { LoadedPackage } from '../loader'
import { type NavNode, type BuildingEntry, type LatLng, SpatialQueryService } from '@navi/core'
import type { BuildingResult } from './building-service'

export interface SnapResult {
  readonly node: NavNode
  readonly distance: number
}

export interface LocationContext {
  readonly position: LatLng
  readonly node?: SnapResult
  readonly building?: BuildingResult
  readonly isIndoor: boolean
}

const BUILDING_CONTAINMENT_METERS = 100

export class LocationService {
  private nodes: NavNode[]
  private buildings: BuildingEntry[]
  private buildingSpatialIndex?: SpatialQueryService

  constructor(pkg: LoadedPackage) {
    this.nodes = pkg.graph.nodes
    this.buildings = pkg.buildingIndex?.buildings ?? []
  }

  private getBuildingSpatialIndex(): SpatialQueryService {
    if (!this.buildingSpatialIndex) {
      this.buildingSpatialIndex = new SpatialQueryService()
      this.buildingSpatialIndex.loadFromNodes(
        this.buildings.map(b => ({
          id: b.id,
          position: b.position,
          type: 'building' as const,
        })),
      )
    }
    return this.buildingSpatialIndex
  }

  resolve(position: LatLng): LocationContext {
    return this.resolveContext(position)
  }

  snapToNode(position: LatLng): SnapResult | undefined {
    return this.resolveContext(position).node
  }

  getBuilding(position: LatLng): BuildingResult | undefined {
    return this.resolveContext(position).building
  }

  getFloor(position: LatLng): number | undefined {
    return this.resolveContext(position).node?.node.floor
  }

  isInsideBuilding(position: LatLng): boolean {
    return this.resolveContext(position).isIndoor
  }

  private resolveContext(position: LatLng): LocationContext {
    const snapResult = this.findNearestNode(position)
    const building = this.findContainingBuilding(position)
    return {
      position,
      node: snapResult ?? undefined,
      building: building ?? undefined,
      isIndoor: building !== null,
    }
  }

  private findNearestNode(position: LatLng): SnapResult | null {
    if (this.nodes.length === 0) return null
    const svc = new SpatialQueryService()
    svc.loadFromNodes(this.nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
    const result = svc.nearestEntity(position)
    if (!result) return null
    const node = this.nodes.find(n => n.id === result.entity.id)
    if (!node) return null
    return { node, distance: result.distance }
  }

  private findContainingBuilding(position: LatLng): BuildingResult | null {
    if (this.buildings.length === 0) return null
    const idx = this.getBuildingSpatialIndex()
    const result = idx.nearestEntity(position, { maxDistance: BUILDING_CONTAINMENT_METERS })
    if (!result) return null
    const nearest = this.buildings.find(b => b.id === result.entity.id)
    if (!nearest) return null
    return {
      id: nearest.id,
      name: nearest.name,
      code: nearest.code,
      category: nearest.category,
      position: nearest.position,
      entrances: nearest.entrances.map(e => e.id),
      floors: nearest.floors.map(f => f.label),
    }
  }
}
