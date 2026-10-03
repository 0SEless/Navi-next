import type { TracePath } from '@/types/nav-types'

function isWorldPoint(point: unknown): point is { lat: number; lng: number } {
  if (typeof point !== 'object' || point === null) return false
  const { lat, lng } = point as { lat?: unknown; lng?: unknown }
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
}

/** Shared GeoJSON projection for authored campus traces in public map surfaces. */
export function tracesToGeoJSON(traces: readonly TracePath[]): GeoJSON.FeatureCollection {
  const seenIds = new Set<string>()
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = []

  for (const trace of traces) {
    if (trace.displayMode === 'navigation-only' || trace.points.length < 2) continue
    if (seenIds.has(trace.id) || !trace.points.every(isWorldPoint)) continue
    seenIds.add(trace.id)

    features.push({
      type: 'Feature',
      id: trace.id,
      properties: {
        id: trace.id,
        trace_type: trace.type,
        road_type: trace.roadType ?? trace.type,
        name: trace.name ?? '',
        color: trace.color ?? '',
        width: trace.width ?? 8,
        displayMode: trace.displayMode ?? 'visible',
        ...(trace.surface ? { surface: trace.surface } : {}),
        ...(trace.connectorEntranceId ? { connectorEntranceId: trace.connectorEntranceId } : {}),
        ...(trace.metadata ? { metadata: trace.metadata } : {}),
        ...(trace.routing ? { routing: trace.routing } : {}),
      },
      geometry: {
        type: 'LineString',
        coordinates: trace.points.map((point) => [point.lng, point.lat] as [number, number]),
      },
    })
  }

  return { type: 'FeatureCollection', features }
}
