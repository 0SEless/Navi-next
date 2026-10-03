/**
 * Snap overlay — visual indicator for the nearest snap point.
 *
 * Uses the existing SnapEngine to find the closest vertex/edge/midpoint/grid
 * and draws a blue circle indicator on the map.
 */

import type maplibregl from 'maplibre-gl'
import type { CampusDocument, LatLng, SnapTarget } from '@navi/core'
import { SnapEngine, DEFAULT_SNAP_CONFIG } from '@navi/core'

const SNAP_SOURCE = 'navi-snap'
const SNAP_LAYER = 'navi-snap-indicator'

function computeCentroid(points: LatLng[]): { lat: number; lng: number } {
  let lat = 0, lng = 0
  for (const p of points) { lat += p.lat; lng += p.lng }
  const n = points.length || 1
  return { lat: lat / n, lng: lng / n }
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

export class SnapOverlay {
  private map: maplibregl.Map
  private engine: SnapEngine
  private initialized = false

  constructor(map: maplibregl.Map) {
    this.map = map
    this.engine = new SnapEngine()
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true

    const setup = () => {
      this.addSource()
      this.addLayer()
    }

    if (this.map.loaded()) {
      setup()
    } else {
      this.map.on('load', setup)
    }
  }

  destroy(): void {
    try { this.map.removeLayer(SNAP_LAYER) } catch { /* ok */ }
    try { this.map.removeSource(SNAP_SOURCE) } catch { /* ok */ }
    this.initialized = false
  }

  /** Populate the SnapEngine from a CampusDocument. */
  sync(doc: CampusDocument): void {
    this.engine.clear()

    for (const b of doc.buildings) {
      if (b.footprint.points.length < 2) continue
      const origin = computeCentroid(b.footprint.points)

      // Building footprint vertices
      for (const pt of b.footprint.points) {
        this.engine.addVertex(pt, b.id, 'vertex')
      }

      for (const floor of b.floors) {
        // Room vertices + edges
        for (const room of floor.rooms) {
          const pts = room.polygon.points.map(p => {
            const [lng, lat] = localToWorldCoord(p, origin)
            return { lat, lng }
          })
          for (let i = 0; i < pts.length; i++) {
            this.engine.addVertex(pts[i], room.id, 'vertex')
            this.engine.addEdge(pts[i], pts[(i + 1) % pts.length], room.id)
          }
        }

        // Hallway vertices + edges
        for (const hw of floor.hallways) {
          const pts = hw.polyline.points.map(p => {
            const [lng, lat] = localToWorldCoord(p, origin)
            return { lat, lng }
          })
          for (let i = 0; i < pts.length; i++) {
            this.engine.addVertex(pts[i], hw.id, 'vertex')
            if (i < pts.length - 1) {
              this.engine.addEdge(pts[i], pts[i + 1], hw.id)
            }
          }
        }

        // Staircase positions
        for (const st of floor.staircases) {
          const [lng, lat] = localToWorldCoord(st.position, origin)
          this.engine.addVertex({ lat, lng }, st.id, 'vertex')
        }

        // Elevator positions
        for (const el of floor.elevators) {
          const [lng, lat] = localToWorldCoord(el.position, origin)
          this.engine.addVertex({ lat, lng }, el.id, 'vertex')
        }

        // Entrance positions (already world coords)
        for (const ent of floor.entrances) {
          this.engine.addEntrance(ent.position, ent.id)
        }
      }
    }

    // Panorama positions (world coords)
    for (const p of doc.panoramas) {
      this.engine.addVertex(p.position, p.id, 'vertex')
    }

    // QR checkpoint positions (world coords)
    for (const q of doc.qrCheckpoints) {
      this.engine.addVertex(q.position, q.id, 'vertex')
    }

    // Road vertices + edges
    for (const r of doc.roads) {
      for (let i = 0; i < r.polyline.points.length; i++) {
        this.engine.addVertex(r.polyline.points[i], r.id, 'vertex')
        if (i < r.polyline.points.length - 1) {
          this.engine.addEdge(r.polyline.points[i], r.polyline.points[i + 1], r.id)
        }
      }
    }
  }

  /** Find the nearest snap to a world point and show the indicator. */
  updateSnap(position: LatLng): SnapTarget | null {
    const target = this.engine.findSnap(position, DEFAULT_SNAP_CONFIG)
    this.updateIndicator(target)
    return target
  }

  /** Hide the snap indicator. */
  clearSnap(): void {
    this.updateIndicator(null)
  }

  private addSource(): void {
    if (this.map.getSource(SNAP_SOURCE)) return
    this.map.addSource(SNAP_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  private addLayer(): void {
    if (this.map.getLayer(SNAP_LAYER)) return
    this.map.addLayer({
      id: SNAP_LAYER,
      source: SNAP_SOURCE,
      type: 'circle',
      paint: {
        'circle-radius': 7,
        'circle-color': '#3B82F6',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.9,
      },
    } as any)
  }

  private updateIndicator(target: SnapTarget | null): void {
    const data: GeoJSON.FeatureCollection = target
      ? {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { type: target.type, distance: target.distance },
            geometry: {
              type: 'Point',
              coordinates: [target.position.lng, target.position.lat],
            },
          }],
        }
      : { type: 'FeatureCollection', features: [] }

    try {
      const source = this.map.getSource(SNAP_SOURCE) as any
      if (source?.setData) source.setData(data)
    } catch { /* source may not be ready */ }
  }
}
