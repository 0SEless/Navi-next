import type maplibregl from 'maplibre-gl'
import type { CampusDocument } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import type { DocumentEventBus } from '../eventbus'
import type { SelectionManager } from '../selection'
import type { Viewport } from '../viewport'
import { documentToGeoJSON, toPreviewFeature } from './geojson'
import {
  LAYER_IDS, SOURCE_IDS,
  buildingFillPaint, buildingOutlinePaint, buildingExtrusionPaint,
  roomFillPaint, roomOutlinePaint,
  hallwayLinePaint,
  roadOutlinePaint, roadFillPaint, navigationOnlyRoadPaint, pathLinePaint,
  entityCirclePaint, poiCirclePaint, poiFillPaint, poiExtrusionPaint, poiOutlinePaint, ENTITY_ICON_COLORS,
  selectionPaint, hoverPaint, previewPaint, validationPaint,
} from './layers'
import type { LayerId } from './layers'

export interface RendererOptions {
  map: maplibregl.Map
  document: CampusDocument
  eventBus: DocumentEventBus
  selection: SelectionManager
  viewport: Viewport
  transformer?: CoordinateTransformer
}

const ENTITY_SOURCE_MAP: Record<string, string> = {
  buildings: SOURCE_IDS.BUILDINGS,
  rooms: SOURCE_IDS.ROOMS,
  hallways: SOURCE_IDS.HALLWAYS,
  roads: SOURCE_IDS.ROADS,
  entrances: SOURCE_IDS.ENTRANCES,
  staircases: SOURCE_IDS.STAIRCASES,
  elevators: SOURCE_IDS.ELEVATORS,
  panoramas: SOURCE_IDS.PANORAMAS,
  qr: SOURCE_IDS.QR,
  pois: SOURCE_IDS.POIS,
}

export class EntityRenderer {
  private map: maplibregl.Map
  private document: CampusDocument
  private eventBus: DocumentEventBus
  private selection: SelectionManager
  private viewport: Viewport
  private transformer?: CoordinateTransformer
  private initialized = false
  private _bootstrapped = false
  private _pollTimer: ReturnType<typeof setInterval> | null = null
  private _handleStyleLoad: (() => void) | null = null
  private _activeFloor: number = 0
  private _showNavigationOnlyRoutes = false
  private _showHiddenPois = false

  constructor(opts: RendererOptions) {
    this.map = opts.map
    this.document = opts.document
    this.eventBus = opts.eventBus
    this.selection = opts.selection
    this.viewport = opts.viewport
    this.transformer = opts.transformer
  }

  /**
   * Set the active floor for indoor layer filtering.
   * Only rooms, hallways, staircases, elevators, and entrances on this floor will be visible.
   */
  setActiveFloor(floor: number): void {
    this._activeFloor = floor
    this.syncAll()
  }

  /** Temporarily reveal routes whose saved display mode is navigation-only. */
  setShowNavigationOnlyRoutes(visible: boolean): void {
    this._showNavigationOnlyRoutes = visible
    try {
      if (this.map.getLayer(LAYER_IDS.NAVIGATION_ONLY_ROAD)) {
        this.map.setLayoutProperty(LAYER_IDS.NAVIGATION_ONLY_ROAD, 'visibility', visible ? 'visible' : 'none')
      }
    } catch {
      // The style may be between reloads; addLayers() reapplies the state.
    }
  }

  /**
   * Studio-only reveal for POIs authored with `visibility.showOnMap === false`.
   * Off by default so "Show on map" means *invisible* in the Studio canvas too;
   * enabling it lets authors select and re-enable hidden POIs.
   */
  setShowHiddenPois(visible: boolean): void {
    this._showHiddenPois = visible
    this.syncAll()
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true

    // Guard: ensure sources/layers are added once the map is ready.
    // The `load` event is a one-shot in MapLibre — if we mount after it
    // fires, the callback would never run.  We therefore poll briefly
    // until `loaded()` returns true, then bootstrap immediately.
    const bootstrap = () => {
      if (this._bootstrapped || !this.initialized) return
      this._bootstrapped = true
      this.addSources()
      this.addLayers()
      this.syncAll()
      this.listenToEvents()
    }

    if (this.map.loaded()) {
      bootstrap()
    } else {
      // Register the one-shot load handler (covers the normal path)
      this.map.once('load', bootstrap)
      // Also poll in case the event already fired between the check and here
      // or loaded() was briefly false due to React async timing.
      this._pollTimer = setInterval(() => {
        if (this.map.loaded()) {
          clearInterval(this._pollTimer!)
          bootstrap()
        }
      }, 50)
      // Safety: stop polling after 5 s even if loaded() stays false
      setTimeout(() => { if (this._pollTimer) clearInterval(this._pollTimer) }, 5000)
    }

    // Re-add sources and layers after style change (map.setStyle removes them)
    this._handleStyleLoad = () => {
      this._bootstrapped = false
      this.addSources()
      this.addLayers()
      this.syncAll()
    }
    this.map.on('style.load', this._handleStyleLoad)
  }

  destroy(): void {
    if (this._handleStyleLoad) {
      this.map.off('style.load', this._handleStyleLoad)
      this._handleStyleLoad = null
    }
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null }
    for (const id of Object.values(LAYER_IDS)) {
      try { if (this.map.getLayer(id)) this.map.removeLayer(id) } catch { /* ok */ }
    }
    for (const id of Object.values(SOURCE_IDS)) {
      try { if (this.map.getSource(id)) this.map.removeSource(id) } catch { /* ok */ }
    }
    this.initialized = false
    this._bootstrapped = false
  }

  setTransformer(t: CoordinateTransformer): void {
    this.transformer = t
    this.syncAll()
  }

  syncAll(): void {
    const sources = documentToGeoJSON(this.document, { transformer: this.transformer })

    // Indoor entity types that should be filtered by active floor
    const INDOOR_TYPES = new Set(['rooms', 'hallways', 'staircases', 'elevators', 'entrances', 'pois'])

    for (const [key, sourceId] of Object.entries(SOURCE_IDS)) {
      const keyLower = key.toLowerCase()
      const match = Object.entries(ENTITY_SOURCE_MAP).find(([_, v]) => v === sourceId)
      const sourceKey = match ? match[0] : null

      if (sourceKey && sources[sourceKey]) {
        // Filter indoor layers by active floor. Outdoor/campus POIs are
        // world-scoped and stay visible on every floor.
        if (INDOOR_TYPES.has(sourceKey)) {
          let features = sources[sourceKey].features.filter(
            (f: GeoJSON.Feature) => f.properties?.scope === 'outdoor' || f.properties?.floor === this._activeFloor
          )
          // `showOnMap: false` hides a POI everywhere by default; the Studio
          // reveal toggle brings hidden POIs back for editing.
          if (sourceKey === 'pois' && !this._showHiddenPois) {
            features = features.filter((f: GeoJSON.Feature) => f.properties?.showOnMap !== false)
          }
          const filtered: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features,
          }
          this.updateSource(sourceId, filtered)
        } else {
          this.updateSource(sourceId, sources[sourceKey])
        }
      } else if (keyLower === 'buildings' && sources.buildings) {
        this.updateSource(sourceId, sources.buildings)
      } else if (keyLower === 'preview' || keyLower === 'selection') {
        continue
      }
    }
  }

  // ── Preview layer ──

  setPreview(geometry: GeoJSON.Geometry | null): void {
    if (!this.sourceExists(SOURCE_IDS.PREVIEW)) return
    const fc: GeoJSON.FeatureCollection = geometry
      ? { type: 'FeatureCollection', features: [toPreviewFeature(geometry)] }
      : { type: 'FeatureCollection', features: [] }
    this.updateSource(SOURCE_IDS.PREVIEW, fc)
  }

  clearPreview(): void {
    this.setPreview(null)
  }

  // ── Selection overlay ──

  updateSelection(coords: [number, number][][]): void {
    if (!this.sourceExists(SOURCE_IDS.SELECTION)) return
    const features = coords.map(ring => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: ring },
    })) as unknown as GeoJSON.Feature[]
    this.updateSource(SOURCE_IDS.SELECTION, { type: 'FeatureCollection', features })
  }

  clearSelection(): void {
    this.updateSelection([])
  }

  // ── Private ──

  private addSources(): void {
    this.addGeoJSONSource(SOURCE_IDS.BUILDINGS)
    this.addGeoJSONSource(SOURCE_IDS.ROOMS)
    this.addGeoJSONSource(SOURCE_IDS.HALLWAYS)
    this.addGeoJSONSource(SOURCE_IDS.ROADS)
    this.addGeoJSONSource(SOURCE_IDS.ENTRANCES)
    this.addGeoJSONSource(SOURCE_IDS.STAIRCASES)
    this.addGeoJSONSource(SOURCE_IDS.ELEVATORS)
    this.addGeoJSONSource(SOURCE_IDS.PANORAMAS)
    this.addGeoJSONSource(SOURCE_IDS.QR)
    this.addGeoJSONSource(SOURCE_IDS.POIS)
    this.addGeoJSONSource(SOURCE_IDS.PREVIEW)
    this.addGeoJSONSource(SOURCE_IDS.SELECTION)
  }

  private addGeoJSONSource(id: string): void {
    if (this.map.getSource(id)) return
    this.map.addSource(id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'id',
    })
  }

  private addLayers(): void {
    const visibleRoadFilter = ['all', ['!=', ['get', 'displayMode'], 'navigation-only'], ['!=', ['get', 'type'], 'pedestrian']]
    const visiblePedestrianFilter = ['all', ['!=', ['get', 'displayMode'], 'navigation-only'], ['==', ['get', 'type'], 'pedestrian']]
    const layerDefs: Array<{ id: LayerId; source: string; type: string; paint: any; filter?: any[]; layout?: any }> = [
      // Roads (below buildings per V1 hierarchy)
      { id: LAYER_IDS.ROAD_OUTLINE, source: SOURCE_IDS.ROADS, type: 'line', paint: roadOutlinePaint(), filter: visibleRoadFilter },
      { id: LAYER_IDS.ROAD_FILL, source: SOURCE_IDS.ROADS, type: 'line', paint: roadFillPaint(), filter: visibleRoadFilter },
      { id: LAYER_IDS.PATH_LINE, source: SOURCE_IDS.ROADS, type: 'line', paint: pathLinePaint(), filter: visiblePedestrianFilter },
      { id: LAYER_IDS.NAVIGATION_ONLY_ROAD, source: SOURCE_IDS.ROADS, type: 'line', paint: navigationOnlyRoadPaint(), filter: ['==', ['get', 'displayMode'], 'navigation-only'], layout: { visibility: this._showNavigationOnlyRoutes ? 'visible' : 'none' } },
      // Buildings (above roads)
      { id: LAYER_IDS.BUILDING_EXTRUSION, source: SOURCE_IDS.BUILDINGS, type: 'fill-extrusion', paint: buildingExtrusionPaint() },
      { id: LAYER_IDS.BUILDING_FILL, source: SOURCE_IDS.BUILDINGS, type: 'fill', paint: buildingFillPaint() },
      { id: LAYER_IDS.BUILDING_OUTLINE, source: SOURCE_IDS.BUILDINGS, type: 'line', paint: buildingOutlinePaint() },
      // Rooms and hallways (inside buildings)
      { id: LAYER_IDS.ROOM_FILL, source: SOURCE_IDS.ROOMS, type: 'fill', paint: roomFillPaint() },
      { id: LAYER_IDS.ROOM_OUTLINE, source: SOURCE_IDS.ROOMS, type: 'line', paint: roomOutlinePaint() },
      { id: LAYER_IDS.HALLWAY_LINE, source: SOURCE_IDS.HALLWAYS, type: 'line', paint: hallwayLinePaint() },
      // Entrances and points of interest
      { id: LAYER_IDS.ENTRANCE_ICON, source: SOURCE_IDS.ENTRANCES, type: 'circle', paint: entityCirclePaint('entrance') },
      { id: LAYER_IDS.STAIRCASE_ICON, source: SOURCE_IDS.STAIRCASES, type: 'circle', paint: entityCirclePaint('staircase') },
      { id: LAYER_IDS.ELEVATOR_ICON, source: SOURCE_IDS.ELEVATORS, type: 'circle', paint: entityCirclePaint('elevator') },
      { id: LAYER_IDS.PANORAMA_ICON, source: SOURCE_IDS.PANORAMAS, type: 'circle', paint: entityCirclePaint('panorama') },
      { id: LAYER_IDS.QR_ICON, source: SOURCE_IDS.QR, type: 'circle', paint: entityCirclePaint('qr') },
      { id: LAYER_IDS.POI_FILL, source: SOURCE_IDS.POIS, type: 'fill', paint: poiFillPaint(), filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'appearanceMode'], '2d']] },
      { id: LAYER_IDS.POI_EXTRUSION, source: SOURCE_IDS.POIS, type: 'fill-extrusion', paint: poiExtrusionPaint(), filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'appearanceMode'], '2.5d']] },
      { id: LAYER_IDS.POI_OUTLINE, source: SOURCE_IDS.POIS, type: 'line', paint: poiOutlinePaint(), filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['any', ['==', ['get', 'appearanceMode'], '2d'], ['==', ['get', 'appearanceMode'], '2.5d']] ] },
      { id: LAYER_IDS.POI_ICON, source: SOURCE_IDS.POIS, type: 'circle', paint: poiCirclePaint(), filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'appearanceMode'], 'marker']] },
      // Top-level overlays (above all map content)
      { id: LAYER_IDS.SELECTION_OVERLAY, source: SOURCE_IDS.SELECTION, type: 'line', paint: selectionPaint() },
      { id: LAYER_IDS.HOVER_HIGHLIGHT, source: SOURCE_IDS.SELECTION, type: 'line', paint: hoverPaint() },
      { id: LAYER_IDS.PREVIEW, source: SOURCE_IDS.PREVIEW, type: 'line', paint: previewPaint() },
      { id: LAYER_IDS.VALIDATION_OVERLAY, source: SOURCE_IDS.SELECTION, type: 'line', paint: validationPaint() },
    ]

    for (const def of layerDefs) {
      if (this.map.getLayer(def.id)) continue
      this.map.addLayer(def as any)
    }
  }

  private listenToEvents(): void {
    this.eventBus.on('entity.created', (e) => { this.syncAll() })
    this.eventBus.on('entity.deleted', (e) => { this.syncAll() })
    this.eventBus.on('entity.updated', (e) => { this.syncAll() })
    // History undo/redo dispatches inverse commands with skipHooks, so those
    // commands intentionally do not emit entity.* events. document.changed is
    // emitted for every successful command and is the renderer's fallback for
    // those canonical document mutations.
    this.eventBus.on('document.changed', () => { this.syncAll() })
  }

  private updateSource(sourceId: string, data: GeoJSON.FeatureCollection): void {
    try {
      const source = this.map.getSource(sourceId) as any
      if (source?.setData) source.setData(data)
    } catch {
      // source may not be ready
    }
  }

  private sourceExists(id: string): boolean {
    return !!this.map.getSource(id)
  }
}
