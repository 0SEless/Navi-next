import type { NavNode, NavEdge, Building, TracePath } from '@/types/nav-types'

/** Build a GeoJSON FeatureCollection for building footprints. */
export function buildBuildingGeo(buildings: Building[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: buildings.map((b) => ({
      type: 'Feature',
      properties: { id: b.id, name: b.name, color: b.color || '#1C6BEB', height: b.height || 15 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          b.footprint
            .map((p) => [p.lng, p.lat] as [number, number])
            .concat([[b.footprint[0].lng, b.footprint[0].lat]] as [number, number][]),
        ],
      },
    })),
  }
}

/** Build a GeoJSON FeatureCollection for navigation nodes. */
export function buildNodeGeo(nodes: NavNode[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: nodes.map((n) => ({
      type: 'Feature',
      properties: { id: n.id, type: n.type },
      geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
    })),
  }
}

/** Build a GeoJSON FeatureCollection for connection nodes (distinct styling). */
export function buildConnectionNodeGeo(nodes: NavNode[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: nodes.map((n) => ({
      type: 'Feature',
      properties: { id: n.id, connection: true },
      geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
    })),
  }
}

/**
 * A blue connection point can be either an existing shared junction or an
 * endpoint that is available for an explicit author connection. Keeping this
 * predicate separate preserves the meaning of `connectionNode` in the graph.
 */
export function isConnectionPoint(node: NavNode): boolean {
  return node.metadata?.connectionNode === true || node.metadata?.roadEndpoint === true
}

/** Build a GeoJSON FeatureCollection for edges. */
export function buildEdgeGeo(
  edges: NavEdge[],
  nodes: NavNode[],
): GeoJSON.FeatureCollection {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  return {
    type: 'FeatureCollection',
    features: edges
      .map((e) => {
        const from = nodeMap.get(e.from)
        const to = nodeMap.get(e.to)
        if (!from || !to) return null
        return {
          type: 'Feature',
          properties: { id: e.id },
          geometry: {
            type: 'LineString',
            coordinates: [
              [from.position.lng, from.position.lat],
              [to.position.lng, to.position.lat],
            ],
          },
        }
      })
      .filter(Boolean) as GeoJSON.Feature[],
  }
}

/** Build a GeoJSON FeatureCollection for trace paths. */
export function buildTracesGeo(traces: TracePath[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: traces.map((t) => ({
      type: 'Feature',
      properties: {
        id: t.id,
        name: t.name,
        type: t.type,
        color: t.color || '#FFFFFF',
        width: t.width ?? 8,
      },
      geometry: {
        type: 'LineString',
        coordinates: t.points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    })),
  }
}
