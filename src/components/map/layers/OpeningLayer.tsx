'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { OpeningRenderData, WallRenderData } from '@/components/map/NavigationRenderModel'
import { cssVar } from '@/components/map/mapTheme'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'openings'
const LYR = {
  DOOR_LINE: 'openings-door-line',
  DOOR_FILL: 'openings-door-fill',
  DOOR_OUTLINE: 'openings-door-outline',
  WINDOW_FILL: 'openings-window-fill',
  WINDOW_OUTLINE: 'openings-window-outline',
} as const

// ── Props ──────────────────────────────────────────────────────

export interface OpeningLayerProps {
  map: maplibregl.Map | null
  openings: OpeningRenderData[]
  walls?: WallRenderData[]
  buildingId?: string
  floor?: number
  indoorContext?: { active: boolean; buildingId?: string; floorId?: number }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Compute the world position (lat/lng) of an opening along a wall.
 * Opening offset is meters from wall.start; wall coordinates are lat/lng.
 */
function openingPosition(
  wall: WallRenderData,
  offset: number,
): { lat: number; lng: number } | null {
  const dx = wall.end.lng - wall.start.lng
  const dy = wall.end.lat - wall.start.lat
  const wallLenDeg = Math.sqrt(dx * dx + dy * dy)
  if (wallLenDeg < 1e-10) return null

  const wallLenM = wallLenDeg * 111320
  const t = Math.min(Math.max(offset / wallLenM, 0), 1)

  return {
    lng: wall.start.lng + dx * t,
    lat: wall.start.lat + dy * t,
  }
}

/**
 * Compute the wall direction angle in radians (atan2 of wall vector).
 */
function wallAngle(wall: WallRenderData): number {
  const dx = wall.end.lng - wall.start.lng
  const dy = wall.end.lat - wall.start.lat
  return Math.atan2(dy, dx)
}

/**
 * Build GeoJSON features for openings.
 *
 * Door openings: rendered as short line segments perpendicular to the wall
 * (or rotated by the explicit `orientation` angle if provided).
 * Window openings: rendered as circle markers.
 */
export function buildOpeningGeoJSON(
  openings: OpeningRenderData[],
  walls: WallRenderData[] = [],
) {
  // Index walls by id for O(1) lookup
  const wallMap = new Map<string, WallRenderData>()
  for (const w of walls) wallMap.set(w.id, w)

  const doorLineFeatures: GeoJSON.Feature[] = []
  const circleFeatures: GeoJSON.Feature[] = []

  for (const o of openings) {
    const wall = wallMap.get(o.wallId)

    if (o.type === 'door' && wall) {
      const pos = openingPosition(wall, o.offset)
      if (!pos) continue

      // Door orientation: explicit orientation overrides wall perpendicular
      const angle = o.orientation !== undefined
        ? (o.orientation * Math.PI) / 180
        : wallAngle(wall) + Math.PI / 2

      const halfWidth = (o.width || 0.9) / 2
      // Convert half-width from meters to degrees (approximate)
      const halfDeg = halfWidth / 111320
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      doorLineFeatures.push({
        type: 'Feature',
        id: o.id,
        properties: {
          id: o.id,
          type: 'door',
          wallId: o.wallId,
          offset: o.offset,
          width: o.width,
          buildingId: o.buildingId,
          floor: o.floor,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [pos.lng - cos * halfDeg, pos.lat - sin * halfDeg],
            [pos.lng + cos * halfDeg, pos.lat + sin * halfDeg],
          ],
        },
      })
    } else {
      // Window openings or doors without wall data: circle marker
      circleFeatures.push({
        type: 'Feature',
        id: o.id,
        properties: {
          id: o.id,
          type: o.type,
          wallId: o.wallId,
          offset: o.offset,
          width: o.width,
          buildingId: o.buildingId,
          floor: o.floor,
        },
        geometry: {
          type: 'Point',
          coordinates: [o.offset, o.width],
        },
      })
    }
  }

  return {
    type: 'FeatureCollection' as const,
    features: [...doorLineFeatures, ...circleFeatures],
  }
}

// ── Component ──────────────────────────────────────────────────

export function OpeningLayer({
  map,
  openings,
  walls,
  buildingId,
  floor,
  indoorContext,
}: OpeningLayerProps) {
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

      // Door line — perpendicular wall-opening segment (spec §4.3)
      map.addLayer({
        id: LYR.DOOR_LINE,
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'type'], 'door'],
        paint: {
          'line-color': cssVar('--navi-door-outline', '#475569'),
          'line-width': 2,
          'line-opacity': 0.85,
        },
      })

      // Door fill — subtle indicator (fallback for doors without wall data)
      map.addLayer({
        id: LYR.DOOR_FILL,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'type'], 'door'],
        paint: {
          'circle-radius': 4,
          'circle-color': cssVar('--navi-door-fill', '#475569'),
          'circle-opacity': 0.6,
          'circle-stroke-width': 1,
          'circle-stroke-color': cssVar('--navi-door-outline', '#334155'),
        },
      })

      // Door outline (fallback)
      map.addLayer({
        id: LYR.DOOR_OUTLINE,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'type'], 'door'],
        paint: {
          'circle-radius': 5,
          'circle-color': 'transparent',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': cssVar('--navi-door-outline', '#334155'),
          'circle-stroke-opacity': 0.8,
        },
      })

      // Window fill — lighter, more subtle
      map.addLayer({
        id: LYR.WINDOW_FILL,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'type'], 'window'],
        paint: {
          'circle-radius': 3,
          'circle-color': cssVar('--navi-window-fill', '#94A3B8'),
          'circle-opacity': 0.5,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': cssVar('--navi-window-outline', '#64748B'),
        },
      })

      // Window outline
      map.addLayer({
        id: LYR.WINDOW_OUTLINE,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'type'], 'window'],
        paint: {
          'circle-radius': 4,
          'circle-color': 'transparent',
          'circle-stroke-width': 1,
          'circle-stroke-color': cssVar('--navi-window-outline', '#64748B'),
          'circle-stroke-opacity': 0.7,
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
        ;[LYR.DOOR_LINE, LYR.WINDOW_OUTLINE, LYR.WINDOW_FILL, LYR.DOOR_OUTLINE, LYR.DOOR_FILL].forEach(l => {
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

    // If indoor context is inactive, hide all openings
    if (!indoorContext?.active) {
      src.setData(buildOpeningGeoJSON([], []))
      hasPopulatedRef.current = true
      map.triggerRepaint()
      return
    }

    let filtered = openings
    let filteredWalls = walls ?? []
    // Gate by indoor context building and floor
    if (indoorContext.buildingId) {
      filtered = filtered.filter(o => o.buildingId === indoorContext.buildingId)
      filteredWalls = filteredWalls.filter(w => w.buildingId === indoorContext.buildingId)
    }
    if (indoorContext.floorId !== undefined) {
      filtered = filtered.filter(o => o.floor === indoorContext.floorId)
      filteredWalls = filteredWalls.filter(w => w.floor === indoorContext.floorId)
    }
    // Also apply legacy buildingId/floor props if provided
    if (buildingId) {
      filtered = filtered.filter(o => o.buildingId === buildingId)
      filteredWalls = filteredWalls.filter(w => w.buildingId === buildingId)
    }
    if (floor !== undefined) {
      filtered = filtered.filter(o => o.floor === floor)
      filteredWalls = filteredWalls.filter(w => w.floor === floor)
    }

    src.setData(buildOpeningGeoJSON(filtered, filteredWalls))
    hasPopulatedRef.current = true
    map.triggerRepaint()
  }, [map, openings, walls, buildingId, floor, indoorContext])

  useEffect(() => {
    setData()
  }, [setData, indoorContext])

  // Post-init safety net
  useEffect(() => {
    if (!map || !initializedRef.current || hasPopulatedRef.current) return
    setData()
  }, [map, openings, walls, indoorContext])

  return null
}
