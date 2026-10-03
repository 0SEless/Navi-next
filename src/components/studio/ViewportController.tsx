'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useEditor } from '@navi/editor'
import type { ViewportCommand } from '@navi/editor'
import maplibregl from 'maplibre-gl'
import { useGraphStore } from '@/store/graph-store'
import { computeCampusBounds } from '@/lib/campus-bounds'

interface ViewportControllerProps {
  map: maplibregl.Map
  initialCenter?: { lat: number; lng: number }
}

/**
 * One-shot campus auto-framing contract (Phase 2G):
 *  - frames the selected campus exactly once per campus identity/load
 *  - priority: campus boundary -> building geometry -> route nodes
 *  - falls back to `initialCenter` flyTo only when no usable campus geometry
 *  - normal edits/rerenders do NOT reset the camera (guard keyed by campusId)
 *  - switching campus re-frames once for the new selection
 *  - geolocation is never consulted here
 */
export function ViewportController({ map, initialCenter }: ViewportControllerProps) {
  const { services } = useEditor()
  const viewport = services.get('viewport')
  const eventBus = services.get('eventBus')
  const graph = useGraphStore((s) => s.graph)
  const framedRef = useRef<string | null>(null)
  const initialDoneRef = useRef(false)

  const campusId = (graph as { campusId?: string } | null)?.campusId ?? null
  const bounds = useMemo(() => computeCampusBounds(graph as Record<string, unknown> | null), [graph])

  useEffect(() => {
    if (!campusId) return
    if (framedRef.current === campusId) return
    if (!bounds) return
    const sw: [number, number] = [bounds.minLng, bounds.minLat]
    const ne: [number, number] = [bounds.maxLng, bounds.maxLat]
    const singlePoint = bounds.minLat === bounds.maxLat && bounds.minLng === bounds.maxLng
    if (singlePoint) {
      map.flyTo({ center: sw, zoom: 18, duration: 300 })
    } else {
      map.fitBounds(new maplibregl.LngLatBounds(sw, ne), { padding: 80, maxZoom: 19, duration: 300 })
    }
    framedRef.current = campusId
  }, [map, campusId, bounds])

  useEffect(() => {
    if (initialDoneRef.current) return
    if (bounds) { initialDoneRef.current = true; return } // campus geometry wins over fallback center
    if (initialCenter) {
      map.flyTo({ center: [initialCenter.lng, initialCenter.lat], zoom: 17 })
      initialDoneRef.current = true
    }
  }, [map, initialCenter, bounds])

  useEffect(() => {
    if (!viewport || !eventBus) return

    const executeCommand = () => {
      const cmd: ViewportCommand | null = viewport.consumePendingCommand()
      if (!cmd) return

      switch (cmd.type) {
        case 'flyTo':
          if (cmd.center) {
            map.flyTo({
              center: [cmd.center.lng, cmd.center.lat],
              zoom: cmd.zoom,
              duration: cmd.duration ?? 500,
            })
          }
          break
        case 'fitBounds':
          if (cmd.bounds) {
            const b = new maplibregl.LngLatBounds(
              [cmd.bounds.sw.lng, cmd.bounds.sw.lat],
              [cmd.bounds.ne.lng, cmd.bounds.ne.lat],
            )
            map.fitBounds(b, { padding: cmd.padding ?? 80, duration: cmd.duration ?? 500 })
          }
          break
        case 'easeTo':
          map.easeTo({
            center: cmd.center ? [cmd.center.lng, cmd.center.lat] : undefined,
            zoom: cmd.zoom,
            bearing: cmd.bearing,
            pitch: cmd.pitch,
            duration: cmd.duration ?? 500,
          })
          break
        case 'reset':
          map.flyTo({ center: [0, 0], zoom: 15, bearing: 0, pitch: 0 })
          break
        case 'zoomToSelection':
          break
      }
    }

    executeCommand()

    const unsub = eventBus.on('viewport.changed', executeCommand)
    return () => { unsub() }
  }, [map, viewport, eventBus])

  return null
}
