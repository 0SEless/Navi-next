import type { PlanAlignment } from '@navi/core'
import {
  getPlanDimensionsMeters,
  resolvePlanAlignment,
  type FootprintFrameMeters,
} from './floor-plan-transform'
import {
  MAX_PLAN_SCALE,
  MIN_PLAN_DIMENSION_METERS,
} from './floor-plan-resize'

export type FloorPlanInspectorFrame = Pick<FootprintFrameMeters, 'width' | 'height'>

export interface FloorPlanInspectorValues {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
}

export type FloorPlanInspectorField = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'

export interface FloorPlanInspectorEdit {
  field: FloorPlanInspectorField
  /** X/Y/width/height/rotation use their displayed units; opacity uses 0..100. */
  value: number
  aspectRatioLocked: boolean
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function minimumScale(baseDimension: number): number {
  if (!(baseDimension > 0) || !finite(baseDimension)) return Number.NaN
  return Math.max(MIN_PLAN_DIMENSION_METERS / baseDimension, Number.EPSILON)
}

function scaleForDimension(requestedDimension: number, baseDimension: number): number | null {
  if (!finite(requestedDimension) || requestedDimension <= 0) return null
  if (!(baseDimension > 0) || !finite(baseDimension)) return null
  return clamp(requestedDimension / baseDimension, minimumScale(baseDimension), MAX_PLAN_SCALE)
}

function canonicalAlignment(alignment?: PlanAlignment | null): PlanAlignment {
  const resolved = resolvePlanAlignment(alignment)
  return {
    offset: { ...resolved.offset },
    scaleX: resolved.scaleX,
    scaleY: resolved.scaleY,
    rotation: resolved.rotation,
    opacity: resolved.opacity,
    locked: resolved.locked,
  }
}

/** Normalize legacy-compatible input into the canonical write shape. */
export function normalizePlanAlignmentForWrite(alignment?: PlanAlignment | null): PlanAlignment {
  return canonicalAlignment(alignment)
}

/** Derive administrator-facing values from the canonical alignment only. */
export function deriveFloorPlanInspectorValues(
  frame: FloorPlanInspectorFrame,
  alignment?: PlanAlignment | null,
): FloorPlanInspectorValues {
  const resolved = resolvePlanAlignment(alignment)
  const dimensions = getPlanDimensionsMeters(frame, resolved)
  return {
    x: resolved.offset.x,
    y: resolved.offset.y,
    width: dimensions.width,
    height: dimensions.height,
    rotation: resolved.rotation,
    opacity: resolved.opacity,
    locked: resolved.locked,
  }
}

/**
 * Apply one Inspector edit without mutating the input. Invalid placement and
 * dimension values return null so callers can leave the document untouched.
 */
export function updateAlignmentFromInspector(
  frame: FloorPlanInspectorFrame,
  alignment: PlanAlignment | null | undefined,
  edit: FloorPlanInspectorEdit,
): PlanAlignment | null {
  const next = canonicalAlignment(alignment)
  const value = edit.value

  if (!finite(value)) return null

  switch (edit.field) {
    case 'x':
      next.offset = { x: value, y: next.offset?.y ?? 0 }
      return next
    case 'y':
      next.offset = { x: next.offset?.x ?? 0, y: value }
      return next
    case 'rotation':
      next.rotation = resolvePlanAlignment({ rotation: value }).rotation
      return next
    case 'opacity':
      next.opacity = clamp(value / 100, 0, 1)
      return next
    case 'width':
    case 'height': {
      const current = getPlanDimensionsMeters(frame, next)
      const requestedScale = scaleForDimension(value, edit.field === 'width' ? frame.width : frame.height)
      if (requestedScale == null) return null

      if (edit.aspectRatioLocked) {
        const currentDimension = edit.field === 'width' ? current.width : current.height
        if (!(currentDimension > 0) || !finite(currentDimension)) return null
        const factor = requestedScale / (edit.field === 'width' ? next.scaleX ?? 1 : next.scaleY ?? 1)
        const boundedFactor = clamp(
          factor,
          Math.max(minimumScale(frame.width) / next.scaleX!, minimumScale(frame.height) / next.scaleY!),
          Math.min(MAX_PLAN_SCALE / next.scaleX!, MAX_PLAN_SCALE / next.scaleY!),
        )
        next.scaleX = next.scaleX! * boundedFactor
        next.scaleY = next.scaleY! * boundedFactor
      } else if (edit.field === 'width') {
        next.scaleX = requestedScale
      } else {
        next.scaleY = requestedScale
      }
      return next
    }
  }
}

/** Deterministic Phase 3 fit/reset; visual-only fields are preserved. */
export function resetFloorPlanAlignment(alignment?: PlanAlignment | null): PlanAlignment {
  const resolved = resolvePlanAlignment(alignment)
  return {
    offset: { x: 0, y: 0 },
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: resolved.opacity,
    locked: resolved.locked,
  }
}
