import { type LatLng, type PanoramaEntry, type HotspotEntry, SpatialQueryService } from '@navi/core'
import type { LoadedPackage } from '../loader'

// ── Panorama Service (M6.5b) ──
// Viewer-agnostic capability. Exposes panorama metadata and hotspot relationships
// only. No rendering, camera, transition, DOM, or viewer-library concerns.

export interface PanoramaPosition {
  readonly yaw: number // degrees, 0-360
  readonly pitch: number // degrees, -90 to 90
}

export interface PanoramaResult {
  readonly id: string
  readonly roomId?: string
  readonly buildingId?: string
  readonly floor?: number
  readonly imageAssetId: string
  readonly heading?: number
  readonly position: LatLng
}

export interface HotspotContent {
  readonly title?: string
  readonly description?: string
  readonly imageUrl?: string
  readonly linkUrl?: string
  readonly linkLabel?: string
  readonly entityId?: string
}

export interface HotspotResult {
  readonly id: string
  readonly type: 'navigation' | 'information' | 'link'
  readonly position: PanoramaPosition
  readonly targetPanoramaId?: string
  readonly targetRoomId?: string
  readonly targetUrl?: string
  readonly label?: string
  readonly hotspotType?: 'navigation' | 'information'
  readonly content?: HotspotContent
}

export class PanoramaService {
  private readonly panoramas: readonly PanoramaEntry[]
  private readonly panoramaIds: ReadonlySet<string>
  private spatialIndex?: SpatialQueryService

  constructor(pkg: LoadedPackage) {
    this.panoramas = pkg.panoramaIndex?.panoramas ?? []
    this.panoramaIds = new Set(this.panoramas.map(p => p.id))
  }

  private getSpatialIndex(): SpatialQueryService {
    if (!this.spatialIndex) {
      this.spatialIndex = new SpatialQueryService()
      this.spatialIndex.loadFromNodes(
        this.panoramas.map(p => ({
          id: p.id,
          position: p.position,
          type: 'panorama' as const,
          buildingId: p.buildingId,
          floor: p.floor,
        })),
      )
    }
    return this.spatialIndex
  }

  get(id: string): PanoramaResult | undefined {
    const entry = this.panoramas.find(p => p.id === id)
    return entry ? this.mapPanorama(entry) : undefined
  }

  list(buildingId?: string): PanoramaResult[] {
    return this.panoramas
      .filter(p => (buildingId ? p.buildingId === buildingId : true))
      .map(p => this.mapPanorama(p))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  findNearest(position: LatLng): PanoramaResult | undefined {
    if (this.panoramas.length === 0) return undefined
    const idx = this.getSpatialIndex()
    const result = idx.nearestEntity(position)
    if (!result) return undefined
    const entry = this.panoramas.find(p => p.id === result.entity.id)
    return entry ? this.mapPanorama(entry) : undefined
  }

  getHotspots(panoramaId: string): HotspotResult[] {
    const entry = this.panoramas.find(p => p.id === panoramaId)
    if (!entry) return []
    return entry.hotspots.map(h => this.mapHotspot(h))
  }

  resolve(roomId: string): PanoramaResult | undefined {
    const entry = this.panoramas.find(p =>
      p.hotspots.some(h => h.type === 'navigation' && h.target === roomId),
    )
    if (!entry) return undefined
    return this.mapPanorama(entry, roomId)
  }

  private mapPanorama(entry: PanoramaEntry, roomId?: string): PanoramaResult {
    return {
      id: entry.id,
      roomId,
      buildingId: entry.buildingId,
      floor: entry.floor,
      imageAssetId: entry.imageAssetId,
      heading: entry.heading,
      position: entry.position,
    }
  }

  private mapHotspot(h: HotspotEntry): HotspotResult {
    const base: HotspotResult = {
      id: h.id,
      type: h.type,
      position: { yaw: h.yaw, pitch: h.pitch },
      label: h.label,
      hotspotType: h.hotspotType,
      content: h.content,
    }
    if (h.type === 'navigation') {
      if (this.panoramaIds.has(h.target)) {
        return { ...base, targetPanoramaId: h.target }
      }
      return { ...base, targetRoomId: h.target }
    }
    if (h.type === 'link') {
      return { ...base, targetUrl: h.target }
    }
    return base
  }
}
