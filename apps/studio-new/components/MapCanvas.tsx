'use client'

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}

interface MapCanvasProps {
  center?: { lat: number; lng: number }
  zoom?: number
  onMapReady?: (map: maplibregl.Map) => void
}

export function MapCanvas({ center, zoom, onMapReady }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (mapRef.current) return
    const container = containerRef.current
    if (!container) return

    const c = center ?? { lat: 11.8195, lng: 122.0922 }
    const z = zoom ?? 17
    let mounted = true

    const map = new maplibregl.Map({
      container,
      style: OSM_STYLE,
      center: [c.lng, c.lat],
      zoom: z,
    })

    map.on('load', () => {
      if (!mounted) return
      setReady(true)
      onMapReady?.(map)
    })

    mapRef.current = map

    return () => {
      mounted = false
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
