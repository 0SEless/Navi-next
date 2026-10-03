/**
 * Relationship Overlay — renders ephemeral visualizations of entity relationships.
 *
 * Architecture:
 *   CampusDocument → buildRelationshipGeometry() → RelationshipGeometry → renderRelationshipOverlay() → MapLibre
 *
 * The geometry builder is pure (no MapLibre dependency).
 * The renderer translates geometry into MapLibre source updates.
 *
 * Today this supports entrance→road. The types are generic enough for future
 * relationship types (stair↔stair, QR↔entrance, panorama↔room, etc.).
 */

import type { Map as MapLibreMap } from 'maplibregl'
import type { CampusDocument, LatLng, Road, CoordinateTransformer } from '@navi/core'

// ── Geometry types ──────────────────────────────────────────────────────────

export interface RelationshipHighlight {
  type: 'roadHighlight'
  /** World-coordinate polyline of the road to emphasize */
  polyline: LatLng[]
  /** Road width in meters (for reference; renderer decides visual width) */
  width: number
}

export interface RelationshipConnector {
  type: 'connector'
  /** Start point (e.g. entrance position) */
  from: LatLng
  /** End point (nearest point on road) */
  to: LatLng
}

export interface RelationshipGeometry {
  highlights: RelationshipHighlight[]
  connectors: RelationshipConnector[]
}

// ── Pure geometry builder ───────────────────────────────────────────────────

/**
 * Find the nearest point on a polyline to a given point.
 * Returns the closest LatLng on the polyline.
 */
function nearestPointOnPolyline(point: LatLng, polyline: LatLng[]): LatLng | null {
  if (polyline.length === 0) return null
  if (polyline.length === 1) return polyline[0]

  let bestDist = Infinity
  let bestPoint = polyline[0]

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]

    // Project point onto segment AB
    const dx = b.lng - a.lng
    const dy = b.lat - a.lat
    const lenSq = dx * dx + dy * dy

    let t: number
    if (lenSq === 0) {
      t = 0
    } else {
      t = Math.max(0, Math.min(1, ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lenSq))
    }

    const proj = { lat: a.lat + t * dy, lng: a.lng + t * dx }
    const dist = (proj.lng - point.lng) ** 2 + (proj.lat - point.lat) ** 2

    if (dist < bestDist) {
      bestDist = dist
      bestPoint = proj
    }
  }

  return bestPoint
}

/**
 * Build relationship geometry from the current selection and document.
 *
 * - If selectedId is not an entrance → returns null
 * - If entrance has no connectorRoadId → returns null
 * - If referenced road is missing or has invalid geometry → returns null
 * - Otherwise returns road highlight + connector line
 */
export function buildRelationshipGeometry(
  selectedId: string | null | undefined,
  document: CampusDocument,
  transformer?: CoordinateTransformer,
): RelationshipGeometry | null {
  if (!selectedId) return null

  // Find the entrance entity in the document
  let entrance: { connectorRoadId?: string; position: LatLng; buildingId: string } | null = null
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const ent of floor.entrances) {
        if (ent.id === selectedId) {
          entrance = { connectorRoadId: ent.connectorRoadId, position: ent.position as unknown as LatLng, buildingId: building.id }
          break
        }
      }
      if (entrance) break
    }
    if (entrance) break
  }

  if (!entrance) return null
  if (!entrance.connectorRoadId) return null

  // Find the connected road
  const road = document.roads.find(r => r.id === entrance!.connectorRoadId)
  if (!road) return null

  // Validate road has valid geometry
  const roadPoints = road.polyline?.points
  if (!roadPoints || roadPoints.length < 2) return null

  // P1-T4 (D9): entrance positions are building-local — derive world for the
  // comparison against the road's world polyline. Legacy world-stored records
  // pass through verbatim; without a transformer a local entrance cannot be
  // anchored, so no overlay is drawn.
  const entranceWorld = (entrance.position as unknown as { lat?: number }).lat !== undefined
    ? (entrance.position as unknown as LatLng)
    : (transformer ? transformer.buildingLocalToWorld(entrance.position as unknown as { x: number; y: number }, entrance.buildingId) : null)
  if (!entranceWorld) return null

  // Compute nearest point on road to entrance
  const nearest = nearestPointOnPolyline(entranceWorld, roadPoints)
  if (!nearest) return null

  return {
    highlights: [{
      type: 'roadHighlight',
      polyline: roadPoints,
      width: road.width,
    }],
    connectors: [{
      type: 'connector',
      from: entranceWorld,
      to: nearest,
    }],
  }
}

// ── MapLibre renderer ───────────────────────────────────────────────────────

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Convert RelationshipGeometry to a GeoJSON FeatureCollection.
 */
function geometryToGeoJSON(geometry: RelationshipGeometry | null): GeoJSON.FeatureCollection {
  if (!geometry) return EMPTY

  const features: GeoJSON.Feature[] = []

  for (const highlight of geometry.highlights) {
    features.push({
      type: 'Feature',
      properties: { type: 'roadHighlight' },
      geometry: {
        type: 'LineString',
        coordinates: highlight.polyline.map(p => [p.lng, p.lat] as [number, number]),
      },
    })
  }

  for (const connector of geometry.connectors) {
    features.push({
      type: 'Feature',
      properties: { type: 'connector' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [connector.from.lng, connector.from.lat] as [number, number],
          [connector.to.lng, connector.to.lat] as [number, number],
        ],
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

/**
 * Render (sync) the relationship overlay on the map.
 * Call this whenever the geometry changes (selection change, document change).
 *
 * If the overlay source/layers don't exist yet, they should be created
 * by addSourcesAndLayers() before calling this function.
 */
export function renderRelationshipOverlay(
  map: MapLibreMap | null,
  geometry: RelationshipGeometry | null,
): void {
  if (!map) return

  const source = map.getSource('relationship-overlay') as maplibregl.GeoJSONSource | undefined
  if (!source) return

  source.setData(geometryToGeoJSON(geometry))
}
