'use client'

import { useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import {
  DEFAULT_POI_2_5D_HEIGHT,
  validatePointOfInterestAppearance,
  validateWorldPointOfInterestGeometry,
} from '@navi/core'
import type { PoiRenderData } from '@/components/map/NavigationRenderModel'
import type { CampusPOI, LatLng } from '@/types/nav-types'
import { cssVar } from '@/components/map/mapTheme'
import { whenMapStyleReady } from '@/components/map/mapStyleReadiness'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'pois'
const LYR = 'pois-layer'
const SHAPE_FILL_LYR = 'pois-outdoor-fill'
const SHAPE_OUTLINE_LYR = 'pois-outdoor-outline'
const SHAPE_EXTRUSION_LYR = 'pois-outdoor-extrusion'
const EMPTY_OUTDOOR_POIS: readonly CampusPOI[] = []
const OUTDOOR_POI_DEFAULT_COLOR = '#F59E0B'

// ── Props ──────────────────────────────────────────────────────

export interface POILayerProps {
  map: maplibregl.Map | null
  pois: PoiRenderData[]
  outdoorPois?: readonly CampusPOI[]
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
type WorldPosition = [number, number]

function isWorldPoint(value: unknown): value is LatLng {
  if (typeof value !== 'object' || value === null) return false
  const point = value as { lat?: unknown; lng?: unknown }
  return typeof point.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point.lng === 'number' && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
}

function closeWorldRing(points: readonly LatLng[]): WorldPosition[] {
  const ring = points.map((point) => [point.lng, point.lat] as WorldPosition)
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first])
  return ring
}

function circleRing(center: LatLng, radiusMeters: number, segments = 48): WorldPosition[] {
  const earthRadius = 6_371_008.8
  const angularDistance = radiusMeters / earthRadius
  const latitude = center.lat * Math.PI / 180
  const longitude = center.lng * Math.PI / 180
  const ring: WorldPosition[] = []

  for (let index = 0; index < segments; index += 1) {
    const bearing = index * Math.PI * 2 / segments
    const nextLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    )
    const nextLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
    )
    ring.push([nextLongitude * 180 / Math.PI, nextLatitude * 180 / Math.PI])
  }
  ring.push([...ring[0]])
  return ring
}

function outdoorGeometry(poi: CampusPOI): GeoJSON.Geometry | null {
  const geometry = poi.geometry
  if (!geometry) {
    return isWorldPoint(poi.position)
      ? { type: 'Point', coordinates: [poi.position.lng, poi.position.lat] }
      : null
  }
  if (!validateWorldPointOfInterestGeometry(geometry).valid) return null

  switch (geometry.type) {
    case 'point':
      return { type: 'Point', coordinates: [geometry.position.lng, geometry.position.lat] }
    case 'circle':
      return { type: 'Polygon', coordinates: [circleRing(geometry.center, geometry.radius)] }
    case 'rectangle':
    case 'polygon':
      return { type: 'Polygon', coordinates: [closeWorldRing(geometry.points)] }
  }
}

function outdoorAppearance(poi: CampusPOI) {
  const geometry = poi.geometry ?? { type: 'point' as const, position: poi.position }
  const validation = validatePointOfInterestAppearance(poi.appearance, geometry)
  const authored = validation.valid ? poi.appearance : undefined
  const mode = authored?.mode ?? (geometry.type === 'point' ? 'marker' : '2d')
  const rawBase = poi.properties.base_elevation ?? poi.metadata?.base_elevation

  return {
    mode,
    color: authored?.color ?? OUTDOOR_POI_DEFAULT_COLOR,
    height: mode === '2.5d'
      ? authored?.height ?? DEFAULT_POI_2_5D_HEIGHT
      : 0,
    baseElevation: typeof rawBase === 'number' && Number.isFinite(rawBase) ? rawBase : 0,
  }
}

export function buildPoiGeoJSON(
  pois: PoiRenderData[],
  revealedIds?: readonly string[],
  outdoorPois: readonly CampusPOI[] = EMPTY_OUTDOOR_POIS,
) {
  const revealed = new Set(revealedIds ?? [])
  const visible = pois.filter(p => p.showOnMap !== false || revealed.has(p.id))
  const features: GeoJSON.Feature<GeoJSON.Geometry>[] = visible.map(p => ({
    type: 'Feature',
    id: p.id,
    properties: {
      id: p.id,
      name: p.name,
      buildingId: p.buildingId,
      floor: p.floor,
      category: p.category ?? '',
      appearanceMode: 'marker',
      appearanceColor: cssVar('--navi-accent', '#7C3AED'),
      revealed: revealed.has(p.id),
    },
    geometry: {
      type: 'Point',
      coordinates: [p.position.lng, p.position.lat],
    },
  }))

  for (const poi of outdoorPois) {
    const visibleOnMap = poi.showOnMap ?? poi.visibility?.showOnMap !== false
    if (!visibleOnMap && !revealed.has(poi.id)) continue
    const geometry = outdoorGeometry(poi)
    if (!geometry) continue

    const metadata = { ...(poi.properties ?? {}), ...(poi.metadata ?? {}) }
    const appearance = outdoorAppearance(poi)
    features.push({
      type: 'Feature',
      id: poi.id,
      properties: {
        id: poi.id,
        name: poi.name ?? poi.label,
        category: poi.category,
        scope: 'outdoor',
        geometryType: poi.geometry?.type ?? 'point',
        appearanceMode: appearance.mode,
        appearanceColor: appearance.color,
        appearanceHeight: appearance.height,
        base_elevation: appearance.baseElevation,
        revealed: revealed.has(poi.id),
        ...(poi.buildingId ? { buildingId: poi.buildingId } : {}),
        ...(poi.floorId ? { floorId: poi.floorId } : {}),
        ...(poi.source ? { source: poi.source } : {}),
        ...(poi.sourceId ? { sourceId: poi.sourceId } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
      geometry,
    })
  }

  return {
    type: 'FeatureCollection' as const,
    features,
  }
}

// ── Component ──────────────────────────────────────────────────

export function POILayer({
  map,
  pois,
  outdoorPois = EMPTY_OUTDOOR_POIS,
  buildingId,
  floor,
  revealedIds,
  onPoiClick,
}: POILayerProps) {
  const initializedRef = useRef(false)
  const setDataRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (!map) return
    if (initializedRef.current) return
    if (map.getSource(SRC)) {
      initializedRef.current = true
      setDataRef.current()
      return
    }

    const init = () => {
      if (initializedRef.current) return
      if (map.getSource(SRC)) {
        initializedRef.current = true
        setDataRef.current()
        return
      }

      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      map.addLayer({
        id: SHAPE_FILL_LYR,
        type: 'fill',
        source: SRC,
        // Narrow campus fit starts near 15.35; authored landmarks belong there.
        minzoom: 15,
        filter: ['all', ['==', ['get', 'scope'], 'outdoor'], ['==', ['get', 'appearanceMode'], '2d']],
        paint: {
          'fill-color': ['coalesce', ['get', 'appearanceColor'], OUTDOOR_POI_DEFAULT_COLOR],
          'fill-opacity': ['case', ['boolean', ['get', 'revealed'], false], 0.38, 0.2],
        },
      })

      map.addLayer({
        id: SHAPE_EXTRUSION_LYR,
        type: 'fill-extrusion',
        source: SRC,
        minzoom: 15,
        filter: ['all', ['==', ['get', 'scope'], 'outdoor'], ['==', ['get', 'appearanceMode'], '2.5d']],
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', 'appearanceColor'], OUTDOOR_POI_DEFAULT_COLOR],
          'fill-extrusion-height': ['get', 'appearanceHeight'],
          'fill-extrusion-base': ['get', 'base_elevation'],
          'fill-extrusion-opacity': 0.65,
        },
      })

      map.addLayer({
        id: SHAPE_OUTLINE_LYR,
        type: 'line',
        source: SRC,
        minzoom: 15,
        filter: ['all',
          ['==', ['get', 'scope'], 'outdoor'],
          ['in', ['get', 'appearanceMode'], ['literal', ['2d', '2.5d']]],
        ],
        paint: {
          'line-color': ['coalesce', ['get', 'appearanceColor'], OUTDOOR_POI_DEFAULT_COLOR],
          'line-width': ['case', ['boolean', ['get', 'revealed'], false], 3, 2],
          'line-opacity': 0.9,
        },
      })

      // POI marker — accent-colored pin (spec §5.3). Quiet baseline otherwise.
      // A search-revealed hidden POI gets a larger, accented ring so the user
      // notices the temporary reveal.
      map.addLayer({
        id: LYR,
        type: 'circle',
        source: SRC,
        minzoom: 15,
        filter: ['==', ['get', 'appearanceMode'], 'marker'],
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'revealed'], false], 9, 7],
          'circle-color': ['coalesce', ['get', 'appearanceColor'], OUTDOOR_POI_DEFAULT_COLOR],
          'circle-stroke-width': ['case', ['boolean', ['get', 'revealed'], false], 3, 2],
          'circle-stroke-color': ['case',
            ['boolean', ['get', 'revealed'], false],
            ['coalesce', ['get', 'appearanceColor'], OUTDOOR_POI_DEFAULT_COLOR],
            cssVar('--navi-card', '#FFFFFF'),
          ],
          'circle-opacity': 0.95,
        },
      })

      initializedRef.current = true
      setDataRef.current()
    }

    const stopWaitingForStyle = whenMapStyleReady(map, init)

    return () => {
      stopWaitingForStyle()
      try {
        if (map.getLayer(LYR)) map.removeLayer(LYR)
        if (map.getLayer(SHAPE_EXTRUSION_LYR)) map.removeLayer(SHAPE_EXTRUSION_LYR)
        if (map.getLayer(SHAPE_OUTLINE_LYR)) map.removeLayer(SHAPE_OUTLINE_LYR)
        if (map.getLayer(SHAPE_FILL_LYR)) map.removeLayer(SHAPE_FILL_LYR)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {}
      initializedRef.current = false
    }
  }, [map])

  const setData = useCallback(() => {
    if (!map || !initializedRef.current) return
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    let filtered = pois
    if (buildingId) filtered = filtered.filter(p => p.buildingId === buildingId)
    if (floor !== undefined) filtered = filtered.filter(p => p.floor === floor)

    src.setData(buildPoiGeoJSON(filtered, revealedIds, outdoorPois))
    map.triggerRepaint()
  }, [map, pois, outdoorPois, buildingId, floor, revealedIds])

  useEffect(() => {
    setDataRef.current = setData
    setData()
  }, [setData])

  // Click handler
  useEffect(() => {
    if (!map || !onPoiClick) return

    const handler = (e: maplibregl.MapMouseEvent & { features?: Array<{ properties?: { id?: unknown } }> }) => {
      if (e.features && e.features.length > 0) {
        const id = e.features[0].properties?.id
        if (typeof id === 'string') onPoiClick(id)
      }
    }

    for (const layerId of [LYR, SHAPE_FILL_LYR, SHAPE_OUTLINE_LYR, SHAPE_EXTRUSION_LYR]) map.on('click', layerId, handler)
    return () => {
      try {
        for (const layerId of [LYR, SHAPE_FILL_LYR, SHAPE_OUTLINE_LYR, SHAPE_EXTRUSION_LYR]) map.off('click', layerId, handler)
      } catch {}
    }
  }, [map, onPoiClick])

  // Hover cursor
  useEffect(() => {
    if (!map) return

    const onMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onMouseLeave = () => { map.getCanvas().style.cursor = '' }

    for (const layerId of [LYR, SHAPE_FILL_LYR, SHAPE_OUTLINE_LYR, SHAPE_EXTRUSION_LYR]) {
      map.on('mouseenter', layerId, onMouseEnter)
      map.on('mouseleave', layerId, onMouseLeave)
    }
    return () => {
      try {
        for (const layerId of [LYR, SHAPE_FILL_LYR, SHAPE_OUTLINE_LYR, SHAPE_EXTRUSION_LYR]) {
          map.off('mouseenter', layerId, onMouseEnter)
          map.off('mouseleave', layerId, onMouseLeave)
        }
      } catch {}
    }
  }, [map])

  return null
}
