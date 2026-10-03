import type { LatLng, LocalCoord, PlanAlignment } from '@navi/core'
import {
  getFootprintFrameMeters,
  inverseTransformLocalPoint,
  latLngToLocalMeters,
  transformLocalPoint,
} from './floor-plan-transform'

export type Point2D = [number, number]

export interface CalibrationError {
  code: string
  message: string
}

export interface CalibrationImageSize {
  width: number
  height: number
}

export interface CalibrationFrame {
  width: number
  height: number
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function angleDeg(v: Point2D): number {
  return (Math.atan2(v[1], v[0]) * 180) / Math.PI
}

function normalizeDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function pointInPolygon(px: number, py: number, polygon: Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * ((py - yi) / (yj - yi)) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function validatePlanPoints(
  a: Point2D,
  b: Point2D,
  imageWidth: number,
  imageHeight: number,
): CalibrationError | null {
  if (distance(a, b) < 1) {
    return { code: 'IDENTICAL_PLAN_POINTS', message: 'Plan points must be at least 1 pixel apart.' }
  }
  if (a[0] < 0 || a[0] > imageWidth || a[1] < 0 || a[1] > imageHeight) {
    return { code: 'PLAN_POINT_A_OUT_OF_BOUNDS', message: 'Plan point A is outside the image bounds.' }
  }
  if (b[0] < 0 || b[0] > imageWidth || b[1] < 0 || b[1] > imageHeight) {
    return { code: 'PLAN_POINT_B_OUT_OF_BOUNDS', message: 'Plan point B is outside the image bounds.' }
  }
  return null
}

/** Validate local-meter map points against the local-meter footprint polygon. */
export function validateMapPoints(
  a: Point2D,
  b: Point2D,
  buildingFootprint: Point2D[],
): CalibrationError | null {
  if (distance(a, b) < 1) {
    return { code: 'IDENTICAL_MAP_POINTS', message: 'Map points must be at least 1 meter apart.' }
  }
  if (buildingFootprint.length >= 3) {
    if (!pointInPolygon(a[0], a[1], buildingFootprint)) {
      return { code: 'MAP_POINT_A_OUT_OF_BOUNDS', message: 'Map point A is outside the building footprint.' }
    }
    if (!pointInPolygon(b[0], b[1], buildingFootprint)) {
      return { code: 'MAP_POINT_B_OUT_OF_BOUNDS', message: 'Map point B is outside the building footprint.' }
    }
  }
  return null
}

function assertCalibrationFrame(imageSize: CalibrationImageSize, frame: CalibrationFrame): void {
  if (!Number.isFinite(imageSize.width) || !Number.isFinite(imageSize.height) || imageSize.width <= 0 || imageSize.height <= 0) {
    throw new Error('Image dimensions are required for calibration.')
  }
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) {
    throw new Error('A non-zero footprint frame is required for calibration.')
  }
}

/** Convert a source image pixel (origin top-left, y downward) into frame-local meters. */
export function imagePixelToFrameLocal(
  pixel: Point2D,
  imageSize: CalibrationImageSize,
  frame: CalibrationFrame,
): LocalCoord {
  return {
    x: (pixel[0] / imageSize.width - 0.5) * frame.width,
    y: (0.5 - pixel[1] / imageSize.height) * frame.height,
  }
}

/** Convert an untransformed frame-local meter point back to a source image pixel. */
export function frameLocalToImagePixel(
  point: LocalCoord,
  imageSize: CalibrationImageSize,
  frame: CalibrationFrame,
): Point2D {
  return [
    (point.x / frame.width + 0.5) * imageSize.width,
    (0.5 - point.y / frame.height) * imageSize.height,
  ]
}

/**
 * Compute the canonical alignment from two source-image/map-local pairs.
 * A two-point constraint determines one uniform physical multiplier, so the
 * result writes that multiplier to both image-local axes.
 */
export function computeTwoPointAlignment(
  planPoints: [Point2D, Point2D],
  mapPoints: [Point2D, Point2D],
  imageSize: CalibrationImageSize,
  frame: CalibrationFrame,
): PlanAlignment {
  assertCalibrationFrame(imageSize, frame)
  const [planA, planB] = planPoints
  const [mapA, mapB] = mapPoints
  const sourceA = imagePixelToFrameLocal(planA, imageSize, frame)
  const sourceB = imagePixelToFrameLocal(planB, imageSize, frame)
  const sourceVector: Point2D = [sourceB.x - sourceA.x, sourceB.y - sourceA.y]
  const mapVector: Point2D = [mapB[0] - mapA[0], mapB[1] - mapA[1]]
  const sourceDist = distance([0, 0], sourceVector)
  const mapDist = distance([0, 0], mapVector)

  if (sourceDist < Number.EPSILON) throw new Error('Plan points are too close together.')
  if (mapDist < Number.EPSILON) throw new Error('Map points are too close together.')

  const scale = mapDist / sourceDist
  // Positive canonical rotation is clockwise. In east/north coordinates that
  // subtracts from the usual atan2 angle, hence sourceAngle - mapAngle.
  const rotation = normalizeDegrees(angleDeg(sourceVector) - angleDeg(mapVector))
  const withoutOffset = { scaleX: scale, scaleY: scale, rotation }
  const transformedA = transformLocalPoint(sourceA, withoutOffset)
  const offset = {
    x: mapA[0] - transformedA.x,
    y: mapA[1] - transformedA.y,
  }

  return {
    scaleX: Math.round(scale * 1_000_000) / 1_000_000,
    scaleY: Math.round(scale * 1_000_000) / 1_000_000,
    rotation: Math.round(rotation * 10_000) / 10_000,
    offset: {
      x: Math.round(offset.x * 1_000_000) / 1_000_000,
      y: Math.round(offset.y * 1_000_000) / 1_000_000,
    },
  }
}

interface UnprojectableMap {
  unproject: (point: [number, number]) => { lng: number; lat: number }
}

/**
 * Convert a screen click to source-image pixels through the active renderer
 * transform. This path does not assume an axis-aligned or unrotated image.
 */
export function screenToImagePixel(
  screenX: number,
  screenY: number,
  map: UnprojectableMap,
  canvasRect: Pick<DOMRect, 'left' | 'top'>,
  footprint: readonly LatLng[],
  imageWidth: number,
  imageHeight: number,
  alignment?: PlanAlignment | null,
): Point2D {
  const frame = getFootprintFrameMeters(footprint)
  if (frame.width <= 0 || frame.height <= 0) return [Number.NaN, Number.NaN]
  const geographic = map.unproject([screenX - canvasRect.left, screenY - canvasRect.top])
  const transformedLocal = latLngToLocalMeters(geographic, frame.center)
  const sourceLocal = inverseTransformLocalPoint(transformedLocal, alignment)
  return frameLocalToImagePixel(sourceLocal, { width: imageWidth, height: imageHeight }, frame)
}

/** Convert a screen position into true building-local meters. */
export function screenToBuildingLocal(
  screenX: number,
  screenY: number,
  map: UnprojectableMap,
  canvasRect: Pick<DOMRect, 'left' | 'top'>,
  centroid: Point2D,
  footprint?: readonly LatLng[],
): Point2D {
  const point = map.unproject([screenX - canvasRect.left, screenY - canvasRect.top])
  const center = footprint && footprint.length > 0
    ? getFootprintFrameMeters(footprint).center
    : { lng: centroid[0], lat: centroid[1] }
  const local = latLngToLocalMeters(point, center)
  return [local.x, local.y]
}
