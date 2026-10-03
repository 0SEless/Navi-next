'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { genId } from '@navi/editor'
import { useCurrentTool } from './useCurrentTool'
import type { LatLng } from '@/types/nav-types'
import type { DrawingSessionValue } from './useDrawingSession'

const SNAP_THRESHOLD_PX = 12
const TRACER_SOURCE = 'building-tracer-drawing'
const TRACER_EXTRUSION = 'building-tracer-extrusion'
const TRACER_LINE = 'building-tracer-line'
const TRACER_VERTICES = 'building-tracer-vertices'

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export interface BuildingFootprint {
  id: string
  points: LatLng[]
}

function addTracerSourceAndLayers(map: maplibregl.Map) {
  if (map.getSource(TRACER_SOURCE)) return
  map.addSource(TRACER_SOURCE, { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: TRACER_EXTRUSION, type: 'fill-extrusion', source: TRACER_SOURCE,
    paint: {
      'fill-extrusion-color': '#8B5CF6',
      'fill-extrusion-opacity': 0.3,
      'fill-extrusion-height': 15,
    },
  })
  map.addLayer({
    id: TRACER_LINE, type: 'line', source: TRACER_SOURCE,
    paint: { 'line-color': '#06B6D4', 'line-width': 3, 'line-dasharray': [4, 4] },
  })
  map.addLayer({
    id: TRACER_VERTICES, type: 'circle', source: TRACER_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 20, 7], 'circle-color': '#06B6D4',
      'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF',
    },
  })
}

function renderTracerDrawing(map: maplibregl.Map, points: LatLng[]) {
  const features: GeoJSON.Feature[] = []
  if (points.length >= 1) {
    const coords = points.map((p) => [p.lng, p.lat])
    if (points.length >= 3) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
        properties: {},
      })
    }
    if (points.length >= 2) {
      const lineCoords = points.length >= 3 ? [...coords, coords[0]] : coords
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lineCoords },
        properties: {},
      })
    }
    for (const p of points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {},
      })
    }
  }
  try {
    const src = map.getSource(TRACER_SOURCE) as maplibregl.GeoJSONSource
    if (src) src.setData({ type: 'FeatureCollection', features })
  } catch { console.warn('[BuildingTracer] render source not ready') }
}

function clearTracerDrawing(map: maplibregl.Map) {
  try {
    const src = map.getSource(TRACER_SOURCE) as maplibregl.GeoJSONSource
    if (src) src.setData(EMPTY_FC)
  } catch { console.warn('[BuildingTracer] clear source not ready') }
}

export function useBuildingTracer(
  map: maplibregl.Map | null,
  onComplete?: (footprint: BuildingFootprint) => void,
  drawing?: DrawingSessionValue,
) {
  const tool = useCurrentTool()
  const pointsRef = useRef<LatLng[]>([])
  const onCompleteRef = useRef(onComplete)
  const drawingRef = useRef(drawing)
  drawingRef.current = drawing

  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    if (!map) return
    const onStyleLoad = () => {
      addTracerSourceAndLayers(map)
      if (pointsRef.current.length > 0) renderTracerDrawing(map, pointsRef.current)
    }
    map.on('style.load', onStyleLoad)
    addTracerSourceAndLayers(map)
    return () => { try { map.off('style.load', onStyleLoad) } catch {} }
  }, [map])

  // Sync visual when drawPoints changes externally (undo/cancel)
  useEffect(() => {
    if (!map || tool !== 'building' || !drawingRef.current) return
    pointsRef.current = [...drawingRef.current.drawPoints]
    renderTracerDrawing(map, pointsRef.current)
  }, [map, tool, drawing?.drawPoints])

  useEffect(() => {
    const d = drawingRef.current
    if (!map) return
    if (tool !== 'building') {
      pointsRef.current = []
      clearTracerDrawing(map)
      map.doubleClickZoom?.enable()
      return
    }

    map.doubleClickZoom?.disable()

    function completePolygon() {
      if (pointsRef.current.length < 3) return
      const result: BuildingFootprint = {
        id: genId('building-footprint'),
        points: [...pointsRef.current],
      }
      onCompleteRef.current?.(result)
      pointsRef.current = []
      if (map) clearTracerDrawing(map)
      d?.clearDrawPoints()
    }

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng }

      if (pointsRef.current.length >= 3) {
        const first = pointsRef.current[0]
        const firstScreen = map.project([first.lng, first.lat])
        const dx = e.point.x - firstScreen.x
        const dy = e.point.y - firstScreen.y
        if (Math.sqrt(dx * dx + dy * dy) <= SNAP_THRESHOLD_PX) {
          completePolygon()
          return
        }
      }

      pointsRef.current = [...pointsRef.current, pos]
      renderTracerDrawing(map, pointsRef.current)
      d?.setDrawPoints(pointsRef.current)
    }

    const handleDblClick = () => completePolygon()

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)

    return () => {
      try {
        map.off('click', handleClick)
        map.off('dblclick', handleDblClick)
        map.doubleClickZoom?.enable()
      } catch {}
      pointsRef.current = []
      clearTracerDrawing(map)
      d?.clearDrawPoints()
    }
  }, [map, tool])
}
