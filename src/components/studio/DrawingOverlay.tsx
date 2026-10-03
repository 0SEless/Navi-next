'use client'

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useDrawingSessionContext } from './useDrawingSession'

const SRC_DRAWING = 's-drawing'

function buildDrawingGeoJSON(
  tracePoints: Array<{ lat: number; lng: number }>,
  drawPoints: Array<{ lat: number; lng: number }>,
  roomDrag: { start: { lat: number; lng: number }; current: { lat: number; lng: number } } | null
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const points = tracePoints.length > 0 ? tracePoints : drawPoints

  if (points.length > 0) {
    const coords: [number, number][] = points.map(p => [p.lng, p.lat])
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    })
    for (const p of points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {},
      })
    }
  }

  if (roomDrag) {
    const s = roomDrag.start
    const c = roomDrag.current
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[s.lng, s.lat], [c.lng, s.lat], [c.lng, c.lat], [s.lng, c.lat], [s.lng, s.lat]]],
      },
      properties: {},
    })
  }

  return { type: 'FeatureCollection', features }
}

interface DrawingOverlayProps {
  map: maplibregl.Map
}

export function DrawingOverlay({ map }: DrawingOverlayProps) {
  const { tracePoints, drawPoints, roomDrag, pendingConfirm } = useDrawingSessionContext()

  useEffect(() => {
    if (pendingConfirm) return

    try {
      const src = map.getSource(SRC_DRAWING) as maplibregl.GeoJSONSource
      if (src) {
        src.setData(buildDrawingGeoJSON(tracePoints, drawPoints, roomDrag))
      }
    } catch { /* source not ready */ }
  }, [map, tracePoints, drawPoints, roomDrag, pendingConfirm])

  return null
}
