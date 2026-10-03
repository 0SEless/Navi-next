'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { DoorRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'doors'
const LYR = 'doors-layer'

// ── Props ──────────────────────────────────────────────────────

export interface DoorLayerProps {
  map: maplibregl.Map | null
  doors: DoorRenderData[]
  buildingId?: string
  floor?: number
  onDoorClick?: (doorId: string) => void
  /** W16C: Explicit indoor context — gates layer visibility. */
  indoorContext?: { active: boolean; buildingId?: string; floorId?: number }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Build a door as a short line segment — the wall opening.
 * The line is centered on the door position and extends `width/2` in each
 * direction, rotated by `angle` (degrees). This replaces the old red/orange
 * circle markers with a neutral, architectural wall-opening line (spec §4.3).
 */
export function buildDoorGeoJSON(doors: DoorRenderData[]) {
  return {
    type: 'FeatureCollection' as const,
    features: doors.map(d => {
      const half = (d.width || 1) / 2
      const a = ((d.angle ?? 0) * Math.PI) / 180
      const dx = half * Math.cos(a)
      const dy = half * Math.sin(a)
      const lng = d.position.lng
      const lat = d.position.lat
      return {
        type: 'Feature' as const,
        id: d.id,
        properties: {
          id: d.id,
          roomId: d.roomId,
          buildingId: d.buildingId,
          floor: d.floor,
          width: d.width,
          angle: d.angle ?? 0,
          connectedToId: d.connectedToId,
          isExterior: d.isExterior,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [lng - dx, lat - dy],
            [lng + dx, lat + dy],
          ] as [number, number][],
        },
      }
    }),
  }
}

// ── Component ──────────────────────────────────────────────────

export function DoorLayer({
  map,
  doors,
  buildingId,
  floor,
  onDoorClick,
  indoorContext,
}: DoorLayerProps) {
  const initializedRef = useRef(false)
  const hasPopulatedRef = useRef(false)

  useEffect(() => {
    if (!map) return
    if (initializedRef.current) return
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

      // Wall-opening line — neutral, exterior slightly thicker (spec §4.3).
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR,
        type: 'line',
        source: SRC,
        paint: {
          'line-color': cssVar('--navi-door-outline', '#475569'),
          'line-width': [
            'case',
            ['get', 'isExterior'], 2.5,
            2,
          ],
          'line-opacity': 0.85,
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
      hasPopulatedRef.current = false
    }
  }, [map])

  const setData = useCallback(() => {
    if (!map || !initializedRef.current) return
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    // W16C: If indoor context is inactive, hide all doors
    if (!indoorContext?.active) {
      src.setData(buildDoorGeoJSON([]))
      hasPopulatedRef.current = true
      map.triggerRepaint()
      return
    }

    let filtered = doors
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId) {
      filtered = filtered.filter(d => d.buildingId === indoorContext.buildingId)
    }
    if (indoorContext.floorId !== undefined) {
      filtered = filtered.filter(d => d.floor === indoorContext.floorId)
    }
    // Also apply legacy buildingId/floor props if provided
    if (buildingId) filtered = filtered.filter(d => d.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(d => d.floor === floor)

    src.setData(buildDoorGeoJSON(filtered))
    hasPopulatedRef.current = true
    map.triggerRepaint()
  }, [map, doors, buildingId, floor, indoorContext])

  useEffect(() => {
    setData()
  }, [setData, indoorContext])

  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, doors, indoorContext])

  // Click handler
  useEffect(() => {
    if (!map || !onDoorClick) return

    const handler = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
      if (e.features && e.features.length > 0) {
        const id = e.features[0].properties?.id
        if (id) onDoorClick(id)
      }
    }

    map.on('click', LYR, handler)
    return () => { try { map.off('click', LYR, handler) } catch {} }
  }, [map, onDoorClick])

  // Hover cursor
  useEffect(() => {
    if (!map) return

    const onMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('mouseenter', LYR, onMouseEnter)
    map.on('mouseleave', LYR, onMouseLeave)
    return () => {
      try {
        map.off('mouseenter', LYR, onMouseEnter)
        map.off('mouseleave', LYR, onMouseLeave)
      } catch {}
    }
  }, [map])

  return null
}
