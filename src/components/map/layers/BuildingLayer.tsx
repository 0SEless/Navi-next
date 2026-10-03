'use client'

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import type { BuildingRenderData } from '@/components/map/NavigationRenderModel'
import { whenMapStyleReady } from '@/components/map/mapStyleReadiness'

// ── Constants ──────────────────────────────────────────────────

const SRC = 'buildings'
const LYR = {
  FILL: 'buildings-fill',
  OUTLINE: 'buildings-outline',
  EXTRUSION: 'buildings-extrusion',
  LABELS: 'buildings-labels',
} as const

// ── Props ──────────────────────────────────────────────────────

export interface BuildingLayerProps {
  map: maplibregl.Map | null
  buildings: BuildingRenderData[]
  showLabels?: boolean
  showExtrusion?: boolean
  selectedBuildingId?: string | null
  onBuildingClick?: (buildingId: string) => void
}

// ── Helpers ────────────────────────────────────────────────────

function buildGeoJSON(buildings: BuildingRenderData[]) {
  return {
    type: 'FeatureCollection' as const,
    features: buildings
      .filter(b => b.footprint.length >= 3)
      .map(b => ({
        type: 'Feature' as const,
        id: b.id,
        properties: {
          id: b.id,
          name: b.name,
          color: b.color,
          height: b.height,
          base_elevation: 0,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [b.footprint.map(p => [p.lng, p.lat] as [number, number])],
        },
      })),
  }
}

/** Selected outline is intentionally visible through color, width, and opacity. */
export function getBuildingOutlinePaint(): maplibregl.LineLayerSpecification['paint'] {
  return {
    'line-color': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      '#0F6B3A',
      ['get', 'color'],
    ],
    'line-width': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      4,
      2,
    ],
    'line-opacity': [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      1,
      0.8,
    ],
  } as maplibregl.LineLayerSpecification['paint']
}

// ── Component ──────────────────────────────────────────────────

export function BuildingLayer({
  map,
  buildings,
  showLabels = true,
  showExtrusion = true,
  selectedBuildingId,
  onBuildingClick,
}: BuildingLayerProps) {
  const initializedRef = useRef(false)
  const buildingsRef = useRef(buildings)
  const selectedBuildingIdRef = useRef(selectedBuildingId ?? null)
  const selectedFeatureIdRef = useRef<string | null>(null)
  const onBuildingClickRef = useRef(onBuildingClick)

  useLayoutEffect(() => {
    buildingsRef.current = buildings
  }, [buildings])

  useLayoutEffect(() => {
    selectedBuildingIdRef.current = selectedBuildingId ?? null
  }, [selectedBuildingId])

  useLayoutEffect(() => {
    onBuildingClickRef.current = onBuildingClick
  }, [onBuildingClick])

  const setData = useCallback(() => {
    if (!map || !initializedRef.current) return
    const source = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!source) return
    source.setData(buildGeoJSON(buildingsRef.current))
    map.triggerRepaint()
  }, [map])

  // Source updates from sibling layers can temporarily make isStyleLoaded false
  // after the one-shot map load. Wait for current style readiness, not a new load.
  useEffect(() => {
    if (!map) return
    if (initializedRef.current) return

    const init = () => {
      if (initializedRef.current) return
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      }

      // Fill layer
      if (!map.getLayer(LYR.FILL)) {
        map.addLayer({
          id: LYR.FILL,
          type: 'fill',
          source: SRC,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 0.45,
              0.25,
            ],
          },
        })
      }

      // Outline layer
      if (!map.getLayer(LYR.OUTLINE)) {
        map.addLayer({
          id: LYR.OUTLINE,
          type: 'line',
          source: SRC,
          paint: {
            ...getBuildingOutlinePaint(),
          },
        })
      }

      // Extrusion layer (3D buildings)
      if (showExtrusion && !map.getLayer(LYR.EXTRUSION)) {
        map.addLayer({
          id: LYR.EXTRUSION,
          type: 'fill-extrusion',
          source: SRC,
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'base_elevation'],
            'fill-extrusion-opacity': 0.55,
          },
        })
      }

      // Labels layer
      if (showLabels && !map.getLayer(LYR.LABELS)) {
        map.addLayer({
          id: LYR.LABELS,
          type: 'symbol',
          source: SRC,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
          },
          paint: {
            'text-color': '#0F172A',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 2,
          },
        })
      }

      initializedRef.current = true
      // Delayed initialization must populate without a subsequent React render.
      setData()
    }

    const stopWaitingForStyle = whenMapStyleReady(map, init)

    return () => {
      stopWaitingForStyle()
      try {
        // Cleanup layers and source
        ;[LYR.LABELS, LYR.EXTRUSION, LYR.OUTLINE, LYR.FILL].forEach(l => {
          if (map.getLayer(l)) map.removeLayer(l)
        })
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {}
      initializedRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, setData])

  // Handle data arriving after the map is ready; init handles the other ordering.
  useEffect(() => {
    setData()
  }, [buildings, setData])

  // The listener is stable for the lifetime of the map. The desired selection
  // is read from a ref so route/store changes do not churn styledata handlers.
  const syncSelection = useCallback(() => {
    if (!map || !initializedRef.current || !map.isStyleLoaded() || !map.getSource(SRC)) return
    const previousId = selectedFeatureIdRef.current
    const nextId = selectedBuildingIdRef.current
    if (previousId && previousId !== nextId) {
      try { map.setFeatureState({ source: SRC, id: previousId }, { selected: false }) } catch {}
    }
    if (nextId) {
      try { map.setFeatureState({ source: SRC, id: nextId }, { selected: true }) } catch {}
    }
    selectedFeatureIdRef.current = nextId
  }, [map])

  useEffect(() => {
    if (!map) return
    map.on('styledata', syncSelection)
    return () => {
      try { map.off('styledata', syncSelection) } catch {}
    }
  }, [map, syncSelection])

  useEffect(() => {
    syncSelection()
  }, [selectedBuildingId, syncSelection])

  // Click handler stays attached even when no callback is currently supplied;
  // a ref dispatches to the latest route callback without listener churn.
  useEffect(() => {
    if (!map) return

    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      if (e.features && e.features.length > 0) {
        const id = e.features[0].properties?.id
        if (id) onBuildingClickRef.current?.(id)
      }
    }

    map.on('click', LYR.FILL, handler)
    return () => { try { map.off('click', LYR.FILL, handler) } catch {} }
  }, [map])

  // Hover cursor
  useEffect(() => {
    if (!map) return

    const onMouseEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onMouseLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('mouseenter', LYR.FILL, onMouseEnter)
    map.on('mouseleave', LYR.FILL, onMouseLeave)
    return () => {
      try {
        map.off('mouseenter', LYR.FILL, onMouseEnter)
        map.off('mouseleave', LYR.FILL, onMouseLeave)
      } catch {}
    }
  }, [map])

  return null // This is a headless layer component
}
