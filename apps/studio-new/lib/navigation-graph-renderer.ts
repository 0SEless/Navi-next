/**
 * Stage 3B — NavigationGraphRenderer
 *
 * Renders compiled NavigationGraph nodes and edges as a visual-only overlay.
 *
 * ADR 005 boundary:
 *   - NAVG renders ONLY NavigationGraph (never CampusDocument)
 *   - NAVG uses navg-* layer namespace (separate from navi-* authored layers)
 *   - EntityRenderer never receives NavigationGraph
 *
 * Visual-only: no selection, no hover, no click, no pathfinding.
 * Toggle independently via setVisible().
 */

import type maplibregl from 'maplibre-gl'
import type { NavigationGraph } from '@navi/compiler'

// ── Layer/ source IDs (navg-* namespace) ───────────────────────

const LAYER = {
  EDGE_LINE: 'navg-edge-line',
  NODE_CIRCLE: 'navg-node-circle',
  NODE_LABEL: 'navg-node-label',
} as const

const SOURCE = {
  EDGES: 'navg-edges',
  NODES: 'navg-nodes',
} as const

// ── Node color by type ─────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  space: '#3B82F6',       // blue
  corridor: '#10B981',    // green
  transition: '#F59E0B',  // orange
  intersection: '#EF4444', // red
  poi: '#8B5CF6',         // purple
}

// ── Edge color by type ─────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  walk: '#94A3B8',        // gray
  stairs: '#F97316',      // orange
  elevator: '#A855F7',    // purple
  transition: '#14B8A6',  // teal
}

// ── GeoJSON conversion ─────────────────────────────────────────

function graphToGeoJSON(graph: NavigationGraph): {
  nodes: GeoJSON.FeatureCollection
  edges: GeoJSON.FeatureCollection
} {
  const nodeFeatures: GeoJSON.Feature[] = graph.nodes.map(n => ({
    type: 'Feature',
    id: n.id,
    properties: {
      id: n.id,
      label: n.label,
      type: n.type,
      floor: n.floor,
      buildingId: n.buildingId,
      color: NODE_COLORS[n.type] ?? '#888',
    },
    geometry: {
      type: 'Point',
      coordinates: [n.position.lng, n.position.lat],
    },
  }))

  const edgeFeatures: GeoJSON.Feature[] = graph.edges.map(e => {
    const fromNode = graph.nodes.find(n => n.id === e.from)
    const toNode = graph.nodes.find(n => n.id === e.to)
    const coords: [number, number][] = []

    if (fromNode) coords.push([fromNode.position.lng, fromNode.position.lat])
    if (toNode) coords.push([toNode.position.lng, toNode.position.lat])

    // Fall back to edge midpoint if nodes not found
    if (coords.length < 2) return null

    return {
      type: 'Feature',
      id: e.id,
      properties: {
        id: e.id,
        from: e.from,
        to: e.to,
        type: e.type,
        distance: e.distance,
        weight: e.weight,
        color: EDGE_COLORS[e.type] ?? '#64748B',
      },
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
    }
  }).filter(Boolean) as GeoJSON.Feature[]

  return {
    nodes: { type: 'FeatureCollection', features: nodeFeatures },
    edges: { type: 'FeatureCollection', features: edgeFeatures },
  }
}

// ── Paint style helpers ────────────────────────────────────────

function edgeLinePaint(): maplibregl.LineLayerSpecification['paint'] {
  return {
    'line-color': ['get', 'color'],
    'line-width': [
      'case',
      ['>=', ['get', 'weight'], 5], 2,
      ['>=', ['get', 'weight'], 2], 1.5,
      1,
    ],
    'line-opacity': 0.5,
    // Dotted for transitions (stairs/elevator), solid for walk edges
    'line-dasharray': [
      'case',
      ['==', ['get', 'type'], 'walk'], ['literal', [1, 0]],
      ['literal', [3, 2]],
    ],
  }
}

function nodeCirclePaint(): maplibregl.CircleLayerSpecification['paint'] {
  return {
    'circle-radius': [
      'case',
      ['==', ['get', 'type'], 'space'], 5,
      ['==', ['get', 'type'], 'corridor'], 4,
      ['==', ['get', 'type'], 'transition'], 6,
      ['==', ['get', 'type'], 'intersection'], 7,
      4,
    ],
    'circle-color': ['get', 'color'],
    'circle-opacity': 0.8,
    'circle-stroke-width': 1,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-opacity': 0.6,
  }
}

function nodeLabelPaint(): maplibregl.SymbolLayerSpecification['paint'] {
  return {
    'text-color': '#e2e8f0',
    'text-halo-color': '#0f172a',
    'text-halo-width': 1.5,
    'text-opacity': 0.9,
  }
}

// ── NavigationGraphRenderer class ──────────────────────────────

export class NavigationGraphRenderer {
  private map: maplibregl.Map
  private visible = true
  private initialized = false

  constructor(map: maplibregl.Map) {
    this.map = map
  }

  /** Create GeoJSON sources and layers. Safe to call multiple times. */
  init(): void {
    if (this.initialized) return
    this.initialized = true

    if (this.map.loaded()) {
      this.addSources()
      this.addLayers()
    } else {
      this.map.on('load', () => {
        this.addSources()
        this.addLayers()
      })
    }
  }

  /** Sync sources from a NavigationGraph. */
  sync(graph: NavigationGraph): void {
    const { nodes, edges } = graphToGeoJSON(graph)
    this.setSourceData(SOURCE.NODES, nodes)
    this.setSourceData(SOURCE.EDGES, edges)
  }

  /** Toggle visibility of all graph layers. */
  setVisible(v: boolean): void {
    this.visible = v
    for (const id of Object.values(LAYER)) {
      try {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none')
        }
      } catch { /* ok */ }
    }
  }

  /** Check current visibility. */
  isVisible(): boolean {
    return this.visible
  }

  /** Remove all navg-* layers and sources. */
  destroy(): void {
    if (!this.initialized) return
    for (const id of Object.values(LAYER)) {
      try { this.map.removeLayer(id) } catch { /* ok */ }
    }
    for (const id of Object.values(SOURCE)) {
      try { this.map.removeSource(id) } catch { /* ok */ }
    }
    this.initialized = false
  }

  // ── Private ──

  private addSources(): void {
    for (const id of Object.values(SOURCE)) {
      if (this.map.getSource(id)) continue
      this.map.addSource(id, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
  }

  private addLayers(): void {
    const layerDefs: Array<{
      id: string; source: string; type: string; paint: any; layout?: any
    }> = [
      // Edges first (behind nodes)
      { id: LAYER.EDGE_LINE, source: SOURCE.EDGES, type: 'line', paint: edgeLinePaint() },
      // Nodes on top
      { id: LAYER.NODE_CIRCLE, source: SOURCE.NODES, type: 'circle', paint: nodeCirclePaint() },
      // Labels
      {
        id: LAYER.NODE_LABEL, source: SOURCE.NODES, type: 'symbol',
        paint: nodeLabelPaint(),
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-font': ['Open Sans Regular'],
        },
      },
    ]

    for (const def of layerDefs) {
      if (this.map.getLayer(def.id)) continue
      this.map.addLayer(def as any)
    }
  }

  private setSourceData(sourceId: string, data: GeoJSON.FeatureCollection): void {
    try {
      const source = this.map.getSource(sourceId) as any
      if (source?.setData) source.setData(data)
    } catch {
      // source may not be ready
    }
  }
}
