'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import maplibregl, { type ExpressionSpecification } from 'maplibre-gl'
import { splitRouteByFloor } from '@/lib/route-floors'
import { cssVar } from '@/components/map/mapTheme'
import type { NavigationSegment } from '@/components/map/NavigationContext'

interface RouteLineProps {
  map: maplibregl.Map | null
  route: { path: string[]; cost: number } | null
  getNodePosition: (nodeId: string) => { lat: number; lng: number } | undefined
  /** Floor of a route node — enables per-floor emphasis. */
  getNodeFloor?: (nodeId: string) => number | undefined
  /** Floor to highlight in the route color (others render dimmed). */
  activeFloor?: number
  /** Whether this route layer owns the camera fit. Canonical Navigate opts out. */
  fitCamera?: boolean
  /**
   * Current navigation phase. Drives EMPHASIS only — when the user is actively
   * navigating indoors/floor-transition the route is rendered loud; outdoor/
   * entrance phases render it quiet. Does NOT redefine the visual language.
   */
  navigationSegment?: NavigationSegment | null
}

const LAYER_IDS = ['route-glow', 'route-core', 'route-flow'] as const
const SOURCE_ID = 'route'

// Centralized route styling (spec §4.4) — resolves theme tokens at runtime.
const ROUTE_COLOR = cssVar('--navi-route', '#3B82F6')
const ROUTE_DIM = cssVar('--navi-route-dim', '#94A3B8')
const ROUTE_FLOW = cssVar('--navi-route-flow', '#FFFFFF')

// Active = loud (theme route color), inactive = quiet (dim). The SAME mechanism
// is reused for both floor-based and navigation-segment-based emphasis.
const ACTIVE_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'active'], 1], ROUTE_COLOR,
  ROUTE_DIM,
]

const lastFittedPathByMap = new WeakMap<maplibregl.Map, string>()
const EMPTY_ROUTE_DATA: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function removeRouteLayers(map: maplibregl.Map) {
  for (const id of LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}

export function RouteLine({ map, route, getNodePosition, getNodeFloor, activeFloor, navigationSegment, fitCamera = true }: RouteLineProps) {
  const initializedRef = useRef(false)
  const routePathRef = useRef<string[]>(route?.path ?? [])
  const pathKey = route?.path.join('\u0000') ?? ''

  useLayoutEffect(() => {
    routePathRef.current = route?.path ?? []
  }, [route])

  useEffect(() => {
    if (!map) return
    const initialize = () => {
      if (initializedRef.current) return
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_ROUTE_DATA })
      }

      const layers: maplibregl.LayerSpecification[] = [
        {
          id: 'route-glow',
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': ACTIVE_COLOR,
            'line-width': 12,
            'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.3, 0.08],
            'line-blur': 4,
          },
        },
        {
          id: 'route-core',
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': ACTIVE_COLOR,
            'line-width': ['case', ['==', ['get', 'active'], 1], 4, 2.5],
            'line-opacity': ['case', ['==', ['get', 'active'], 1], 1, 0.45],
          },
        },
        {
          id: 'route-flow',
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': ROUTE_FLOW,
            'line-width': 2,
            'line-dasharray': [0.5, 2],
            'line-opacity': ['case', ['==', ['get', 'active'], 1], 1, 0.2],
          },
        },
      ]
      for (const layer of layers) {
        if (!map.getLayer(layer.id)) map.addLayer(layer)
      }
      initializedRef.current = true
    }

    if (map.isStyleLoaded()) initialize()
    else map.on('load', initialize)

    return () => {
      try {
        map.off('load', initialize)
        removeRouteLayers(map)
      } catch { /* map may be gone */ }
      initializedRef.current = false
    }
  }, [map])

  useEffect(() => {
    if (!map || !initializedRef.current) return
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!source) return

    const path = routePathRef.current
    if (path.length < 2) {
      source.setData(EMPTY_ROUTE_DATA)
      return
    }

    const segments = getNodeFloor
      ? splitRouteByFloor(path, getNodeFloor)
      : [{ floor: undefined, nodes: path }]
    const floorSet = new Set(segments.map((segment) => segment.floor))
    const multiFloor = getNodeFloor !== undefined && floorSet.size > 1
    const features: GeoJSON.Feature[] = []

    for (const segment of segments) {
      const coordinates: [number, number][] = []
      for (const nodeId of segment.nodes) {
        const position = getNodePosition(nodeId)
        if (position) coordinates.push([position.lng, position.lat])
      }
      if (coordinates.length < 2) continue
      const active = multiFloor
        ? (segment.floor === activeFloor ? 1 : 0)
        : (navigationSegment === 'indoor' || navigationSegment === 'floor-transition' ? 1 : 0)
      features.push({
        type: 'Feature',
        properties: { active },
        geometry: { type: 'LineString', coordinates },
      })
    }

    source.setData({ type: 'FeatureCollection', features })
  }, [activeFloor, getNodeFloor, getNodePosition, map, navigationSegment, pathKey])

  useEffect(() => {
    if (!map || !fitCamera || routePathRef.current.length < 2 || !pathKey) return
    if (lastFittedPathByMap.get(map) === pathKey) return

    const coordinates: [number, number][] = []
    for (const nodeId of routePathRef.current) {
      const position = getNodePosition(nodeId)
      if (position) coordinates.push([position.lng, position.lat])
    }
    if (coordinates.length < 2) return

    const first = coordinates[0]
    const bounds = coordinates.reduce(
      (current, coordinate) => current.extend(coordinate),
      new maplibregl.LngLatBounds(first, first),
    )
    lastFittedPathByMap.set(map, pathKey)
    map.fitBounds(bounds, { padding: 80 })
  }, [fitCamera, getNodePosition, map, pathKey])

  return null
}
