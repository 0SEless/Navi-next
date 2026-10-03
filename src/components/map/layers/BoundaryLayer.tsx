'use client'

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { NavigationRenderModel } from '@/components/map/NavigationRenderModel'

const SRC = 'boundary'
const LYR = {
  FILL: 'boundary-fill',
  OUTLINE: 'boundary-outline',
} as const

export interface BoundaryLayerProps {
  map: maplibregl.Map | null
  boundary: NavigationRenderModel['boundary']
}

export function BoundaryLayer({ map, boundary }: BoundaryLayerProps) {
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!map || initializedRef.current) return
    if (map.getSource(SRC)) {
      initializedRef.current = true
      return
    }

    const init = () => {
      if (initializedRef.current) return
      if (map.getSource(SRC)) {
        initializedRef.current = true
        return
      }

      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: LYR.FILL,
        type: 'fill',
        source: SRC,
        paint: { 'fill-color': '#94A3B8', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: LYR.OUTLINE,
        type: 'line',
        source: SRC,
        paint: { 'line-color': '#94A3B8', 'line-width': 2, 'line-dasharray': [4, 2], 'line-opacity': 0.5 },
      })

      initializedRef.current = true
    }

    if (map.isStyleLoaded()) {
      init()
    } else {
      map.on('load', init)
    }

    return () => {
      try {
        map.off('load', init)
        ;[LYR.OUTLINE, LYR.FILL].forEach(l => { if (map.getLayer(l)) map.removeLayer(l) })
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {}
      initializedRef.current = false
    }
  }, [map])

  useEffect(() => {
    if (!map || !initializedRef.current) return
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    if (!boundary) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    const { minLat, maxLat, minLng, maxLng } = boundary
    const ring: [number, number][] = [
      [minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat],
    ]

    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      }],
    })
  }, [map, boundary])

  return null
}
