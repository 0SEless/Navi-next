'use client'

import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useStudioStore } from '@/store/studio-store'
import type { ValidationFocus } from '@/types/studio-types'
import { LYR, SRC } from './rendering/constants'

const EMPTY_FOCUS_DATA: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

function focusToGeoJSON(focus: ValidationFocus | null): GeoJSON.FeatureCollection {
  if (!focus) return EMPTY_FOCUS_DATA

  const properties = {
    issueId: focus.issueId,
    targetId: focus.targetId,
    targetType: focus.targetType,
    buildingId: focus.buildingId,
    floor: focus.floor,
    layer: focus.layer,
  }

  switch (focus.geometry.kind) {
    case 'point':
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties,
          geometry: {
            type: 'Point',
            coordinates: [focus.geometry.position.lng, focus.geometry.position.lat],
          },
        }],
      }
    case 'line':
      if (focus.geometry.points.length < 2) return EMPTY_FOCUS_DATA
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties,
          geometry: {
            type: 'LineString',
            coordinates: focus.geometry.points.map((point) => [point.lng, point.lat]),
          },
        }],
      }
    case 'polygon': {
      if (focus.geometry.points.length < 3) return EMPTY_FOCUS_DATA
      const coordinates = focus.geometry.points.map((point) => [point.lng, point.lat] as [number, number])
      const first = coordinates[0]
      const last = coordinates[coordinates.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first])
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties,
          geometry: {
            type: 'Polygon',
            coordinates: [coordinates],
          },
        }],
      }
    }
  }
}

function ensureFocusLayers(map: maplibregl.Map): maplibregl.GeoJSONSource | undefined {
  try {
    if (!map.getSource(SRC.VALIDATION_FOCUS)) {
      map.addSource(SRC.VALIDATION_FOCUS, { type: 'geojson', data: EMPTY_FOCUS_DATA })
    }

    const addLayer = (layer: maplibregl.AnyLayer) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer)
    }

    addLayer({
      id: LYR.VALIDATION_FOCUS_POLYGON_FILL,
      type: 'fill',
      source: SRC.VALIDATION_FOCUS,
      filter: ['==', '$type', 'Polygon'],
      paint: {
        'fill-color': '#f59e0b',
        'fill-opacity': 0.18,
      },
    })
    addLayer({
      id: LYR.VALIDATION_FOCUS_POLYGON_OUTLINE,
      type: 'line',
      source: SRC.VALIDATION_FOCUS,
      filter: ['==', '$type', 'Polygon'],
      paint: {
        'line-color': '#f59e0b',
        'line-width': 3,
        'line-dasharray': [1, 1],
      },
    })
    addLayer({
      id: LYR.VALIDATION_FOCUS_LINE,
      type: 'line',
      source: SRC.VALIDATION_FOCUS,
      filter: ['==', '$type', 'LineString'],
      paint: {
        'line-color': '#f59e0b',
        'line-width': 5,
        'line-opacity': 0.95,
      },
    })
    addLayer({
      id: LYR.VALIDATION_FOCUS_POINT,
      type: 'circle',
      source: SRC.VALIDATION_FOCUS,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-color': '#f59e0b',
        'circle-radius': 8,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    })

    return map.getSource(SRC.VALIDATION_FOCUS) as maplibregl.GeoJSONSource | undefined
  } catch {
    return undefined
  }
}

export interface ValidationIssueOverlayProps {
  map: maplibregl.Map
}

/**
 * Renders one temporary validation focus target above the editor layers.
 * It only consumes UI focus state; it never dispatches a document command or
 * changes the user's authored layer visibility preferences.
 */
export function ValidationIssueOverlay({ map }: ValidationIssueOverlayProps) {
  const focus = useStudioStore((state) => state.validationFocus)

  useEffect(() => {
    const repaint = () => {
      const source = ensureFocusLayers(map)
      source?.setData(focusToGeoJSON(focus))
    }

    repaint()
    const onStyleLoad = () => repaint()
    map.on('style.load', onStyleLoad)
    return () => {
      try { map.off('style.load', onStyleLoad) } catch {}
    }
  }, [focus, map])

  return null
}
