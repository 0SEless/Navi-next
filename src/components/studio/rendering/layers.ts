import maplibregl from 'maplibre-gl'
import { SRC, LYR } from './constants'

/**
 * Register all GeoJSON sources and render layers on the map.
 * Idempotent — returns early if sources already exist.
 */
/**
 * Idempotently add the area source and layers.
 * Called independently so areas can be added after the main batch.
 */
export function addAreaSourceAndLayer(map: maplibregl.Map): void {
  if (map.getSource(SRC.AREAS)) return
  map.addSource(SRC.AREAS, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    promoteId: 'id',
  })
  map.addLayer({
    id: LYR.AREAS_FILL,
    type: 'fill',
    source: SRC.AREAS,
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#FFFFFF',
        ['get', 'color'],
      ],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        0.25,
        0.15,
      ],
    },
  })
  map.addLayer({
    id: LYR.AREAS_OUTLINE,
    type: 'line',
    source: SRC.AREAS,
    paint: {
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#FFFFFF',
        ['get', 'color'],
      ],
      'line-width': 1.5,
      'line-dasharray': [4, 4],
      'line-opacity': 0.6,
    },
  })
}

/**
 * Register all GeoJSON sources and render layers on the map.
 * Idempotent — returns early if sources already exist.
 * Note: Areas use a separate addAreaSourceAndLayer call.
 */
export function addSourcesAndLayers(map: maplibregl.Map): void {
  if (map.getSource(SRC.NODES)) return

  // --- Edges ---
  map.addSource(SRC.EDGES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: LYR.EDGES,
    type: 'line',
    source: SRC.EDGES,
    paint: { 'line-color': '#475569', 'line-width': 2 },
  })

  // --- Nodes ---
  map.addSource(SRC.NODES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    promoteId: 'id',
  })
  map.addLayer({
    id: LYR.NODES,
    type: 'circle',
    source: SRC.NODES,
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        8,
        5,
      ],
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#22D3EE',
        '#F59E0B',
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        2.5,
        2,
      ],
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#0E7490',
        '#1E293B',
      ],
    },
  })

  // --- Connection nodes ---
  map.addSource(SRC.NODES_CONNECTION, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    promoteId: 'id',
  })
  map.addLayer({
    id: LYR.NODES_CONNECTION,
    type: 'circle',
    source: SRC.NODES_CONNECTION,
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        9,
        6,
      ],
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#67E8F9',
        '#22D3EE',
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        3,
        2.5,
      ],
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#155E75',
        '#0E7490',
      ],
    },
  })

  // --- Boundary ---
  map.addSource(SRC.BOUNDARY, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: LYR.BOUNDARY_FILL,
    type: 'fill',
    source: SRC.BOUNDARY,
    paint: {
      'fill-color': '#94A3B8',
      'fill-opacity': 0.12,
    },
  })
  map.addLayer({
    id: LYR.BOUNDARY_OUTLINE,
    type: 'line',
    source: SRC.BOUNDARY,
    paint: {
      'line-color': '#94A3B8',
      'line-width': 1.5,
      'line-dasharray': [4, 4],
      'line-opacity': 0.5,
    },
  })

  // --- Drawing (ephemeral) ---
  map.addSource(SRC.DRAWING, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: LYR.DRAWING_LINE,
    type: 'line',
    source: SRC.DRAWING,
    paint: {
      'line-color': '#06B6D4',
      'line-width': 3,
      'line-dasharray': [4, 4],
      'line-opacity': 0.6,
    },
  })
  map.addLayer({
    id: LYR.DRAWING_POINTS,
    type: 'circle',
    source: SRC.DRAWING,
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        9,
        6,
      ],
      'circle-color': '#06B6D4',
      'circle-opacity': 0.8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  })
}
