'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { ElevatorRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'
import { generateElevatorGraphicsLatLng } from '@navi/editor/src/rendering/feature-graphics'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'elevators'
const LYR_SHAFT_FILL = 'elevators-shaft-fill'
const LYR_SHAFT_OUTLINE = 'elevators-shaft-outline'
const LYR_CABIN = 'elevators-cabin-outline'
const LYR_DOORS = 'elevators-door-lines'
const LYR_SYMBOL = 'elevators-layer'

// ── Props ──────────────────────────────────────────────────────

export interface ElevatorLayerProps {
  map: maplibregl.Map | null
  elevators: ElevatorRenderData[]
  buildingId?: string
  floor?: number
  /** W16C: Explicit indoor context — gates layer visibility. */
  indoorContext?: { active: boolean; buildingId?: string; floorId?: number }
}

// ── Helpers ────────────────────────────────────────────────────

export function buildElevatorGeoJSON(elevators: ElevatorRenderData[]) {
  const features: GeoJSON.Feature[] = []

  for (const e of elevators) {
    if (e.polygon && e.polygon.length >= 3) {
      const graphics = generateElevatorGraphicsLatLng(e.polygon)

      // 1. Elevator shaft fill & outline
      const shaftCoords = [...graphics.shaftOutline.map(p => [p.lng, p.lat] as [number, number]), [graphics.shaftOutline[0].lng, graphics.shaftOutline[0].lat] as [number, number]]
      features.push({
        type: 'Feature',
        id: `${e.id}-shaft`,
        properties: { id: e.id, featureId: e.id, kind: 'shaft', name: e.name, buildingId: e.buildingId, floor: e.floor },
        geometry: { type: 'Polygon', coordinates: [shaftCoords] },
      })

      // 2. Cabin inset box
      if (graphics.cabinOutline.length >= 3) {
        const cabinCoords = graphics.cabinOutline.map(p => [p.lng, p.lat] as [number, number])
        features.push({
          type: 'Feature',
          id: `${e.id}-cabin`,
          properties: { id: e.id, featureId: e.id, kind: 'cabin', buildingId: e.buildingId, floor: e.floor },
          geometry: { type: 'Polygon', coordinates: [cabinCoords] },
        })
      }

      // 3. Door marker double lines
      for (let i = 0; i < graphics.doorLines.length; i++) {
        const dl = graphics.doorLines[i]
        features.push({
          type: 'Feature',
          id: `${e.id}-door-${i}`,
          properties: { id: e.id, featureId: e.id, kind: 'door', buildingId: e.buildingId, floor: e.floor },
          geometry: { type: 'LineString', coordinates: [[dl[0].lng, dl[0].lat], [dl[1].lng, dl[1].lat]] },
        })
      }
    }

    // 4. Central glyph point
    features.push({
      type: 'Feature',
      id: `${e.id}-symbol`,
      properties: {
        id: e.id,
        featureId: e.id,
        kind: 'symbol',
        name: e.name,
        buildingId: e.buildingId,
        floor: e.floor,
      },
      geometry: {
        type: 'Point',
        coordinates: [e.position.lng, e.position.lat],
      },
    })
  }

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

// ── Component ──────────────────────────────────────────────────

export function ElevatorLayer({
  map,
  elevators,
  buildingId,
  floor,
  indoorContext,
}: ElevatorLayerProps) {
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

      // Shaft fill
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_SHAFT_FILL,
        type: 'fill',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'shaft'],
        paint: {
          'fill-color': cssVar('--navi-connector-elevator', '#6366F1'),
          'fill-opacity': 0.16,
        },
      })

      // Shaft outline
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_SHAFT_OUTLINE,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'shaft'],
        paint: {
          'line-color': cssVar('--navi-connector-elevator', '#6366F1'),
          'line-width': 2,
          'line-opacity': 0.9,
        },
      })

      // Cabin inset outline
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_CABIN,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'cabin'],
        paint: {
          'line-color': cssVar('--navi-connector-elevator', '#818CF8'),
          'line-width': 1.5,
          'line-opacity': 0.8,
          'line-dasharray': [3, 1.5],
        },
      })

      // Door indicator lines
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_DOORS,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'door'],
        paint: {
          'line-color': cssVar('--navi-connector-elevator', '#4F46E5'),
          'line-width': 3,
          'line-opacity': 0.95,
        },
      })

      // Elevator marker — EL label, connector accent (spec §5.2).
      // W16C: minzoom removed — visibility gated by indoorContext in setData.
      map.addLayer({
        id: LYR_SYMBOL,
        type: 'symbol',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'symbol'],
        layout: {
          'text-field': 'EL',
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': cssVar('--navi-connector-elevator', '#6366F1'),
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
        if (map.getLayer(LYR_DOORS)) map.removeLayer(LYR_DOORS)
        if (map.getLayer(LYR_CABIN)) map.removeLayer(LYR_CABIN)
        if (map.getLayer(LYR_SHAFT_OUTLINE)) map.removeLayer(LYR_SHAFT_OUTLINE)
        if (map.getLayer(LYR_SHAFT_FILL)) map.removeLayer(LYR_SHAFT_FILL)
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

    // W16C: If indoor context is inactive, hide all elevators
    if (!indoorContext?.active) {
      src.setData(buildElevatorGeoJSON([]))
      hasPopulatedRef.current = true
      map.triggerRepaint()
      return
    }

    let filtered = elevators
    // W16C: Gate by indoor context building and floor
    if (indoorContext.buildingId) {
      filtered = filtered.filter(e => e.buildingId === indoorContext.buildingId)
    }
    if (indoorContext.floorId !== undefined) {
      filtered = filtered.filter(e => e.floor === indoorContext.floorId)
    }
    // Also apply legacy buildingId/floor props if provided
    if (buildingId) filtered = filtered.filter(e => e.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(e => e.floor === floor)

    src.setData(buildElevatorGeoJSON(filtered))
    hasPopulatedRef.current = true
    map.triggerRepaint()
  }, [map, elevators, buildingId, floor, indoorContext])

  useEffect(() => {
    setData()
  }, [setData, indoorContext])

  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, elevators, indoorContext])

  return null
}
