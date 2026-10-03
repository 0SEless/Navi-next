'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import {
  asEntityId,
  genId,
  SelectionOrigin,
  useEditor,
} from '@navi/editor'
import type { CampusDocument, LatLng, LocalCoord } from '@navi/core'
import { worldDistanceMeters } from '@navi/core'
import { useStudioStore } from '@/store/studio-store'
import { useCurrentTool } from './useCurrentTool'
import {
  POI_PREVIEW_FILL,
  POI_PREVIEW_LINE,
  POI_PREVIEW_SOURCE,
  POI_PREVIEW_VERTICES,
} from './rendering/constants'
import {
  buildCircleLocalPoints,
  buildPOIGeometry,
  buildRectangleLocalPoints,
  buildWorldCirclePreview,
  buildWorldPOIGeometry,
  buildWorldRectanglePreview,
  localDistance,
  normalizeRectangle,
  isPOIGeometryTool,
  type POIGeometryTool,
} from './poi-geometry-authoring'
import {
  describePoiGeometryFailure,
  reportPoiPlacementBlocked,
  resolvePoiPlacementContext,
} from './poi-placement-context'

interface POIGeometryAuthoringProps {
  map: maplibregl.Map
}

interface POIDraft {
  tool: POIGeometryTool
  scope: 'indoor' | 'outdoor'
  buildingId: string
  floorLevel: number
  // Indoor (floor-local meters) gesture state.
  center?: LocalCoord
  first?: LocalCoord
  current?: LocalCoord
  points: LocalCoord[]
  // Outdoor (world LatLng) gesture state.
  worldCenter?: LatLng
  worldFirst?: LatLng
  worldCurrent?: LatLng
  worldPoints: LatLng[]
  dragging: boolean
}

interface POICommandDispatcher {
  execute(command: {
    id: 'poi.create'
    label: string
    payload: Record<string, unknown>
  }): { success?: boolean; error?: string } | undefined
}

interface POISelectionManager {
  select(selector: {
    type: 'poi'
    id: ReturnType<typeof asEntityId>
    buildingId?: ReturnType<typeof asEntityId>
    floorId?: ReturnType<typeof asEntityId>
  }, origin: SelectionOrigin): void
}

type GestureContext =
  | { ok: true; scope: 'indoor'; buildingId: string; floorId: string; floorLevel: number }
  | { ok: true; scope: 'outdoor' }
  | { ok: false; reason: string }

const EMPTY_PREVIEW: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

function copyPoint(point: LocalCoord): LocalCoord {
  return { x: point.x, y: point.y }
}

function copyLatLng(point: LatLng): LatLng {
  return { lat: point.lat, lng: point.lng }
}

function samePoint(a: LocalCoord, b: LocalCoord): boolean {
  return a.x === b.x && a.y === b.y
}

function sameLatLng(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng
}

function removeConsecutiveDuplicates(points: LocalCoord[]): LocalCoord[] {
  return points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]))
}

function removeConsecutiveWorldDuplicates(points: LatLng[]): LatLng[] {
  return points.filter((point, index) => index === 0 || !sameLatLng(point, points[index - 1]))
}

function localPreviewPoints(draft: POIDraft): LocalCoord[] {
  if (draft.tool === 'poi-circle' && draft.center && draft.current) {
    const radius = localDistance(draft.center, draft.current)
    return radius > 0 ? buildCircleLocalPoints(draft.center, radius) : [copyPoint(draft.center)]
  }

  if (draft.tool === 'poi-rectangle' && draft.first && draft.current) {
    const bounds = normalizeRectangle(draft.first, draft.current)
    if (bounds.min.x === bounds.max.x || bounds.min.y === bounds.max.y) {
      return [copyPoint(draft.first)]
    }
    return buildRectangleLocalPoints(bounds.min, bounds.max)
  }

  return draft.points.map(copyPoint)
}

function worldPreviewPoints(draft: POIDraft): LatLng[] {
  if (draft.tool === 'poi-circle' && draft.worldCenter && draft.worldCurrent) {
    const radius = worldDistanceMeters(draft.worldCenter, draft.worldCurrent)
    return radius > 0 ? buildWorldCirclePreview(draft.worldCenter, radius) : [copyLatLng(draft.worldCenter)]
  }

  if (draft.tool === 'poi-rectangle' && draft.worldFirst && draft.worldCurrent) {
    if (draft.worldFirst.lat === draft.worldCurrent.lat || draft.worldFirst.lng === draft.worldCurrent.lng) {
      return [copyLatLng(draft.worldFirst)]
    }
    return buildWorldRectanglePreview(draft.worldFirst, draft.worldCurrent)
  }

  return draft.worldPoints.map(copyLatLng)
}

function buildPreviewGeoJSON(
  draft: POIDraft | null,
  document: CampusDocument,
  transformer: { floorLocalToWorld(local: LocalCoord, buildingId: string, level: number): { lat: number; lng: number } | null } | undefined,
  buildingId: string | null,
  floorLevel: number,
): GeoJSON.FeatureCollection {
  if (!draft) return EMPTY_PREVIEW

  let worldPoints: Array<[number, number]> = []

  if (draft.scope === 'outdoor') {
    worldPoints = worldPreviewPoints(draft).map(point => [point.lng, point.lat] as [number, number])
  } else {
    if (!transformer || !buildingId) return EMPTY_PREVIEW
    const building = document.buildings.find(candidate => candidate.id === buildingId)
    const floor = building?.floors.find(candidate => candidate.level === floorLevel)
    if (!floor) return EMPTY_PREVIEW

    const localPoints = localPreviewPoints(draft)
    worldPoints = localPoints
      .map(point => transformer.floorLocalToWorld(point, buildingId, floor.level))
      .filter((point): point is { lat: number; lng: number } => point !== null)
      .map(point => [point.lng, point.lat] as [number, number])
  }

  if (worldPoints.length === 0) return EMPTY_PREVIEW

  const features: GeoJSON.Feature[] = []
  if (worldPoints.length >= 3) {
    features.push({
      type: 'Feature',
      properties: { preview: true },
      geometry: { type: 'Polygon', coordinates: [[...worldPoints, worldPoints[0]]] },
    })
  }
  if (worldPoints.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { preview: true },
      geometry: {
        type: 'LineString',
        coordinates: [...worldPoints, ...(worldPoints.length >= 3 ? [worldPoints[0]] : [])],
      },
    })
  }
  for (const point of worldPoints) {
    features.push({
      type: 'Feature',
      properties: { preview: true },
      geometry: { type: 'Point', coordinates: point },
    })
  }

  return { type: 'FeatureCollection', features }
}

function ensurePreviewLayers(map: maplibregl.Map): void {
  try {
    if (!map.getSource(POI_PREVIEW_SOURCE)) {
      map.addSource(POI_PREVIEW_SOURCE, { type: 'geojson', data: EMPTY_PREVIEW })
    }
    if (!map.getLayer(POI_PREVIEW_FILL)) {
      map.addLayer({
        id: POI_PREVIEW_FILL,
        type: 'fill',
        source: POI_PREVIEW_SOURCE,
        paint: { 'fill-color': '#F59E0B', 'fill-opacity': 0.12 },
      } as maplibregl.FillLayerSpecification)
    }
    if (!map.getLayer(POI_PREVIEW_LINE)) {
      map.addLayer({
        id: POI_PREVIEW_LINE,
        type: 'line',
        source: POI_PREVIEW_SOURCE,
        paint: { 'line-color': '#F59E0B', 'line-width': 2, 'line-dasharray': [3, 2] },
      } as maplibregl.LineLayerSpecification)
    }
    if (!map.getLayer(POI_PREVIEW_VERTICES)) {
      map.addLayer({
        id: POI_PREVIEW_VERTICES,
        type: 'circle',
        source: POI_PREVIEW_SOURCE,
        paint: {
          'circle-radius': 5,
          'circle-color': '#F59E0B',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#FFFFFF',
        },
      } as maplibregl.CircleLayerSpecification)
    }
  } catch {
    // The map can be between style transitions; style.load retries setup.
  }
}

function clearPreview(map: maplibregl.Map): void {
  try {
    const source = map.getSource(POI_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(EMPTY_PREVIEW)
  } catch {
    // The map may already be unmounting.
  }
}

export function POIGeometryAuthoring({ map }: POIGeometryAuthoringProps) {
  const currentTool = useCurrentTool()
  const { document, services, transformer } = useEditor()
  const activeBuildingId = useStudioStore(state => state.activeBuildingId)
  const activeFloor = useStudioStore(state => state.activeFloor)
  const [draft, setDraft] = useState<POIDraft | null>(null)
  const draftRef = useRef<POIDraft | null>(null)
  const contextRef = useRef({ document, transformer, activeBuildingId, activeFloor })
  useEffect(() => {
    contextRef.current = { document, transformer, activeBuildingId, activeFloor }
  }, [activeBuildingId, activeFloor, document, transformer])

  const dispatcher = services.get('dispatcher') as POICommandDispatcher | undefined
  const selection = services.get('selection') as POISelectionManager | undefined

  const updateDraft = useCallback((next: POIDraft | null) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  const visibleDraft = draft
    && isPOIGeometryTool(currentTool)
    && draft.tool === currentTool
    && (draft.scope === 'outdoor' || (draft.buildingId === activeBuildingId && draft.floorLevel === activeFloor))
    ? draft
    : null

  const setDragPanEnabled = useCallback((enabled: boolean) => {
    if (enabled) map.dragPan.enable()
    else map.dragPan.disable()
  }, [map])

  const clearDraft = useCallback(() => {
    const previous = draftRef.current
    updateDraft(null)
    clearPreview(map)
    if (previous?.dragging) setDragPanEnabled(true)
  }, [map, setDragPanEnabled, updateDraft])

  /**
   * Resolve the placement scope for a new gesture:
   *  - no active building → outdoor/campus POI (world coordinates);
   *  - active building + matching floor + transform → indoor floor-local POI;
   *  - active building but broken context → explicit reason (never a silent
   *    outdoor fallback while a building is selected).
   */
  const resolveGestureContext = useCallback((): GestureContext => {
    const { document: currentDocument, transformer: currentTransformer, activeBuildingId: buildingId, activeFloor: floorLevel } = contextRef.current
    if (!buildingId) return { ok: true, scope: 'outdoor' }

    const placement = resolvePoiPlacementContext(currentDocument, buildingId, floorLevel)
    if (!placement.ok) return placement
    if (!currentTransformer) {
      return { ok: false, reason: 'Floor coordinate transform is unavailable. Reopen the floor and try again.' }
    }
    return {
      ok: true,
      scope: 'indoor',
      buildingId: placement.building.id,
      floorId: placement.floor.id,
      floorLevel: placement.floor.level,
    }
  }, [])

  const eventWorld = useCallback((event: maplibregl.MapMouseEvent): LatLng => ({
    lat: event.lngLat.lat,
    lng: event.lngLat.lng,
  }), [])

  const commitDraft = useCallback((candidate: POIDraft): { ok: boolean; reason?: string } => {
    const gesture = resolveGestureContext()
    if (!gesture.ok) return gesture
    if (!dispatcher || !selection) return { ok: false, reason: 'POI tool is not connected to the editor document.' }
    if (candidate.scope !== gesture.scope) {
      return { ok: false, reason: 'The placement context changed; start the gesture again.' }
    }

    const label = `Create ${candidate.tool === 'poi-circle' ? 'Circle' : candidate.tool === 'poi-rectangle' ? 'Rectangle' : 'Polygon'} POI`
    const id = genId('poi')

    if (gesture.scope === 'outdoor') {
      const geometry = buildWorldPOIGeometry(candidate.tool, {
        center: candidate.worldCenter,
        first: candidate.worldFirst,
        current: candidate.worldCurrent,
        points: candidate.worldPoints,
      })
      if (!geometry) return { ok: false, reason: describePoiGeometryFailure(candidate.tool) }

      const result = dispatcher.execute({
        id: 'poi.create',
        label,
        payload: {
          id,
          scope: 'outdoor',
          name: '',
          category: 'other',
          geometry,
        },
      })
      if (result?.success === false) {
        return { ok: false, reason: `POI creation failed: ${result.error ?? 'unknown error'}` }
      }

      selection.select({ type: 'poi', id: asEntityId(id) }, SelectionOrigin.Canvas)
      clearDraft()
      return { ok: true }
    }

    const geometry = buildPOIGeometry(candidate.tool, candidate)
    if (!geometry) return { ok: false, reason: describePoiGeometryFailure(candidate.tool) }

    const result = dispatcher.execute({
      id: 'poi.create',
      label,
      payload: {
        id,
        buildingId: gesture.buildingId,
        floorId: gesture.floorId,
        name: '',
        category: 'other',
        geometry,
      },
    })
    if (result?.success === false) {
      return { ok: false, reason: `POI creation failed: ${result.error ?? 'unknown error'}` }
    }

    selection.select({
      type: 'poi',
      id: asEntityId(id),
      buildingId: asEntityId(gesture.buildingId),
      floorId: asEntityId(gesture.floorId),
    }, SelectionOrigin.Canvas)
    clearDraft()
    return { ok: true }
  }, [clearDraft, dispatcher, resolveGestureContext, selection])

  const finishPolygon = useCallback((): boolean => {
    const current = draftRef.current
    if (!current || current.tool !== 'poi-polygon') return false

    let candidate: POIDraft
    if (current.scope === 'outdoor') {
      const worldPoints = removeConsecutiveWorldDuplicates(current.worldPoints)
      if (worldPoints.length < 3) {
        reportPoiPlacementBlocked(describePoiGeometryFailure('poi-polygon'))
        return false
      }
      candidate = { ...current, worldPoints }
    } else {
      const points = removeConsecutiveDuplicates(current.points)
      if (points.length < 3) {
        reportPoiPlacementBlocked(describePoiGeometryFailure('poi-polygon'))
        return false
      }
      candidate = { ...current, points }
    }

    const committed = commitDraft(candidate)
    if (!committed.ok) {
      if (committed.reason) reportPoiPlacementBlocked(committed.reason)
      updateDraft(candidate)
      return false
    }
    return true
  }, [commitDraft, updateDraft])

  useEffect(() => {
    ensurePreviewLayers(map)
    const onStyleLoad = () => {
      ensurePreviewLayers(map)
      const { document: currentDocument, transformer: currentTransformer, activeBuildingId: buildingId, activeFloor: floorLevel } = contextRef.current
      const source = map.getSource(POI_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined
      source?.setData(buildPreviewGeoJSON(draftRef.current, currentDocument, currentTransformer, buildingId, floorLevel))
    }
    map.on('style.load', onStyleLoad)
    return () => {
      try { map.off('style.load', onStyleLoad) } catch {}
      clearPreview(map)
      for (const layerId of [POI_PREVIEW_VERTICES, POI_PREVIEW_LINE, POI_PREVIEW_FILL]) {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId) } catch {}
      }
      try { if (map.getSource(POI_PREVIEW_SOURCE)) map.removeSource(POI_PREVIEW_SOURCE) } catch {}
    }
  }, [map])

  useEffect(() => {
    ensurePreviewLayers(map)
    const source = map.getSource(POI_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(buildPreviewGeoJSON(visibleDraft, document, transformer, activeBuildingId, activeFloor))
  }, [activeBuildingId, activeFloor, document, map, transformer, visibleDraft])

  useEffect(() => {
    if (isPOIGeometryTool(currentTool)) return
    const previous = draftRef.current
    if (!previous) return
    draftRef.current = null
    clearPreview(map)
    if (previous.dragging) setDragPanEnabled(true)
  }, [currentTool, map, setDragPanEnabled])

  useEffect(() => {
    const previous = draftRef.current
    if (!previous) return
    const contextMatches = previous.scope === 'outdoor'
      ? activeBuildingId === null
      : previous.buildingId === activeBuildingId && previous.floorLevel === activeFloor
    if (contextMatches) return
    draftRef.current = null
    clearPreview(map)
    if (previous.dragging) setDragPanEnabled(true)
  }, [activeBuildingId, activeFloor, map, setDragPanEnabled])

  useEffect(() => {
    if (!isPOIGeometryTool(currentTool)) return

    const startDraft = (scope: 'indoor' | 'outdoor', event: maplibregl.MapMouseEvent): POIDraft | null => {
      if (scope === 'outdoor') {
        const world = eventWorld(event)
        return currentTool === 'poi-circle'
          ? { tool: currentTool, scope, buildingId: '', floorLevel: 0, worldCenter: world, worldCurrent: world, worldPoints: [], points: [], dragging: true }
          : { tool: currentTool, scope, buildingId: '', floorLevel: 0, worldFirst: world, worldCurrent: world, worldPoints: [], points: [], dragging: true }
      }
      const localResult = resolveIndoorLocal(event)
      if (!localResult.ok) {
        reportPoiPlacementBlocked(localResult.reason)
        return null
      }
      return currentTool === 'poi-circle'
        ? { tool: currentTool, scope, buildingId: contextRef.current.activeBuildingId ?? '', floorLevel: contextRef.current.activeFloor, center: localResult.local, current: localResult.local, points: [], worldPoints: [], dragging: true }
        : { tool: currentTool, scope, buildingId: contextRef.current.activeBuildingId ?? '', floorLevel: contextRef.current.activeFloor, first: localResult.local, current: localResult.local, points: [], worldPoints: [], dragging: true }
    }

    const resolveIndoorLocal = (event: maplibregl.MapMouseEvent): { ok: true; local: LocalCoord } | { ok: false; reason: string } => {
      const { document: currentDocument, transformer: currentTransformer, activeBuildingId: buildingId, activeFloor: floorLevel } = contextRef.current
      const placement = resolvePoiPlacementContext(currentDocument, buildingId, floorLevel)
      if (!placement.ok) return placement
      if (!currentTransformer) {
        return { ok: false, reason: 'Floor coordinate transform is unavailable. Reopen the floor and try again.' }
      }
      const local = currentTransformer.worldToFloorLocal(
        { lat: event.lngLat.lat, lng: event.lngLat.lng },
        placement.building.id,
        placement.floor.level,
      )
      if (!local) {
        return { ok: false, reason: 'Could not convert this point to floor coordinates. Reopen the floor and try again.' }
      }
      return { ok: true, local }
    }

    const handleMouseDown = (event: maplibregl.MapMouseEvent) => {
      if (event.originalEvent.button !== 0) return
      if (currentTool !== 'poi-circle' && currentTool !== 'poi-rectangle') return
      const gesture = resolveGestureContext()
      if (!gesture.ok) {
        reportPoiPlacementBlocked(gesture.reason)
        return
      }
      const next = startDraft(gesture.scope, event)
      if (!next) return
      setDragPanEnabled(false)
      updateDraft(next)
    }

    const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
      const current = draftRef.current
      if (!current?.dragging || current.tool !== currentTool) return
      if (current.scope === 'outdoor') {
        updateDraft({ ...current, worldCurrent: eventWorld(event) })
        return
      }
      const localResult = resolveIndoorLocal(event)
      if (!localResult.ok) return
      updateDraft({ ...current, current: localResult.local })
    }

    const handleMouseUp = (event: maplibregl.MapMouseEvent) => {
      const current = draftRef.current
      if (!current?.dragging || current.tool !== currentTool) return

      let candidate: POIDraft
      if (current.scope === 'outdoor') {
        candidate = { ...current, worldCurrent: eventWorld(event), dragging: false }
      } else {
        const localResult = resolveIndoorLocal(event)
        if (!localResult.ok) {
          reportPoiPlacementBlocked(localResult.reason)
          clearDraft()
          return
        }
        candidate = { ...current, current: localResult.local, dragging: false }
      }

      const committed = commitDraft(candidate)
      if (!committed.ok) {
        if (committed.reason) reportPoiPlacementBlocked(committed.reason)
        clearDraft()
      }
    }

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (currentTool !== 'poi-polygon') return
      const gesture = resolveGestureContext()
      if (!gesture.ok) {
        reportPoiPlacementBlocked(gesture.reason)
        return
      }
      const current = draftRef.current

      if (gesture.scope === 'outdoor') {
        updateDraft({
          tool: 'poi-polygon',
          scope: 'outdoor',
          buildingId: '',
          floorLevel: 0,
          points: [],
          worldPoints: [...(current?.scope === 'outdoor' ? current.worldPoints : []), eventWorld(event)],
          dragging: false,
        })
        return
      }

      const localResult = resolveIndoorLocal(event)
      if (!localResult.ok) {
        reportPoiPlacementBlocked(localResult.reason)
        return
      }
      updateDraft({
        tool: 'poi-polygon',
        scope: 'indoor',
        buildingId: contextRef.current.activeBuildingId ?? '',
        floorLevel: contextRef.current.activeFloor,
        points: [...(current?.scope === 'indoor' ? current.points : []), localResult.local],
        worldPoints: [],
        dragging: false,
      })
    }

    const handleDoubleClick = (event: maplibregl.MapMouseEvent & { preventDefault?: () => void }) => {
      if (currentTool !== 'poi-polygon') return
      event.preventDefault?.()
      finishPolygon()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTextEntry = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
        || target?.isContentEditable
      if (isTextEntry) return
      if (event.key === 'Escape') {
        event.preventDefault()
        clearDraft()
      } else if (event.key === 'Enter' && currentTool === 'poi-polygon') {
        event.preventDefault()
        finishPolygon()
      }
    }

    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    map.on('click', handleClick)
    map.on('dblclick', handleDoubleClick)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      try { map.off('mousedown', handleMouseDown) } catch {}
      try { map.off('mousemove', handleMouseMove) } catch {}
      try { map.off('mouseup', handleMouseUp) } catch {}
      try { map.off('click', handleClick) } catch {}
      try { map.off('dblclick', handleDoubleClick) } catch {}
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [clearDraft, commitDraft, currentTool, eventWorld, finishPolygon, map, resolveGestureContext, setDragPanEnabled, updateDraft])

  if (!visibleDraft) return null

  const polygon = visibleDraft.tool === 'poi-polygon'
  const polygonVertexCount = polygon
    ? (visibleDraft.scope === 'outdoor'
      ? removeConsecutiveWorldDuplicates(visibleDraft.worldPoints).length
      : removeConsecutiveDuplicates(visibleDraft.points).length)
    : 0
  const canFinishPolygon = polygon && polygonVertexCount >= 3
  const scopeLabel = visibleDraft.scope === 'outdoor' ? 'Outdoor ' : ''
  return (
    <div
      data-poi-geometry-authoring="true"
      style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: '#1E293B', borderRadius: 8, color: '#E2E8F0', fontSize: 11,
        zIndex: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <span>{polygon
        ? `${scopeLabel}POI Polygon · ${polygonVertexCount} vertices`
        : `${scopeLabel}POI ${visibleDraft.tool === 'poi-circle' ? 'Circle' : 'Rectangle'} · release to commit`}</span>
      {polygon && (
        <button type="button" disabled={!canFinishPolygon} onClick={finishPolygon} aria-label="Finish Polygon">
          Finish Polygon
        </button>
      )}
      <button type="button" onClick={clearDraft} aria-label="Cancel POI geometry">
        Cancel
      </button>
    </div>
  )
}
