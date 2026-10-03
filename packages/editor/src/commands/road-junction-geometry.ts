import { ROUTE_NETWORK_THRESHOLDS, haversine } from '@navi/core'
import type { CampusDocument } from '@navi/core'

export interface RoadJunctionMoveGeometry {
  roadId: string
  points: Array<{ lat: number; lng: number }>
}

export interface RoadJunctionMoveRequest {
  junctionId: string
  position: { lat: number; lng: number }
  /** Exact geometry is supplied by undo/redo so inserted junction vertices are reversible. */
  roadGeometry?: RoadJunctionMoveGeometry[]
}

export interface RoadJunctionMovePlan {
  junctionId: string
  position: { lat: number; lng: number }
  previousPosition: { lat: number; lng: number }
  roads: Array<{
    roadId: string
    previousPoints: Array<{ lat: number; lng: number }>
    points: Array<{ lat: number; lng: number }>
  }>
}

function closestPointOnSegment(
  target: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
) {
  const longitudeScale = Math.cos((target.lat * Math.PI) / 180)
  const dx = (end.lng - start.lng) * longitudeScale
  const dy = end.lat - start.lat
  const px = (target.lng - start.lng) * longitudeScale
  const py = target.lat - start.lat
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return null
  const ratio = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
  const point = {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: start.lng + (end.lng - start.lng) * ratio,
  }
  return { point, distanceMeters: haversine(target, point) }
}

function moveRoadJunctionPosition(
  points: Array<{ lat: number; lng: number }>,
  junctionPosition: { lat: number; lng: number },
  nextPosition: { lat: number; lng: number },
) {
  const previousPoints = points.map((point) => ({ ...point }))
  const movedPoints = points.map((point) => ({ ...point }))
  const radius = ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters
  const matchingVertices = movedPoints
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => haversine(point, junctionPosition) <= radius)

  if (matchingVertices.length > 0) {
    for (const { index } of matchingVertices) movedPoints[index] = { ...nextPosition }
    return { previousPoints, points: movedPoints }
  }

  let closestSegment: { index: number; distanceMeters: number } | null = null
  for (let index = 0; index < movedPoints.length - 1; index += 1) {
    const projection = closestPointOnSegment(junctionPosition, movedPoints[index], movedPoints[index + 1])
    if (projection && (!closestSegment || projection.distanceMeters < closestSegment.distanceMeters)) {
      closestSegment = { index, distanceMeters: projection.distanceMeters }
    }
  }

  if (!closestSegment || closestSegment.distanceMeters > radius) return null
  movedPoints.splice(closestSegment.index + 1, 0, { ...nextPosition })
  return { previousPoints, points: movedPoints }
}

/** Build a reversible shared-geometry move for every road in an authored junction. */
export function buildRoadJunctionMovePlan(
  document: Pick<CampusDocument, 'roads' | 'roadJunctions'>,
  request: RoadJunctionMoveRequest,
): RoadJunctionMovePlan | null {
  const junction = (document.roadJunctions ?? []).find((candidate) => candidate.id === request.junctionId)
  if (!junction || junction.roadIds.length < 2 ||
      !Number.isFinite(request.position.lat) || !Number.isFinite(request.position.lng)) return null

  const previousPosition = { ...junction.position }
  const roadIds = [...new Set(junction.roadIds)]
  let roads: RoadJunctionMovePlan['roads']

  if (request.roadGeometry) {
    const suppliedIds = request.roadGeometry.map((geometry) => geometry.roadId)
    if (new Set(suppliedIds).size !== suppliedIds.length ||
        suppliedIds.length !== roadIds.length || roadIds.some((roadId) => !suppliedIds.includes(roadId))) return null

    roads = []
    for (const roadId of roadIds) {
      const road = document.roads.find((candidate) => candidate.id === roadId)
      const geometry = request.roadGeometry.find((candidate) => candidate.roadId === roadId)
      if (!road || !geometry || geometry.points.length < 2 || geometry.points.some((point) =>
        !Number.isFinite(point.lat) || !Number.isFinite(point.lng),
      )) return null
      roads.push({
        roadId,
        previousPoints: road.polyline.points.map((point) => ({ ...point })),
        points: geometry.points.map((point) => ({ ...point })),
      })
    }
  } else {
    roads = []
    for (const roadId of roadIds) {
      const road = document.roads.find((candidate) => candidate.id === roadId)
      if (!road) return null
      const geometry = moveRoadJunctionPosition(road.polyline.points, previousPosition, request.position)
      if (!geometry) return null
      roads.push({ roadId, ...geometry })
    }
  }

  return {
    junctionId: junction.id,
    position: { ...request.position },
    previousPosition,
    roads,
  }
}
