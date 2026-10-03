/**
 * Generic campus geographic bounds (Phase 2G camera fix).
 *
 * Priority: authored campus boundary -> building geometry (outline/footprint,
 * then center) -> route-node positions. Malformed/non-geographic values are
 * ignored safely. Returns null when no usable geometry exists (caller falls
 * back to existing behavior).
 *
 * Pure + side-effect free for easy testing. No hard-coded coordinates.
 */

export type CampusBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number; points: number }

type AnyRecord = Record<string, unknown>
const isRecord = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v)
const isValidLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180

function collectFrom(value: unknown, sink: Array<[number, number]>): void {
  // Campus boundary (and other collections) may be a top-level array of points
  // or nested coordinate arrays — traverse them generically.
  if (Array.isArray(value)) {
    for (const item of value) collectFrom(item, sink)
    return
  }
  if (!isRecord(value)) return
  const lat = value.lat; const lng = value.lng
  if (isValidLatLng(lat, lng)) { sink.push([lat as number, lng as number]); return }
  const pos = (value.position ?? value.center ?? value.location)
  if (isRecord(pos)) {
    const pl = pos.lat; const pg = pos.lng
    if (isValidLatLng(pl, pg)) sink.push([pl as number, pg as number])
  }
  for (const key of ['points', 'polygon', 'outline', 'footprint']) {
    const arr = value[key]
    if (Array.isArray(arr)) for (const p of arr) collectFrom(p, sink)
  }
}

export function computeCampusBounds(graph: AnyRecord | null | undefined): CampusBounds | null {
  if (!isRecord(graph)) return null
  const sink: Array<[number, number]> = []

  // 1) authored boundary, when valid
  for (const key of ['boundary', 'bounds']) {
    const b = graph[key]
    if (!b) continue
    const before = sink.length
    collectFrom(b, sink)
    if (sink.length > before) return finish(sink)
  }

  // 2) building geometry (outline/footprint first, then centers)
  const buildings = Array.isArray(graph.buildings) ? graph.buildings : []
  for (const key of ['outline', 'footprint']) {
    for (const b of buildings) if (isRecord(b) && b[key]) collectFrom({ [key]: b[key] }, sink)
  }
  if (sink.length === 0) {
    for (const b of buildings) if (isRecord(b)) {
      if (isRecord(b.center)) collectFrom(b.center, sink)
      else collectFrom(b, sink)
    }
  }
  if (sink.length > 0) return finish(sink)

  // 3) route-node positions
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  for (const n of nodes) if (isRecord(n)) collectFrom(n, sink)
  if (sink.length > 0) return finish(sink)

  return null
}

function finish(sink: Array<[number, number]>): CampusBounds {
  let minLat = sink[0][0], maxLat = sink[0][0], minLng = sink[0][1], maxLng = sink[0][1]
  for (const [lat, lng] of sink) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return { minLat, maxLat, minLng, maxLng, points: sink.length }
}
