/**
 * P4-T2: React hook that extracts MapLibre camera state.
 *
 * Listens for MapLibre move/zoom/rotate events and returns camera state
 * as { center: LatLng, zoom: number, bearing: number }.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { LatLng } from '@navi/core'

// ── Types ──

export interface MapLibreCameraState {
  center: LatLng
  zoom: number
  bearing: number
}

export interface MapLike {
  getCenter(): { lat: number; lng: number }
  getZoom(): number
  getBearing(): number
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
}

// ── Hook ──

export function useMapLibreCamera(map: MapLike | null): MapLibreCameraState {
  const [camera, setCamera] = useState<MapLibreCameraState>(() => ({
    center: { lat: 0, lng: 0 },
    zoom: 1,
    bearing: 0,
  }))

  const mapRef = useRef(map)
  mapRef.current = map

  const updateCamera = useCallback(() => {
    const m = mapRef.current
    if (!m) return
    const c = m.getCenter()
    setCamera({
      center: { lat: c.lat, lng: c.lng },
      zoom: m.getZoom(),
      bearing: m.getBearing(),
    })
  }, [])

  useEffect(() => {
    const m = map
    if (!m) return

    updateCamera()

    const events = ['move', 'zoom', 'rotate']
    for (const event of events) {
      m.on(event, updateCamera)
    }

    return () => {
      for (const event of events) {
        m.off(event, updateCamera)
      }
    }
  }, [map, updateCamera])

  return camera
}
