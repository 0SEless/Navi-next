'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { StairRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'
import { generateStairGraphicsLatLng } from '@navi/editor/src/rendering/feature-graphics'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'stairs'
const LYR_FILL = 'stairs-fill'
const LYR_OUTLINE = 'stairs-outline'
const LYR_TREADS = 'stairs-treads'
const LYR_ARROW = 'stairs-arrow'
const LYR_SYMBOL = 'stairs-layer'

// ── Props ──────────────────────────────────────────────────────

export interface StaircaseLayerProps {
  map: maplibregl.Map | null
  stairs: StairRenderData[]
  buildingId?: string
  floor?: number
  /** W16C: Explicit indoor context — gates layer visibility. */
  indoorContext?: { active: boolean; buildingId?: string; floorId?: number }
}

// ── Helpers ────────────────────────────────────────────────────

export function buildStairGeoJSON(stairs: StairRenderData[]) {
  const features: GeoJSON.Feature[] = []

  for (const s of stairs) {
    if (s.polygon && s.polygon.length >= 3) {
      const graphics = generateStairGraphicsLatLng(s.polygon)

      // 1. Staircase shaft fill & outline
      const coords = [...graphics.outline.map(p => [p.lng, p.lat] as [number, number]), [graphics.outline[0].lng, graphics.outline[0].lat] as [number, number]]
      features.push({
        type: 'Feature',
        id: `${s.id}-body`,
        properties: { id: s.id, featureId: s.id, kind: 'body', name: s.name, buildingId: s.buildingId, floor: s.floor },
        geometry: { type: 'Polygon', coordinates: [coords] },
      })

      // 2. Tread step lines
      for (let i = 0; i < graphics.treads.length; i++) {
        const tr = graphics.treads[i]
        features.push({
          type: 'Feature',
          id: `${s.id}-tread-${i}`,
          properties: { id: s.id, featureId: s.id, kind: 'tread', buildingId: s.buildingId, floor: s.floor },
          geometry: { type: 'LineString', coordinates: [[tr[0].lng, tr[0].lat], [tr[1].lng, tr[1].lat]] },
        })
      }

      // 3. Directional walk arrow
      if (graphics.arrow.length >= 2) {
        features.push({
          type: 'Feature',
          id: `${s.id}-arrow`,
          properties: { id: s.id, featureId: s.id, kind: 'arrow', buildingId: s.buildingId, floor: s.floor },
          geometry: { type: 'LineString', coordinates: graphics.arrow.map(p => [p.lng, p.lat]) },
        })
      }
    }

    // 4. Central glyph/symbol point
    features.push({
      type: 'Feature',
      id: `${s.id}-symbol`,
      properties: {
        id: s.id,
        featureId: s.id,
        kind: 'symbol',
        name: s.name,
        buildingId: s.buildingId,
        floor: s.floor,
      },
      geometry: {
        type: 'Point',
        coordinates: [s.position.lng, s.position.lat],
      },
    })
  }

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

// ── Component ──────────────────────────────────────────────────

export function StaircaseLayer({
  map,
  stairs,
  buildingId,
  floor,
  indoorContext,
}: StaircaseLayerProps) {
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

      // Staircase body fill
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_FILL,
        type: 'fill',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'body'],
        paint: {
          'fill-color': cssVar('--navi-connector-stair', '#F59E0B'),
          'fill-opacity': 0.18,
        },
      })

      // Staircase body outline
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_OUTLINE,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'body'],
        paint: {
          'line-color': cssVar('--navi-connector-stair', '#F59E0B'),
          'line-width': 2,
          'line-opacity': 0.9,
        },
      })

      // Stair treads
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_TREADS,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'tread'],
        paint: {
          'line-color': cssVar('--navi-connector-stair', '#F59E0B'),
          'line-width': 1.5,
          'line-opacity': 0.75,
        },
      })

      // Walk arrow
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_ARROW,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'arrow'],
        paint: {
          'line-color': cssVar('--navi-connector-stair', '#D97706'),
          'line-width': 2,
          'line-opacity': 0.85,
        },
      })

      // Stair marker — architectural ↕ symbol
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_SYMBOL,
        type: 'symbol',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'symbol'],
        layout: {
          'text-field': '↕',
          'text-size': 16,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': cssVar('--navi-connector-stair', '#F59E0B'),
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
        if (map.getLayer(LYR_SYMBOL)) map.removeLayer(LYR_SYMBOL)
        if (map.getLayer(LYR_ARROW)) map.removeLayer(LYR_ARROW)
        if (map.getLayer(LYR_TREADS)) map.removeLayer(LYR_TREADS)
        if (map.getLayer(LYR_OUTLINE)) map.removeLayer(LYR_OUTLINE)
        if (map.getLayer(LYR_FILL)) map.removeLayer(LYR_FILL)
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

    // W16C: If indoor context is inactive, hide all stairs
    if (!indoorContext?.active) {
      src.setData(buildStairGeoJSON([]))
      hasPopulatedRef.current = true
      map.triggerRepaint()
      return
    }

    let filtered = stairs
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId) {
      filtered = filtered.filter(s => s.buildingId === indoorContext.buildingId)
    }
    if (indoorContext.floorId !== undefined) {
      filtered = filtered.filter(s => s.floor === indoorContext.floorId)
    }
    // Also apply legacy buildingId/floor props if provided
    if (buildingId) filtered = filtered.filter(s => s.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(s => s.floor === floor)

    src.setData(buildStairGeoJSON(filtered))
    hasPopulatedRef.current = true
    map.triggerRepaint()
  }, [map, stairs, buildingId, floor, indoorContext])

  useEffect(() => {
    setData()
  }, [setData, indoorContext])

  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, stairs, indoorContext])

  return null
}
