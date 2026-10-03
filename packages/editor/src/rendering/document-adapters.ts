import type { CampusDocument, Building, Road, Area } from '@navi/core'
import { roadTypeColor } from '@navi/core'

export function buildingsToGeoJSON(buildings: Building[]): GeoJSON.FeatureCollection {
  const features = buildings
    .filter((b) => (b.footprint?.points?.length ?? 0) > 0)
    .map((b) => ({
      type: 'Feature' as const,
      properties: { id: b.id, name: b.name, color: b.color || '#1C6BEB', height: b.height || 15 },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          b.footprint.points
            .map((p) => [p.lng, p.lat] as [number, number])
            .concat([[b.footprint.points[0].lng, b.footprint.points[0].lat]] as [number, number][]),
        ],
      },
    }))
  return { type: 'FeatureCollection', features }
}

export function roadsToTracesGeoJSON(roads: Road[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.map((r) => ({
      type: 'Feature',
      properties: {
        id: r.id,
        name: r.name,
        type: 'road',
        displayMode: r.displayMode ?? 'visible',
        color: (r.metadata?.color as string) || roadTypeColor(r.type),
        width: r.width ?? 8,
      },
      geometry: {
        type: 'LineString',
        coordinates: r.polyline.points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    })),
  }
}

export function areasToGeoJSON(areas: Area[] | undefined): GeoJSON.FeatureCollection {
  if (!areas) return { type: 'FeatureCollection', features: [] }
  const features = areas
    .filter((a) => a.points.length >= 3)
    .map((a) => ({
      type: 'Feature' as const,
      properties: { id: a.id, name: a.name, color: a.color || '#8B5CF6' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          a.points
            .map((p) => [p.lng, p.lat] as [number, number])
            .concat([[a.points[0].lng, a.points[0].lat]] as [number, number][]),
        ],
      },
    }))
  return { type: 'FeatureCollection', features }
}

export function documentToRenderingGeo(document: CampusDocument): {
  buildingsGeo: GeoJSON.FeatureCollection
  roadsGeo: GeoJSON.FeatureCollection
} {
  return {
    buildingsGeo: buildingsToGeoJSON(document.buildings),
    roadsGeo: roadsToTracesGeoJSON(document.roads),
  }
}
