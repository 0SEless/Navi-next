/**
 * RenderManager: orchestrates all renderers for the Canvas viewport.
 *
 * Renders layers in correct z-order:
 *   1. Reference image (bottom)
 *   2. 2D/2.5D floor geometry
 *   3. Route overlay
 *   4. Selection/hover overlay
 *   5. Editing handles (top)
 *
 * Supports mode switching between '2d' and '2.5d'.
 */

import type { FloorGeometryFloor } from '@navi/core'
import type { CameraState, CanvasSize } from '../canvas/viewport'
import { applyCamera, resetCamera, drawFloorPlanImage } from '../canvas/viewport'
import {
  renderFloor,
  renderInteractionOverlays,
  renderEditingHandles,
  type FloorRenderContext,
  type HandleState,
} from '../canvas/floor-renderer'

// ── Types ──

export type RenderMode = '2d' | '2.5d'

export interface SelectionLike {
  type: string
  id: string
  name: string
}

export interface RouteOverlay {
  /** Route path as coordinate pairs (building-local meters). */
  path: Array<{ x: number; y: number }>
  /** Stroke color for the route line. */
  color?: string
  /** Line width in pixels. */
  width?: number
}

export interface RenderState {
  /** Floor geometry to render. Null = empty canvas. */
  floor: FloorGeometryFloor | null
  /** Render style override. */
  style?: FloorRenderContext
  /** Current selection (room, hallway, etc.). */
  selection?: SelectionLike | null
  /** Current hover target. */
  hover?: SelectionLike | null
  /** Editing handle state (vertices/midpoints). */
  handleState?: HandleState | null
  /** Vertices for editing handles (building-local meters). */
  handleVertices?: Array<{ x: number; y: number; id?: string }>
  /** Route overlay to render on top of floor geometry. */
  route?: RouteOverlay | null
  /** Reference image for background rendering. */
  referenceImage?: CanvasImageSource | null
  /** Footprint polygon for the reference image alignment. */
  footprint?: Array<{ x: number; y: number }>
  /** Alignment params for the reference image. */
  imageAlignment?: {
    scale?: number
    rotation?: number
    offset?: { x: number; y: number }
    opacity?: number
  }
  /** 2.5D extrusion height multiplier (only used in 2.5d mode). */
  extrusionHeight?: number
}

export interface RenderManagerOptions {
  /** Initial render mode. Defaults to '2d'. */
  mode?: RenderMode
}

// ── Layer IDs (for z-order tracking) ──

export const enum LayerZ {
  REFERENCE_IMAGE = 0,
  FLOOR_GEOMETRY = 1,
  ROUTE_OVERLAY = 2,
  SELECTION_OVERLAY = 3,
  EDITING_HANDLES = 4,
}

// ── RenderManager ──

export class RenderManager {
  private mode: RenderMode

  constructor(options?: RenderManagerOptions) {
    this.mode = options?.mode ?? '2d'
  }

  /** Get the current render mode. */
  getMode(): RenderMode {
    return this.mode
  }

  /** Switch between 2D and 2.5D rendering modes. */
  setMode(mode: RenderMode): void {
    this.mode = mode
  }

  /**
   * Render all layers in correct z-order.
   *
   * @param ctx - Canvas 2D rendering context (camera transform should be applied by caller)
   * @param state - Current render state
   * @param camera - Camera state for coordinate transforms
   * @param canvas - Canvas dimensions
   */
  render(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    camera: CameraState,
    canvas: CanvasSize,
  ): void {
    // Layer 0: Reference image (bottom)
    this.renderReferenceImage(ctx, state, camera, canvas)

    // Layer 1: Floor geometry (2D or 2.5D based on mode)
    this.renderFloorGeometry(ctx, state)

    // Layer 2: Route overlay
    this.renderRouteOverlay(ctx, state)

    // Layer 3: Selection/hover overlay
    this.renderSelectionOverlay(ctx, state)

    // Layer 4: Editing handles (top)
    this.renderEditingHandles(ctx, state)
  }

  /** Render the reference image layer (bottom-most). */
  private renderReferenceImage(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
    camera: CameraState,
    canvas: CanvasSize,
  ): void {
    if (!state.referenceImage || !state.footprint || state.footprint.length < 3) return

    ctx.save()
    applyCamera(ctx, camera, canvas)

    drawFloorPlanImage(
      ctx,
      state.referenceImage!,
      state.footprint!,
      state.imageAlignment ?? {},
      camera,
      canvas,
    )

    resetCamera(ctx)
    ctx.restore()
  }

  /** Render floor geometry in 2D or 2.5D mode. */
  private renderFloorGeometry(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
  ): void {
    const floor = state.floor
    if (!floor) return

    const style: FloorRenderContext = state.style ?? {
      strokeStyle: '#333',
      fillStyle: 'rgba(200,200,255,0.3)',
      lineWidth: 1,
    }

    if (this.mode === '2d') {
      renderFloor(ctx, floor, style)
    } else {
      this.renderFloor25D(ctx, floor, style, state.extrusionHeight ?? 4)
    }
  }

  /**
   * Render floor geometry with 2.5D perspective extrusion.
   * Applies oblique projection to simulate depth with extruded faces.
   */
  private renderFloor25D(
    ctx: CanvasRenderingContext2D,
    floor: FloorGeometryFloor,
    style: FloorRenderContext,
    extrusionHeight: number,
  ): void {
    ctx.save()

    // Apply 2.5D transform: shear + vertical offset
    const shearX = 0.5
    const shearY = -0.3

    ctx.save()
    ctx.transform(1, shearY, shearX, 1, 0, 0)

    // Render rooms with extrusion effect
    for (const room of floor.rooms) {
      const pts = room.polygon.points
      if (pts.length < 3) continue

      ctx.fillStyle = 'rgba(100, 150, 200, 0.3)'
      ctx.strokeStyle = style.strokeStyle
      ctx.lineWidth = style.lineWidth

      // Draw front face
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Draw extruded top face
      ctx.fillStyle = 'rgba(150, 200, 255, 0.4)'
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y - extrusionHeight)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y - extrusionHeight)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Draw connecting side faces
      ctx.fillStyle = 'rgba(120, 170, 220, 0.35)'
      for (let i = 0; i < pts.length; i++) {
        const next = (i + 1) % pts.length
        ctx.beginPath()
        ctx.moveTo(pts[i].x, pts[i].y)
        ctx.lineTo(pts[next].x, pts[next].y)
        ctx.lineTo(pts[next].x, pts[next].y - extrusionHeight)
        ctx.lineTo(pts[i].x, pts[i].y - extrusionHeight)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }

      // Draw room number at centroid (on top face)
      const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length
      const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length
      ctx.fillStyle = style.strokeStyle
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(room.number, cx, cy - extrusionHeight)
    }

    // Render hallways with extrusion
    ctx.strokeStyle = style.strokeStyle
    ctx.lineWidth = style.lineWidth * 0.75
    for (const hw of floor.hallways) {
      const pts = hw.polyline.points
      if (pts.length < 2) continue

      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y - extrusionHeight)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y - extrusionHeight)
      }
      ctx.stroke()
    }

    ctx.restore()
    ctx.restore()
  }

  /** Render route overlay. */
  private renderRouteOverlay(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
  ): void {
    if (!state.route || state.route.path.length < 2) return

    ctx.save()
    ctx.strokeStyle = state.route.color ?? '#3B82F6'
    ctx.lineWidth = state.route.width ?? 3
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    ctx.beginPath()
    ctx.moveTo(state.route.path[0].x, state.route.path[0].y)
    for (let i = 1; i < state.route.path.length; i++) {
      ctx.lineTo(state.route.path[i].x, state.route.path[i].y)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** Render selection and hover overlays. */
  private renderSelectionOverlay(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
  ): void {
    const floor = state.floor
    if (!floor) return

    const selection = state.selection ?? null
    const hover = state.hover ?? null

    renderInteractionOverlays(ctx, selection, hover, floor)
  }

  /** Render editing handles (vertices + midpoints). */
  private renderEditingHandles(
    ctx: CanvasRenderingContext2D,
    state: RenderState,
  ): void {
    const hs = state.handleState
    const verts = state.handleVertices

    if (hs && verts && verts.length > 0) {
      renderEditingHandles(ctx, verts, hs)
    }
  }
}
