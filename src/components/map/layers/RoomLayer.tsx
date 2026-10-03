'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { RoomRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'rooms'
const LYR = {
  FILL: 'rooms-fill',
  OUTLINE: 'rooms-outline',
  LABELS: 'rooms-labels',
} as const

// ── Props ──────────────────────────────────────────────────────

export interface RoomLayerProps {
  map: maplibregl.Map | null
  rooms: RoomRenderData[]
  buildingId?: string
  floor?: number
  onRoomClick?: (roomId: string) => void
  /** W16C: Explicit indoor context — gates layer visibility. */
  indoorContext?: { active: boolean; buildingId?: string; floorId?: number }
}

// ── Helpers ────────────────────────────────────────────────────

export function buildRoomGeoJSON(rooms: RoomRenderData[]) {
  return {
    type: 'FeatureCollection' as const,
    features: rooms
      .filter(r => r.polygon.length >= 3)
      .map(r => ({
        type: 'Feature' as const,
        id: r.id,
        properties: {
          id: r.id,
          name: r.name,
          buildingId: r.buildingId,
          floor: r.floor,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [r.polygon.map(p => [p.lng, p.lat] as [number, number])],
        },
      })),
  }
}

// ── Component ──────────────────────────────────────────────────

export function RoomLayer({
  map,
  rooms,
  buildingId,
  floor,
  onRoomClick,
  indoorContext,
}: RoomLayerProps) {
  const initializedRef = useRef(false)
  const hasPopulatedRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)

  // Initialize sources and layers
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

      // Fill layer — neutral, category-agnostic (spec §4.1). Selection brightens.
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR.FILL,
        type: 'fill',
        source: SRC,
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            cssVar('--navi-room-selected-fill', '#DBEAFE'),
            cssVar('--navi-room-fill', '#F1F5F9'),
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.9,
            ['boolean', ['feature-state', 'hovered'], false], 0.85,
            0.7,
          ],
        },
      })

      // Outline layer — thin neutral; blue + thicker on hover/selection.
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR.OUTLINE,
        type: 'line',
        source: SRC,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            cssVar('--navi-room-selected-outline', '#3B82F6'),
            ['boolean', ['feature-state', 'hovered'], false],
            cssVar('--navi-room-selected-outline', '#3B82F6'),
            cssVar('--navi-room-outline', '#CBD5E1'),
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 2,
            1,
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1,
            ['boolean', ['feature-state', 'hovered'], false], 1,
            0.7,
          ],
        },
      })

      // Labels layer — subdued; appear at medium-high zoom only (spec §6).
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR.LABELS,
        type: 'symbol',
        source: SRC,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-offset': [0, 0],
          'text-anchor': 'center',
        },
        paint: {
          'text-color': cssVar('--navi-text-secondary', '#64748B'),
          'text-halo-color': cssVar('--navi-card', '#FFFFFF'),
          'text-halo-width': 1.5,
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
        ;[LYR.LABELS, LYR.OUTLINE, LYR.FILL].forEach(l => {
          if (map.getLayer(l)) map.removeLayer(l)
        })
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {}
      initializedRef.current = false
      hasPopulatedRef.current = false
    }
  }, [map])

  // Sync room data with optional building/floor filter
  const setData = useCallback(() => {
    if (!map || !initializedRef.current) return
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    // W16C: If indoor context is inactive, hide all rooms
    if (!indoorContext?.active) {
      src.setData(buildRoomGeoJSON([]))
      hasPopulatedRef.current = true
      map.triggerRepaint()
      return
    }

    let filtered = rooms
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId) {
      filtered = filtered.filter(r => r.buildingId === indoorContext.buildingId)
    }
    if (indoorContext.floorId !== undefined) {
      filtered = filtered.filter(r => r.floor === indoorContext.floorId)
    }
    // Also apply legacy buildingId/floor props if provided
    if (buildingId) filtered = filtered.filter(r => r.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(r => r.floor === floor)

    src.setData(buildRoomGeoJSON(filtered))
    hasPopulatedRef.current = true
    // Re-apply persistent selection after data refresh.
    if (selectedIdRef.current) {
      try { map.setFeatureState({ source: SRC, id: selectedIdRef.current }, { selected: true }) } catch {}
    }
    map.triggerRepaint()
  }, [map, rooms, buildingId, floor, indoorContext])

  useEffect(() => {
    setData()
  }, [setData, indoorContext])

  // Post-init safety net
  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, rooms, indoorContext])

  // Click handler — toggles persistent selection, then notifies parent.
  useEffect(() => {
    if (!map) return

    const handler = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
      if (e.features && e.features.length > 0) {
        const id = e.features[0].properties?.id
        if (id) {
          if (selectedIdRef.current && selectedIdRef.current !== id) {
            try { map.setFeatureState({ source: SRC, id: selectedIdRef.current }, { selected: false }) } catch {}
          }
          const isSelected = selectedIdRef.current === id
          try { map.setFeatureState({ source: SRC, id }, { selected: !isSelected }) } catch {}
          selectedIdRef.current = isSelected ? null : id
          onRoomClick?.(id)
        }
      }
    }

    map.on('click', LYR.FILL, handler)
    return () => { try { map.off('click', LYR.FILL, handler) } catch {} }
  }, [map, onRoomClick])

  // Hover — cursor + feature-state (fixes prior no-op hover fill).
  useEffect(() => {
    if (!map) return

    const onMouseEnter = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      const f = e.features?.[0]
      if (f) { try { map.setFeatureState({ source: SRC, id: f.id }, { hovered: true }) } catch {} }
    }
    const onMouseLeave = (e: maplibregl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = ''
      const f = e.features?.[0]
      if (f) { try { map.setFeatureState({ source: SRC, id: f.id }, { hovered: false }) } catch {} }
    }

    map.on('mouseenter', LYR.FILL, onMouseEnter)
    map.on('mouseleave', LYR.FILL, onMouseLeave)
    return () => {
      try {
        map.off('mouseenter', LYR.FILL, onMouseEnter)
        map.off('mouseleave', LYR.FILL, onMouseLeave)
      } catch {}
    }
  }, [map])

  return null
}
