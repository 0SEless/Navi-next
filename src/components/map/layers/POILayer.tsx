'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { PoiRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'pois'
const LYR = 'pois-layer'

// ── Props ──────────────────────────────────────────────────────

export interface POILayerProps {
  map: maplibregl.Map | null
  pois: PoiRenderData[]
  buildingId?: string
  floor?: number
  /** Temporarily revealed hidden POIs (e.g. a hidden-but-searchable match). */
  revealedIds?: readonly string[]
  onPoiClick?: (poiId: string) => void
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Build POI point features. POIs carry accent color (spec §5.3) so they read
 * as distinct from the quiet neutral room/hallway geometry.
 *
 * Visibility: `showOnMap === false` POIs are omitted unless they are in the
 * transient `revealedIds` set (public search reveal). The reveal is never
 * persisted; clearing the search restores the hidden state.
 */
export function buildPoiGeoJSON(pois: PoiRenderData[], revealedIds?: readonly string[]) {
  const revealed = new Set(revealedIds ?? [])
  const visible = pois.filter(p => p.showOnMap !== false || revealed.has(p.id))
  return {
    type: 'FeatureCollection' as const,
    features: visible.map(p => ({
      type: 'Feature' as const,
      id: p.id,
      properties: {
        id: p.id,
        name: p.name,
        buildingId: p.buildingId,
        floor: p.floor,
        category: p.category ?? '',
        revealed: revealed.has(p.id),
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [p.position.lng, p.position.lat] as [number, number],
      },
    })),
  }
}

// ── Component ──────────────────────────────────────────────────

export function POILayer({
  map,
  pois,
  buildingId,
  floor,
  revealedIds,
  onPoiClick,
}: POILayerProps) {
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

      // POI marker — accent-colored pin (spec §5.3). Quiet baseline otherwise.
      // A search-revealed hidden POI gets a larger, accented ring so the user
      // notices the temporary reveal.
      map.addLayer({
        id: LYR,
        type: 'circle',
        source: SRC,
        minzoom: 16,
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'revealed'], false], 9, 7],
          'circle-color': cssVar('--navi-accent', '#7C3AED'),
          'circle-stroke-width': ['case', ['boolean', ['get', 'revealed'], false], 3, 2],
          'circle-stroke-color': ['case',
            ['boolean', ['get', 'revealed'], false], cssVar('--navi-accent', '#7C3AED'),
            cssVar('--navi-card', '#FFFFFF'),
          ],
          'circle-opacity': 0.95,
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

    let filtered = pois
    if (buildingId) filtered = filtered.filter(p => p.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(p => p.floor === floor)

    src.setData(buildPoiGeoJSON(filtered, revealedIds))
    hasPopulatedRef.current = true
    map.triggerRepaint()
  }, [map, pois, buildingId, floor, revealedIds])

  useEffect(() => {
    setData()
  }, [setData])

  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, pois])

  // Click handler
  useEffect(() => {
    if (!map || !onPoiClick) return

    const handler = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
      if (e.features && e.features.length > 0) {
        const id = e.features[0].properties?.id
        if (id) onPoiClick(id)
      }
    }

    map.on('click', LYR, handler)
    return () => { try { map.off('click', LYR, handler) } catch {} }
  }, [map, onPoiClick])

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
