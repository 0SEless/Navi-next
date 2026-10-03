'use client'

import { useCallback, useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import { useDocumentVersion, useEditor, useSelection } from '@navi/editor'
import type { CampusDocument, LatLng, LocalCoord, PointOfInterest, PointOfInterestGeometry, PointOfInterestNavigation, WorldPOIGeometry } from '@navi/core'
import {
  moveLocalPolygonVertex,
  moveLocalPoiPoint,
  moveWorldPolygonVertex,
  moveWorldPoiPoint,
  nearestLocalPoiAnchor,
  nearestWorldPoiAnchor,
  resizeLocalRectangle,
  resizeWorldRectangle,
  rotateWorldPoiGeometry,
  setLocalCircleRadius,
  setWorldCircleRadius,
  translateLocalPoiGeometry,
  translateWorldPoiGeometry,
  worldCirclePoints,
  worldDistanceMeters,
  worldPoiGeometryCentroid,
} from '@navi/core'
import { useCurrentTool } from './useCurrentTool'
import { resolveApproachAnchorWorld } from './poi-anchor-overlay'
import { showImportToast } from './ImportToast'

/**
 * POI editing overlay: selection handles + drag transforms.
 *
 * Gestures (select tool + selected POI):
 *  - Point: drag the marker.
 *  - Circle: drag the body to move; drag the radius handle to resize.
 *  - Rectangle: drag the body to move; drag a corner to resize; drag the
 *    rotation handle (outdoor) to rotate.
 *  - Polygon: drag the fill/body to move; drag a vertex to reshape.
 *
 * Every gesture commits exactly one `poi.update` command on mouse-up, so
 * undo/redo uses the existing command/history architecture. No topology or
 * non-POI entity is touched.
 */

const EDIT_SOURCE = 's-poi-edit'
const EDIT_FILL = 'l-poi-edit-fill'
const EDIT_LINE = 'l-poi-edit-line'
const EDIT_HANDLES = 'l-poi-edit-handles'
const EDIT_ANCHOR = 'l-poi-edit-anchor'

const POI_HIT_LAYERS = ['navi-poi-icon', 'navi-poi-fill', 'navi-poi-extrusion', 'navi-poi-outline']
const HANDLE_HIT_RADIUS_PX = 12
const MOVED_EPSILON_PX = 2
const ROTATION_HANDLE_METERS = 28

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

type Scope = 'indoor' | 'outdoor'

type HandleKind =
  | { type: 'body' }
  | { type: 'radius' }
  | { type: 'resize'; corner: number }
  | { type: 'rotate' }
  | { type: 'vertex'; index: number }

interface SelectionInfo {
  id: string
  scope: Scope
  geometry: PointOfInterestGeometry | WorldPOIGeometry
  buildingId?: string
  floorLevel?: number
  navigation?: PointOfInterestNavigation
}

interface EditHandle {
  kind: HandleKind
  position: LatLng
}

interface DragState {
  kind: HandleKind
  startWorld: LatLng
  original: PointOfInterestGeometry | WorldPOIGeometry
  candidate: PointOfInterestGeometry | WorldPOIGeometry
  moved: boolean
}

function findSelectedPoi(
  document: CampusDocument | undefined,
  id: string | null,
): SelectionInfo | null {
  if (!document || !id) return null

  for (const poi of document.pois ?? []) {
    if (poi.id === id) return { id, scope: 'outdoor', geometry: poi.geometry, navigation: poi.navigation }
  }
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      const poi = floor.pois?.find((candidate) => candidate.id === id)
      if (poi) {
        const geometry = 'geometry' in poi && poi.geometry !== undefined
          ? poi.geometry
          : ('position' in poi ? { type: 'point' as const, position: { ...(poi as PointOfInterest).position } } : null)
        if (geometry) {
          return { id, scope: 'indoor', geometry, buildingId: building.id, floorLevel: floor.level, navigation: (poi as PointOfInterest).navigation }
        }
      }
    }
  }
  return null
}

function metersPerDegreeLng(latitude: number): number {
  return Math.max(Math.cos((latitude * Math.PI) / 180) * 111_320, 1)
}

export function usePoiEditor(map: maplibregl.Map | null): void {
  const currentTool = useCurrentTool()
  const { document, services, transformer } = useEditor()
  const selection = useSelection()
  useDocumentVersion()

  const documentRef = useRef(document)
  documentRef.current = document
  const transformerRef = useRef(transformer)
  transformerRef.current = transformer
  const dispatcherRef = useRef(services.get('dispatcher'))
  dispatcherRef.current = services.get('dispatcher')
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const dragRef = useRef<DragState | null>(null)
  const anchorPickRef = useRef<string | null>(null)

  const selectedId = selection.lastSelected?.type === 'poi'
    ? selection.lastSelected.id
    : null
  const selectedInfo = currentTool === 'select' ? findSelectedPoi(document, selectedId) : null
  const selectedInfoRef = useRef<SelectionInfo | null>(selectedInfo)
  selectedInfoRef.current = selectedInfo

  // ── Coordinate adapters ──
  const toWorld = useCallback((local: LocalCoord, info: SelectionInfo): LatLng | null => {
    const model = transformerRef.current
    if (!model || info.buildingId === undefined || info.floorLevel === undefined) return null
    return model.floorLocalToWorld(local, info.buildingId, info.floorLevel)
  }, [])

  const toLocal = useCallback((world: LatLng, info: SelectionInfo): LocalCoord | null => {
    const model = transformerRef.current
    if (!model || info.buildingId === undefined || info.floorLevel === undefined) return null
    return model.worldToFloorLocal(world, info.buildingId, info.floorLevel)
  }, [])

  const geometryToWorldRings = useCallback((geometry: PointOfInterestGeometry | WorldPOIGeometry, info: SelectionInfo): Array<Array<[number, number]>> => {
    const worldPoint = (point: LatLng): [number, number] => [point.lng, point.lat]
    const localToWorldPoint = (point: LocalCoord): [number, number] | null => {
      const world = toWorld(point, info)
      return world ? worldPoint(world) : null
    }

    if (geometry.type === 'point') return []
    if (geometry.type === 'circle') {
      const center = info.scope === 'outdoor'
        ? (geometry as Extract<WorldPOIGeometry, { type: 'circle' }>).center
        : toWorld((geometry as Extract<PointOfInterestGeometry, { type: 'circle' }>).center, info)
      if (!center) return []
      const ring = worldCirclePoints(center, geometry.radius).map(worldPoint)
      return [[...ring, ring[0]]]
    }
    if (geometry.type === 'polygon') {
      const points = info.scope === 'outdoor'
        ? (geometry as Extract<WorldPOIGeometry, { type: 'polygon' }>).points.map(worldPoint)
        : (geometry as Extract<PointOfInterestGeometry, { type: 'polygon' }>).points
            .map(localToWorldPoint)
            .filter((point): point is [number, number] => point !== null)
      return points.length >= 3 ? [[...points, points[0]]] : []
    }
    // rectangle
    const corners = info.scope === 'outdoor'
      ? (geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>).points.map(worldPoint)
      : [
          { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.y },
          { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.y },
          { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.y },
          { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.y },
        ].map(localToWorldPoint).filter((point): point is [number, number] => point !== null)
    return corners.length >= 3 ? [[...corners, corners[0]]] : []
  }, [toWorld])

  const handlesFor = useCallback((geometry: PointOfInterestGeometry | WorldPOIGeometry, info: SelectionInfo): EditHandle[] => {
    if (geometry.type === 'point') {
      const world = info.scope === 'outdoor'
        ? (geometry as Extract<WorldPOIGeometry, { type: 'point' }>).position
        : toWorld((geometry as Extract<PointOfInterestGeometry, { type: 'point' }>).position, info)
      return world ? [{ kind: { type: 'body' }, position: world }] : []
    }

    if (geometry.type === 'circle') {
      const center = info.scope === 'outdoor'
        ? (geometry as Extract<WorldPOIGeometry, { type: 'circle' }>).center
        : toWorld((geometry as Extract<PointOfInterestGeometry, { type: 'circle' }>).center, info)
      if (!center) return []
      const radius = geometry.radius
      const edge: LatLng = {
        lat: center.lat,
        lng: center.lng + radius / metersPerDegreeLng(center.lat),
      }
      return [{ kind: { type: 'body' }, position: center }, { kind: { type: 'radius' }, position: edge }]
    }

    const handles: EditHandle[] = []
    if (geometry.type === 'rectangle') {
      const corners: LatLng[] = info.scope === 'outdoor'
        ? (geometry as Extract<WorldPOIGeometry, { type: 'rectangle' }>).points
        : [
            { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.y },
            { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.y },
            { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.y },
            { x: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).min.x, y: (geometry as Extract<PointOfInterestGeometry, { type: 'rectangle' }>).max.y },
          ].map((corner) => toWorld(corner, info)).filter((corner): corner is LatLng => corner !== null)
      corners.forEach((corner, cornerIndex) => handles.push({ kind: { type: 'resize', corner: cornerIndex }, position: corner }))
      if (info.scope === 'outdoor' && corners.length === 4) {
        const midpoint = {
          lat: (corners[0].lat + corners[1].lat) / 2,
          lng: (corners[0].lng + corners[1].lng) / 2,
        }
        const centroid = worldPoiGeometryCentroid(geometry as WorldPOIGeometry)
        const dx = midpoint.lng - centroid.lng
        const dy = midpoint.lat - centroid.lat
        const length = Math.hypot(dx, dy) || 1
        handles.push({
          kind: { type: 'rotate' },
          position: {
            lat: midpoint.lat + (dy / length) * (ROTATION_HANDLE_METERS / 111_320),
            lng: midpoint.lng + (dx / length) * (ROTATION_HANDLE_METERS / metersPerDegreeLng(midpoint.lat)),
          },
        })
      }
      return handles
    }

    // polygon
    const points: LatLng[] = info.scope === 'outdoor'
      ? (geometry as Extract<WorldPOIGeometry, { type: 'polygon' }>).points
      : (geometry as Extract<PointOfInterestGeometry, { type: 'polygon' }>).points
          .map((point) => toWorld(point, info))
          .filter((point): point is LatLng => point !== null)
    points.forEach((point, index) => handles.push({ kind: { type: 'vertex', index }, position: point }))
    return handles
  }, [toWorld])

  // ── Preferred-anchor picking (Inspector -> next map click) ──
  useEffect(() => {
    const eventBus = services.get('eventBus') as unknown as {
      on?: (event: string, handler: (payload: unknown) => void) => (() => void) | void
      off?: (event: string, handler: (payload: unknown) => void) => void
    } | undefined
    if (!eventBus?.on) return
    const handler = (payload: unknown) => {
      const poiId = (payload as { poiId?: string } | null)?.poiId
      if (poiId) {
        anchorPickRef.current = poiId
        // The pick needs the select tool's mousedown handler; activation also
        // gives the user a clear mode switch instead of a silent no-op.
        const registry = services.get('toolRegistry') as { activate?: (id: string) => void } | undefined
        registry?.activate?.('select')
        try { if (map) map.getCanvas().style.cursor = 'crosshair' } catch {}
        showImportToast({ message: 'Click the shape to place the approach anchor.', type: 'info' })
      }
    }
    const unsubscribe = eventBus.on('poi.anchor.pick', handler)
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
      else eventBus.off?.('poi.anchor.pick', handler)
    }
  }, [map, services])

  // ── Overlay source/layers ──
  useEffect(() => {
    if (!map) return
    const ensure = () => {
      try {
        if (!map.getSource(EDIT_SOURCE)) {
          map.addSource(EDIT_SOURCE, { type: 'geojson', data: EMPTY })
        }
        if (!map.getLayer(EDIT_FILL)) {
          map.addLayer({
            id: EDIT_FILL, type: 'fill', source: EDIT_SOURCE,
            paint: { 'fill-color': '#22D3EE', 'fill-opacity': 0.12 },
          })
        }
        if (!map.getLayer(EDIT_LINE)) {
          map.addLayer({
            id: EDIT_LINE, type: 'line', source: EDIT_SOURCE,
            paint: { 'line-color': '#22D3EE', 'line-width': 1.5, 'line-dasharray': [3, 2] },
          })
        }
        if (!map.getLayer(EDIT_HANDLES)) {
          map.addLayer({
            id: EDIT_HANDLES, type: 'circle', source: EDIT_SOURCE,
            filter: ['==', ['get', 'edit'], 'handle'],
            paint: {
              'circle-radius': 5,
              'circle-color': '#FFFFFF',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#0EA5E9',
            },
          })
        }
        if (!map.getLayer(EDIT_ANCHOR)) {
          map.addLayer({
            id: EDIT_ANCHOR, type: 'circle', source: EDIT_SOURCE,
            filter: ['==', ['get', 'edit'], 'anchor'],
            paint: {
              'circle-radius': 7,
              'circle-color': '#F97316',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFFFFF',
            },
          })
        }
      } catch {
        // style transition; style.load retries
      }
    }
    ensure()
    const onStyleLoad = () => ensure()
    map.on('style.load', onStyleLoad)
    return () => {
      try { map.off('style.load', onStyleLoad) } catch {}
      for (const layerId of [EDIT_ANCHOR, EDIT_HANDLES, EDIT_LINE, EDIT_FILL]) {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId) } catch {}
      }
      try { if (map.getSource(EDIT_SOURCE)) map.removeSource(EDIT_SOURCE) } catch {}
    }
  }, [map])

  const renderOverlay = useCallback((
    geometry: PointOfInterestGeometry | WorldPOIGeometry | null,
    info: SelectionInfo | null,
    handles: EditHandle[],
  ) => {
    if (!map) return
    const features: GeoJSON.Feature[] = []
    if (geometry && info) {
      for (const ring of geometryToWorldRings(geometry, info)) {
        features.push({ type: 'Feature', properties: { edit: 'shape' }, geometry: { type: 'Polygon', coordinates: ring } })
      }
      const anchorWorld = resolveApproachAnchorWorld({
        scope: info.scope,
        geometry,
        navigation: info.navigation,
        localToWorld: info.scope === 'indoor' ? (local) => toWorld(local, info) : undefined,
      })
      if (anchorWorld) {
        features.push({ type: 'Feature', properties: { edit: 'anchor' }, geometry: { type: 'Point', coordinates: [anchorWorld.lng, anchorWorld.lat] } })
      }
    }
    for (const handle of handles) {
      features.push({ type: 'Feature', properties: { edit: 'handle' }, geometry: { type: 'Point', coordinates: [handle.position.lng, handle.position.lat] } })
    }
    try {
      const source = map.getSource(EDIT_SOURCE) as maplibregl.GeoJSONSource | undefined
      source?.setData({ type: 'FeatureCollection', features })
    } catch {
      // map may be unmounting
    }
  }, [map, geometryToWorldRings, toWorld])

  useEffect(() => {
    const drag = dragRef.current
    if (drag) return
    const handles = selectedInfo ? handlesFor(selectedInfo.geometry, selectedInfo) : []
    renderOverlay(selectedInfo?.geometry ?? null, selectedInfo, handles)
  }, [handlesFor, renderOverlay, selectedInfo])

  // ── Gesture handling ──
  useEffect(() => {
    if (!map || currentTool !== 'select') return

    const projectHandles = (info: SelectionInfo): Array<EditHandle & { screen: { x: number; y: number } }> =>
      handlesFor(info.geometry, info).map((handle) => ({
        ...handle,
        screen: map.project([handle.position.lng, handle.position.lat]),
      }))

    const beginDrag = (kind: HandleKind, startWorld: LatLng) => {
      if (!selectedInfoRef.current) return
      dragRef.current = {
        kind,
        startWorld,
        original: structuredClone(selectedInfoRef.current.geometry),
        candidate: structuredClone(selectedInfoRef.current.geometry),
        moved: false,
      }
      map.dragPan.disable()
    }

    const computeCandidate = (dragged: LatLng): PointOfInterestGeometry | WorldPOIGeometry | null => {
      const drag = dragRef.current
      const info = selectedInfoRef.current
      if (!drag || !info) return null
      const { original, startWorld, kind } = drag

      if (info.scope === 'outdoor') {
        const geometry = original as WorldPOIGeometry
        if (kind.type === 'body') {
          if (geometry.type === 'point') return moveWorldPoiPoint(geometry, dragged)
          return translateWorldPoiGeometry(geometry, dragged.lat - startWorld.lat, dragged.lng - startWorld.lng)
        }
        if (kind.type === 'radius' && geometry.type === 'circle') {
          return setWorldCircleRadius(geometry, worldDistanceMeters(geometry.center, dragged))
        }
        if (kind.type === 'resize' && geometry.type === 'rectangle') {
          return resizeWorldRectangle(geometry, kind.corner, dragged) ?? geometry
        }
        if (kind.type === 'rotate') {
          const centroid = worldPoiGeometryCentroid(geometry)
          const angle = (point: LatLng) => Math.atan2(
            point.lat - centroid.lat,
            (point.lng - centroid.lng) * Math.cos((centroid.lat * Math.PI) / 180),
          )
          return rotateWorldPoiGeometry(geometry, angle(dragged) - angle(startWorld))
        }
        if (kind.type === 'vertex' && geometry.type === 'polygon') {
          return moveWorldPolygonVertex(geometry, kind.index, dragged)
        }
        return null
      }

      const local = toLocal(dragged, info)
      const startLocal = toLocal(startWorld, info)
      if (!local || !startLocal) return null
      const geometry = original as PointOfInterestGeometry
      if (kind.type === 'body') {
        if (geometry.type === 'point') return moveLocalPoiPoint(geometry, local)
        return translateLocalPoiGeometry(geometry, local.x - startLocal.x, local.y - startLocal.y)
      }
      if (kind.type === 'radius' && geometry.type === 'circle') {
        return setLocalCircleRadius(geometry, Math.hypot(local.x - geometry.center.x, local.y - geometry.center.y))
      }
      if (kind.type === 'resize' && geometry.type === 'rectangle') {
        return resizeLocalRectangle(geometry, kind.corner, local) ?? geometry
      }
      if (kind.type === 'vertex' && geometry.type === 'polygon') {
        return moveLocalPolygonVertex(geometry, kind.index, local)
      }
      return null
    }

    const handleMouseDown = (event: maplibregl.MapMouseEvent) => {
      if (event.originalEvent.button !== 0) return
      const info = selectedInfoRef.current
      if (!info) return

      // Preferred-anchor pick mode: the next click snaps to the nearest point
      // on the POI boundary and stores the geometry-relative anchor.
      if (anchorPickRef.current === info.id) {
        anchorPickRef.current = null
        try { map.getCanvas().style.cursor = '' } catch {}
        const clicked = { lat: event.lngLat.lat, lng: event.lngLat.lng }
        if (info.geometry.type !== 'point') {
          const nearest = info.scope === 'outdoor'
            ? nearestWorldPoiAnchor(info.geometry as WorldPOIGeometry, clicked)
            : (() => {
                const local = toLocal(clicked, info)
                return local ? nearestLocalPoiAnchor(info.geometry as PointOfInterestGeometry, local) : null
              })()
          if (nearest) {
            dispatcherRef.current?.execute({
              id: 'poi.update',
              label: 'Set approach anchor',
              payload: { poiId: info.id, patch: { navigation: { approachMode: 'preferred', anchor: nearest.anchor } } },
            })
            showImportToast({ message: 'Approach anchor set. It stays attached when the shape moves.', type: 'success' })
          }
        }
        return
      }

      const handles = projectHandles(info)
      let closest: { distance: number; handle: EditHandle } | null = null
      for (const handle of handles) {
        const distance = Math.hypot(handle.screen.x - event.point.x, handle.screen.y - event.point.y)
        if (!closest || distance < closest.distance) closest = { distance, handle }
      }
      if (closest && closest.distance <= HANDLE_HIT_RADIUS_PX) {
        beginDrag(closest.handle.kind, { lat: event.lngLat.lat, lng: event.lngLat.lng })
        return
      }

      const hitLayers = POI_HIT_LAYERS.filter((layer) => map.getLayer(layer))
      if (hitLayers.length === 0) return
      const hits = map.queryRenderedFeatures(event.point, { layers: hitLayers })
      if (hits.some((hit) => hit.properties?.id === info.id)) {
        beginDrag({ type: 'body' }, { lat: event.lngLat.lat, lng: event.lngLat.lng })
      }
    }

    const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dragged = { lat: event.lngLat.lat, lng: event.lngLat.lng }
      const candidate = computeCandidate(dragged)
      if (!candidate) return
      drag.candidate = candidate
      drag.moved = Math.hypot(
        (dragged.lat - drag.startWorld.lat) * 111_320,
        (dragged.lng - drag.startWorld.lng) * metersPerDegreeLng(dragged.lat),
      ) > MOVED_EPSILON_PX
      const info = selectedInfoRef.current
      renderOverlay(candidate, info, info ? handlesFor(candidate, info) : [])
    }

    const finishDrag = (commit: boolean) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (map) map.dragPan.enable()
      const info = selectedInfoRef.current
      if (commit && drag.moved && info) {
        const dispatcher = dispatcherRef.current
        dispatcher?.execute({
          id: 'poi.update',
          label: 'Edit POI',
          payload: { poiId: info.id, patch: { geometry: drag.candidate } },
        })
      }
      const handles = info ? handlesFor(info.geometry, info) : []
      renderOverlay(info?.geometry ?? null, info, handles)
    }

    const handleMouseUp = () => finishDrag(true)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) finishDrag(false)
      if (event.key === 'Escape' && anchorPickRef.current) {
        anchorPickRef.current = null
        try { map.getCanvas().style.cursor = '' } catch {}
      }
    }

    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      try { map.off('mousedown', handleMouseDown) } catch {}
      try { map.off('mousemove', handleMouseMove) } catch {}
      try { map.off('mouseup', handleMouseUp) } catch {}
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [currentTool, handlesFor, map, renderOverlay, toLocal])
}
