/**
 * Stage 4.2 — Canvas hit-testing
 *
 * Map click → determine which authored entity was clicked.
 *
 * Layer-to-type mapping:
 *   navi-building-*  → 'building'
 *   navi-room-*      → 'room'
 *   navi-hallway-*   → 'hallway'
 *   navi-road-*      → 'road'
 *
 * Returns { type, id } or null if nothing was hit.
 */

import type maplibregl from 'maplibre-gl'
import type { EntityRef } from './selection-manager'

/** Layers to query for hit-testing, in priority order (topmost first). */
const HIT_LAYERS = [
  'navi-building-extrusion',
  'navi-room-fill',
  'navi-room-outline',
  'navi-hallway-line',
  'navi-road-line',
  'navi-entrance-icon',
  'navi-staircase-icon',
  'navi-elevator-icon',
  'navi-panorama-icon',
  'navi-qr-icon',
]

/** Map navi-* layer IDs to entity types. */
function layerToType(layerId: string): EntityRef['type'] | null {
  if (layerId.includes('building')) return 'building'
  if (layerId.includes('room')) return 'room'
  if (layerId.includes('hallway')) return 'hallway'
  if (layerId.includes('road')) return 'road'
  if (layerId.includes('entrance')) return 'entrance'
  if (layerId.includes('staircase')) return 'staircase'
  if (layerId.includes('elevator')) return 'elevator'
  if (layerId.includes('panorama')) return 'panorama'
  if (layerId.includes('qr')) return 'qr'
  return null
}

/**
 * Hit-test a map click event against authored (navi-*) layers.
 * Returns the first matching entity, or null.
 */
export function hitTest(
  map: maplibregl.Map,
  point: { x: number; y: number },
): EntityRef | null {
  const features = map.queryRenderedFeatures([point.x, point.y], {
    layers: HIT_LAYERS,
  })

  if (features.length === 0) return null

  const feature = features[0]
  const layerId = feature.layer?.id ?? ''
  const entityType = layerToType(layerId)
  const entityId = feature.properties?.id as string | undefined

  if (!entityType || !entityId) return null

  return { type: entityType, id: entityId }
}
