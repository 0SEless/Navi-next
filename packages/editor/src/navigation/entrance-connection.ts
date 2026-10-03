import type { Entrance, Road } from '@navi/core'
import { haversine } from '@navi/core'
import type { CoordinateTransformer } from '@navi/core'
import type { LatLng } from '@navi/core'

const DEFAULT_MAX_DISTANCE = 200

export interface EntranceConnectionResult {
  connected: boolean
  roadId?: string
  distance?: number
  error?: string
}

function pointToSegmentDistance(
  point: LatLng,
  a: LatLng,
  b: LatLng,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(point.lat)
  const lng1 = toRad(a.lng)
  const lng2 = toRad(point.lng)

  const lenSq = dLat * dLat + dLng * dLng * Math.cos((lat1 + lat2) / 2) ** 2
  if (lenSq === 0) return haversine(point, a)

  let t = ((point.lat - a.lat) * dLat + (point.lng - a.lng) * dLng * Math.cos((lat1 + lat2) / 2) ** 2) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projLat = a.lat + t * (b.lat - a.lat)
  const projLng = a.lng + t * (b.lng - a.lng)
  return haversine(point, { lat: projLat, lng: projLng })
}

export function connectEntranceToRoad(
  entrance: Entrance,
  roadNetwork: Road[],
  transformer: CoordinateTransformer,
  buildingId: string,
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): EntranceConnectionResult {
  const worldPos = transformer.buildingLocalToWorld(entrance.position, buildingId)
  if (!worldPos) {
    return { connected: false, error: 'Could not transform entrance position to world coordinates' }
  }

  let bestRoad: Road | null = null
  let bestDist = Infinity

  for (const road of roadNetwork) {
    const points = road.polyline.points
    if (points.length < 2) continue

    for (let i = 0; i < points.length - 1; i++) {
      const dist = pointToSegmentDistance(worldPos, points[i], points[i + 1])
      if (dist < bestDist) {
        bestDist = dist
        bestRoad = road
      }
    }
  }

  if (!bestRoad || bestDist > maxDistance) {
    return { connected: false, distance: bestDist, error: `No road within ${maxDistance}m` }
  }

  const updatedEntrance: Entrance = { ...entrance, connectorRoadId: bestRoad.id }
  const updatedRoad: Road = { ...bestRoad, connectorEntranceId: entrance.id }

  Object.assign(entrance, updatedEntrance)
  Object.assign(bestRoad, updatedRoad)

  return { connected: true, roadId: bestRoad.id, distance: bestDist }
}

export function validateEntranceConnection(
  entrance: Entrance,
  roadNetwork: Road[],
  transformer: CoordinateTransformer,
  buildingId: string,
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): { valid: boolean; error?: string } {
  if (!entrance.connectorRoadId) {
    return { valid: false, error: 'Entrance has no road connection' }
  }

  const road = roadNetwork.find(r => r.id === entrance.connectorRoadId)
  if (!road) {
    return { valid: false, error: `Connected road ${entrance.connectorRoadId} not found in network` }
  }

  if (road.connectorEntranceId !== entrance.id) {
    return { valid: false, error: 'Road connectorEntranceId does not reference this entrance' }
  }

  const worldPos = transformer.buildingLocalToWorld(entrance.position, buildingId)
  if (!worldPos) {
    return { valid: false, error: 'Could not transform entrance position to world coordinates' }
  }

  const points = road.polyline.points
  if (points.length < 2) {
    return { valid: false, error: 'Road has insufficient polyline points' }
  }

  let minDist = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const dist = pointToSegmentDistance(worldPos, points[i], points[i + 1])
    if (dist < minDist) minDist = dist
  }

  if (minDist > maxDistance) {
    return { valid: false, error: `Entrance is ${minDist.toFixed(1)}m from connected road (max ${maxDistance}m)` }
  }

  return { valid: true }
}

export function disconnectEntrance(entrance: Entrance, roadNetwork: Road[]): void {
  if (!entrance.connectorRoadId) return

  const road = roadNetwork.find(r => r.id === entrance.connectorRoadId)
  if (road && road.connectorEntranceId === entrance.id) {
    road.connectorEntranceId = undefined
  }

  entrance.connectorRoadId = undefined
}
