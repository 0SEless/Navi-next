'use client'

import { useCallback, useRef, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { buildRoadJunctionMovePlan, useEditor, useEditingEngine } from '@navi/editor'
import type { RoadJunctionMovePlan } from '@navi/editor'
import { useStudioStore } from '@/store/studio-store'
import type { LatLng } from '@/types/nav-types'
import { haversine } from '@/engine/geo-utils'

const VERTEX_SOURCE = 'vertex-source'
const VERTEX_LAYER = 'vertex-points'
const VERTEX_EDGE_LAYER = 'vertex-edges'
const VERTEX_MIDPOINT_LAYER = 'vertex-midpoints'

interface ActiveVertexDrag {
  pointerId: number
  canvas: HTMLCanvasElement
  originalPoints: LatLng[]
  previewPoints: LatLng[]
  originalPosition: LatLng
  latestPosition: LatLng
  renderedPosition: LatLng
  selectedIndex: number
  originals: { adjacentPoint?: LatLng; isEndpoint: boolean }
  moved: boolean
  junctionId: string | null
  junctionPlan: RoadJunctionMovePlan | null
  frameId: number | null
  dragPanWasEnabled: boolean
  boxZoomWasEnabled: boolean
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
  const { begin, doCommit } = useEditingEngine()
  const dispatcher = services.get('dispatcher')!
  const workflow = services.get('workflow')!
  const autosaveRef = useRef<{ setTransientInteractionActive?: (active: boolean) => void } | null>(
    services.get('autosave') as { setTransientInteractionActive?: (active: boolean) => void } | null,
  )
  const transientInteractionActiveRef = useRef(false)
  const activeDragRef = useRef<ActiveVertexDrag | null>(null)
  const finishDragRef = useRef<((commit: boolean) => void) | null>(null)
  const doubleClickZoomWasEnabledRef = useRef<boolean | null>(null)

  useEffect(() => {
    autosaveRef.current = services.get('autosave') as { setTransientInteractionActive?: (active: boolean) => void } | null
  }, [services])

  const setTransientInteractionActive = useCallback((active: boolean) => {
    if (transientInteractionActiveRef.current === active) return
    transientInteractionActiveRef.current = active
    autosaveRef.current?.setTransientInteractionActive?.(active)
  }, [])

  const releaseTransientInteraction = useCallback(() => {
    setTransientInteractionActive(false)
  }, [setTransientInteractionActive])

  const currentEditRoad =
    editTargetType === 'trace' && editTargetId
      ? document.roads.find((r) => r.id === editTargetId) ?? null
      : null

  const pointsRef = useRef<LatLng[]>(currentEditRoad?.polyline.points ?? [])
  const selectedIdxRef = useRef<number | null>(null)

  useEffect(() => {
    pointsRef.current = currentEditRoad?.polyline.points ?? []
  }, [currentEditRoad])

  const handleSave = useCallback((points: LatLng[], junctionPlan?: RoadJunctionMovePlan | null) => {
    if (currentEditRoad) {
      begin({ kind: 'modifyGeometry', entityId: currentEditRoad.id, geometry: { polyline: { points } } })
      doCommit()
      dispatcher.execute({
        id: 'entity.update',
        label: 'Update Road Geometry',
        payload: {
          entityId: currentEditRoad.id,
          changes: { polyline: { points } },
          ...(junctionPlan ? {
            junctionMove: {
              junctionId: junctionPlan.junctionId,
              position: junctionPlan.position,
              roadGeometry: junctionPlan.roads.map(({ roadId, points: roadPoints }) => ({ roadId, points: roadPoints })),
            },
          } : {}),
        },
      })
      workflow.save('manual')
    }
  }, [begin, currentEditRoad, dispatcher, doCommit, workflow])

  const tool = useStudioStore((s) => s.tool)
  const updateDisplay = useCallback((points: LatLng[], selectedIdx?: number, junctionPlan?: RoadJunctionMovePlan | null) => {
    if (!map || !map.getSource(VERTEX_SOURCE)) return
    const src = map.getSource(VERTEX_SOURCE) as maplibregl.GeoJSONSource
    if (src) {
      const selectedRoadId = currentEditRoad?.id ?? ''
      const previewRoads = junctionPlan?.roads ?? [{ roadId: selectedRoadId, points }]
      const features: GeoJSON.Feature[] = []

      for (const road of previewRoads) {
        const roadPoints = road.roadId === selectedRoadId ? points : road.points
        const isSelectedRoad = road.roadId === selectedRoadId
        if (isSelectedRoad) {
          roadPoints.forEach((point, index) => {
            features.push({
              type: 'Feature',
              properties: {
                roadId: road.roadId,
                index,
                selected: index === selectedIdx,
                segment: -1,
              },
              geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
            })
          })
        }
        if (roadPoints.length > 1) {
          features.push({
            type: 'Feature',
            properties: { roadId: road.roadId, segment: -2 },
            geometry: { type: 'LineString', coordinates: roadPoints.map((point) => [point.lng, point.lat]) },
          })
          for (let index = 0; isSelectedRoad && index < roadPoints.length - 1; index += 1) {
            const midpoint = {
              lat: (roadPoints[index].lat + roadPoints[index + 1].lat) / 2,
              lng: (roadPoints[index].lng + roadPoints[index + 1].lng) / 2,
            }
            features.push({
              type: 'Feature',
              properties: { roadId: road.roadId, segment: index },
              geometry: { type: 'Point', coordinates: [midpoint.lng, midpoint.lat] },
            })
          }
        }
      }
      src.setData({
        type: 'FeatureCollection',
        features,
      })
    }
  }, [currentEditRoad?.id, map])

  useEffect(() => {
    if (!map) return
    addVertexLayers(map)

    // Re-add vertex layers after style changes (e.g., when switching basemaps)
    // This ensures vertex layers survive map.setStyle() calls
    const onStyleLoad = () => {
      addVertexLayers(map)
      if (isVertexEditing && currentEditRoad) {
        updateDisplay(pointsRef.current)
      }
    }
    map.on('style.load', onStyleLoad)

    return () => {
      map.off('style.load', onStyleLoad)
    }
  }, [map, isVertexEditing, currentEditRoad, updateDisplay])

  // Keep the historical double-click zoom lock, restoring its exact prior state.
  // Pan and box zoom are disabled only for the lifetime of an active pointer drag.
  useEffect(() => {
    if (!map) return
    if (isVertexEditing) {
      if (doubleClickZoomWasEnabledRef.current === null) {
        doubleClickZoomWasEnabledRef.current = map.doubleClickZoom.isEnabled()
      }
      map.doubleClickZoom.disable()
    } else if (doubleClickZoomWasEnabledRef.current !== null) {
      if (doubleClickZoomWasEnabledRef.current) map.doubleClickZoom.enable()
      else map.doubleClickZoom.disable()
      doubleClickZoomWasEnabledRef.current = null
    }
    return () => {
      const wasEnabled = doubleClickZoomWasEnabledRef.current
      if (wasEnabled !== null) {
        try {
          if (wasEnabled) map.doubleClickZoom.enable()
          else map.doubleClickZoom.disable()
        } catch {
          /* map may already be removed (StrictMode / unmount) */
        }
        doubleClickZoomWasEnabledRef.current = null
      }
    }
  }, [map, isVertexEditing])

  // Toggle vertex editing visibility
  useEffect(() => {
    if (!map || !isVertexEditing || !currentEditRoad) return
    updateDisplay(pointsRef.current)
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
      const vertexFeature = features.find((feature) => feature.properties?.roadId === currentEditRoad?.id)
      if (vertexFeature) {
        const index = vertexFeature.properties?.index
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < pointsRef.current.length) {
          selectedIdxRef.current = index
          updateDisplay(pointsRef.current, index)
        }
        return
      }
      const midpointFeature = safeQueryRenderedFeatures(map, e.point, { layers: [VERTEX_MIDPOINT_LAYER] })
        .find((feature) => feature.properties?.roadId === currentEditRoad?.id)
      if (midpointFeature) {
        const segment = midpointFeature.properties?.segment
        if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0 && segment < pointsRef.current.length - 1) {
          const mid = {
            lat: (pointsRef.current[segment].lat + pointsRef.current[segment + 1].lat) / 2,
            lng: (pointsRef.current[segment].lng + pointsRef.current[segment + 1].lng) / 2,
          }
          const newPoints = [...pointsRef.current]
          newPoints.splice(segment + 1, 0, mid)
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
  }, [map, isVertexEditing, currentEditRoad?.id, updateDisplay])

  // Native captured drag: only transient overlay geometry changes per frame.
  useEffect(() => {
    if (!map || !isVertexEditing || tool !== 'vertex' || !currentEditRoad) return
    const canvas = map.getCanvas()

    const toPosition = (event: PointerEvent): LatLng => {
      const bounds = canvas.getBoundingClientRect()
      const point: [number, number] = [event.clientX - bounds.left, event.clientY - bounds.top]
      const position = map.unproject(point)
      return { lat: position.lat, lng: position.lng }
    }

    const updatePreview = (drag: ActiveVertexDrag, position: LatLng) => {
      if (drag.junctionId) {
        const plan = buildRoadJunctionMovePlan(document, { junctionId: drag.junctionId, position })
        const selectedRoad = plan?.roads.find((road) => road.roadId === currentEditRoad.id)
        if (plan && selectedRoad) {
          drag.junctionPlan = plan
          drag.previewPoints = selectedRoad.points
          pointsRef.current = selectedRoad.points
          selectedIdxRef.current = drag.selectedIndex
          updateDisplay(selectedRoad.points, drag.selectedIndex, plan)
          drag.renderedPosition = position
          return
        }
        drag.junctionPlan = null
      }

      const points = [...drag.previewPoints]
      const { isEndpoint, adjacentPoint } = drag.originals
      if (isEndpoint && adjacentPoint) {
        const distanceToAdjacent = haversine(position, adjacentPoint)
        const originalDistance = haversine(drag.originalPosition, adjacentPoint)
        if (distanceToAdjacent > originalDistance * 1.1) {
          const insertAt = drag.selectedIndex === 0 ? 0 : points.length
          points.splice(insertAt, 0, { ...position })
          drag.selectedIndex = insertAt
          drag.originals.adjacentPoint = insertAt === 0
            ? { ...points[1] }
            : { ...points[points.length - 2] }
        } else {
          points[drag.selectedIndex] = { ...position }
        }
      } else {
        points[drag.selectedIndex] = { ...position }
      }
      drag.previewPoints = points
      pointsRef.current = points
      selectedIdxRef.current = drag.selectedIndex
      updateDisplay(points, drag.selectedIndex)
      drag.renderedPosition = position
    }

    const removeWindowListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel, true)
      canvas.removeEventListener('lostpointercapture', handleLostPointerCapture)
    }

    const finishDrag = (commit: boolean, finalPosition?: LatLng) => {
      const drag = activeDragRef.current
      if (!drag) return
      if (finalPosition) {
        drag.latestPosition = finalPosition
        if (!drag.moved && (finalPosition.lat !== drag.originalPosition.lat || finalPosition.lng !== drag.originalPosition.lng)) {
          drag.moved = true
          setTransientInteractionActive(true)
        }
      }
      activeDragRef.current = null
      if (drag.frameId !== null) {
        cancelAnimationFrame(drag.frameId)
        drag.frameId = null
      }

      try {
        if (commit && drag.moved) {
          if (drag.latestPosition.lat !== drag.renderedPosition.lat || drag.latestPosition.lng !== drag.renderedPosition.lng) {
            updatePreview(drag, drag.latestPosition)
          }
          handleSave(drag.previewPoints, drag.junctionPlan)
        } else if (!commit) {
          pointsRef.current = drag.originalPoints
          selectedIdxRef.current = drag.selectedIndex
          updateDisplay(drag.originalPoints, drag.selectedIndex)
        }
      } finally {
        removeWindowListeners()
        try {
          if (drag.canvas.hasPointerCapture(drag.pointerId)) drag.canvas.releasePointerCapture(drag.pointerId)
        } catch {
          /* Pointer capture can be released automatically by the browser. */
        }
        try {
          if (drag.dragPanWasEnabled) map.dragPan.enable()
          else map.dragPan.disable()
          if (drag.boxZoomWasEnabled) map.boxZoom.enable()
          else map.boxZoom.disable()
        } catch {
          /* The map may have been removed during cleanup. */
        }
        releaseTransientInteraction()
      }
    }
    finishDragRef.current = (commit) => finishDrag(commit)

    const handlePointerMove = (event: PointerEvent) => {
      const drag = activeDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      event.preventDefault()
      const position = toPosition(event)
      drag.latestPosition = position
      if (!drag.moved && (position.lat !== drag.originalPosition.lat || position.lng !== drag.originalPosition.lng)) {
        drag.moved = true
        setTransientInteractionActive(true)
      }
      if (drag.frameId === null) {
        drag.frameId = requestAnimationFrame(() => {
          drag.frameId = null
          if (activeDragRef.current !== drag) return
          try {
            updatePreview(drag, drag.latestPosition)
          } catch (error) {
            finishDrag(false)
            throw error
          }
        })
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const drag = activeDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      event.preventDefault()
      finishDrag(true, toPosition(event))
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const drag = activeDragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      finishDrag(true, toPosition(event))
    }

    const handleLostPointerCapture = (event: PointerEvent) => {
      const drag = activeDragRef.current
      if (drag && event.pointerId === drag.pointerId) finishDrag(true)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || activeDragRef.current) return
      const bounds = canvas.getBoundingClientRect()
      const point: [number, number] = [event.clientX - bounds.left, event.clientY - bounds.top]
      const features = safeQueryRenderedFeatures(map, point, { layers: [VERTEX_LAYER] })
      const index = features[0]?.properties?.index
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= pointsRef.current.length) return

      event.preventDefault()
      event.stopPropagation()
      const originalPoints = pointsRef.current.map((position) => ({ ...position }))
      const originalPosition = toPosition(event)
      const junction = (document.roadJunctions ?? []).find((candidate) =>
        candidate.roadIds.includes(currentEditRoad.id) &&
        haversine(originalPoints[index], candidate.position) <= ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters,
      )
      const initialJunctionPlan = junction
        ? buildRoadJunctionMovePlan(document, { junctionId: junction.id, position: junction.position })
        : null
      const drag: ActiveVertexDrag = {
        pointerId: event.pointerId,
        canvas,
        originalPoints,
        previewPoints: originalPoints.map((position) => ({ ...position })),
        originalPosition,
        latestPosition: originalPosition,
        renderedPosition: originalPosition,
        selectedIndex: index,
        originals: {
          isEndpoint: index === 0 || index === originalPoints.length - 1,
          adjacentPoint: index === 0 && originalPoints.length > 1
            ? { ...originalPoints[1] }
            : index === originalPoints.length - 1 && originalPoints.length > 1
              ? { ...originalPoints[originalPoints.length - 2] }
              : undefined,
        },
        moved: false,
        junctionId: initialJunctionPlan?.junctionId ?? null,
        junctionPlan: initialJunctionPlan,
        frameId: null,
        dragPanWasEnabled: map.dragPan.isEnabled(),
        boxZoomWasEnabled: map.boxZoom.isEnabled(),
      }
      activeDragRef.current = drag
      selectedIdxRef.current = index
      updateDisplay(originalPoints, index, initialJunctionPlan)
      map.dragPan.disable()
      map.boxZoom.disable()
      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('pointerup', handlePointerUp, true)
      window.addEventListener('pointercancel', handlePointerCancel, true)
      canvas.addEventListener('lostpointercapture', handleLostPointerCapture)
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        /* Window listeners still track the pointer when capture is unavailable. */
      }
    }

    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      finishDragRef.current?.(false)
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
    map.on('contextmenu', handleContextMenu)
    canvas.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      finishDrag(false)
      finishDragRef.current = null
      map.off('contextmenu', handleContextMenu)
      canvas.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [map, isVertexEditing, currentEditRoad, document, tool, updateDisplay, handleSave, releaseTransientInteraction, setTransientInteractionActive])

  return { active: isVertexEditing, getPoints: () => pointsRef.current, cancel: () => setVertexEditing(null, null) }
}
