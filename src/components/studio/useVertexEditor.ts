'use client'

import { useCallback, useRef, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { buildRoadJunctionMovePlan, useEditor, useEditingEngine } from '@navi/editor'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { useStudioStore } from '@/store/studio-store'
import type { LatLng } from '@/types/nav-types'
import { haversine } from '@/engine/geo-utils'

const VERTEX_SOURCE = 'vertex-source'
const VERTEX_LAYER = 'vertex-points'
const VERTEX_EDGE_LAYER = 'vertex-edges'
const VERTEX_MIDPOINT_LAYER = 'vertex-midpoints'

interface ActiveVertexPointerDrag {
  pointerId: number
  canvas: HTMLCanvasElement
  initialPoints: LatLng[]
  initialIndex: number
  initialHandlerState: { dragPan: boolean; boxZoom: boolean }
}

// Safe query wrapper that checks if layer exists before querying
function safeQueryRenderedFeatures(
  map: maplibregl.Map,
  point: maplibregl.PointLike,
  options: { layers: string[] }
): maplibregl.MapboxGeoJSONFeature[] {
  try {
    // Check if all requested layers exist
    const layersExist = options.layers.every(layer => map.getLayer(layer))
    if (!layersExist) return []
    return map.queryRenderedFeatures(point, options)
  } catch {
    return []
  }
}

function pointsToLineCoords(points: LatLng[]): [number, number][] {
  return points.map((p) => [p.lng, p.lat] as [number, number])
}

function buildEdgeGeo(points: LatLng[]): GeoJSON.FeatureCollection {
  if (points.length < 2) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: pointsToLineCoords(points) },
    }],
  }
}

function buildMidpointGeo(points: LatLng[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const mid = {
      lat: (points[i].lat + points[i + 1].lat) / 2,
      lng: (points[i].lng + points[i + 1].lng) / 2,
    }
    features.push({
      type: 'Feature',
      properties: { segment: i },
      geometry: { type: 'Point', coordinates: [mid.lng, mid.lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

function addVertexLayers(map: maplibregl.Map) {
  try {
    if (!map.getSource(VERTEX_SOURCE)) {
      map.addSource(VERTEX_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    }
    if (!map.getLayer(VERTEX_EDGE_LAYER)) {
      map.addLayer({ id: VERTEX_EDGE_LAYER, type: 'line', source: VERTEX_SOURCE, paint: { 'line-color': '#F59E0B', 'line-width': 2, 'line-dasharray': [2, 2] } })
    }
    if (!map.getLayer(VERTEX_MIDPOINT_LAYER)) {
      map.addLayer({ id: VERTEX_MIDPOINT_LAYER, type: 'circle', source: VERTEX_SOURCE, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 4, 20, 8], 'circle-color': '#94A3B8', 'circle-stroke-width': 1, 'circle-stroke-color': '#1E293B', 'circle-opacity': 0.6 }, filter: ['!=', ['get', 'segment'], -1] })
    }
    if (!map.getLayer(VERTEX_LAYER)) {
      map.addLayer({ id: VERTEX_LAYER, type: 'circle', source: VERTEX_SOURCE, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, ['case', ['boolean', ['get', 'selected'], false], 12, 8], 20, ['case', ['boolean', ['get', 'selected'], false], 18, 14]], 'circle-color': '#F59E0B', 'circle-stroke-width': 2, 'circle-stroke-color': '#1E293B' }, filter: ['==', ['get', 'segment'], -1] })
    }

    // Keep edit controls above authored roads/buildings after every style
    // rebuild. `moveLayer` is best-effort because MapLibre can be between
    // style states while a basemap is being replaced.
    for (const layerId of [VERTEX_EDGE_LAYER, VERTEX_MIDPOINT_LAYER, VERTEX_LAYER]) {
      if (map.getLayer(layerId)) {
        try { map.moveLayer(layerId) } catch { /* style is still settling */ }
      }
    }
  } catch {
    // The style can be unavailable for one render tick; style.load retries it.
  }
}

/**
 * Vertex editor for road geometry.
 *
 * Reads the current road (via edit target ID matching road ID) from
 * CampusDocument and edits its polyline points through commands.
 * The GraphAdapter (when wired) will regenerate compiled traces
 * from the updated Road entity.
 */
export function useVertexEditor(map: maplibregl.Map | null) {
  const editTargetType = useStudioStore((s) => s.editTargetType)
  const editTargetId = useStudioStore((s) => s.editTargetId)
  const isVertexEditing = useStudioStore((s) => s.isVertexEditing)
  const setVertexEditing = useStudioStore((s) => s.setVertexEditing)

  const { document, services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get('dispatcher')!
  const workflow = services.get('workflow')!

  const currentEditRoad =
    editTargetType === 'trace' && editTargetId
      ? document.roads.find((r) => r.id === editTargetId) ?? null
      : null

  const pointsRef = useRef<LatLng[]>(currentEditRoad?.polyline.points ?? [])
  const selectedIdxRef = useRef<number | null>(null)
  const dragStartRef = useRef<LatLng | null>(null)
  const dragOriginalsRef = useRef<{ adjacentPoint?: LatLng; isEndpoint: boolean }>({ isEndpoint: false })
  const activePointerDragRef = useRef<ActiveVertexPointerDrag | null>(null)
  const pendingCoordinateRef = useRef<LatLng | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const junctionDragIdRef = useRef<string | null>(null)
  const connectedRoadsRef = useRef<Array<{ roadId: string; points: LatLng[] }>>([])

  useEffect(() => {
    pointsRef.current = currentEditRoad?.polyline.points ?? []
  }, [currentEditRoad])

  const handleSave = useCallback((points: LatLng[], junctionMove?: { junctionId: string; position: LatLng }) => {
    if (currentEditRoad) {
      editEngine.begin({ kind: 'modifyGeometry', entityId: currentEditRoad.id, geometry: { polyline: { points } } })
      editEngine.doCommit()
      dispatcher.execute({
        id: 'entity.update',
        label: 'Update Road Geometry',
        payload: {
          entityId: currentEditRoad.id,
          changes: { polyline: { points } },
          ...(junctionMove ? { junctionMove } : {}),
        },
      })
      workflow.save('manual')
    }
  }, [currentEditRoad, editEngine, dispatcher, workflow])

  const updateDisplay = useCallback((
    points: LatLng[],
    selectedIdx?: number,
    connectedRoads: Array<{ roadId: string; points: LatLng[] }> = [],
  ) => {
    if (!map || !map.getSource(VERTEX_SOURCE)) return
    const src = map.getSource(VERTEX_SOURCE) as maplibregl.GeoJSONSource
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          ...points.map((p, i) => ({
            type: 'Feature' as const,
            properties: { index: i, selected: i === selectedIdx || false, segment: -1 },
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
          })),
          ...connectedRoads.map((road) => ({
            type: 'Feature' as const,
            properties: { roadId: road.roadId, segment: -2 },
            geometry: { type: 'LineString' as const, coordinates: pointsToLineCoords(road.points) },
          })),
          ...buildEdgeGeo(points).features,
          ...buildMidpointGeo(points).features,
        ],
      })
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    addVertexLayers(map)

    // Re-add vertex layers after style changes (e.g., when switching basemaps)
    // This ensures vertex layers survive map.setStyle() calls
    const onStyleLoad = () => {
      addVertexLayers(map)
      if (isVertexEditing && currentEditRoad) {
        updateDisplay(pointsRef.current, selectedIdxRef.current ?? undefined, connectedRoadsRef.current)
      }
    }
    map.on('style.load', onStyleLoad)

    return () => {
      map.off('style.load', onStyleLoad)
    }
  }, [map, isVertexEditing, currentEditRoad, updateDisplay])

  // Keep double-click zoom out of the vertex-edit gesture while leaving map
  // panning available until an actual pointer drag starts.
  useEffect(() => {
    if (!map || !isVertexEditing) return
    const wasEnabled = map.doubleClickZoom.isEnabled()
    if (wasEnabled) map.doubleClickZoom.disable()
    return () => {
      if (!wasEnabled) return
      try { map.doubleClickZoom.enable() } catch { /* Map may already be removed. */ }
    }
  }, [map, isVertexEditing])

  // Toggle vertex editing visibility
  useEffect(() => {
    if (!map || !isVertexEditing || !currentEditRoad) return
    updateDisplay(pointsRef.current, selectedIdxRef.current ?? undefined, connectedRoadsRef.current)
  }, [isVertexEditing, currentEditRoad, map, updateDisplay])

  // Clean up on disable
  useEffect(() => {
    if (!map || isVertexEditing) return
    try {
      const src = map.getSource(VERTEX_SOURCE) as maplibregl.GeoJSONSource
      if (src) src.setData({ type: 'FeatureCollection', features: [] })
    } catch { /* ok */ }
  }, [isVertexEditing, map])

  // Vertex click to select
  useEffect(() => {
    if (!map || !isVertexEditing) return
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const features = safeQueryRenderedFeatures(map, e.point, { layers: [VERTEX_LAYER] })
      if (features.length > 0) {
        const idx = features[0].properties?.index as number
        if (idx != null) selectedIdxRef.current = idx
        updateDisplay(pointsRef.current, idx)
        return
      }
      const midFeatures = safeQueryRenderedFeatures(map, e.point, { layers: [VERTEX_MIDPOINT_LAYER] })
      if (midFeatures.length > 0) {
        const segIdx = midFeatures[0].properties?.segment as number
        if (segIdx != null && pointsRef.current.length > 1) {
          const mid = {
            lat: (pointsRef.current[segIdx].lat + pointsRef.current[segIdx + 1].lat) / 2,
            lng: (pointsRef.current[segIdx].lng + pointsRef.current[segIdx + 1].lng) / 2,
          }
          const newPoints = [...pointsRef.current]
          newPoints.splice(segIdx + 1, 0, mid)
          pointsRef.current = newPoints
          updateDisplay(newPoints)
        }
        return
      }
      selectedIdxRef.current = null
      updateDisplay(pointsRef.current)
    }
    map.on('click', handleClick)
    return () => { map.off('click', handleClick) }
  }, [map, isVertexEditing, updateDisplay])

  // Vertex drag: own the native pointer until up/cancel and repaint at most once per frame.
  useEffect(() => {
    if (!map || !isVertexEditing) return
    const canvas = map.getCanvas()

    const restoreMapHandlers = (state: ActiveVertexPointerDrag['initialHandlerState']) => {
      const restore = (handler: { enable: () => void; disable: () => void }, enabled: boolean) => {
        if (enabled) handler.enable()
        else handler.disable()
      }
      restore(map.dragPan, state.dragPan)
      restore(map.boxZoom, state.boxZoom)
    }

    const getCoordinate = (event: PointerEvent, dragCanvas: HTMLCanvasElement): LatLng => {
      const rect = dragCanvas.getBoundingClientRect()
      const projected = map.unproject({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      return { lat: projected.lat, lng: projected.lng }
    }

    const applyPosition = (position: LatLng) => {
      const idx = selectedIdxRef.current
      if (idx == null) return

      const junctionId = junctionDragIdRef.current
      if (junctionId && currentEditRoad) {
        const plan = buildRoadJunctionMovePlan(document, { junctionId, position })
        const editedRoad = plan?.roads.find((road) => road.roadId === currentEditRoad.id)
        if (!plan || !editedRoad) return
        pointsRef.current = editedRoad.points.map((point) => ({ ...point }))
        connectedRoadsRef.current = plan.roads
          .filter((road) => road.roadId !== currentEditRoad.id)
          .map((road) => ({ roadId: road.roadId, points: road.points.map((point) => ({ ...point })) }))
        updateDisplay(pointsRef.current, selectedIdxRef.current ?? idx, connectedRoadsRef.current)
        return
      }

      const { isEndpoint, adjacentPoint } = dragOriginalsRef.current
      if (isEndpoint && adjacentPoint && dragStartRef.current) {
        const distToAdj = haversine(position, adjacentPoint)
        const originalDist = haversine(dragStartRef.current, adjacentPoint)
        if (distToAdj > originalDist * 1.1) {
          const newPoints = [...pointsRef.current]
          const insertAt = idx === 0 ? 0 : newPoints.length
          newPoints.splice(insertAt, 0, { ...position })
          pointsRef.current = newPoints
          selectedIdxRef.current = insertAt
          updateDisplay(newPoints, insertAt)
          dragOriginalsRef.current = {
            ...dragOriginalsRef.current,
            adjacentPoint: idx === 0
              ? { ...pointsRef.current[1] }
              : { ...pointsRef.current[pointsRef.current.length - 2] },
          }
          return
        }
      }

      const newPoints = pointsRef.current.map((point) => ({ ...point }))
      newPoints[idx] = { ...position }
      pointsRef.current = newPoints
      updateDisplay(newPoints, idx)
    }

    const flushPendingCoordinate = () => {
      const pending = pendingCoordinateRef.current
      pendingCoordinateRef.current = null
      if (pending) applyPosition(pending)
    }

    const scheduleCoordinate = (position: LatLng) => {
      const idx = selectedIdxRef.current
      const current = idx == null ? null : pointsRef.current[idx]
      if (current?.lat === position.lat && current.lng === position.lng) return
      pendingCoordinateRef.current = position
      if (animationFrameRef.current == null) {
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null
          flushPendingCoordinate()
        })
      }
    }

    const finishPointerDrag = (restoreOriginal: boolean) => {
      const drag = activePointerDragRef.current
      if (!drag) return
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      pendingCoordinateRef.current = null
      if (restoreOriginal) {
        pointsRef.current = drag.initialPoints.map((point) => ({ ...point }))
        selectedIdxRef.current = drag.initialIndex
        connectedRoadsRef.current = []
        updateDisplay(pointsRef.current, drag.initialIndex)
      }
      activePointerDragRef.current = null
      dragStartRef.current = null
      junctionDragIdRef.current = null
      connectedRoadsRef.current = []
      try {
        if (drag.canvas.hasPointerCapture(drag.pointerId)) drag.canvas.releasePointerCapture(drag.pointerId)
      } catch { /* Pointer capture may already have been released by the browser. */ }
      try { restoreMapHandlers(drag.initialHandlerState) } catch { /* Map may have been removed. */ }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || activePointerDragRef.current) return
      const rect = canvas.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const features = safeQueryRenderedFeatures(map, point, { layers: [VERTEX_LAYER] })
      const idx = features[0]?.properties?.index as number | undefined
      if (idx == null || !pointsRef.current[idx]) return

      const initialPoints = pointsRef.current.map((coordinate) => ({ ...coordinate }))
      const startPosition = { ...initialPoints[idx] }
      selectedIdxRef.current = idx
      dragStartRef.current = startPosition
      dragOriginalsRef.current = {
        isEndpoint: idx === 0 || idx === initialPoints.length - 1,
        adjacentPoint: idx === 0 && initialPoints.length > 1
          ? { ...initialPoints[1] }
          : idx === initialPoints.length - 1 && initialPoints.length > 1
            ? { ...initialPoints[initialPoints.length - 2] }
            : undefined,
      }

      const matchingJunction = currentEditRoad
        ? (document.roadJunctions ?? []).find((junction) =>
          junction.roadIds.includes(currentEditRoad.id) &&
          haversine(startPosition, junction.position) <= ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters,
        )
        : undefined
      if (matchingJunction) {
        const plan = buildRoadJunctionMovePlan(document, { junctionId: matchingJunction.id, position: startPosition })
        if (!plan) {
          updateDisplay(initialPoints, idx)
          return
        }
        junctionDragIdRef.current = matchingJunction.id
        connectedRoadsRef.current = plan.roads
          .filter((road) => road.roadId !== currentEditRoad?.id)
          .map((road) => ({ roadId: road.roadId, points: road.points.map((coordinate) => ({ ...coordinate })) }))
      } else {
        junctionDragIdRef.current = null
        connectedRoadsRef.current = []
      }

      const initialHandlerState = {
        dragPan: map.dragPan.isEnabled(),
        boxZoom: map.boxZoom.isEnabled(),
      }
      activePointerDragRef.current = {
        pointerId: event.pointerId,
        canvas,
        initialPoints,
        initialIndex: idx,
        initialHandlerState,
      }
      try { canvas.setPointerCapture(event.pointerId) } catch { /* Window listeners keep ownership if capture is unavailable. */ }
      if (initialHandlerState.dragPan) map.dragPan.disable()
      if (initialHandlerState.boxZoom) map.boxZoom.disable()
      event.preventDefault()
      updateDisplay(pointsRef.current, idx, connectedRoadsRef.current)
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const drag = activePointerDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      scheduleCoordinate(getCoordinate(event, drag.canvas))
    }

    const handlePointerUp = (event: PointerEvent) => {
      const drag = activePointerDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      scheduleCoordinate(getCoordinate(event, drag.canvas))
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      flushPendingCoordinate()

      const moved = drag.initialPoints.length !== pointsRef.current.length || pointsRef.current.some((point, index) =>
        point.lat !== drag.initialPoints[index]?.lat || point.lng !== drag.initialPoints[index]?.lng,
      )
      if (moved) {
        const junctionId = junctionDragIdRef.current
        const finalIndex = selectedIdxRef.current
        const finalPosition = finalIndex == null ? undefined : pointsRef.current[finalIndex]
        handleSave(
          pointsRef.current,
          junctionId && finalPosition ? { junctionId, position: { ...finalPosition } } : undefined,
        )
      }
      finishPointerDrag(false)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const drag = activePointerDragRef.current
      if (drag && event.pointerId === drag.pointerId) finishPointerDrag(true)
    }

    const handleLostPointerCapture = (event: PointerEvent) => {
      const drag = activePointerDragRef.current
      if (drag && event.pointerId === drag.pointerId) finishPointerDrag(true)
    }
    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.originalEvent.preventDefault()
      const features = safeQueryRenderedFeatures(map, e.point, { layers: [VERTEX_LAYER] })
      if (features.length > 0 && pointsRef.current.length > 2) {
        const idx = features[0].properties?.index as number
        const newPoints = [...pointsRef.current]
        newPoints.splice(idx, 1)
        pointsRef.current = newPoints
        selectedIdxRef.current = null
        updateDisplay(newPoints)
        handleSave(newPoints)
      }
    }
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('lostpointercapture', handleLostPointerCapture)
    map.on('contextmenu', handleContextMenu)
    return () => {
      finishPointerDrag(true)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture)
      map.off('contextmenu', handleContextMenu)
    }
  }, [map, isVertexEditing, document, currentEditRoad, updateDisplay, handleSave])

  return { active: isVertexEditing, getPoints: () => pointsRef.current, cancel: () => setVertexEditing(null, null) }
}
