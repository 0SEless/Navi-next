import type { LoadedPackage } from '../loader'
import type { NavigationGraph, SearchIndex, BuildingIndex, BuildingEntry, BoundingBox } from '@navi/core'
import type { NavigationPackageManifest } from '@navi/core'

export class DataAPI {
  constructor(private pkg: LoadedPackage) {}

  getGraph(): NavigationGraph { return this.pkg.graph }
  getSearchIndex(): SearchIndex | undefined { return this.pkg.searchIndex }
  getPOI(): unknown { return this.pkg.poiIndex }
  getBuildings(): BuildingIndex | undefined { return this.pkg.buildingIndex }
  getManifest(): NavigationPackageManifest { return this.pkg.manifest }
  getBuilding(id: string): BuildingEntry | undefined {
    return this.pkg.buildingIndex?.buildings.find(b => b.id === id)
  }
  getCampusId(): string { return this.pkg.manifest.campusId }
  getBoundingBox(): BoundingBox { return this.pkg.graph.metadata.boundingBox }
}
