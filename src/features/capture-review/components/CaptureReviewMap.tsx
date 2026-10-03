'use client'

import { useEffect, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import type { Road } from '@navi/core'
import NavigationMap, { useNavigationMap } from '@/components/map/NavigationMap'
import { getCaptureBounds } from '@/features/capture/geometry'
import type { CaptureCoordinate, CaptureSession } from '@/features/capture/types'
import type { CampusMap } from '@/types/campus-map'
import { buildCaptureReviewGeoJson } from '../metrics'
import type { EndpointSnapTarget } from '../route-editing'
import type { CaptureReviewSelection, ReviewLayerKey } from '../types'

const SOURCE_IDS = [
  'capture-review-campus',
  'capture-review-raw-route',
  'capture-review-candidate-route',
  'capture-review-candidate-nodes',
  'capture-review-markers',
  'capture-review-gps-warnings',
  'capture-import-existing-roads',
  'capture-review-snap-targets',
] as const

const LAYER_IDS = [
  'capture-review-campus-fill',
  'capture-review-campus-outline',
  'capture-review-raw-route-line',
  'capture-review-candidate-route-line',
  'capture-review-candidate-node-points',
  'capture-review-marker-points',
  'capture-review-gps-warning-lines',
  'capture-import-existing-roads-line',
  'capture-review-snap-target-points',
] as const

const VISIBILITY_LAYERS: Record<ReviewLayerKey, string> = {
  rawGps: 'capture-review-raw-route-line',
  candidateRoute: 'capture-review-candidate-route-line',
  candidateNodes: 'capture-review-candidate-node-points',
  markers: 'capture-review-marker-points',
  gpsWarnings: 'capture-review-gps-warning-lines',
}

function campusGeoJson(campusMap: CampusMap | null): GeoJSON.FeatureCollection {
  const boundary = campusMap?.boundary ?? []
  if (boundary.length < 3) return { type: 'FeatureCollection', features: [] }
  const coordinates = boundary.map((point) => [point.lng, point.lat] as [number, number])
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: campusMap?.name ?? 'Campus boundary' },
      geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] },
    }],
  }
}

type ReviewCoordinate = { lat: number; lng: number } | { latitude: number; longitude: number }

function toLatLng(point: ReviewCoordinate) {
  return 'lat' in point
    ? point
    : { lat: point.latitude, lng: point.longitude }
}

function allBounds(session: CaptureSession, campusMap: CampusMap | null) {
  const captureBounds = getCaptureBounds(session)
  const coordinates: ReviewCoordinate[] = [
    ...(campusMap?.boundary ?? []),
    ...(session.candidateRoute?.points ?? []),
  ]
  if (!captureBounds && coordinates.length === 0) return null

  const firstPoint = coordinates[0] ? toLatLng(coordinates[0]) : null
  const initial = captureBounds ?? {
    minLat: firstPoint?.lat ?? 0,
    maxLat: firstPoint?.lat ?? 0,
    minLng: firstPoint?.lng ?? 0,
    maxLng: firstPoint?.lng ?? 0,
  }
  return coordinates.reduce((bounds, point) => {
    const { lat: latitude, lng: longitude } = toLatLng(point)
    return {
      minLat: Math.min(bounds.minLat, latitude),
      maxLat: Math.max(bounds.maxLat, latitude),
      minLng: Math.min(bounds.minLng, longitude),
      maxLng: Math.max(bounds.maxLng, longitude),
    }
  }, initial)
}

function addSourceIfMissing(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  if (map.getSource(id)) return
  map.addSource(id, { type: 'geojson', data })
}

function addLayerIfMissing(map: maplibregl.Map, layer: maplibregl.AddLayerObject) {
  if (map.getLayer(layer.id)) return
  map.addLayer(layer)
}

function existingRoadsGeoJson(roads: Road[] | undefined): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (roads ?? [])
      .filter((road) => road.polyline.points.length >= 2)
      .map((road) => ({
        type: 'Feature' as const,
        properties: { roadId: road.id, name: road.name },
        geometry: {
          type: 'LineString' as const,
          coordinates: road.polyline.points.map((point) => [point.lng, point.lat]),
        },
      })),
  }
}

function snapTargetsGeoJson(targets: EndpointSnapTarget[] | undefined): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (targets ?? []).map((target) => ({
      type: 'Feature' as const,
      properties: {
        endpoint: target.endpoint,
        roadId: target.roadId,
        roadName: target.roadName,
        segmentIndex: target.segmentIndex,
        distanceMeters: target.distanceMeters,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [target.coordinate.longitude, target.coordinate.latitude],
      },
    })),
  }
}

function initializeReviewLayers(map: maplibregl.Map, campus: GeoJSON.FeatureCollection) {
  const empty = { type: 'FeatureCollection' as const, features: [] }
  addSourceIfMissing(map, 'capture-review-campus', campus)
  addSourceIfMissing(map, 'capture-review-raw-route', empty)
  addSourceIfMissing(map, 'capture-review-candidate-route', empty)
  addSourceIfMissing(map, 'capture-review-candidate-nodes', empty)
  addSourceIfMissing(map, 'capture-review-markers', empty)
  addSourceIfMissing(map, 'capture-review-gps-warnings', empty)
  addSourceIfMissing(map, 'capture-import-existing-roads', empty)
  addSourceIfMissing(map, 'capture-review-snap-targets', empty)

  addLayerIfMissing(map, {
    id: 'capture-review-campus-fill',
    type: 'fill',
    source: 'capture-review-campus',
    paint: { 'fill-color': '#64748b', 'fill-opacity': 0.08 },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-campus-outline',
    type: 'line',
    source: 'capture-review-campus',
    paint: { 'line-color': '#64748b', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-raw-route-line',
    type: 'line',
    source: 'capture-review-raw-route',
    paint: { 'line-color': '#38bdf8', 'line-width': 2, 'line-opacity': 0.45 },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-gps-warning-lines',
    type: 'line',
    source: 'capture-review-gps-warnings',
    paint: { 'line-color': '#f59e0b', 'line-width': 5, 'line-opacity': 0.75, 'line-dasharray': [1, 1] },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-candidate-route-line',
    type: 'line',
    source: 'capture-review-candidate-route',
    paint: {
      'line-color': '#22c55e',
      'line-width': 5,
      'line-opacity': ['case', ['==', ['get', 'decision'], 'excluded'], 0.2, 0.95] as unknown as number,
    },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-candidate-node-points',
    type: 'circle',
    source: 'capture-review-candidate-nodes',
    paint: { 'circle-color': '#16a34a', 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-marker-points',
    type: 'circle',
    source: 'capture-review-markers',
    paint: {
      'circle-color': [
        'match', ['get', 'type'],
        'poi', '#a855f7',
        'panorama', '#2563eb',
        'entrance', '#f97316',
        'hazard', '#dc2626',
        '#64748b',
      ] as unknown as string,
      'circle-radius': 7,
      'circle-opacity': ['case', ['==', ['get', 'decision'], 'excluded'], 0.25, 1] as unknown as number,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
  addLayerIfMissing(map, {
    id: 'capture-import-existing-roads-line',
    type: 'line',
    source: 'capture-import-existing-roads',
    paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.7, 'line-dasharray': [2, 1] },
  })
  addLayerIfMissing(map, {
    id: 'capture-review-snap-target-points',
    type: 'circle',
    source: 'capture-review-snap-targets',
    paint: {
      'circle-color': '#facc15',
      'circle-radius': 8,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#422006',
      'circle-stroke-width': 2,
    },
  })
}

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined
  source?.setData(data)
}

export function removeCaptureReviewLayers(map: maplibregl.Map | null | undefined) {
  if (!map) return
  for (const id of LAYER_IDS) {
    try {
      if (map.getLayer(id)) map.removeLayer(id)
    } catch {
      return
    }
  }
  for (const id of SOURCE_IDS) {
    try {
      if (map.getSource(id)) map.removeSource(id)
    } catch {
      return
    }
  }
}

type ReviewMapEvent = {
  lngLat?: { lat: number; lng: number }
  features?: Array<{ properties?: Record<string, unknown> }>
  preventDefault?: () => void
}

type ReviewMapInteractions = {
  on: (event: string, layerOrListener: string | ((event: ReviewMapEvent) => void), listener?: (event: ReviewMapEvent) => void) => void
  off: (event: string, layerOrListener: string | ((event: ReviewMapEvent) => void), listener?: (event: ReviewMapEvent) => void) => void
  getCanvas?: () => { style: { cursor: string } }
  dragPan?: { disable: () => void; enable: () => void }
}

function nodeIndexFromEvent(event: ReviewMapEvent): number | null {
  const value = event.features?.[0]?.properties?.nodeIndex
  const index = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(index) && index >= 0 ? index : null
}

function CaptureReviewMapLayers({
  session,
  campusMap,
  existingRoads,
  layers,
  selection,
  editMode,
  onMovePoint,
  onAddPoint,
  onRemovePoint,
  snapTargets,
}: CaptureReviewMapProps) {
  const { map, isReady } = useNavigationMap()
  const geoJson = useMemo(() => {
    const reviewGeoJson = buildCaptureReviewGeoJson(session, selection)
    return { ...reviewGeoJson, campus: campusGeoJson(campusMap) }
  }, [campusMap, selection, session])
  const existingRoadGeoJson = useMemo(() => existingRoadsGeoJson(existingRoads), [existingRoads])
  const snapTargetGeoJson = useMemo(() => snapTargetsGeoJson(snapTargets), [snapTargets])

  useEffect(() => {
    if (!map || !isReady) return
    initializeReviewLayers(map, geoJson.campus)
    return () => removeCaptureReviewLayers(map)
  }, [geoJson.campus, isReady, map])

  useEffect(() => {
    if (!map || !isReady) return
    setData(map, 'capture-review-campus', geoJson.campus)
    setData(map, 'capture-review-raw-route', geoJson.rawRoute)
    setData(map, 'capture-review-candidate-route', geoJson.candidateRoute)
    setData(map, 'capture-review-candidate-nodes', geoJson.candidateNodes)
    setData(map, 'capture-review-markers', geoJson.markers)
    setData(map, 'capture-review-gps-warnings', geoJson.gpsWarnings)
    setData(map, 'capture-import-existing-roads', existingRoadGeoJson)
    setData(map, 'capture-review-snap-targets', snapTargetGeoJson)
  }, [existingRoadGeoJson, geoJson, isReady, map, snapTargetGeoJson])

  useEffect(() => {
    if (!map || !isReady) return
    for (const [layer, id] of Object.entries(VISIBILITY_LAYERS) as [ReviewLayerKey, string][]) {
      try {
        map.setLayoutProperty(id, 'visibility', layers[layer] ? 'visible' : 'none')
      } catch {
        // The parent map may be between style teardown and cleanup.
      }
    }
  }, [isReady, layers, map])

  useEffect(() => {
    if (!map || !isReady || !editMode) return
    const interactiveMap = map as unknown as ReviewMapInteractions
    if (typeof interactiveMap.on !== 'function' || typeof interactiveMap.off !== 'function') return

    const canvas = interactiveMap.getCanvas?.()
    let movingIndex: number | null = null
    let movingCoordinate: CaptureCoordinate | null = null

    const handleMoveStart = (event: ReviewMapEvent) => {
      const index = nodeIndexFromEvent(event)
      if (index == null || !onMovePoint) return
      movingIndex = index
      event.preventDefault?.()
      interactiveMap.dragPan?.disable()
      if (canvas) canvas.style.cursor = 'grabbing'
    }
    const handleMove = (event: ReviewMapEvent) => {
      if (movingIndex == null || !event.lngLat || !onMovePoint) return
      movingCoordinate = { latitude: event.lngLat.lat, longitude: event.lngLat.lng }
    }
    const handleMoveEnd = () => {
      if (movingIndex == null) return
      const index = movingIndex
      const coordinate = movingCoordinate
      movingIndex = null
      movingCoordinate = null
      interactiveMap.dragPan?.enable()
      if (canvas) canvas.style.cursor = ''
      if (coordinate && onMovePoint) onMovePoint(index, coordinate)
    }
    const handleAdd = (event: ReviewMapEvent) => {
      if (!event.lngLat || !onAddPoint) return
      onAddPoint({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
    }
    const handleRemove = (event: ReviewMapEvent) => {
      const index = nodeIndexFromEvent(event)
      if (index == null || !onRemovePoint) return
      onRemovePoint(index)
    }

    if (editMode === 'move') {
      interactiveMap.on('mousedown', 'capture-review-candidate-node-points', handleMoveStart)
      interactiveMap.on('mousemove', handleMove)
      interactiveMap.on('mouseup', handleMoveEnd)
      interactiveMap.on('mouseleave', handleMoveEnd)
    } else if (editMode === 'add') {
      interactiveMap.on('click', handleAdd)
    } else if (editMode === 'remove') {
      interactiveMap.on('click', 'capture-review-candidate-node-points', handleRemove)
    }

    return () => {
      if (editMode === 'move') {
        interactiveMap.off('mousedown', 'capture-review-candidate-node-points', handleMoveStart)
        interactiveMap.off('mousemove', handleMove)
        interactiveMap.off('mouseup', handleMoveEnd)
        interactiveMap.off('mouseleave', handleMoveEnd)
        if (movingIndex != null) interactiveMap.dragPan?.enable()
        if (canvas) canvas.style.cursor = ''
      } else if (editMode === 'add') {
        interactiveMap.off('click', handleAdd)
      } else if (editMode === 'remove') {
        interactiveMap.off('click', 'capture-review-candidate-node-points', handleRemove)
      }
    }
  }, [editMode, isReady, map, onAddPoint, onMovePoint, onRemovePoint])

  return null
}

export interface CaptureReviewMapProps {
  session: CaptureSession
  campusMap: CampusMap | null
  existingRoads?: Road[]
  layers: Record<ReviewLayerKey, boolean>
  selection: CaptureReviewSelection
  editMode?: 'move' | 'add' | 'remove' | null
  onMovePoint?: (index: number, coordinate: CaptureCoordinate) => void
  onAddPoint?: (coordinate: CaptureCoordinate) => void
  onRemovePoint?: (index: number) => void
  snapTargets?: EndpointSnapTarget[]
}

export function CaptureReviewMap({
  session,
  campusMap,
  existingRoads,
  layers,
  selection,
  editMode,
  onMovePoint,
  onAddPoint,
  onRemovePoint,
  snapTargets,
}: CaptureReviewMapProps) {
  const center = campusMap?.center
    ?? (session.rawSamples[0] ? { lat: session.rawSamples[0].latitude, lng: session.rawSamples[0].longitude } : undefined)
  const bounds = allBounds(session, campusMap)

  return (
    <NavigationMap
      center={center ? [center.lng, center.lat] : undefined}
      zoom={17}
      bounds={bounds}
      className="capture-review-map"
    >
      <CaptureReviewMapLayers
        session={session}
        campusMap={campusMap}
        existingRoads={existingRoads}
        layers={layers}
        selection={selection}
        editMode={editMode}
        onMovePoint={onMovePoint}
        onAddPoint={onAddPoint}
        onRemovePoint={onRemovePoint}
        snapTargets={snapTargets}
      />
    </NavigationMap>
  )
}
