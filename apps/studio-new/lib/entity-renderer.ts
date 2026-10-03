/**
 * Stage 3A — Entity Rendering Foundation
 *
 * Pure CampusDocument → MapLibre renderer.
 * NO editor logic (no eventBus, selection, viewport, tools).
 *
 * Pipeline:
 *   CampusDocument → EntityRenderer → MapLibre GeoJSON sources + layers
 */

import type maplibregl from 'maplibre-gl'
import type { CampusDocument, Building, Road, Room, Hallway, LegacyStaircase, LegacyElevator, Entrance, Panorama, QRCheckpoint, LatLng } from '@navi/core'

// ── Layer IDs (navi-* convention) ──────────────────────────────

const LAYER = {
  BUILDING_EXTRUSION: 'navi-building-extrusion',
  BUILDING_FILL: 'navi-building-fill',
  BUILDING_OUTLINE: 'navi-building-outline',
  ROOM_FILL: 'navi-room-fill',
  ROOM_OUTLINE: 'navi-room-outline',
  HALLWAY_LINE: 'navi-hallway-line',
  ROAD_LINE: 'navi-road-line',
  ENTRANCE_ICON: 'navi-entrance-icon',
  STAIRCASE_ICON: 'navi-staircase-icon',
  ELEVATOR_ICON: 'navi-elevator-icon',
  PANORAMA_ICON: 'navi-panorama-icon',
  QR_ICON: 'navi-qr-icon',
} as const

const SOURCE = {
  BUILDINGS: 'navi-buildings',
  ROOMS: 'navi-rooms',
  HALLWAYS: 'navi-hallways',
  ROADS: 'navi-roads',
  ENTRANCES: 'navi-entrances',
  STAIRCASES: 'navi-staircases',
  ELEVATORS: 'navi-elevators',
  PANORAMAS: 'navi-panoramas',
  QR: 'navi-qr',
} as const

const ENTITY_ICON_COLORS: Record<string, string> = {
  entrance: '#FF8C00',
  staircase: '#20B2AA',
  elevator: '#9370DB',
  panorama: '#FF69B4',
  qr: '#32CD32',
}

// ── GeoJSON conversion (pure functions) ─────────────────────────

function latLngToCoord(p: LatLng): [number, number] {
  return [p.lng, p.lat]
}

function buildingToFeature(b: Building): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: b.id,
    properties: {
      id: b.id,
      name: b.name,
      code: b.code,
      category: b.category,
      color: b.color ?? '#1C6BEB',
      height: b.height ?? 10,
      baseElevation: b.baseElevation ?? 0,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [b.footprint.points.map(latLngToCoord)],
    },
  }
}

function roadToFeature(r: Road): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: r.id,
    properties: {
      id: r.id,
      name: r.name,
      width: r.width ?? 4,
      surface: r.surface,
      type: r.type,
    },
    geometry: {
      type: 'LineString',
      coordinates: r.polyline.points.map(latLngToCoord),
    },
  }
}

/** Convert a local (x,y) to a world [lng,lat] using the building origin. */
function localToWorldCoord(
  local: { x: number; y: number },
  origin: { lat: number; lng: number },
): [number, number] {
  // Simple offset: 1 unit ≈ 0.00001° (roughly 1m at mid-latitudes)
  const SCALE = 0.00001
  return [
    origin.lng + local.x * SCALE,
    origin.lat - local.y * SCALE,
  ]
}

function computeCentroid(points: LatLng[]): { lat: number; lng: number } {
  let lat = 0, lng = 0
  for (const p of points) { lat += p.lat; lng += p.lng }
  const n = points.length || 1
  return { lat: lat / n, lng: lng / n }
}

function floorFeatures(
  building: Building,
  origin: { lat: number; lng: number },
): { rooms: GeoJSON.Feature[]; hallways: GeoJSON.Feature[]; staircases: GeoJSON.Feature[]; elevators: GeoJSON.Feature[]; entrances: GeoJSON.Feature[] } {
  const rooms: GeoJSON.Feature[] = []
  const hallways: GeoJSON.Feature[] = []
  const staircases: GeoJSON.Feature[] = []
  const elevators: GeoJSON.Feature[] = []
  const entrances: GeoJSON.Feature[] = []

  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      const coords = room.polygon.points.map(p => localToWorldCoord(p, origin))
      if (coords.length >= 3) {
        rooms.push({
          type: 'Feature',
          id: room.id,
          properties: {
            id: room.id, name: room.name, number: room.number,
            category: room.category, buildingId: building.id,
            floorId: floor.id, floor: floor.level,
          },
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
      }
    }
    for (const hw of floor.hallways) {
      const coords = hw.polyline.points.map(p => localToWorldCoord(p, origin))
      if (coords.length >= 2) {
        hallways.push({
          type: 'Feature',
          id: hw.id,
          properties: {
            id: hw.id, name: hw.name, width: hw.width ?? 2,
            buildingId: building.id, floorId: floor.id, floor: floor.level,
          },
          geometry: { type: 'LineString', coordinates: coords },
        })
      }
    }
    for (const st of floor.staircases) {
      const coord = localToWorldCoord(st.position, origin)
      staircases.push({
        type: 'Feature',
        id: st.id,
        properties: { id: st.id, name: st.name, fromLevel: st.fromLevel, toLevel: st.toLevel, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'staircase' },
        geometry: { type: 'Point', coordinates: coord },
      })
    }
    for (const el of floor.elevators) {
      const coord = localToWorldCoord(el.position, origin)
      elevators.push({
        type: 'Feature',
        id: el.id,
        properties: { id: el.id, name: el.name, fromLevel: el.fromLevel, toLevel: el.toLevel, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'elevator' },
        geometry: { type: 'Point', coordinates: coord },
      })
    }
    for (const ent of floor.entrances) {
      entrances.push({
        type: 'Feature',
        id: ent.id,
        properties: { id: ent.id, label: ent.label, level: ent.level, type: ent.type, buildingId: building.id, floorId: floor.id, floor: floor.level, entityType: 'entrance' },
        geometry: { type: 'Point', coordinates: latLngToCoord(ent.position) },
      })
    }
  }

  return { rooms, hallways, staircases, elevators, entrances }
}

export interface GeoJSONSources {
  buildings: GeoJSON.FeatureCollection
  rooms: GeoJSON.FeatureCollection
  hallways: GeoJSON.FeatureCollection
  roads: GeoJSON.FeatureCollection
  staircases: GeoJSON.FeatureCollection
  elevators: GeoJSON.FeatureCollection
  entrances: GeoJSON.FeatureCollection
  panoramas: GeoJSON.FeatureCollection
  qr: GeoJSON.FeatureCollection
}

function panoramaToFeature(p: Panorama): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: p.id,
    properties: { id: p.id, label: p.label, heading: p.heading, imageAssetId: p.imageAssetId, entityType: 'panorama' },
    geometry: { type: 'Point', coordinates: latLngToCoord(p.position) },
  }
}

function qrToFeature(q: QRCheckpoint): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: q.id,
    properties: { id: q.id, label: q.label, code: q.code, entityType: 'qr' },
    geometry: { type: 'Point', coordinates: latLngToCoord(q.position) },
  }
}

export function documentToSources(doc: CampusDocument): GeoJSONSources {
  // Buildings (footprints in world coords)
  const buildingFeatures = doc.buildings.map(buildingToFeature)

  // Roads (polylines in world coords)
  const roadFeatures = doc.roads.map(roadToFeature)

  // World-coord point entities
  const panoramaFeatures = doc.panoramas.map(panoramaToFeature)
  const qrFeatures = doc.qrCheckpoints.map(qrToFeature)

  // Floors — local coords → world via building origin
  const allRooms: GeoJSON.Feature[] = []
  const allHallways: GeoJSON.Feature[] = []
  const allStaircases: GeoJSON.Feature[] = []
  const allElevators: GeoJSON.Feature[] = []
  const allEntrances: GeoJSON.Feature[] = []
  for (const b of doc.buildings) {
    if (b.footprint.points.length < 2) continue
    const origin = computeCentroid(b.footprint.points)
    const features = floorFeatures(b, origin)
    allRooms.push(...features.rooms)
    allHallways.push(...features.hallways)
    allStaircases.push(...features.staircases)
    allElevators.push(...features.elevators)
    allEntrances.push(...features.entrances)
  }

  return {
    buildings: { type: 'FeatureCollection', features: buildingFeatures },
    rooms: { type: 'FeatureCollection', features: allRooms },
    hallways: { type: 'FeatureCollection', features: allHallways },
    roads: { type: 'FeatureCollection', features: roadFeatures },
    staircases: { type: 'FeatureCollection', features: allStaircases },
    elevators: { type: 'FeatureCollection', features: allElevators },
    entrances: { type: 'FeatureCollection', features: allEntrances },
    panoramas: { type: 'FeatureCollection', features: panoramaFeatures },
    qr: { type: 'FeatureCollection', features: qrFeatures },
  }
}

// ── Paint style helpers ─────────────────────────────────────────

function buildingFillPaint(): maplibregl.FillLayerSpecification['paint'] {
  return {
    'fill-color': [
      'case',
      ['has', 'color'], ['get', 'color'],
      '#1C6BEB',
    ],
    'fill-opacity': 0.2,
  }
}

function buildingOutlinePaint(): maplibregl.LineLayerSpecification['paint'] {
  return {
    'line-color': [
      'case',
      ['has', 'color'], ['get', 'color'],
      '#1C6BEB',
    ],
    'line-width': 2,
  }
}

function buildingExtrusionPaint(): maplibregl.FillExtrusionLayerSpecification['paint'] {
  return {
    'fill-extrusion-color': [
      'case',
      ['has', 'color'], ['get', 'color'],
      '#1C6BEB',
    ],
    'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['get', 'baseElevation'],
    'fill-extrusion-opacity': 0.65,
  }
}

function roomFillPaint(): maplibregl.FillLayerSpecification['paint'] {
  return {
    'fill-color': '#87CEEB',
    'fill-opacity': 0.35,
  }
}

function roomOutlinePaint(): maplibregl.LineLayerSpecification['paint'] {
  return {
    'line-color': '#666',
    'line-width': 1,
    'line-opacity': 0.6,
  }
}

function hallwayLinePaint(): maplibregl.LineLayerSpecification['paint'] {
  return {
    'line-color': '#B0C4DE',
    'line-width': ['get', 'width'],
    'line-opacity': 0.7,
  }
}

function roadLinePaint(): maplibregl.LineLayerSpecification['paint'] {
  return {
    'line-color': '#FFD700',
    'line-width': ['get', 'width'],
    'line-opacity': 0.6,
  }
}

function entityCirclePaint(entityType: string): maplibregl.CircleLayerSpecification['paint'] {
  return {
    'circle-radius': 6,
    'circle-color': ENTITY_ICON_COLORS[entityType] || '#888',
    'circle-stroke-width': 2,
    'circle-stroke-color': '#fff',
  }
}

// ── EntityRenderer class ───────────────────────────────────────

export class EntityRenderer {
  private map: maplibregl.Map
  private initialized = false

  constructor(map: maplibregl.Map) {
    this.map = map
  }

  /** Create GeoJSON sources and MapLibre layers. Safe to call multiple times. */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    if (this.map.loaded()) {
      this.addSources()
      this.addLayers()
    } else {
      this.map.on('load', () => {
        this.addSources()
        this.addLayers()
      })
    }
  }

  /** Sync all sources from a CampusDocument. */
  sync(doc: CampusDocument): void {
    const sources = documentToSources(doc)

    this.setSourceData(SOURCE.BUILDINGS, sources.buildings)
    this.setSourceData(SOURCE.ROOMS, sources.rooms)
    this.setSourceData(SOURCE.HALLWAYS, sources.hallways)
    this.setSourceData(SOURCE.ROADS, sources.roads)
    this.setSourceData(SOURCE.STAIRCASES, sources.staircases)
    this.setSourceData(SOURCE.ELEVATORS, sources.elevators)
    this.setSourceData(SOURCE.ENTRANCES, sources.entrances)
    this.setSourceData(SOURCE.PANORAMAS, sources.panoramas)
    this.setSourceData(SOURCE.QR, sources.qr)
  }

  /** Remove all navi-* layers and sources. */
  destroy(): void {
    if (!this.initialized) return
    for (const id of Object.values(LAYER)) {
      try { this.map.removeLayer(id) } catch { /* ok */ }
    }
    for (const id of Object.values(SOURCE)) {
      try { this.map.removeSource(id) } catch { /* ok */ }
    }
    this.initialized = false
  }

  // ── Private ──

  private addSources(): void {
    for (const id of Object.values(SOURCE)) {
      if (this.map.getSource(id)) continue
      this.map.addSource(id, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
  }

  private addLayers(): void {
    const layerDefs: Array<{
      id: string
      source: string
      type: string
      paint: any
      filter?: any[]
    }> = [
      // Buildings — extrusion below fill so hover/fill overlay
      { id: LAYER.BUILDING_EXTRUSION, source: SOURCE.BUILDINGS, type: 'fill-extrusion', paint: buildingExtrusionPaint() },
      { id: LAYER.BUILDING_FILL, source: SOURCE.BUILDINGS, type: 'fill', paint: buildingFillPaint() },
      { id: LAYER.BUILDING_OUTLINE, source: SOURCE.BUILDINGS, type: 'line', paint: buildingOutlinePaint() },
      // Rooms
      { id: LAYER.ROOM_FILL, source: SOURCE.ROOMS, type: 'fill', paint: roomFillPaint() },
      { id: LAYER.ROOM_OUTLINE, source: SOURCE.ROOMS, type: 'line', paint: roomOutlinePaint() },
      // Hallways
      { id: LAYER.HALLWAY_LINE, source: SOURCE.HALLWAYS, type: 'line', paint: hallwayLinePaint() },
      // Roads
      { id: LAYER.ROAD_LINE, source: SOURCE.ROADS, type: 'line', paint: roadLinePaint() },
      // Point entities
      { id: LAYER.ENTRANCE_ICON, source: SOURCE.ENTRANCES, type: 'circle', paint: entityCirclePaint('entrance') },
      { id: LAYER.STAIRCASE_ICON, source: SOURCE.STAIRCASES, type: 'circle', paint: entityCirclePaint('staircase') },
      { id: LAYER.ELEVATOR_ICON, source: SOURCE.ELEVATORS, type: 'circle', paint: entityCirclePaint('elevator') },
      { id: LAYER.PANORAMA_ICON, source: SOURCE.PANORAMAS, type: 'circle', paint: entityCirclePaint('panorama') },
      { id: LAYER.QR_ICON, source: SOURCE.QR, type: 'circle', paint: entityCirclePaint('qr') },
    ]

    for (const def of layerDefs) {
      if (this.map.getLayer(def.id)) continue
      this.map.addLayer(def as any)
    }
  }

  private setSourceData(sourceId: string, data: GeoJSON.FeatureCollection): void {
    try {
      const source = this.map.getSource(sourceId) as any
      if (source?.setData) source.setData(data)
    } catch {
      // source may not be ready
    }
  }
}
