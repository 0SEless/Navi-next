'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { NavNode, NavEdge } from '@/types/nav-types'

const SRC_ROUTE = 'route-overlay'
const SRC_ROUTE_NODES = 'route-overlay-nodes'
const SRC_GRAPH_EDGES = 'graph-edges'
const SRC_GRAPH_NODES = 'graph-nodes'
const SRC_SNAP = 'snap-lines'
const LYR_ROUTE_LINE = 'route-line'
const LYR_ROUTE_DASHED = 'route-dashed'
const LYR_ROUTE_GLOW = 'route-glow'
const LYR_NODE_ALL = 'route-all-nodes'
const LYR_NODE_START = 'route-start'
const LYR_NODE_END = 'route-end'
const LYR_GRAPH_EDGES = 'graph-edge-lines'
const LYR_GRAPH_NODES = 'graph-nodes-layer'
const LYR_GRAPH_NODE_IDS = 'graph-node-ids'
const LYR_SNAP = 'snap-line-layer'
const LYR_EDGE_LABELS = 'graph-edge-labels'

export interface RouteOverlayProps {
  map: maplibregl.Map
  nodes: NavNode[]
  edges: NavEdge[]
  path: string[] | null
  animStep: number
  showGraph?: boolean
  showLabels?: boolean
  showNodeIds?: boolean
  snapLines?: Array<{ from: [number, number]; to: [number, number]; color: string }>
  selectedNodeId?: string | null
  onNodeHover?: (nodeId: string | null) => void
  onNodeClick?: (nodeId: string) => void
}

function addSourceIfMissing(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  if (map.getSource(id)) {
    const src = map.getSource(id) as maplibregl.GeoJSONSource
    try { src.setData(data) } catch {}
  } else {
    map.addSource(id, { type: 'geojson', data })
  }
}

function addLayerIfMissing(map: maplibregl.Map, def: maplibregl.LayerSpecification) {
  if (map.getLayer(def.id)) return
  map.addLayer(def)
}

function removeIfExists(map: maplibregl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  } catch {}
}

function removeSourceIfExists(map: maplibregl.Map, sourceId: string) {
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  } catch {}
}

/**
 * RouteOverlay — draws the A* route, all graph nodes, and start/end markers
 * on a MapLibre map. Used by RouteTesting to visualize routes on the real map.
 */
export function RouteOverlay({ map, nodes, edges, path, animStep, showGraph, showLabels, showNodeIds, snapLines, selectedNodeId, onNodeHover, onNodeClick }: RouteOverlayProps) {
  const initializedRef = useRef(false)

  // ── Initialize sources and layers once ──
  useEffect(() => {
    if (!map || initializedRef.current) return
    const bootstrap = () => {
      if (initializedRef.current) return
      initializedRef.current = true

      addSourceIfMissing(map, SRC_ROUTE, { type: 'FeatureCollection', features: [] })
      addSourceIfMissing(map, SRC_ROUTE_NODES, { type: 'FeatureCollection', features: [] })

      // Graph sources
      addSourceIfMissing(map, SRC_GRAPH_EDGES, { type: 'FeatureCollection', features: [] })
      addSourceIfMissing(map, SRC_GRAPH_NODES, { type: 'FeatureCollection', features: [] })

      // Snap lines source
      addSourceIfMissing(map, SRC_SNAP, { type: 'FeatureCollection', features: [] })

      // Route glow (wide, faint)
      addLayerIfMissing(map, {
        id: LYR_ROUTE_GLOW, type: 'line', source: SRC_ROUTE,
        paint: { 'line-color': '#3B82F6', 'line-width': 12, 'line-opacity': 0.15 },
      })
      // Route dashed (preview before animation)
      addLayerIfMissing(map, {
        id: LYR_ROUTE_DASHED, type: 'line', source: SRC_ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#93C5FD', 'line-width': 3, 'line-opacity': 0.6, 'line-dasharray': [6, 4] },
      })
      // Route solid (animated)
      addLayerIfMissing(map, {
        id: LYR_ROUTE_LINE, type: 'line', source: SRC_ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3B82F6', 'line-width': 4, 'line-opacity': 0.95 },
      })
      // All graph nodes (small, gray)
      addLayerIfMissing(map, {
        id: LYR_NODE_ALL, type: 'circle', source: SRC_ROUTE_NODES,
        paint: {
          'circle-radius': 3,
          'circle-color': '#94A3B8',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.6,
        },
      })
      // Start marker
      addLayerIfMissing(map, {
        id: LYR_NODE_START, type: 'circle', source: SRC_ROUTE_NODES,
        filter: ['==', ['get', 'role'], 'start'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#059669',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      })
      // End marker
      addLayerIfMissing(map, {
        id: LYR_NODE_END, type: 'circle', source: SRC_ROUTE_NODES,
        filter: ['==', ['get', 'role'], 'end'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#3B82F6',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      })

      // Graph edge lines (thin, gray)
      addLayerIfMissing(map, {
        id: LYR_GRAPH_EDGES, type: 'line', source: SRC_GRAPH_EDGES,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#CBD5E1', 'line-width': 1, 'line-opacity': 0.5 },
      })

      // Edge distance labels
      addLayerIfMissing(map, {
        id: LYR_EDGE_LABELS, type: 'symbol', source: SRC_GRAPH_EDGES,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'distance'],
          'text-size': 8,
        },
        paint: { 'text-color': '#94A3B8', 'text-halo-color': '#fff', 'text-halo-width': 1 },
      })

      // Graph nodes with degree-based sizing
      addLayerIfMissing(map, {
        id: LYR_GRAPH_NODES, type: 'circle', source: SRC_GRAPH_NODES,
        paint: {
          'circle-radius': [
            'case',
            ['>=', ['get', 'degree'], 3], 6,
            ['>=', ['get', 'degree'], 2], 4,
            3,
          ],
          'circle-color': [
            'match', ['get', 'nodeType'],
            'entrance', '#059669',
            'building_entrance', '#059669',
            'intersection', '#3B82F6',
            'outdoor', '#F97316',
            'staircase', '#8B5CF6',
            'stair', '#8B5CF6',
            'elevator', '#8B5CF6',
            '#94A3B8',
          ],
          'circle-stroke-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#EAB308',
            ['boolean', ['feature-state', 'hovered'], false], '#F59E0B',
            '#fff',
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3,
            ['boolean', ['feature-state', 'hovered'], false], 2.5,
            1,
          ],
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false], 1,
            ['boolean', ['feature-state', 'selected'], false], 1,
            0.7,
          ],
        },
      })

      // Node ID labels
      addLayerIfMissing(map, {
        id: LYR_GRAPH_NODE_IDS, type: 'symbol', source: SRC_GRAPH_NODES,
        layout: {
          'text-field': ['get', 'nodeId'],
          'text-size': 8,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#64748B', 'text-halo-color': '#fff', 'text-halo-width': 1 },
      })

      // Snap lines (dashed, colored)
      addLayerIfMissing(map, {
        id: LYR_SNAP, type: 'line', source: SRC_SNAP,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
      })
    }

    if (map.loaded()) bootstrap()
    else map.once('load', bootstrap)

    return () => {
      // Clean up layers and sources on unmount
      ;[LYR_ROUTE_LINE, LYR_ROUTE_DASHED, LYR_ROUTE_GLOW, LYR_NODE_ALL, LYR_NODE_START, LYR_NODE_END, LYR_GRAPH_EDGES, LYR_GRAPH_NODES, LYR_GRAPH_NODE_IDS, LYR_EDGE_LABELS, LYR_SNAP].forEach(l => removeIfExists(map, l))
      ;[SRC_ROUTE, SRC_ROUTE_NODES, SRC_GRAPH_EDGES, SRC_GRAPH_NODES, SRC_SNAP].forEach(s => removeSourceIfExists(map, s))
      initializedRef.current = false
    }
  }, [map])

  // ── Update node markers whenever nodes change ──
  useEffect(() => {
    if (!map || !initializedRef.current) return
    const nodeFeatures: GeoJSON.Feature[] = nodes.map(n => ({
      type: 'Feature',
      properties: { id: n.id, name: n.name || n.label, type: n.type, role: '' },
      geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
    }))
    const src = map.getSource(SRC_ROUTE_NODES) as maplibregl.GeoJSONSource
    if (src) {
      try { src.setData({ type: 'FeatureCollection', features: nodeFeatures }) } catch {}
    }
  }, [map, nodes])

  // ── Update graph overlay (independent of routing) ──
  useEffect(() => {
    if (!map || !initializedRef.current) return

    // Compute degree
    const degreeMap = new Map<string, number>()
    for (const n of nodes) degreeMap.set(n.id, 0)
    for (const e of edges) {
      degreeMap.set(e.from, (degreeMap.get(e.from) ?? 0) + 1)
      degreeMap.set(e.to, (degreeMap.get(e.to) ?? 0) + 1)
    }

    // Graph edges
    const edgeFeatures: GeoJSON.Feature[] = edges.map(e => {
      const fromNode = nodes.find(n => n.id === e.from)
      const toNode = nodes.find(n => n.id === e.to)
      if (!fromNode || !toNode) return null
      return {
        type: 'Feature',
        properties: { type: e.type, distance: `${Math.round(e.distance)}m` },
        geometry: { type: 'LineString', coordinates: [[fromNode.position.lng, fromNode.position.lat], [toNode.position.lng, toNode.position.lat]] },
      }
    }).filter(Boolean) as GeoJSON.Feature[]

    // Graph nodes
    const nodeFeatures: GeoJSON.Feature[] = nodes.map(n => ({
      type: 'Feature',
      id: n.id,
      properties: { nodeId: n.id, nodeType: n.type, degree: degreeMap.get(n.id) ?? 0, name: n.name || n.label },
      geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
    }))

    const edgeSrc = map.getSource(SRC_GRAPH_EDGES) as maplibregl.GeoJSONSource
    const nodeSrc = map.getSource(SRC_GRAPH_NODES) as maplibregl.GeoJSONSource
    if (edgeSrc) try { edgeSrc.setData({ type: 'FeatureCollection', features: edgeFeatures }) } catch {}
    if (nodeSrc) try { nodeSrc.setData({ type: 'FeatureCollection', features: nodeFeatures }) } catch {}
  }, [map, nodes, edges])

  // ── Toggle graph overlay visibility ──
  useEffect(() => {
    if (!map || !initializedRef.current) return
    const vis = showGraph ? 'visible' : 'none'
    try {
      map.setLayoutProperty(LYR_GRAPH_EDGES, 'visibility', vis)
      map.setLayoutProperty(LYR_GRAPH_NODES, 'visibility', vis)
      map.setLayoutProperty(LYR_GRAPH_NODE_IDS, 'visibility', showGraph && showNodeIds ? 'visible' : 'none')
      map.setLayoutProperty(LYR_EDGE_LABELS, 'visibility', showGraph && showLabels ? 'visible' : 'none')
    } catch {}
  }, [map, showGraph, showNodeIds, showLabels])

  // ── Graph node interactivity (hover/click) ──
  useEffect(() => {
    if (!map || !initializedRef.current) return

    let hoveredId: string | null = null

    const onMouseMove = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
      if (e.features && e.features.length > 0) {
        const id = String(e.features[0].properties?.nodeId)
        if (hoveredId && hoveredId !== id) {
          map.setFeatureState({ source: SRC_GRAPH_NODES, id: hoveredId }, { hovered: false })
        }
        hoveredId = id
        map.setFeatureState({ source: SRC_GRAPH_NODES, id }, { hovered: true })
        map.getCanvas().style.cursor = 'pointer'
        onNodeHover?.(id)
      } else {
        if (hoveredId) {
          map.setFeatureState({ source: SRC_GRAPH_NODES, id: hoveredId }, { hovered: false })
          hoveredId = null
        }
        map.getCanvas().style.cursor = ''
        onNodeHover?.(null)
      }
    }

    const onClick = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
      if (e.features && e.features.length > 0) {
        const id = String(e.features[0].properties?.nodeId)
        onNodeClick?.(id)
      }
    }

    const onMouseLeave = () => {
      if (hoveredId) {
        map.setFeatureState({ source: SRC_GRAPH_NODES, id: hoveredId }, { hovered: false })
        hoveredId = null
      }
      map.getCanvas().style.cursor = ''
      onNodeHover?.(null)
    }

    map.on('mousemove', LYR_GRAPH_NODES, onMouseMove)
    map.on('mouseleave', LYR_GRAPH_NODES, onMouseLeave)
    map.on('click', LYR_GRAPH_NODES, onClick)

    return () => {
      try {
        map.off('mousemove', LYR_GRAPH_NODES, onMouseMove)
        map.off('mouseleave', LYR_GRAPH_NODES, onMouseLeave)
        map.off('click', LYR_GRAPH_NODES, onClick)
      } catch {}
    }
  }, [map, onNodeHover, onNodeClick])

  // ── Update selected node state ──
  useEffect(() => {
    if (!map || !initializedRef.current || !selectedNodeId) return
    try {
      map.setFeatureState({ source: SRC_GRAPH_NODES, id: selectedNodeId }, { selected: true })
    } catch {}
    return () => {
      try {
        map.setFeatureState({ source: SRC_GRAPH_NODES, id: selectedNodeId }, { selected: false })
      } catch {}
    }
  }, [map, selectedNodeId])

  // ── Update route line and markers whenever path or animStep changes ──
  useEffect(() => {
    if (!map || !initializedRef.current) return

    const routeSrc = map.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource
    const nodeSrc = map.getSource(SRC_ROUTE_NODES) as maplibregl.GeoJSONSource
    if (!routeSrc || !nodeSrc) return

    if (!path || path.length < 2) {
      try {
        routeSrc.setData({ type: 'FeatureCollection', features: [] })
      } catch {}
      // Remove start/end role from nodes
      const nodeFeatures: GeoJSON.Feature[] = nodes.map(n => ({
        type: 'Feature',
        properties: { id: n.id, name: n.name || n.label, type: n.type, role: '' },
        geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
      }))
      try { nodeSrc.setData({ type: 'FeatureCollection', features: nodeFeatures }) } catch {}
      return
    }

    // Build full path line (dashed preview)
    const fullPathCoords = path.map(id => {
      const n = nodes.find(n => n.id === id)
      return n ? [n.position.lng, n.position.lat] : null
    }).filter(Boolean) as [number, number][]

    const fullFeature: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: fullPathCoords },
    }

    // Build animated path (solid, up to animStep)
    const animatedLen = Math.min(animStep + 1, path.length)
    const animPathCoords = path.slice(0, animatedLen).map(id => {
      const n = nodes.find(n => n.id === id)
      return n ? [n.position.lng, n.position.lat] : null
    }).filter(Boolean) as [number, number][]

    const animFeature: GeoJSON.Feature = animPathCoords.length >= 2 ? {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: animPathCoords },
    } : {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0]] },
    }

    // Glow follows the animated portion
    const glowFeature: GeoJSON.Feature = animPathCoords.length >= 2 ? {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: animPathCoords },
    } : {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0]] },
    }

    // Dashed line shows full route, solid shows animated portion
    // When fully animated, dashed is hidden
    const showDashed = animStep < path.length - 1

    try {
      routeSrc.setData({
        type: 'FeatureCollection',
        features: [glowFeature, animFeature, fullFeature],
      })
    } catch {}

    // Update node roles
    const startId = path[0]
    const endId = path[path.length - 1]
    const animatedIds = new Set(path.slice(0, animatedLen))
    const nodeFeatures: GeoJSON.Feature[] = nodes.map(n => ({
      type: 'Feature',
      properties: {
        id: n.id,
        name: n.name || n.label,
        type: n.type,
        role: n.id === startId ? 'start' : n.id === endId ? 'end' : '',
        inPath: animatedIds.has(n.id),
      },
      geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
    }))
    try { nodeSrc.setData({ type: 'FeatureCollection', features: nodeFeatures }) } catch {}

    // Toggle layer visibility
    try {
      const dashedLayer = map.getLayer(LYR_ROUTE_DASHED)
      if (dashedLayer) map.setLayoutProperty(LYR_ROUTE_DASHED, 'visibility', showDashed ? 'visible' : 'none')
    } catch {}
  }, [map, nodes, path, animStep])

  // ── Update snap lines ──
  useEffect(() => {
    if (!map || !initializedRef.current) return
    const src = map.getSource(SRC_SNAP) as maplibregl.GeoJSONSource
    if (!src) return
    if (!snapLines || snapLines.length === 0) {
      try { src.setData({ type: 'FeatureCollection', features: [] }) } catch {}
      return
    }
    const features = snapLines.map(sl => ({
      type: 'Feature' as const,
      properties: { color: sl.color },
      geometry: { type: 'LineString' as const, coordinates: [sl.from, sl.to] },
    }))
    try { src.setData({ type: 'FeatureCollection', features }) } catch {}
  }, [map, snapLines])

  return null
}
