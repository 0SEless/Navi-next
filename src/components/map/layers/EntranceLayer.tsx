'use client'

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { EntranceRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'

const SRC = 'entrances'
const LYR = 'entrances-layer'

export interface EntranceLayerProps {
  map: maplibregl.Map | null
  entrances: EntranceRenderData[]
}

export function EntranceLayer({ map, entrances }: EntranceLayerProps) {
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
      // Entrance marker — house glyph, distinct green accent (spec §5.4).
      map.addLayer({
        id: LYR,
        type: 'symbol',
        source: SRC,
        minzoom: 15,
        layout: {
          'text-field': '⌂',
          'text-size': 18,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': cssVar('--navi-entrance-marker', '#10B981'),
          'text-halo-color': cssVar('--navi-card', '#FFFFFF'),
          'text-halo-width': 2,
        },
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
        if (map.getLayer(LYR)) map.removeLayer(LYR)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {}
      initializedRef.current = false
    }
  }, [map])

  useEffect(() => {
    if (!map || !initializedRef.current) return
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    const features = entrances.map(e => ({
      type: 'Feature' as const,
      properties: { id: e.id, label: e.label, floor: e.floor, buildingId: e.buildingId },
      geometry: { type: 'Point' as const, coordinates: [e.position.lng, e.position.lat] as [number, number] },
    }))

    src.setData({ type: 'FeatureCollection', features })
  }, [map, entrances])

  return null
}
