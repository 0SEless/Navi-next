'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { genId } from '@navi/editor'
import { useCurrentTool } from './useCurrentTool'
import type { LatLng } from '@/types/nav-types'
import type { DrawingSessionValue } from './useDrawingSession'

const SNAP_THRESHOLD_PX = 12
const BOUNDARY_SOURCE = 'campus-boundary-drawing'
const BOUNDARY_FILL = 'campus-boundary-fill'
const BOUNDARY_LINE = 'campus-boundary-line'
const BOUNDARY_VERTICES = 'campus-boundary-vertices'

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export interface BoundaryPolygon {
  id: string
  points: LatLng[]
}

export interface CampusBoundaryOptions {
  /** Tool ID that triggers this hook (default: 'boundary') */
  toolId?: string
  /** Skip the confirm bar and auto-complete (default: false) */
  autoConfirm?: boolean
  /** Called when polygon is completed in autoConfirm mode */
  onAutoConfirm?: (polygon: BoundaryPolygon) => void
}

function addBoundarySourceAndLayers(map: maplibregl.Map) {
  if (map.getSource(BOUNDARY_SOURCE)) return
  map.addSource(BOUNDARY_SOURCE, { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: BOUNDARY_FILL, type: 'fill', source: BOUNDARY_SOURCE,
    paint: { 'fill-color': '#94A3B8', 'fill-opacity': 0.12 },
  })
  map.addLayer({
    id: BOUNDARY_LINE, type: 'line', source: BOUNDARY_SOURCE,
    paint: { 'line-color': '#94A3B8', 'line-width': 2, 'line-dasharray': [4, 4] },
  })
  map.addLayer({
    id: BOUNDARY_VERTICES, type: 'circle', source: BOUNDARY_SOURCE,
    paint: {
      'circle-radius': 5, 'circle-color': '#94A3B8',
      'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF',
    },
  })
}

function renderBoundaryDrawing(map: maplibregl.Map, points: LatLng[]) {
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
    const src = map.getSource(BOUNDARY_SOURCE) as maplibregl.GeoJSONSource
    if (src) src.setData({ type: 'FeatureCollection', features })
  } catch { /* source not ready */ }
}

function clearBoundaryDrawing(map: maplibregl.Map) {
  try {
    const src = map.getSource(BOUNDARY_SOURCE) as maplibregl.GeoJSONSource
    if (src) src.setData(EMPTY_FC)
  } catch { console.warn('[CampusBoundary] clear source not ready') }
}

export function useCampusBoundary(
  map: maplibregl.Map | null,
  onComplete?: (polygon: BoundaryPolygon) => void,
  drawing?: DrawingSessionValue,
  options?: CampusBoundaryOptions,
) {
  const tool = useCurrentTool()
  const toolId = options?.toolId ?? 'boundary'
  const pointsRef = useRef<LatLng[]>([])
  const onCompleteRef = useRef(onComplete)
  const drawingRef = useRef(drawing)
  const optionsRef = useRef(options)
  drawingRef.current = drawing
  optionsRef.current = options

  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    if (!map) return
    addBoundarySourceAndLayers(map)
  }, [map])

  // Sync visual when drawPoints changes externally (undo/cancel/confirm).
  useEffect(() => {
    if (!map || tool !== toolId) return
    pointsRef.current = [...(drawing?.drawPoints ?? [])]
    renderBoundaryDrawing(map, pointsRef.current)
  }, [map, tool, toolId, drawing?.drawPoints])

  useEffect(() => {
    const d = drawingRef.current
    const opts = optionsRef.current
    if (!map) return
    if (tool !== toolId) {
      pointsRef.current = []
      clearBoundaryDrawing(map)
      map.doubleClickZoom?.enable()
      return
    }

    map.doubleClickZoom?.disable()
    const m = map

    function completePolygon() {
      if (pointsRef.current.length < 3) return
      if (drawingRef.current?.pendingConfirm) return
      const points = [...pointsRef.current]
      const result: BoundaryPolygon = {
        id: genId('campus-boundary'),
        points,
      }

      if (opts?.autoConfirm && opts?.onAutoConfirm) {
        opts.onAutoConfirm(result)
        pointsRef.current = []
        clearBoundaryDrawing(m)
        d?.clearDrawPoints()
        return
      }

      // Leave the completed boundary in the shared drawing session. The
      // confirmation overlay owns the mutation and persistence; this hook
      // only owns pointer input and its preview.
      pointsRef.current = points
      drawingRef.current?.setDrawPoints(points)
      renderBoundaryDrawing(m, points)
      onCompleteRef.current?.(result)
    }

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (drawingRef.current?.pendingConfirm) return
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
      renderBoundaryDrawing(map, pointsRef.current)
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
      clearBoundaryDrawing(map)
      d?.clearDrawPoints()
    }
  }, [map, tool, toolId])
}
