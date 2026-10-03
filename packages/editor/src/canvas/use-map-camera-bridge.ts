/**
 * P4-T4: Bridge hook that syncs MapLibre camera → Canvas CameraState.
 *
 * Listens to MapLibre's move events and converts the geographic
 * camera (center, zoom, bearing) into a Canvas CameraState using
 * the building-local coordinate transformer.
 *
 * This ensures the Canvas overlay renders at the correct geographic
 * position when the user pans/zooms the MapLibre map.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createCamera, type CameraState } from './viewport'
import type { CoordinateTransformer } from '@navi/core'

interface MapLibreLike {
  getCenter(): { lng: number; lat: number }
  getZoom(): number
  getBearing(): number
  on(event: string, cb: () => void): void
  off(event: string, cb: () => void): void
}

/**
 * Derive a Canvas CameraState from the current MapLibre view.
 *
 * Converts the MapLibre geographic center to building-local meters
 * using the CoordinateTransformer, and maps MapLibre zoom/bearing
 * to Canvas zoom/rotation.
 */
function deriveCanvasCamera(
  map: MapLibreLike,
  buildingId: string,
  transformer: CoordinateTransformer,
): CameraState {
  const center = map.getCenter()
  const zoom = map.getZoom()
  const bearing = map.getBearing()

  const local = transformer.worldToBuildingLocal(
    { lat: center.lat, lng: center.lng },
    buildingId,
  )

  const localCenter = local ?? { x: 0, y: 0 }

  const canvasZoom = Math.pow(2, zoom - 14)

  return createCamera({
    center: localCenter,
    zoom: canvasZoom,
    rotation: -bearing,
  })
}

/**
 * Syncs MapLibre camera state to Canvas CameraState.
 *
 * Returns a CameraState that reflects the current MapLibre view,
 * updating whenever the user pans, zooms, or rotates the map.
 */
export function useMapCameraBridge(
  map: MapLibreLike | null,
  buildingId: string,
  transformer: CoordinateTransformer | null,
): CameraState {
  const [camera, setCamera] = useState<CameraState>(() => createCamera())
  const mapRef = useRef(map)
  const transformerRef = useRef(transformer)
  const buildingIdRef = useRef(buildingId)

  useEffect(() => { mapRef.current = map }, [map])
  useEffect(() => { transformerRef.current = transformer }, [transformer])
  useEffect(() => { buildingIdRef.current = buildingId }, [buildingId])

  const syncCamera = useCallback(() => {
    const m = mapRef.current
    const t = transformerRef.current
    if (!m || !t) return
    setCamera(deriveCanvasCamera(m, buildingIdRef.current, t))
  }, [])

  useEffect(() => {
    const m = mapRef.current
    if (!m) return

    syncCamera()

    m.on('move', syncCamera)
    m.on('zoom', syncCamera)
    m.on('rotate', syncCamera)

    return () => {
      m.off('move', syncCamera)
      m.off('zoom', syncCamera)
      m.off('rotate', syncCamera)
    }
  }, [map, syncCamera])

  return camera
}
