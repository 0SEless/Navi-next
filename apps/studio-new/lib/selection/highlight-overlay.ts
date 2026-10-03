/**
 * Stage 4.3 — Highlight Overlay
 *
 * Passive observer of SelectionManager.
 * When selection changes, looks up the entity in CampusDocument,
 * converts to GeoJSON, and updates a MapLibre highlight source.
 *
 * Architectural rules:
 *   - NEVER modifies SelectionManager
 *   - NEVER modifies CampusDocument
 *   - ONLY updates the highlight layer on the map
 */

import type maplibregl from 'maplibre-gl'
import type { CampusDocument, Building, Road, Room, Hallway, LegacyStaircase, LegacyElevator, Entrance, Panorama, QRCheckpoint, LatLng } from '@navi/core'
import { SelectionManager } from './selection-manager'
import type { EntityRef } from './selection-manager'

const HIGHLIGHT_SOURCE = 'navi-highlight'
const HIGHLIGHT_LAYER_FILL = 'navi-highlight-fill'
const HIGHLIGHT_LAYER_OUTLINE = 'navi-highlight-outline'
const HIGHLIGHT_LAYER_CIRCLE = 'navi-highlight-circle'

function latLngToCoord(p: LatLng): [number, number] {
  return [p.lng, p.lat]
}

function localToWorldCoord(
  local: { x: number; y: number },
  origin: { lat: number; lng: number },
): [number, number] {
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

function entityToGeoJSON(
  doc: CampusDocument,
  entity: EntityRef,
): GeoJSON.FeatureCollection | null {
  switch (entity.type) {
    case 'building': {
      const b = doc.buildings.find(x => x.id === entity.id)
      if (!b || b.footprint.points.length < 3) return null
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: b.id,
          properties: { id: b.id, type: 'building' },
          geometry: {
            type: 'Polygon',
            coordinates: [b.footprint.points.map(latLngToCoord)],
          },
        }],
      }
    }

    case 'road': {
      const r = doc.roads.find(x => x.id === entity.id)
      if (!r || r.polyline.points.length < 2) return null
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: r.id,
          properties: { id: r.id, type: 'road' },
          geometry: {
            type: 'LineString',
            coordinates: r.polyline.points.map(latLngToCoord),
          },
        }],
      }
    }

    case 'room': {
      for (const b of doc.buildings) {
        if (b.footprint.points.length < 2) continue
        const origin = computeCentroid(b.footprint.points)
        for (const f of b.floors) {
          const room = f.rooms.find(x => x.id === entity.id)
          if (!room) continue
          const coords = room.polygon.points.map(p => localToWorldCoord(p, origin))
          if (coords.length < 3) return null
          return {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              id: room.id,
              properties: { id: room.id, type: 'room', buildingId: b.id, floorId: f.id },
              geometry: { type: 'Polygon', coordinates: [coords] },
            }],
          }
        }
      }
      return null
    }

    case 'hallway': {
      for (const b of doc.buildings) {
        if (b.footprint.points.length < 2) continue
        const origin = computeCentroid(b.footprint.points)
        for (const f of b.floors) {
          const hw = f.hallways.find(x => x.id === entity.id)
          if (!hw) continue
          const coords = hw.polyline.points.map(p => localToWorldCoord(p, origin))
          if (coords.length < 2) return null
          return {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              id: hw.id,
              properties: { id: hw.id, type: 'hallway', buildingId: b.id, floorId: f.id },
              geometry: { type: 'LineString', coordinates: coords },
            }],
          }
        }
      }
      return null
    }

    case 'staircase': {
      for (const b of doc.buildings) {
        if (b.footprint.points.length < 2) continue
        const origin = computeCentroid(b.footprint.points)
        for (const f of b.floors) {
          const s = f.staircases.find(x => x.id === entity.id)
          if (!s) continue
          return {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: s.id,
              properties: { id: s.id, type: 'staircase', buildingId: b.id, floorId: f.id },
              geometry: { type: 'Point', coordinates: localToWorldCoord(s.position, origin) },
            }],
          }
        }
      }
      return null
    }

    case 'elevator': {
      for (const b of doc.buildings) {
        if (b.footprint.points.length < 2) continue
        const origin = computeCentroid(b.footprint.points)
        for (const f of b.floors) {
          const e = f.elevators.find(x => x.id === entity.id)
          if (!e) continue
          return {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: e.id,
              properties: { id: e.id, type: 'elevator', buildingId: b.id, floorId: f.id },
              geometry: { type: 'Point', coordinates: localToWorldCoord(e.position, origin) },
            }],
          }
        }
      }
      return null
    }

    case 'entrance': {
      for (const b of doc.buildings) {
        for (const f of b.floors) {
          const e = f.entrances.find(x => x.id === entity.id)
          if (!e) continue
          return {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature', id: e.id,
              properties: { id: e.id, type: 'entrance', buildingId: b.id, floorId: f.id },
              geometry: { type: 'Point', coordinates: latLngToCoord(e.position) },
            }],
          }
        }
      }
      return null
    }

    case 'panorama': {
      const p = doc.panoramas.find(x => x.id === entity.id)
      if (!p) return null
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: p.id,
          properties: { id: p.id, type: 'panorama' },
          geometry: { type: 'Point', coordinates: latLngToCoord(p.position) },
        }],
      }
    }

    case 'qr': {
      const q = doc.qrCheckpoints.find(x => x.id === entity.id)
      if (!q) return null
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: q.id,
          properties: { id: q.id, type: 'qr' },
          geometry: { type: 'Point', coordinates: latLngToCoord(q.position) },
        }],
      }
    }

    default:
      return null
  }
}

export class HighlightOverlay {
  private map: maplibregl.Map
  private selectionManager: SelectionManager
  private document: CampusDocument
  private unsub: (() => void) | null = null
  private initialized = false

  constructor(
    map: maplibregl.Map,
    selectionManager: SelectionManager,
    document: CampusDocument,
  ) {
    this.map = map
    this.selectionManager = selectionManager
    this.document = document
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true

    const setup = () => {
      this.addSource()
      this.addLayers()
      this.unsub = this.selectionManager.onChange(() => {
        this.syncHighlight()
      })
      // Initial sync
      this.syncHighlight()
    }

    if (this.map.loaded()) {
      setup()
    } else {
      this.map.on('load', setup)
    }
  }

  /** Update the document reference (called when document changes). */
  setDocument(doc: CampusDocument): void {
    this.document = doc
    this.syncHighlight()
  }

  destroy(): void {
    this.unsub?.()
    try { this.map.removeLayer(HIGHLIGHT_LAYER_FILL) } catch { /* ok */ }
    try { this.map.removeLayer(HIGHLIGHT_LAYER_OUTLINE) } catch { /* ok */ }
    try { this.map.removeLayer(HIGHLIGHT_LAYER_CIRCLE) } catch { /* ok */ }
    try { this.map.removeSource(HIGHLIGHT_SOURCE) } catch { /* ok */ }
    this.initialized = false
  }

  private addSource(): void {
    if (this.map.getSource(HIGHLIGHT_SOURCE)) return
    this.map.addSource(HIGHLIGHT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  private addLayers(): void {
    const layerDefs = [
      {
        id: HIGHLIGHT_LAYER_FILL,
        source: HIGHLIGHT_SOURCE,
        type: 'fill',
        paint: {
          'fill-color': '#3B82F6',
          'fill-opacity': 0.2,
        },
        filter: ['==', ['geometry-type'], 'Polygon'],
      },
      {
        id: HIGHLIGHT_LAYER_OUTLINE,
        source: HIGHLIGHT_SOURCE,
        type: 'line',
        paint: {
          'line-color': '#3B82F6',
          'line-width': 3,
          'line-opacity': 0.9,
        },
      },
      {
        id: HIGHLIGHT_LAYER_CIRCLE,
        source: HIGHLIGHT_SOURCE,
        type: 'circle',
        paint: {
          'circle-radius': 8,
          'circle-color': '#3B82F6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.9,
        },
        filter: ['==', ['geometry-type'], 'Point'],
      },
    ] as any[]

    for (const def of layerDefs) {
      if (this.map.getLayer(def.id)) continue
      this.map.addLayer(def)
    }
  }

  private syncHighlight(): void {
    if (!this.initialized) return

    const entities = this.selectionManager.allSelected
    const features: GeoJSON.Feature[] = []

    for (const entity of entities) {
      const fc = entityToGeoJSON(this.document, entity)
      if (fc) features.push(...fc.features)
    }

    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }

    try {
      const source = this.map.getSource(HIGHLIGHT_SOURCE) as any
      if (source?.setData) source.setData(data)
    } catch { /* source may not be ready */ }
  }
}
