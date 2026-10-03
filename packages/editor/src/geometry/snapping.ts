export interface Point2D {
  x: number
  y: number
}

export interface SnapSegment2D {
  readonly start: Point2D
  readonly end: Point2D
}

export interface SnapConfig {
  gridSize: number
  endpointSnap: number
  gridSnap: number
  orthogonalSnap: boolean
  angle45Snap: boolean
}

export type SnapType = 'none' | 'endpoint' | 'segment' | 'grid' | 'orthogonal' | '45deg'

export interface SnapResult {
  position: Point2D
  snapType: SnapType
  snapTarget?: Point2D
}

function distance(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function closestGridPoint(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  }
}

function closestPointOnSegment(point: Point2D, segment: SnapSegment2D): Point2D | null {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= Number.EPSILON) return null

  const projection = (
    (point.x - segment.start.x) * dx
    + (point.y - segment.start.y) * dy
  ) / lengthSquared
  const t = Math.max(0, Math.min(1, projection))
  return {
    x: segment.start.x + t * dx,
    y: segment.start.y + t * dy,
  }
}

function closestOrthogonalPoint(point: Point2D, lastPoint: Point2D): Point2D {
  const dx = Math.abs(point.x - lastPoint.x)
  const dy = Math.abs(point.y - lastPoint.y)

  if (dx < dy) {
    return { x: lastPoint.x, y: point.y }
  } else {
    return { x: point.x, y: lastPoint.y }
  }
}

function closest45DegreePoint(point: Point2D, lastPoint: Point2D): Point2D {
  const dx = point.x - lastPoint.x
  const dy = point.y - lastPoint.y

  const angle = Math.atan2(dy, dx)
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)

  const dist = Math.sqrt(dx * dx + dy * dy)

  return {
    x: lastPoint.x + Math.cos(snappedAngle) * dist,
    y: lastPoint.y + Math.sin(snappedAngle) * dist,
  }
}

export function snapPoint(
  point: Point2D,
  config: SnapConfig,
  existingPoints: Point2D[],
  lastPoint?: Point2D,
  existingSegments: readonly SnapSegment2D[] = [],
): SnapResult {
  let bestEndpoint: { point: Point2D; dist: number } | null = null
  for (const existing of existingPoints) {
    const d = distance(point, existing)
    if (d <= config.endpointSnap) {
      if (!bestEndpoint || d < bestEndpoint.dist) {
        bestEndpoint = { point: existing, dist: d }
      }
    }
  }
  if (bestEndpoint) {
    return { position: { ...bestEndpoint.point }, snapType: 'endpoint', snapTarget: bestEndpoint.point }
  }

  let bestSegment: { point: Point2D; dist: number } | null = null
  for (const segment of existingSegments) {
    const projected = closestPointOnSegment(point, segment)
    if (!projected) continue
    const d = distance(point, projected)
    if (d <= config.endpointSnap && (!bestSegment || d < bestSegment.dist)) {
      bestSegment = { point: projected, dist: d }
    }
  }
  if (bestSegment) {
    return {
      position: bestSegment.point,
      snapType: 'segment',
      snapTarget: bestSegment.point,
    }
  }

  const gridPt = closestGridPoint(point, config.gridSize)
  const gridDist = distance(point, gridPt)
  if (gridDist <= config.gridSnap) {
    return { position: gridPt, snapType: 'grid', snapTarget: gridPt }
  }

  if (config.orthogonalSnap && lastPoint) {
    const orthoPt = closestOrthogonalPoint(point, lastPoint)
    const orthoDist = distance(point, orthoPt)
    if (orthoDist > 0) {
      return { position: orthoPt, snapType: 'orthogonal', snapTarget: orthoPt }
    }
  }

  if (config.angle45Snap && lastPoint) {
    const pt45 = closest45DegreePoint(point, lastPoint)
    const dist45 = distance(point, pt45)
    if (dist45 > 0) {
      return { position: pt45, snapType: '45deg', snapTarget: pt45 }
    }
  }

  return { position: { ...point }, snapType: 'none' }
}
