'use client'

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { EditablePolygon } from '@/types/polygon-types'
import { PolygonEngine } from './PolygonEngine'
import type { EditablePolygonSession } from './useEditablePolygonEditor'

export type LocalToLngLat = (x: number, y: number) => [number, number]
export type LngLatToLocal = (lng: number, lat: number) => { x: number; y: number }

interface PolygonOverlayProps {
  map: maplibregl.Map | null
  polygon: EditablePolygon | null
  session: EditablePolygonSession | null
  project: LocalToLngLat
  unproject: LngLatToLocal
  onVertexPointerDown: (vertexId: string) => void
  onEdgePointerDown: (edgeId: string) => void
  onPointerMove: (pos: { x: number; y: number }) => void
  onPointerUp: () => void
  setHoveredVertex: (vertexId: string | null) => void
  setHoveredEdge: (edgeId: string | null) => void
  enabled: boolean
}

const SOURCE = 'polygon-overlay'
const VERTICES = 'polygon-vertices'
const MIDPOINTS = 'polygon-midpoints'

const EDGES_LINE = 'polygon-edges-line'
const VERTICES_LAYER = 'polygon-vertices-layer'
const VERTICES_HOVER = 'polygon-vertices-hover'
const VERTICES_DRAG = 'polygon-vertices-drag'
const MIDPOINTS_LAYER = 'polygon-midpoints-layer'

function addSources(map: maplibregl.Map) {
  if (map.getSource(SOURCE)) return
  map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(VERTICES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addSource(MIDPOINTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  map.addLayer({
    id: EDGES_LINE, type: 'line', source: SOURCE,
    paint: { 'line-color': '#CBD5E1', 'line-width': 2.5, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: VERTICES_LAYER, type: 'circle', source: VERTICES,
    paint: { 'circle-radius': 5, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#1C6BEB', 'circle-stroke-width': 2 },
  })
  map.addLayer({
    id: VERTICES_HOVER, type: 'circle', source: VERTICES,
    filter: ['==', ['get', 'hovered'], true],
    paint: { 'circle-radius': 7, 'circle-color': '#1C6BEB', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 },
  })
  map.addLayer({
    id: VERTICES_DRAG, type: 'circle', source: VERTICES,
    filter: ['==', ['get', 'dragged'], true],
    paint: { 'circle-radius': 8, 'circle-color': '#1C6BEB', 'circle-opacity': 0.5 },
  })
  map.addLayer({
    id: MIDPOINTS_LAYER, type: 'circle', source: MIDPOINTS,
    paint: { 'circle-radius': 4, 'circle-color': '#94A3B8', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1 },
  })
}

function removeSources(map: maplibregl.Map) {
  try {
    const ids = [EDGES_LINE, VERTICES_DRAG, VERTICES_HOVER, VERTICES_LAYER, MIDPOINTS_LAYER]
    for (const id of ids) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    const srcs = [SOURCE, VERTICES, MIDPOINTS]
    for (const id of srcs) {
      if (map.getSource(id)) map.removeSource(id)
    }
  } catch {
    // map may already be destroyed during React cleanup
  }
}

export function PolygonOverlay({
  map, polygon, session, project, unproject,
  onVertexPointerDown, onEdgePointerDown, onPointerMove, onPointerUp,
  setHoveredVertex, setHoveredEdge, enabled,
}: PolygonOverlayProps) {
  const frameRef = useRef<number | null>(null)
  const disposedRef = useRef(false)

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

  useEffect(() => {
    if (!map || !enabled || !polygon) return
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      if (disposedRef.current) return

      const edgeSrc = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
      const vertSrc = map.getSource(VERTICES) as maplibregl.GeoJSONSource | undefined
      const midSrc = map.getSource(MIDPOINTS) as maplibregl.GeoJSONSource | undefined
      if (!edgeSrc || !vertSrc || !midSrc) return

      const vertices = polygon.rings[0]?.vertices ?? []
      const edges = PolygonEngine.edges(polygon)
      const hoveredVert = session?.hoveredVertex ?? null
      const draggedVert = session?.draggedVertex ?? null

      const vertFeatures: GeoJSON.Feature[] = vertices.map(v => {
        const [lng, lat] = project(v.x, v.y)
        return {
          type: 'Feature',
          properties: { vertexId: v.id, hovered: v.id === hoveredVert, dragged: v.id === draggedVert },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        }
      })

      const edgeFeatures: GeoJSON.Feature[] = edges.map(e => {
    const sv = vertices.find(v => v.id === e.startVertexId)
    const ev = vertices.find(v => v.id === e.endVertexId)
    if (!sv || !ev) return null
    const [slng, slat] = project(sv.x, sv.y)
    const [elng, elat] = project(ev.x, ev.y)
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[slng, slat], [elng, elat]] },
      properties: {},
    }
  }).filter(Boolean) as GeoJSON.Feature[]

      const midFeatures: GeoJSON.Feature[] = edges.map(e => {
        const sv = vertices.find(v => v.id === e.startVertexId)
        const ev = vertices.find(v => v.id === e.endVertexId)
        if (!sv || !ev) return null
        const mx = (sv.x + ev.x) / 2
        const my = (sv.y + ev.y) / 2
        const [lng, lat] = project(mx, my)
        return {
          type: 'Feature',
          properties: { edgeId: e.id },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        }
      }).filter(Boolean) as GeoJSON.Feature[]

      edgeSrc.setData({ type: 'FeatureCollection', features: edgeFeatures })
      vertSrc.setData({ type: 'FeatureCollection', features: vertFeatures })
      midSrc.setData({ type: 'FeatureCollection', features: midFeatures })
    })
  }, [map, enabled, polygon, session, project])

  useEffect(() => {
    if (!map || !enabled || !polygon) return

    const onVertexClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.originalEvent.stopPropagation()
      if (!e.features?.length) return
      const props = e.features[0].properties
      if (props.vertexId) onVertexPointerDown(props.vertexId as string)
    }

    const onMidpointClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      e.originalEvent.stopPropagation()
      if (!e.features?.length) return
      const props = e.features[0].properties
      if (props.edgeId) onEdgePointerDown(props.edgeId as string)
    }

    const onVertexEnter = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      setHoveredVertex(props.vertexId as string)
    }

    const onVertexLeave = () => {
      setHoveredVertex(null)
    }

    const onMidpointEnter = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      setHoveredEdge(props.edgeId as string)
    }

    const onMidpointLeave = () => {
      setHoveredEdge(null)
    }

    const onMapMouseMove = (e: maplibregl.MapMouseEvent) => {
      const local = unproject(e.lngLat.lng, e.lngLat.lat)
      onPointerMove(local)
    }

    const onMapMouseUp = () => {
      onPointerUp()
    }

    map.on('click', VERTICES_LAYER, onVertexClick as (e: maplibregl.MapMouseEvent) => void)
    map.on('click', VERTICES_HOVER, onVertexClick as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', VERTICES_LAYER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', VERTICES_HOVER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseleave', VERTICES_LAYER, onVertexLeave)
    map.on('mouseleave', VERTICES_HOVER, onVertexLeave)
    map.on('click', MIDPOINTS_LAYER, onMidpointClick as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseenter', MIDPOINTS_LAYER, onMidpointEnter as (e: maplibregl.MapMouseEvent) => void)
    map.on('mouseleave', MIDPOINTS_LAYER, onMidpointLeave)
    map.on('mousemove', onMapMouseMove)
    map.on('mouseup', onMapMouseUp)

    return () => {
      try {
        map.off('click', VERTICES_LAYER, onVertexClick as (e: maplibregl.MapMouseEvent) => void)
        map.off('click', VERTICES_HOVER, onVertexClick as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', VERTICES_LAYER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', VERTICES_HOVER, onVertexEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseleave', VERTICES_LAYER, onVertexLeave)
        map.off('mouseleave', VERTICES_HOVER, onVertexLeave)
        map.off('click', MIDPOINTS_LAYER, onMidpointClick as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseenter', MIDPOINTS_LAYER, onMidpointEnter as (e: maplibregl.MapMouseEvent) => void)
        map.off('mouseleave', MIDPOINTS_LAYER, onMidpointLeave)
        map.off('mousemove', onMapMouseMove)
        map.off('mouseup', onMapMouseUp)
      } catch {
        // map may already be destroyed during React cleanup
      }
    }
  }, [map, enabled, polygon, onVertexPointerDown, onEdgePointerDown, onPointerMove, onPointerUp, unproject, setHoveredVertex, setHoveredEdge])

  return null
}
