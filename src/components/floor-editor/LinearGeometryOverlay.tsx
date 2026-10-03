'use client'

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { EditablePath } from '@/types/path-types'
import type { EditablePathSession } from './useEditablePathEditor'

export type LocalToLngLat = (x: number, y: number) => [number, number]
export type LngLatToLocal = (lng: number, lat: number) => { x: number; y: number }

export interface LinearGeometryOverlayProps {
  map: maplibregl.Map | null
  path: EditablePath | null
  session: EditablePathSession | null
  project: LocalToLngLat
  unproject: LngLatToLocal
  onVertexPointerDown: (vertexId: string) => void
  onSegmentPointerDown: (segmentId: string) => void
  onPointerMove: (pos: { x: number; y: number }) => void
  onPointerUp: () => void
  insertVertex: (segmentId: string) => void
  setHoveredVertex: (vertexId: string | null) => void
  setHoveredSegment: (segmentId: string | null) => void
  enabled: boolean
}

const SEGMENTS = 'overlay-segments'
const VERTICES = 'overlay-vertices'
const MIDPOINTS = 'overlay-midpoints'

const SEGMENTS_LINE = 'overlay-segments-line'
const VERTICES_LAYER = 'overlay-vertices-layer'
const VERTICES_HOVER = 'overlay-vertices-hover'
const VERTICES_SELECTED = 'overlay-vertices-selected'
const VERTICES_DRAG = 'overlay-vertices-drag'
const MIDPOINTS_LAYER = 'overlay-midpoints-layer'

function addSources(map: maplibregl.Map) {
  if (map.getSource(SEGMENTS)) return
  map.addSource(SEGMENTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(VERTICES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(MIDPOINTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  map.addLayer({
    id: SEGMENTS_LINE, type: 'line', source: SEGMENTS,
    paint: {
      'line-color': ['case', ['boolean', ['get', 'selected'], false], '#1C6BEB', ['boolean', ['get', 'hovered'], false], '#60A5FA', '#CBD5E1'],
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 3.5, 2.5],
      'line-opacity': 0.9,
    },
  })

  map.addLayer({
    id: VERTICES_LAYER, type: 'circle', source: VERTICES,
    filter: ['all', ['!=', ['boolean', ['get', 'hovered'], false], true], ['!=', ['boolean', ['get', 'selected'], false], true], ['!=', ['boolean', ['get', 'dragging'], false], true]],
    paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#1C6BEB' },
  })

  map.addLayer({
    id: VERTICES_HOVER, type: 'circle', source: VERTICES,
    filter: ['==', ['boolean', ['get', 'hovered'], false], true],
    paint: { 'circle-radius': 9, 'circle-color': '#DBEAFE', 'circle-stroke-width': 3, 'circle-stroke-color': '#1C6BEB' },
  })

  map.addLayer({
    id: VERTICES_SELECTED, type: 'circle', source: VERTICES,
    filter: ['==', ['boolean', ['get', 'selected'], false], true],
    paint: { 'circle-radius': 8, 'circle-color': '#1C6BEB', 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF' },
  })

  map.addLayer({
    id: VERTICES_DRAG, type: 'circle', source: VERTICES,
    filter: ['==', ['boolean', ['get', 'dragging'], false], true],
    paint: { 'circle-radius': 10, 'circle-color': '#1C6BEB', 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF', 'circle-opacity': 0.7 },
  })

  map.addLayer({
    id: MIDPOINTS_LAYER, type: 'circle', source: MIDPOINTS,
    paint: { 'circle-radius': 5, 'circle-color': '#1C6BEB', 'circle-opacity': 0.6 },
  })
}

function removeSources(map: maplibregl.Map) {
  try {
    const ids = [SEGMENTS_LINE, VERTICES_DRAG, VERTICES_SELECTED, VERTICES_HOVER, VERTICES_LAYER, MIDPOINTS_LAYER]
    for (const id of ids) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    const srcs = [SEGMENTS, VERTICES, MIDPOINTS]
    for (const id of srcs) {
      if (map.getSource(id)) map.removeSource(id)
    }
  } catch {
    // map may already be destroyed during React cleanup
  }
}

export function LinearGeometryOverlay({
  map, path, session, project, unproject,
  onVertexPointerDown, onSegmentPointerDown, onPointerMove, onPointerUp, insertVertex,
  setHoveredVertex, setHoveredSegment,
  enabled,
}: LinearGeometryOverlayProps) {
  const frameRef = useRef<number | null>(null)
  const disposedRef = useRef(false)

  // Add sources/layers when map is ready and enabled
  useEffect(() => {
    if (!map || !enabled) return
    if (!map.isStyleLoaded()) return
    disposedRef.current = false
    addSources(map)
    return () => {
      disposedRef.current = true
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      removeSources(map)
    }
  }, [map, enabled])

  // Sync path + session to MapLibre layers
  useEffect(() => {
    if (!map || !enabled || !path) return
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      if (disposedRef.current) return

      const segSrc = map.getSource(SEGMENTS) as maplibregl.GeoJSONSource | undefined
      const vertSrc = map.getSource(VERTICES) as maplibregl.GeoJSONSource | undefined
      const midSrc = map.getSource(MIDPOINTS) as maplibregl.GeoJSONSource | undefined
      if (!segSrc || !vertSrc || !midSrc) return

      const vertices = path.vertices
      const segments = path.segments
      const selectedVerts = new Set(session?.selectedVertexIds ?? [])
      const hoveredVert = session?.hoveredVertexId ?? null
      const dragVert = session?.dragVertexId ?? null

      // Build vertex features
      const vertFeatures: GeoJSON.Feature[] = vertices.map((v) => {
        const [lng, lat] = project(v.x, v.y)
        return {
          type: 'Feature',
          properties: {
            vertexId: v.id,
            hovered: v.id === hoveredVert,
            selected: selectedVerts.has(v.id),
            dragging: v.id === dragVert,
          },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        }
      })

      // Build segment features
      const segFeatures: GeoJSON.Feature[] = segments.map((seg) => {
        const startV = vertices.find((v) => v.id === seg.startVertexId)
        const endV = vertices.find((v) => v.id === seg.endVertexId)
        if (!startV || !endV) return null
        const [slng, slat] = project(startV.x, startV.y)
        const [elng, elat] = project(endV.x, endV.y)
        return {
          type: 'Feature',
          properties: {
            segmentId: seg.id,
            hovered: seg.id === session?.hoveredSegmentId,
            selected: seg.id === session?.selectedSegmentId,
          },
          geometry: { type: 'LineString', coordinates: [[slng, slat], [elng, elat]] },
        }
      }).filter(Boolean) as GeoJSON.Feature[]

      // Build midpoint features
      const midFeatures: GeoJSON.Feature[] = segments.map((seg) => {
        const startV = vertices.find((v) => v.id === seg.startVertexId)
        const endV = vertices.find((v) => v.id === seg.endVertexId)
        if (!startV || !endV) return null
        const mx = (startV.x + endV.x) / 2
        const my = (startV.y + endV.y) / 2
        const [lng, lat] = project(mx, my)
        return {
          type: 'Feature',
          properties: { segmentId: seg.id },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        }
      }).filter(Boolean) as GeoJSON.Feature[]

      segSrc.setData({ type: 'FeatureCollection', features: segFeatures })
      vertSrc.setData({ type: 'FeatureCollection', features: vertFeatures })
      midSrc.setData({ type: 'FeatureCollection', features: midFeatures })
    })
  }, [map, enabled, path, session, project])

  // Wire MapLibre interaction events
  useEffect(() => {
    if (!map || !enabled || !path) return

    const onVertexMouseDown = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.originalEvent.stopPropagation()
      if (!e.features?.length) return
      const props = e.features[0].properties
      onVertexPointerDown(props.vertexId as string)
    }

    const onSegmentClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.originalEvent.stopPropagation()
      if (!e.features?.length) return
      const props = e.features[0].properties
      onSegmentPointerDown(props.segmentId as string)
    }

    const onMidpointClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.originalEvent.stopPropagation()
      if (!e.features?.length) return
      const props = e.features[0].properties
      insertVertex(props.segmentId as string)
    }

    const onVertexEnter = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      setHoveredVertex(props.vertexId as string)
    }

    const onVertexLeave = () => {
      setHoveredVertex(null)
    }

    const onSegmentEnter = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      setHoveredSegment(props.segmentId as string)
    }

    const onSegmentLeave = () => {
      setHoveredSegment(null)
    }

    const onMapMouseMove = (e: maplibregl.MapMouseEvent) => {
      const local = unproject(e.lngLat.lng, e.lngLat.lat)
      onPointerMove(local)
    }

    const onMapMouseUp = () => {
      onPointerUp()
    }

    const onDeselect = (e: maplibregl.MapMouseEvent) => {
      const target = e.originalEvent.target as HTMLElement
      if (target !== map.getCanvas()) return
      onPointerUp()
    }

    map.on('mousedown', VERTICES_LAYER, onVertexMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', VERTICES_HOVER, onVertexMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', VERTICES_SELECTED, onVertexMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', VERTICES_LAYER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', VERTICES_HOVER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', VERTICES_SELECTED, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseleave', VERTICES_LAYER, onVertexLeave)
    map.on('mouseleave', VERTICES_HOVER, onVertexLeave)
    map.on('mouseleave', VERTICES_SELECTED, onVertexLeave)
    map.on('click', SEGMENTS_LINE, onSegmentClick as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', SEGMENTS_LINE, onSegmentEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseleave', SEGMENTS_LINE, onSegmentLeave)
    map.on('click', MIDPOINTS_LAYER, onMidpointClick as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousemove', onMapMouseMove)
    map.on('mouseup', onMapMouseUp)
    map.on('mouseup', onDeselect)

    return () => {
      try {
        map.off('mousedown', VERTICES_LAYER, onVertexMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', VERTICES_HOVER, onVertexMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', VERTICES_SELECTED, onVertexMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', VERTICES_LAYER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', VERTICES_HOVER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', VERTICES_SELECTED, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseleave', VERTICES_LAYER, onVertexLeave)
        map.off('mouseleave', VERTICES_HOVER, onVertexLeave)
        map.off('mouseleave', VERTICES_SELECTED, onVertexLeave)
        map.off('click', SEGMENTS_LINE, onSegmentClick as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', SEGMENTS_LINE, onSegmentEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseleave', SEGMENTS_LINE, onSegmentLeave)
        map.off('click', MIDPOINTS_LAYER, onMidpointClick as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousemove', onMapMouseMove)
        map.off('mouseup', onMapMouseUp)
        map.off('mouseup', onDeselect)
      } catch {
        // map may already be destroyed during React cleanup
      }
    }
  }, [map, enabled, path, onVertexPointerDown, onSegmentPointerDown, insertVertex, onPointerMove, onPointerUp, unproject, setHoveredVertex, setHoveredSegment])

  return null
}
