'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCurrentTool } from './useCurrentTool'
import type { LatLng } from '@/types/nav-types'
import type { DrawingSessionValue } from './useDrawingSession'

const SNAP_THRESHOLD_PX = 12
const OSM_SOURCE = 'osm-import-drawing'
const OSM_FILL = 'osm-import-fill'
const OSM_LINE = 'osm-import-line'
const OSM_VERTICES = 'osm-import-vertices'

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function addSourceAndLayers(map: maplibregl.Map) {
  if (map.getSource(OSM_SOURCE)) return
  map.addSource(OSM_SOURCE, { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: OSM_FILL, type: 'fill', source: OSM_SOURCE,
    paint: { 'fill-color': '#10B981', 'fill-opacity': 0.12 },
  })
  map.addLayer({
    id: OSM_LINE, type: 'line', source: OSM_SOURCE,
    paint: { 'line-color': '#10B981', 'line-width': 3, 'line-dasharray': [4, 4] },
  })
  map.addLayer({
    id: OSM_VERTICES, type: 'circle', source: OSM_SOURCE,
    paint: {
      'circle-radius': 6, 'circle-color': '#10B981',
      'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF',
    },
  })
}

function renderDrawing(map: maplibregl.Map, points: LatLng[]) {
  const features: GeoJSON.Feature[] = []
  if (points.length >= 1) {
    const coords = points.map((p) => [p.lng, p.lat] as [number, number])
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
    const src = map.getSource(OSM_SOURCE) as maplibregl.GeoJSONSource
    if (src) src.setData({ type: 'FeatureCollection', features })
  } catch { /* source not ready */ }
}

function clearDrawing(map: maplibregl.Map) {
  try {
    const src = map.getSource(OSM_SOURCE) as maplibregl.GeoJSONSource
    if (src) src.setData(EMPTY_FC)
  } catch { /* source not ready */ }
}

export function useOsmImportTool(
  map: maplibregl.Map | null,
  drawing?: DrawingSessionValue,
) {
  const tool = useCurrentTool()
  const pointsRef = useRef<LatLng[]>([])
  const drawingRef = useRef(drawing)
  drawingRef.current = drawing

  // Init sources
  useEffect(() => {
    if (!map) return
    addSourceAndLayers(map)
  }, [map])

  // Sync from external drawPoints changes
  useEffect(() => {
    if (!map || tool !== 'import-osm') return
    pointsRef.current = [...(drawing?.drawPoints ?? [])]
    if (drawing?.pendingConfirm?.type === 'import-osm') {
      clearDrawing(map)
      return
    }
    renderDrawing(map, pointsRef.current)
  }, [map, tool, drawing?.drawPoints, drawing?.pendingConfirm])

  // Main drawing interaction
  useEffect(() => {
    if (!map) return
    if (tool !== 'import-osm') {
      pointsRef.current = []
      clearDrawing(map)
      map.doubleClickZoom?.enable()
      return
    }

    map.doubleClickZoom?.disable()

    function requestPolygonConfirmation() {
      if (pointsRef.current.length < 3) return
      const points = [...pointsRef.current]
      if (drawingRef.current?.pendingConfirm) return
      // Keep the boundary and its preview intact until the shared overlay
      // confirms the network request and persistence result.
      drawingRef.current?.requestConfirm('import-osm', points)
    }

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng }

      if (pointsRef.current.length >= 3) {
        const first = pointsRef.current[0]
        const firstScreen = map.project([first.lng, first.lat])
        const dx = e.point.x - firstScreen.x
        const dy = e.point.y - firstScreen.y
        if (Math.sqrt(dx * dx + dy * dy) <= SNAP_THRESHOLD_PX) {
          requestPolygonConfirmation()
          return
        }
      }

      pointsRef.current = [...pointsRef.current, pos]
      renderDrawing(map, pointsRef.current)
      drawingRef.current?.setDrawPoints(pointsRef.current)
    }

    const handleDblClick = () => requestPolygonConfirmation()

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)

    return () => {
      try {
        map.off('click', handleClick)
        map.off('dblclick', handleDblClick)
        map.doubleClickZoom?.enable()
      } catch {}
      pointsRef.current = []
      clearDrawing(map)
      drawingRef.current?.clearDrawPoints()
    }
  }, [map, tool])
}
