'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { HallwayRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'hallways'
const LYR = {
  FILL: 'hallways-fill',
  OUTLINE: 'hallways-outline',
} as const

// ── Props ──────────────────────────────────────────────────────

export interface HallwayLayerProps {
  map: maplibregl.Map | null
  hallways: HallwayRenderData[]
  buildingId?: string
  floor?: number
  /** W16C: Explicit indoor context — gates layer visibility. */
  indoorContext?: { active: boolean; buildingId?: string; floorId?: number }
}

// ── Helpers ────────────────────────────────────────────────────

export function buildHallwayGeoJSON(hallways: HallwayRenderData[]) {
  return {
    type: 'FeatureCollection' as const,
    features: hallways
      .filter(h => h.polygon.length >= 3)
      .map(h => ({
        type: 'Feature' as const,
        id: h.id,
        properties: {
          id: h.id,
          name: h.name,
          buildingId: h.buildingId,
          floor: h.floor,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [h.polygon.map(p => [p.lng, p.lat] as [number, number])],
        },
      })),
  }
}

// ── Component ──────────────────────────────────────────────────

export function HallwayLayer({
  map,
  hallways,
  buildingId,
  floor,
  indoorContext,
}: HallwayLayerProps) {
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

      // Fill layer — subtle fill to distinguish from background
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR.FILL,
        type: 'fill',
        source: SRC,
        paint: {
          'fill-color': cssVar('--navi-room-fill', '#F1F5F9'),
          'fill-opacity': 0.4,
        },
      })

      // Outline layer — solid, lighter than room outline (spec §4.2).
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR.OUTLINE,
        type: 'line',
        source: SRC,
        paint: {
          'line-color': cssVar('--navi-hallway-outline', '#E2E8F0'),
          'line-width': 1,
          'line-opacity': 1,
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
        ;[LYR.OUTLINE, LYR.FILL].forEach(l => {
          if (map.getLayer(l)) map.removeLayer(l)
        })
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

    // W16C: If indoor context is inactive, hide all hallways
    if (!indoorContext?.active) {
      src.setData(buildHallwayGeoJSON([]))
      hasPopulatedRef.current = true
      map.triggerRepaint()
      return
    }

    let filtered = hallways
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId) {
      filtered = filtered.filter(h => h.buildingId === indoorContext.buildingId)
    }
    if (indoorContext.floorId !== undefined) {
      filtered = filtered.filter(h => h.floor === indoorContext.floorId)
    }
    // Also apply legacy buildingId/floor props if provided
    if (buildingId) filtered = filtered.filter(h => h.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(h => h.floor === floor)

    src.setData(buildHallwayGeoJSON(filtered))
    hasPopulatedRef.current = true
    map.triggerRepaint()
  }, [map, hallways, buildingId, floor, indoorContext])

  useEffect(() => {
    setData()
  }, [setData, indoorContext])

  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, hallways, indoorContext])

  return null
}
