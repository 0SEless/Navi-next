'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { CurrentPosition } from '@navi/runtime'

interface Props {
  map: maplibregl.Map | null
  position: CurrentPosition | null
}

export function BlueDot({ map, position }: Props) {
  const markerRef = useRef<maplibregl.Marker | null>(null)

  useEffect(() => {
    if (!map) return
    const el = document.createElement('div')
    el.style.width = '20px'
    el.style.height = '20px'
    el.style.borderRadius = '50%'
    el.style.backgroundColor = '#3b82f6'
    el.style.border = '3px solid white'
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)'
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([0, 0]).addTo(map)
    return () => { markerRef.current?.remove() }
  }, [map])

  useEffect(() => {
    if (!markerRef.current || !position) return
    markerRef.current.setLngLat([position.latlng.lng, position.latlng.lat])
  }, [position])

  return null
}
