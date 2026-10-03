'use client'

import { useCallback, useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import { roadFillPaint, roadOutlinePaint, RoadStyle } from '@navi/core'
import type { TracePath } from '@/types/nav-types'
import { tracesToGeoJSON } from '@/components/map/authoredTraceGeoJSON'
import { whenMapStyleReady } from '@/components/map/mapStyleReadiness'

const SOURCE_ID = 'authored-roads'
const OUTLINE_LAYER_ID = 'authored-roads-outline'
const FILL_LAYER_ID = 'authored-roads-fill'
const PATH_LAYER_ID = 'authored-roads-path'

const visiblePhysicalRoadFilter: maplibregl.FilterSpecification = [
  'all',
  ['!=', ['get', 'displayMode'], 'navigation-only'],
  ['!=', ['get', 'road_type'], 'pedestrian'],
]
const visiblePedestrianFilter: maplibregl.FilterSpecification = [
  'all',
  ['!=', ['get', 'displayMode'], 'navigation-only'],
  ['==', ['get', 'road_type'], 'pedestrian'],
]

const physicalRoadFillPaint = {
  ...roadFillPaint(),
  'line-color': [
    'case',
    ['all', ['has', 'color'], ['!=', ['get', 'color'], '']],
    ['get', 'color'],
    RoadStyle.fillColor,
  ],
} as maplibregl.LineLayerSpecification['paint']

const pedestrianPathPaint: maplibregl.LineLayerSpecification['paint'] = {
  'line-color': '#64748B',
  'line-width': 2,
  'line-opacity': 0.7,
}

export interface AuthoredRoadLayerProps {
  map: maplibregl.Map | null
  traces: readonly TracePath[]
}

/** Dedicated campus-authored Road source, separate from OSM and active routes. */
export function AuthoredRoadLayer({ map, traces }: AuthoredRoadLayerProps) {
  const initializedRef = useRef(false)
  const latestTracesRef = useRef(traces)

  const setData = useCallback(() => {
    if (!map || !initializedRef.current) return
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!source) return
    source.setData(tracesToGeoJSON(latestTracesRef.current))
    map.triggerRepaint()
  }, [map])

  useEffect(() => {
    if (!map) return undefined
    initializedRef.current = false

    const initialize = () => {
      if (initializedRef.current) return
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }
      if (!map.getLayer(OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: OUTLINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: visiblePhysicalRoadFilter,
          paint: roadOutlinePaint() as maplibregl.LineLayerSpecification['paint'],
        })
      }
      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer({
          id: FILL_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: visiblePhysicalRoadFilter,
          paint: physicalRoadFillPaint,
        })
      }
      if (!map.getLayer(PATH_LAYER_ID)) {
        map.addLayer({
          id: PATH_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          filter: visiblePedestrianFilter,
          paint: pedestrianPathPaint,
        })
      }
      initializedRef.current = true
      setData()
    }

    const stopWaitingForStyle = whenMapStyleReady(map, initialize)

    return () => {
      stopWaitingForStyle()
      try {
        if (map.getLayer(PATH_LAYER_ID)) map.removeLayer(PATH_LAYER_ID)
        if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID)
        if (map.getLayer(OUTLINE_LAYER_ID)) map.removeLayer(OUTLINE_LAYER_ID)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      } catch {}
      initializedRef.current = false
    }
  }, [map, setData])

  useEffect(() => {
    latestTracesRef.current = traces
    setData()
  }, [setData, traces])

  return null
}
