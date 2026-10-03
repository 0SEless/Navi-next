'use client'

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { useDrawingSessionContext } from './useDrawingSession'

const SRC_DRAWING = 's-drawing'

function buildPreviewGeoJSON(
  pendingConfirm: { type: string; points: Array<{ lat: number; lng: number }> } | null
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (!pendingConfirm || pendingConfirm.points.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }

  const isPolygon = pendingConfirm.type === 'building'
    || pendingConfirm.type === 'boundary'
    || pendingConfirm.type === 'import-osm'
    || pendingConfirm.type === 'set-boundary'
  const coords: [number, number][] = pendingConfirm.points.map((p: any) => [p.lng, p.lat])

  if (isPolygon && pendingConfirm.points.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
      properties: { pending: true },
    })
  }
  features.push({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: isPolygon && pendingConfirm.points.length >= 3 ? [...coords, coords[0]] : coords,
    },
    properties: { pending: true },
  })
  for (const p of pendingConfirm.points) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { pending: true },
    })
  }

  return { type: 'FeatureCollection', features }
}

interface PreviewOverlayProps {
  map: maplibregl.Map
}

export function PreviewOverlay({ map }: PreviewOverlayProps) {
  const { pendingConfirm } = useDrawingSessionContext()

  useEffect(() => {
    try {
      const src = map.getSource(SRC_DRAWING) as maplibregl.GeoJSONSource
      if (src) {
        src.setData(buildPreviewGeoJSON(pendingConfirm))
      }
    } catch { /* source not ready */ }
  }, [map, pendingConfirm])

  return null
}
