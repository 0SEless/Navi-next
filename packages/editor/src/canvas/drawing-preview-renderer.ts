/**
 * P2A.1: Drawing preview renderer for the Canvas editor.
 *
 * Pure Canvas-2D rendering functions for drawing-in-progress visuals:
 * - Dashed trace line from first point through all placed points
 * - Rubber band cursor line from last placed point to mouse position
 * - Polygon preview (semi-transparent fill + dashed outline)
 * - Circle vertex markers at each placed vertex
 *
 * All coordinates are building-local meters. The canvas context MUST
 * already have the camera transform applied (via applyCamera).
 */

import type { LocalCoord } from '@navi/core'

// ── Types ──

export interface DrawingStyle {
  strokeColor: string
  fillColor: string
  lineWidth: number
  vertexRadius: number
}

const DEFAULT_STYLE: DrawingStyle = {
  strokeColor: '#F59E0B',
  fillColor: 'rgba(16, 185, 129, 0.15)',
  lineWidth: 2.5,
  vertexRadius: 4,
}

// ── Renderers ──

/**
 * Render dashed trace line connecting placed points.
 * Draws an open polyline (no closePath) with dashed stroke.
 */
export function renderDrawingTrace(
  ctx: CanvasRenderingContext2D,
  points: LocalCoord[],
  style: Partial<DrawingStyle> = {},
): void {
  if (points.length < 2) return
  const s = { ...DEFAULT_STYLE, ...style }

  ctx.save()
  ctx.strokeStyle = s.strokeColor
  ctx.lineWidth = s.lineWidth
  ctx.setLineDash([6, 4])
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * Render rubber band line from last placed point to the current cursor.
 * Solid line, slightly thinner than the trace.
 */
export function renderDrawingCursor(
  ctx: CanvasRenderingContext2D,
  lastPoint: LocalCoord,
  cursorPoint: LocalCoord,
  style: Partial<DrawingStyle> = {},
): void {
  const s = { ...DEFAULT_STYLE, ...style }

  ctx.save()
  ctx.strokeStyle = s.strokeColor
  ctx.lineWidth = s.lineWidth * 0.75
  ctx.globalAlpha = 0.6
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.moveTo(lastPoint.x, lastPoint.y)
  ctx.lineTo(cursorPoint.x, cursorPoint.y)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

/**
 * Render polygon preview for rooms.
 * Draws a semi-transparent filled polygon with dashed outline.
 */
export function renderDrawingPolygon(
  ctx: CanvasRenderingContext2D,
  points: LocalCoord[],
  style: Partial<DrawingStyle> = {},
): void {
  if (points.length < 3) return
  const s = { ...DEFAULT_STYLE, ...style }

  ctx.save()

  // Fill
  ctx.fillStyle = s.fillColor
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.closePath()
  ctx.fill()

  // Dashed outline
  ctx.strokeStyle = s.strokeColor
  ctx.lineWidth = s.lineWidth
  ctx.setLineDash([6, 4])
  ctx.stroke()
  ctx.setLineDash([])

  ctx.restore()
}

/**
 * Render circle markers at each placed vertex.
 */
export function renderDrawingVertices(
  ctx: CanvasRenderingContext2D,
  points: LocalCoord[],
  style: Partial<DrawingStyle> = {},
): void {
  if (points.length === 0) return
  const s = { ...DEFAULT_STYLE, ...style }

  ctx.save()

  for (const pt of points) {
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, s.vertexRadius, 0, Math.PI * 2)
    ctx.fillStyle = s.strokeColor
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Render all drawing preview layers for the current state.
 * Convenience function: trace → cursor → polygon → vertices.
 */
export function renderDrawingPreview(
  ctx: CanvasRenderingContext2D,
  placedPoints: LocalCoord[],
  cursorPoint: LocalCoord | null,
  style: Partial<DrawingStyle> = {},
): void {
  if (placedPoints.length > 0) {
    renderDrawingTrace(ctx, placedPoints, style)

    // Rubber band from last point to cursor
    if (cursorPoint && placedPoints.length > 0) {
      const last = placedPoints[placedPoints.length - 1]
      renderDrawingCursor(ctx, last, cursorPoint, style)
    }

    // Polygon preview when 3+ points placed
    if (placedPoints.length >= 3) {
      renderDrawingPolygon(ctx, placedPoints, style)
    }

    // Vertex markers
    renderDrawingVertices(ctx, placedPoints, style)
  }
}
