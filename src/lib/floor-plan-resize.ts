import type { LatLng } from '@/types/nav-types'
import type { PlanAlignment } from '@navi/core'
import {
  getFootprintFrameMeters,
  inverseTransformLocalPoint,
  latLngToLocalMeters as pointToLocalMeters,
  transformLocalPoint,
} from './floor-plan-transform'

export interface LocalMeters {
  x: number
  y: number
}

export type FloorPlanResizeAlignment = PlanAlignment

export type PlanResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface PlanResizeOptions {
  aspectRatioLocked?: boolean
  minDimensionMeters?: number
  maxScale?: number
}

export type BBoxCorners = [LocalMeters, LocalMeters, LocalMeters, LocalMeters]

export const MIN_PLAN_SCALE = 0.1
export const MAX_PLAN_SCALE = 5
export const MIN_PLAN_DIMENSION_METERS = 0.5

/**
 * Convert a geographic point to the same building-local meter frame used by
 * planAlignment. X is east and Y is north. The frame uses the same
 * de-duplicated footprint center as computeFloorPlanCoords.
 */
export function lngLatToLocalMeters(point: LatLng, footprint: LatLng[]): LocalMeters {
  return pointToLocalMeters(point, getFootprintFrameMeters(footprint).center)
}

/**
 * Return the footprint bounding-box corners in local meters, ordered as
 * top-left, top-right, bottom-right, bottom-left.
 */
export function getFootprintBBoxLocalMeters(footprint: LatLng[]): BBoxCorners {
  return getFootprintFrameMeters(footprint).corners
}

/** Return a transformed plan corner in building-local meters. */
export function getPlanCornerLocalMeters(
  footprint: LatLng[],
  alignment: FloorPlanResizeAlignment,
  cornerIndex: number,
): LocalMeters {
  const corners = getFootprintBBoxLocalMeters(footprint)
  const index = ((cornerIndex % corners.length) + corners.length) % corners.length
  return transformLocalPoint(corners[index], alignment)
}

export interface PlanResizeBasePoints {
  moving: LocalMeters
  anchor: LocalMeters
}

/** Return the image-local moving point and fixed opposite edge/corner point. */
export function getPlanResizeBasePoints(
  footprint: readonly LatLng[],
  handle: PlanResizeHandle,
): PlanResizeBasePoints {
  const corners = getFootprintBBoxLocalMeters([...footprint])
  const center = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[3].y) / 2,
  }
  switch (handle) {
    case 'nw': return { moving: corners[0], anchor: corners[2] }
    case 'n': return { moving: { x: center.x, y: corners[0].y }, anchor: { x: center.x, y: corners[3].y } }
    case 'ne': return { moving: corners[1], anchor: corners[3] }
    case 'e': return { moving: { x: corners[1].x, y: center.y }, anchor: { x: corners[0].x, y: center.y } }
    case 'se': return { moving: corners[2], anchor: corners[0] }
    case 's': return { moving: { x: center.x, y: corners[3].y }, anchor: { x: center.x, y: corners[0].y } }
    case 'sw': return { moving: corners[3], anchor: corners[1] }
    case 'w': return { moving: { x: corners[0].x, y: center.y }, anchor: { x: corners[1].x, y: center.y } }
  }
}

function copyAlignment(alignment: FloorPlanResizeAlignment): FloorPlanResizeAlignment {
  return {
    ...alignment,
    ...(alignment.offset ? { offset: { x: alignment.offset.x, y: alignment.offset.y } } : {}),
  }
}

function clampPositive(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function anchorPreservingOffset(
  anchor: LocalMeters,
  startAlignment: FloorPlanResizeAlignment,
  scaleX: number,
  scaleY: number,
): LocalMeters {
  const anchorWorld = transformLocalPoint(anchor, startAlignment)
  const transformedWithoutOffset = transformLocalPoint(anchor, {
    scaleX,
    scaleY,
    rotation: startAlignment.rotation ?? 0,
    offset: { x: 0, y: 0 },
  })
  return {
    x: anchorWorld.x - transformedWithoutOffset.x,
    y: anchorWorld.y - transformedWithoutOffset.y,
  }
}

/**
 * Calculate a resize from an immutable gesture-start alignment. Pointer and
 * dimensions are building-local meters; the pointer is inverse-rotated into
 * image-local axes before either scale axis is solved. The returned object is
 * a fresh alignment and the input is never mutated.
 */
export function resizePlanFromHandle(
  footprint: readonly LatLng[],
  startAlignment: FloorPlanResizeAlignment,
  handle: PlanResizeHandle,
  pointerLocalMeters: LocalMeters,
  options: PlanResizeOptions = {},
): FloorPlanResizeAlignment {
  const frame = getFootprintFrameMeters(footprint)
  const start = copyAlignment(startAlignment)
  if (
    frame.width <= 0 || frame.height <= 0 ||
    !Number.isFinite(pointerLocalMeters.x) || !Number.isFinite(pointerLocalMeters.y)
  ) return start

  const resolved = startAlignment
  const scaleX = typeof resolved.scaleX === 'number' && Number.isFinite(resolved.scaleX) && resolved.scaleX > 0
    ? resolved.scaleX
    : typeof resolved.scale === 'number' && Number.isFinite(resolved.scale) && resolved.scale > 0 ? resolved.scale : 1
  const scaleY = typeof resolved.scaleY === 'number' && Number.isFinite(resolved.scaleY) && resolved.scaleY > 0
    ? resolved.scaleY
    : typeof resolved.scale === 'number' && Number.isFinite(resolved.scale) && resolved.scale > 0 ? resolved.scale : 1
  const rotation = typeof resolved.rotation === 'number' && Number.isFinite(resolved.rotation) ? resolved.rotation : 0
  const minimumDimension = Number.isFinite(options.minDimensionMeters) && (options.minDimensionMeters ?? 0) > 0
    ? options.minDimensionMeters!
    : MIN_PLAN_DIMENSION_METERS
  const maxScale = Number.isFinite(options.maxScale) && (options.maxScale ?? 0) > 0
    ? options.maxScale!
    : MAX_PLAN_SCALE
  const minimumScaleX = Math.max(minimumDimension / frame.width, Number.EPSILON)
  const minimumScaleY = Math.max(minimumDimension / frame.height, Number.EPSILON)
  const { moving, anchor } = getPlanResizeBasePoints(footprint, handle)
  const pointerImageLocal = inverseTransformLocalPoint(pointerLocalMeters, {
    scaleX: 1,
    scaleY: 1,
    rotation,
    offset: resolved.offset,
  })
  const anchorImageLocal = {
    x: anchor.x * scaleX,
    y: anchor.y * scaleY,
  }
  const delta = {
    x: pointerImageLocal.x - anchorImageLocal.x,
    y: pointerImageLocal.y - anchorImageLocal.y,
  }
  const baseDelta = {
    x: moving.x - anchor.x,
    y: moving.y - anchor.y,
  }

  let nextScaleX = scaleX
  let nextScaleY = scaleY
  if (handle === 'e' || handle === 'w') {
    nextScaleX = clampPositive(delta.x / baseDelta.x, minimumScaleX, maxScale)
  } else if (handle === 'n' || handle === 's') {
    nextScaleY = clampPositive(delta.y / baseDelta.y, minimumScaleY, maxScale)
  } else if (options.aspectRatioLocked !== false) {
    const displayedDiagonal = {
      x: baseDelta.x * scaleX,
      y: baseDelta.y * scaleY,
    }
    const diagonalLength = Math.hypot(displayedDiagonal.x, displayedDiagonal.y)
    const projectedDistance = diagonalLength > Number.EPSILON
      ? (delta.x * displayedDiagonal.x + delta.y * displayedDiagonal.y) / diagonalLength
      : 0
    const minimumFactor = Math.max(minimumScaleX / scaleX, minimumScaleY / scaleY)
    const maximumFactor = Math.min(maxScale / scaleX, maxScale / scaleY)
    const factor = clampPositive(projectedDistance / Math.max(diagonalLength, Number.EPSILON), minimumFactor, maximumFactor)
    nextScaleX = scaleX * factor
    nextScaleY = scaleY * factor
  } else {
    nextScaleX = clampPositive(delta.x / baseDelta.x, minimumScaleX, maxScale)
    nextScaleY = clampPositive(delta.y / baseDelta.y, minimumScaleY, maxScale)
  }

  return {
    ...start,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    offset: anchorPreservingOffset(anchor, startAlignment, nextScaleX, nextScaleY),
  }
}

function roundScale(scale: number): number {
  return Math.round(scale * 100) / 100
}

/**
 * Compute a uniform scale from a pointer in the local-meter frame while
 * keeping the opposite corner fixed. The pointer is projected onto the
 * moving-to-anchor diagonal so off-axis pointer jitter cannot skew the plan.
 */
export function resizePlanFromPointer(
  footprint: LatLng[],
  alignment: FloorPlanResizeAlignment,
  cornerIndex: number,
  pointerLocalMeters: LocalMeters,
): FloorPlanResizeAlignment {
  const corners = getFootprintBBoxLocalMeters(footprint)
  const index = ((cornerIndex % corners.length) + corners.length) % corners.length
  const oppositeIndex = (index + 2) % corners.length
  const rotation = alignment.rotation ?? 0
  const anchor = getPlanCornerLocalMeters(footprint, alignment, oppositeIndex)
  const baseMoving = transformLocalPoint(corners[index], { rotation })
  const baseAnchor = transformLocalPoint(corners[oppositeIndex], { rotation })
  const diagonal = Math.hypot(baseMoving.x - baseAnchor.x, baseMoving.y - baseAnchor.y)

  if (diagonal < Number.EPSILON) return { ...alignment }

  const axis = {
    x: (baseMoving.x - baseAnchor.x) / diagonal,
    y: (baseMoving.y - baseAnchor.y) / diagonal,
  }
  const pointerFromAnchor = {
    x: pointerLocalMeters.x - anchor.x,
    y: pointerLocalMeters.y - anchor.y,
  }
  const projectedDistance = pointerFromAnchor.x * axis.x + pointerFromAnchor.y * axis.y
  const rawScale = projectedDistance / diagonal
  const scale = roundScale(Math.min(MAX_PLAN_SCALE, Math.max(MIN_PLAN_SCALE, rawScale)))

  return {
    ...alignment,
    scale,
    // Solve the translation from the fixed anchor rather than accumulating
    // deltas. This keeps the dragged opposite corner invariant at any scale.
    offset: {
      x: anchor.x - baseAnchor.x * scale,
      y: anchor.y - baseAnchor.y * scale,
    },
  }
}
