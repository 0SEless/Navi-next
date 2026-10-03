/**
 * P2-T1: Pure Canvas-2D viewport for the floor editor.
 *
 * Operates in building-local meters. No MapLibre, no LatLng.
 * Pan/zoom/rotate via canvas 2D transforms.
 *
 * Coordinate system:
 *   x = east (meters), y = north (meters)
 *   Screen: x = right, y = down (standard canvas)
 *
 * Transform chain:
 *   1. Translate to canvas center
 *   2. Scale by zoom (Y inverted for screen coords)
 *   3. Rotate (clockwise = negative angle in canvas)
 *   4. Pan offset (camera center → world origin)
 */

// ── Types ──

export interface Point2D {
  readonly x: number
  readonly y: number
}

export interface CanvasSize {
  readonly width: number
  readonly height: number
}

export interface CameraState {
  /** Camera center in building-local meters. */
  readonly center: Point2D
  /** Zoom level: 1 = 1 meter per pixel, 2 = 0.5 m/px, etc. */
  readonly zoom: number
  /** Rotation in degrees clockwise. */
  readonly rotation: number
}

export interface CameraOverrides {
  center?: Point2D
  zoom?: number
  rotation?: number
}

// ── Constants ──

const MIN_ZOOM = 0.1
const MAX_ZOOM = 50
const DEG2RAD = Math.PI / 180

// ── CameraState factory ──

/** Normalize rotation to [0, 360). */
function normalizeRotation(deg: number): number {
  const r = deg % 360
  return r < 0 ? r + 360 : r
}

/** Clamp zoom to [MIN_ZOOM, MAX_ZOOM]. */
function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

/** Create a frozen CameraState with defaults and clamping. */
export function createCamera(overrides?: CameraOverrides): CameraState {
  const cam = {
    center: overrides?.center ?? { x: 0, y: 0 },
    zoom: clampZoom(overrides?.zoom ?? 1),
    rotation: normalizeRotation(overrides?.rotation ?? 0),
  }
  return Object.freeze(cam)
}

// ── Coordinate conversion ──

/**
 * Convert a building-local point to screen pixel coordinates.
 *
 * Screen origin is top-left; Y increases downward.
 * Building-local Y increases northward (up).
 */
export function worldToScreen(
  world: Point2D,
  camera: CameraState,
  canvas: CanvasSize,
): Point2D {
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const rad = -camera.rotation * DEG2RAD // clockwise → negative

  // Relative to camera center
  const dx = world.x - camera.center.x
  const dy = world.y - camera.center.y

  // Rotate
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad)

  // Scale + screen Y inversion
  return {
    x: cx + rx * camera.zoom,
    y: cy - ry * camera.zoom, // Y inverted: north → up on screen
  }
}

/**
 * Convert screen pixel coordinates to a building-local point.
 * Inverse of worldToScreen.
 */
export function screenToWorld(
  screen: Point2D,
  camera: CameraState,
  canvas: CanvasSize,
): Point2D {
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const rad = -camera.rotation * DEG2RAD

  // Remove screen offset and zoom
  const rx = (screen.x - cx) / camera.zoom
  const ry = -(screen.y - cy) / camera.zoom // Y un-inverted

  // Inverse rotate (transpose of rotation matrix = negative angle)
  const cos = Math.cos(-rad)
  const sin = Math.sin(-rad)
  const dx = rx * cos - ry * sin
  const dy = rx * sin + ry * cos

  return {
    x: dx + camera.center.x,
    y: dy + camera.center.y,
  }
}

// ── Canvas 2D transform ──

/**
 * Apply camera transform to a Canvas 2D rendering context.
 *
 * After calling this, drawing at building-local (0,0) appears at canvas center.
 * Drawing at (100, 0) appears 100 * zoom pixels to the right of center.
 *
 * Usage:
 *   ctx.save()
 *   applyCamera(ctx, camera, { width: ctx.canvas.width, height: ctx.canvas.height })
 *   // ... draw building-local geometry ...
 *   ctx.restore()
 */
export function applyCamera(
  ctx: CanvasRenderingContext2D,
  camera: CameraState,
  canvas: CanvasSize,
): void {
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const rad = -camera.rotation * DEG2RAD

  ctx.translate(cx, cy)
  ctx.rotate(rad)
  ctx.scale(camera.zoom, -camera.zoom) // Y inverted: north → up
  ctx.translate(-camera.center.x, -camera.center.y)
}

/**
 * Reset the canvas transform to identity (screen coordinates).
 */
export function resetCamera(ctx: CanvasRenderingContext2D): void {
  ctx.resetTransform()
}

// ── Floor plan rendering ──

export interface AlignmentParams {
  /** Dimensionless linear multiplier of the bbox fit (default 1). */
  scale?: number
  /** Degrees clockwise (default 0). */
  rotation?: number
  /** Translation in building-local meters (default {0,0}). */
  offset?: Point2D
  /** Render opacity 0–1 (default 1). */
  opacity?: number
}

/**
 * Compute the bounding box of a footprint in building-local meters.
 * Returns { min, max } for each axis, or null for empty footprint.
 */
function footprintBbox(
  footprint: Point2D[],
): { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number } | null {
  if (footprint.length === 0) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of footprint) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

/**
 * Draw a floor plan image on the canvas using the alignment params.
 *
 * The image is positioned at the footprint's bounding box, transformed by
 * alignment (rotation → scale → offset), and drawn using canvas affine
 * transforms. The canvas context MUST already have the camera transform
 * applied (via applyCamera).
 *
 * Transform chain (matches computeFloorPlanCoords semantics):
 *   1. Translate to footprint centroid
 *   2. Rotate by alignment.rotation (degrees clockwise)
 *   3. Scale by alignment.scale (dimensionless multiplier of bbox extent)
 *   4. Translate by alignment.offset (building-local meters)
 *   5. Draw image centered on the transformed position
 */
export function drawFloorPlanImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  footprint: Point2D[],
  alignment: AlignmentParams,
  _camera: CameraState,
  _canvas: CanvasSize,
): void {
  const bbox = footprintBbox(footprint)
  if (!bbox) return

  const scale = alignment.scale ?? 1
  const rotation = alignment.rotation ?? 0
  const ox = alignment.offset?.x ?? 0
  const oy = alignment.offset?.y ?? 0

  // Bbox extent in building-local meters
  const extentX = (bbox.maxX - bbox.minX) * scale
  const extentY = (bbox.maxY - bbox.minY) * scale

  // Apply opacity
  if (alignment.opacity !== undefined && alignment.opacity < 1) {
    ctx.globalAlpha = alignment.opacity
  }

  // Transform: translate to centroid → rotate → scale → offset → draw centered
  ctx.save()
  ctx.translate(bbox.cx + ox, bbox.cy + oy)
  ctx.rotate((-rotation * Math.PI) / 180) // clockwise → negative canvas angle
  ctx.drawImage(image, -extentX / 2, -extentY / 2, extentX, extentY)
  ctx.restore()

  // Reset opacity
  if (alignment.opacity !== undefined && alignment.opacity < 1) {
    ctx.globalAlpha = 1
  }
}
