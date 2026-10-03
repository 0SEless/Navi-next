/**
 * P2-T2: Floor geometry renderer for the Canvas editor.
 *
 * Renders FloorGeometryFloor data (rooms, hallways, stairs, elevators)
 * in building-local meters. The canvas context MUST already have the
 * camera transform applied (via applyCamera from viewport.ts).
 *
 * Rendering order: rooms → hallways → stairs/elevators (top layer).
 */

import type {
  FloorGeometryFloor,
  FloorGeometryFeature,
} from '@navi/core'

// ── Types ──

export interface FloorRenderContext {
  /** Stroke color for outlines (rooms, hallways, features). */
  strokeStyle: string
  /** Fill color for room polygons and feature shapes. */
  fillStyle: string
  /** Line width in pixels. */
  lineWidth: number
}

interface Point {
  x: number
  y: number
}

// ── Helpers ──

function drawPolygonPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.closePath()
}

function drawPolylinePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
}

function centroid(points: Point[]): Point {
  let cx = 0, cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / points.length, y: cy / points.length }
}

/**
 * Draw a circle marker at a position (for position-only entity overlays).
 */
function drawPositionMarker(ctx: CanvasRenderingContext2D, position: Point): void {
  ctx.beginPath()
  ctx.arc(position.x, position.y, 1.5, 0, Math.PI * 2)
}

/**
 * Generate highlight polygon points around a door position.
 * Small rectangle aligned with axes, sized by door width.
 */
function doorHighlightPoints(
  door: { position: { x: number; y: number }; width: number },
): Point[] {
  const hw = (door.width || 1.2) / 2
  const hh = 0.6
  return [
    { x: door.position.x - hw, y: door.position.y - hh },
    { x: door.position.x + hw, y: door.position.y - hh },
    { x: door.position.x + hw, y: door.position.y + hh },
    { x: door.position.x - hw, y: door.position.y + hh },
  ]
}

// ── Renderers ──

/**
 * Draw room polygons as outlined shapes with room number labels.
 * Rooms use the "thin-boundaries" visual language (D6): outlined polygons,
 * no heavy fill.
 */
export function renderRooms(
  ctx: CanvasRenderingContext2D,
  rooms: Array<{ id: string; name: string; number: string; polygon: { points: Point[] } }>,
  style: FloorRenderContext,
): void {
  if (rooms.length === 0) return

  ctx.save()
  ctx.strokeStyle = style.strokeStyle
  ctx.fillStyle = style.fillStyle
  ctx.lineWidth = style.lineWidth

  for (const room of rooms) {
    const pts = room.polygon.points
    drawPolygonPath(ctx, pts)
    ctx.fill()
    ctx.stroke()

    // Draw room number at centroid
    const c = centroid(pts)
    ctx.fillStyle = style.strokeStyle
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(room.number, c.x, c.y)
    ctx.fillStyle = style.fillStyle
  }

  ctx.restore()
}

/**
 * Draw hallway centerlines as stroked polylines.
 * Distinct visual style: dashed or thinner stroke.
 */
export function renderHallways(
  ctx: CanvasRenderingContext2D,
  hallways: Array<{ id: string; name: string; polyline: { points: Point[] } }>,
  style: FloorRenderContext,
): void {
  if (hallways.length === 0) return

  ctx.save()
  ctx.strokeStyle = style.strokeStyle
  ctx.lineWidth = style.lineWidth * 0.75

  for (const hw of hallways) {
    drawPolylinePath(ctx, hw.polyline.points)
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Draw staircases and elevators.
 * - Features with polygon: drawn as filled + outlined shapes.
 * - Position-only features: drawn as circle markers with label.
 */
export function renderStairsElevators(
  ctx: CanvasRenderingContext2D,
  staircases: FloorGeometryFeature[],
  elevators: FloorGeometryFeature[],
  style: FloorRenderContext,
): void {
  const all = [
    ...staircases.map(s => ({ ...s, layer: 'stair' })),
    ...elevators.map(e => ({ ...e, layer: 'elevator' })),
  ]

  if (all.length === 0) return

  ctx.save()

  for (const feature of all) {
    if (feature.polygon && feature.polygon.points.length >= 3) {
      // Draw as filled polygon
      ctx.fillStyle = feature.layer === 'stair'
        ? 'rgba(180, 160, 120, 0.5)'
        : 'rgba(120, 180, 120, 0.5)'
      ctx.strokeStyle = style.strokeStyle
      ctx.lineWidth = style.lineWidth

      drawPolygonPath(ctx, feature.polygon.points)
      ctx.fill()
      ctx.stroke()
    } else {
      // Draw as position marker circle
      ctx.fillStyle = feature.layer === 'stair'
        ? 'rgba(180, 160, 120, 0.8)'
        : 'rgba(120, 180, 120, 0.8)'
      ctx.strokeStyle = style.strokeStyle
      ctx.lineWidth = style.lineWidth

      ctx.beginPath()
      ctx.arc(feature.position.x, feature.position.y, 1.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Label
    ctx.fillStyle = style.strokeStyle
    ctx.font = '8px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(feature.name, feature.position.x, feature.position.y + 2)
  }

  ctx.restore()
}

/**
 * Render a complete floor: rooms → hallways → stairs/elevators.
 * This is the main entry point for floor geometry rendering.
 */
export function renderFloor(
  ctx: CanvasRenderingContext2D,
  floor: FloorGeometryFloor,
  style: FloorRenderContext,
): void {
  renderRooms(ctx, floor.rooms, style)
  renderHallways(ctx, floor.hallways, style)
  renderStairsElevators(ctx, floor.staircases, floor.elevators, style)
}

// ── Interaction overlays ──

interface SelectionLike {
  type: string
  id: string
  name: string
}

/**
 * Find a room polygon by ID. Returns the points array or null.
 */
function findRoomPoints(
  floor: FloorGeometryFloor,
  id: string,
): Point[] | null {
  const room = floor.rooms.find(r => r.id === id)
  return room?.polygon.points ?? null
}

/**
 * Render a selection highlight overlay for the selected entity.
 * Draws a thick, semi-transparent outline on the selected geometry.
 * Supports all entity types: rooms, hallways, stairs, elevators, doors, POIs, QR checkpoints.
 */
export function renderSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  selection: SelectionLike | null,
  floor: FloorGeometryFloor,
): void {
  if (!selection) return

  // Check if entity exists before drawing
  let hasEntity = false
  switch (selection.type) {
    case 'room':
      hasEntity = floor.rooms.some(r => r.id === selection.id)
      break
    case 'hallway':
      hasEntity = floor.hallways.some(h => h.id === selection.id)
      break
    case 'staircase':
      hasEntity = floor.staircases.some(s => s.id === selection.id)
      break
    case 'elevator':
      hasEntity = floor.elevators.some(e => e.id === selection.id)
      break
    case 'door':
      hasEntity = floor.doors.some(d => d.id === selection.id)
      break
    case 'poi':
      hasEntity = floor.pois.some(p => p.id === selection.id)
      break
    case 'qrCheckpoint':
      hasEntity = floor.qrCheckpoints.some(q => q.id === selection.id)
      break
  }
  if (!hasEntity) return

  ctx.save()
  ctx.strokeStyle = 'rgba(0, 120, 255, 0.9)'
  ctx.lineWidth = 3
  ctx.setLineDash([])

  switch (selection.type) {
    case 'room': {
      const pts = findRoomPoints(floor, selection.id)
      if (pts) drawPolygonPath(ctx, pts)
      break
    }
    case 'hallway': {
      const hw = floor.hallways.find(h => h.id === selection.id)
      if (hw) drawPolylinePath(ctx, hw.polyline.points)
      break
    }
    case 'staircase': {
      const s = floor.staircases.find(f => f.id === selection.id)
      if (s?.polygon && s.polygon.points.length >= 3) {
        drawPolygonPath(ctx, s.polygon.points)
      } else if (s) {
        drawPositionMarker(ctx, s.position)
      }
      break
    }
    case 'elevator': {
      const e = floor.elevators.find(f => f.id === selection.id)
      if (e?.polygon && e.polygon.points.length >= 3) {
        drawPolygonPath(ctx, e.polygon.points)
      } else if (e) {
        drawPositionMarker(ctx, e.position)
      }
      break
    }
    case 'door': {
      const d = floor.doors.find(dr => dr.id === selection.id)
      if (d) {
        const pts = doorHighlightPoints(d)
        drawPolygonPath(ctx, pts)
      }
      break
    }
    case 'poi': {
      const p = floor.pois.find(po => po.id === selection.id)
      if (p) drawPositionMarker(ctx, p.position)
      break
    }
    case 'qrCheckpoint': {
      const qr = floor.qrCheckpoints.find(q => q.id === selection.id)
      if (qr) drawPositionMarker(ctx, qr.position)
      break
    }
  }

  ctx.stroke()
  ctx.restore()
}

/**
 * Render a hover highlight overlay for the hovered entity.
 * Draws a lighter outline than selection.
 * Supports all entity types: rooms, hallways, stairs, elevators, doors, POIs, QR checkpoints.
 */
export function renderHoverOverlay(
  ctx: CanvasRenderingContext2D,
  hover: SelectionLike | null,
  floor: FloorGeometryFloor,
): void {
  if (!hover) return

  ctx.save()
  ctx.strokeStyle = 'rgba(0, 120, 255, 0.4)'
  ctx.lineWidth = 2
  ctx.setLineDash([4, 4])

  switch (hover.type) {
    case 'room': {
      const pts = findRoomPoints(floor, hover.id)
      if (pts) drawPolygonPath(ctx, pts)
      break
    }
    case 'hallway': {
      const hw = floor.hallways.find(h => h.id === hover.id)
      if (hw) drawPolylinePath(ctx, hw.polyline.points)
      break
    }
    case 'staircase': {
      const s = floor.staircases.find(f => f.id === hover.id)
      if (s?.polygon && s.polygon.points.length >= 3) {
        drawPolygonPath(ctx, s.polygon.points)
      } else if (s) {
        drawPositionMarker(ctx, s.position)
      }
      break
    }
    case 'elevator': {
      const e = floor.elevators.find(f => f.id === hover.id)
      if (e?.polygon && e.polygon.points.length >= 3) {
        drawPolygonPath(ctx, e.polygon.points)
      } else if (e) {
        drawPositionMarker(ctx, e.position)
      }
      break
    }
    case 'door': {
      const d = floor.doors.find(dr => dr.id === hover.id)
      if (d) {
        const pts = doorHighlightPoints(d)
        drawPolygonPath(ctx, pts)
      }
      break
    }
    case 'poi': {
      const p = floor.pois.find(po => po.id === hover.id)
      if (p) drawPositionMarker(ctx, p.position)
      break
    }
    case 'qrCheckpoint': {
      const qr = floor.qrCheckpoints.find(q => q.id === hover.id)
      if (qr) drawPositionMarker(ctx, qr.position)
      break
    }
  }

  ctx.stroke()
  ctx.restore()
}

/**
 * Render both selection and hover overlays in correct z-order.
 * Selection is drawn first (bottom), hover on top.
 */
export function renderInteractionOverlays(
  ctx: CanvasRenderingContext2D,
  selection: SelectionLike | null,
  hover: SelectionLike | null,
  floor: FloorGeometryFloor,
): void {
  renderSelectionOverlay(ctx, selection, floor)
  renderHoverOverlay(ctx, hover, floor)
}

// ── Building footprint ──

/**
 * Render a building footprint polygon on the Canvas.
 * The footprint is in building-local meters.
 * Drawn as a semi-transparent filled polygon with outline.
 */
export function renderFootprint(
  ctx: CanvasRenderingContext2D,
  footprint: Point[],
  style: FloorRenderContext,
): void {
  if (footprint.length < 3) return

  ctx.save()
  ctx.fillStyle = 'rgba(200, 200, 255, 0.08)'
  ctx.strokeStyle = style.strokeStyle
  ctx.lineWidth = style.lineWidth * 1.5

  drawPolygonPath(ctx, footprint)
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}

// ── P4-T2: Vertex and midpoint handles ──

export interface HandleState {
  hoveredVertexId: string | null
  hoveredSegmentId: string | null
  dragVertexId: string | null
}

const VERTEX_RADIUS = 5
const MIDPOINT_RADIUS = 3.5
const VERTEX_HOVER_SCALE = 1.4
const DRAG_COLOR = '#EF4444'
const HOVER_COLOR = '#3B82F6'
const DEFAULT_VERTEX_COLOR = '#8B5CF6'
const MIDPOINT_COLOR = '#94A3B8'

/**
 * Render vertex handles at polygon/polyline vertices.
 * Shows hover and drag states via color/scale changes.
 */
export function renderVertexHandles(
  ctx: CanvasRenderingContext2D,
  vertices: Point[],
  handleState: HandleState,
): void {
  if (vertices.length === 0) return

  ctx.save()

  for (const v of vertices) {
    const vertexId = (v as Point & { id?: string }).id
    const isHovered = vertexId != null && handleState.hoveredVertexId === vertexId
    const isDragging = vertexId != null && handleState.dragVertexId === vertexId

    const radius = isHovered ? VERTEX_RADIUS * VERTEX_HOVER_SCALE : VERTEX_RADIUS
    const color = isDragging ? DRAG_COLOR : isHovered ? HOVER_COLOR : DEFAULT_VERTEX_COLOR

    ctx.beginPath()
    ctx.arc(v.x, v.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Render midpoint handles at segment midpoints.
 * Smaller than vertex handles, lighter color.
 */
export function renderMidpointHandles(
  ctx: CanvasRenderingContext2D,
  vertices: Point[],
  handleState: HandleState,
): void {
  if (vertices.length < 2) return

  ctx.save()

  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i]
    const b = vertices[i + 1]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2

    // Check if this segment is hovered (segment index = i)
    const isHovered = handleState.hoveredSegmentId != null

    const radius = isHovered ? MIDPOINT_RADIUS * 1.3 : MIDPOINT_RADIUS
    const color = isHovered ? HOVER_COLOR : MIDPOINT_COLOR

    ctx.beginPath()
    ctx.arc(mx, my, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Render all editing handles for a path (vertices + midpoints).
 * Convenience function combining renderVertexHandles + renderMidpointHandles.
 */
export function renderEditingHandles(
  ctx: CanvasRenderingContext2D,
  vertices: Point[],
  handleState: HandleState,
): void {
  renderVertexHandles(ctx, vertices, handleState)
  renderMidpointHandles(ctx, vertices, handleState)
}
