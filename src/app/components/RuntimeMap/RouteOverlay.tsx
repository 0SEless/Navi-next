'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Route } from '@navi/runtime'

interface Props {
  map: maplibregl.Map | null
  route: Route | null
}

const SOURCE_ID = 'route'
const LAYER_ID = 'route-line'

export function RouteOverlay({ map, route }: Props) {
  const added = useRef(false)

  useEffect(() => {
    if (!map || !route) return

    const coords = route.path.map(s => [s.position.lng, s.position.lat])

    const source: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    }

    if (!added.current) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: source })
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 0.8 },
      })
      added.current = true
    } else {
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource
      src?.setData(source)
    }

    if (coords.length > 1) {
      map.fitBounds(coords.reduce<[[number, number], [number, number]]>((acc, c) => {
        acc[0][0] = Math.min(acc[0][0], c[0])
        acc[0][1] = Math.min(acc[0][1], c[1])
        acc[1][0] = Math.max(acc[1][0], c[0])
        acc[1][1] = Math.max(acc[1][1], c[1])
        return acc
      }, [[Infinity, Infinity], [-Infinity, -Infinity]]), { padding: 80 })
    }

    return () => {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      } catch {}
      added.current = false
    }
  }, [map, route])

  return null
}
