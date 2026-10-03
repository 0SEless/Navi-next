import type { LoadedPackage } from '../loader'
import { DataAPI } from './data-api'
import { NavigationService } from './navigation-service'
import { SearchService } from './search-service'
import { BuildingService } from './building-service'
import { LocationService } from './location-service'
import { PanoramaService } from './panorama-service'
import { QrService, type QrApiFallback } from './qr-service'
import { FloorGeometryService } from './floor-geometry-service'

export class RuntimeEngine {
  readonly data: DataAPI
  readonly search: SearchService
  readonly navigation: NavigationService
  readonly buildings: BuildingService
  readonly location: LocationService
  readonly panoramas: PanoramaService
  /** P1-T13 (R10.2): opaque QR checkpoint resolution (local-first + API fallback). */
  readonly qr: QrService
  /** P1-T14: building-local indoor geometry from floor-geometry artifact. */
  readonly floorGeometry: FloorGeometryService

  constructor(pkg: LoadedPackage, qrApiFallback?: QrApiFallback) {
    this.data = new DataAPI(pkg)
    this.search = new SearchService(pkg)
    this.navigation = new NavigationService(pkg)
    this.buildings = new BuildingService(pkg)
    this.location = new LocationService(pkg)
    this.panoramas = new PanoramaService(pkg)
    this.qr = new QrService(pkg, qrApiFallback)
    this.floorGeometry = new FloorGeometryService(pkg)
  }
}
