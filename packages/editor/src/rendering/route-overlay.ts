import type { RouteNode, RouteEdge, RouteNodeType, RouteEdgeType } from '@navi/core'

// ── Style types ──

export interface RouteNodeStyle {
  radius: number
  fillColor: string
  strokeColor: string
  strokeWidth: number
  labelFont: string
  labelSize: number
  labelColor: string
  labelOffset: number
}

export interface RouteEdgeStyle {
  lineWidth: number
  color: string
  dashPattern: number[]
  transitionLineWidth: number
  transitionColor: string
  transitionDashPattern: number[]
}

export interface TransitionIndicatorStyle {
  width: number
  height: number
  bgColor: string
  borderColor: string
  iconColor: string
  labelFont: string
  labelSize: number
  labelColor: string
}

export interface RouteOverlayStyle {
  node: RouteNodeStyle
  edge: RouteEdgeStyle
  transition: TransitionIndicatorStyle
  projection: (x: number, y: number) => [number, number]
}

// ── Default styles ──

export const DEFAULT_ROUTE_NODE_STYLE: RouteNodeStyle = {
  radius: 5,
  fillColor: '#3B82F6',
  strokeColor: '#FFFFFF',
  strokeWidth: 2,
  labelFont: '12px sans-serif',
  labelSize: 12,
  labelColor: '#1E293B',
  labelOffset: 10,
}

export const DEFAULT_ROUTE_EDGE_STYLE: RouteEdgeStyle = {
  lineWidth: 2,
  color: '#64748B',
  dashPattern: [],
  transitionLineWidth: 3,
  transitionColor: '#F59E0B',
  transitionDashPattern: [6, 4],
}

export const DEFAULT_TRANSITION_INDICATOR_STYLE: TransitionIndicatorStyle = {
  width: 24,
  height: 24,
  bgColor: '#FEF3C7',
  borderColor: '#F59E0B',
  iconColor: '#92400E',
  labelFont: '10px sans-serif',
  labelSize: 10,
  labelColor: '#78350F',
}

export function defaultRouteOverlayStyle(
  projection: (x: number, y: number) => [number, number],
): RouteOverlayStyle {
  return {
    node: { ...DEFAULT_ROUTE_NODE_STYLE },
    edge: { ...DEFAULT_ROUTE_EDGE_STYLE },
    transition: { ...DEFAULT_TRANSITION_INDICATOR_STYLE },
    projection,
  }
}

// ── Node color by type ──

const NODE_TYPE_COLORS: Record<RouteNodeType, string> = {
  waypoint: '#3B82F6',
  poi: '#8B5CF6',
  transition: '#F59E0B',
  entrance: '#10B981',
  outdoor: '#6366F1',
  portal: '#EC4899',
}

function nodeColor(type: RouteNodeType, style: RouteNodeStyle): string {
  return NODE_TYPE_COLORS[type] ?? style.fillColor
}

// ── Edge rendering helpers ──

function isTransitionEdge(edge: RouteEdge): boolean {
  return edge.type === 'stairs' || edge.type === 'elevator'
}

function edgeColor(type: RouteEdgeType, style: RouteEdgeStyle): string {
  if (type === 'stairs' || type === 'elevator') return style.transitionColor
  if (type === 'portal') return '#EC4899'
  return style.color
}

function edgeWidth(type: RouteEdgeType, style: RouteEdgeStyle): number {
  if (type === 'stairs' || type === 'elevator') return style.transitionLineWidth
  return style.lineWidth
}

function edgeDash(type: RouteEdgeType, style: RouteEdgeStyle): number[] {
  if (type === 'stairs' || type === 'elevator') return style.transitionDashPattern
  return style.dashPattern
}

// ── Public API ──

/**
 * Render route node markers on a Canvas 2D context.
 *
 * Each node is drawn as a filled circle with a white stroke border.
 * Nodes of type 'transition' get a distinct amber color. An optional
 * label is rendered below each node if provided in the labels map.
 *
 * @param ctx - Canvas 2D rendering context
 * @param nodes - The route nodes to render
 * @param style - Rendering style configuration
 * @param labels - Optional map from node ID to display label
 */
export function renderRouteNodes(
  ctx: CanvasRenderingContext2D,
  nodes: RouteNode[],
  style: RouteOverlayStyle,
  labels?: Map<string, string>,
): void {
  for (const node of nodes) {
    const [sx, sy] = style.projection(node.position.x, node.position.y)

    // Fill circle
    ctx.beginPath()
    ctx.arc(sx, sy, style.node.radius, 0, Math.PI * 2)
    ctx.fillStyle = nodeColor(node.type, style.node)
    ctx.fill()

    // Stroke circle
    ctx.lineWidth = style.node.strokeWidth
    ctx.strokeStyle = style.node.strokeColor
    ctx.stroke()

    // Label
    const label = labels?.get(node.id)
    if (label) {
      ctx.font = style.node.labelFont
      ctx.fillStyle = style.node.labelColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(label, sx, sy + style.node.labelOffset)
    }
  }
}

/**
 * Render route edge lines on a Canvas 2D context.
 *
 * Edges are drawn as straight lines between their source and target nodes.
 * Transition edges (stairs/elevator) are rendered with a dashed amber stroke.
 * Walk edges use a solid gray stroke. Portal edges use a pink stroke.
 *
 * @param edges - The route edges to render
 * @param nodeMap - A Map from node ID to RouteNode for looking up positions
 * @param style - Rendering style configuration
 */
export function renderRouteEdges(
  ctx: CanvasRenderingContext2D,
  edges: RouteEdge[],
  nodeMap: Map<string, RouteNode>,
  style: RouteOverlayStyle,
): void {
  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)
    if (!fromNode || !toNode) continue

    const [sx, sy] = style.projection(fromNode.position.x, fromNode.position.y)
    const [ex, ey] = style.projection(toNode.position.x, toNode.position.y)

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(ex, ey)

    ctx.lineWidth = edgeWidth(edge.type, style.edge)
    ctx.strokeStyle = edgeColor(edge.type, style.edge)

    const dash = edgeDash(edge.type, style.edge)
    ctx.setLineDash(dash)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/**
 * Draw a staircase icon inside an indicator rectangle.
 */
function drawStairIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const half = size * 0.35
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Three step-like lines going up-right
  const steps = 3
  const stepW = (half * 2) / steps
  const stepH = (half * 1.6) / steps

  ctx.beginPath()
  for (let i = 0; i < steps; i++) {
    const x0 = cx - half + i * stepW
    const y0 = cy + half - i * stepH
    ctx.moveTo(x0, y0)
    ctx.lineTo(x0 + stepW, y0)
    ctx.lineTo(x0 + stepW, y0 - stepH)
  }
  ctx.stroke()
}

/**
 * Draw an elevator icon inside an indicator rectangle.
 */
function drawElevatorIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const half = size * 0.3
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'

  // Shaft outline
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2)

  // Up arrow
  ctx.beginPath()
  ctx.moveTo(cx, cy - half * 0.5)
  ctx.lineTo(cx, cy + half * 0.5)
  ctx.moveTo(cx - half * 0.3, cy - half * 0.1)
  ctx.lineTo(cx, cy - half * 0.5)
  ctx.lineTo(cx + half * 0.3, cy - half * 0.1)
  ctx.stroke()
}

/**
 * Render transition indicators (staircase/elevator icons) on a Canvas 2D context.
 *
 * Transition indicators are small labeled boxes placed at the midpoint of
 * transition edges. They show a staircase or elevator icon with a label
 * indicating the floor transition (e.g., "F0→F1").
 *
 * @param transitions - The transition edges to render indicators for
 * @param nodeMap - A Map from node ID to RouteNode for looking up positions and floors
 * @param style - Rendering style configuration
 */
export function renderTransitionIndicators(
  ctx: CanvasRenderingContext2D,
  transitions: RouteEdge[],
  nodeMap: Map<string, RouteNode>,
  style: TransitionIndicatorStyle,
  projection: (x: number, y: number) => [number, number],
): void {
  for (const edge of transitions) {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)
    if (!fromNode || !toNode) continue

    // Position indicator at midpoint
    const midX = (fromNode.position.x + toNode.position.x) / 2
    const midY = (fromNode.position.y + toNode.position.y) / 2
    const [sx, sy] = projection(midX, midY)

    const w = style.width
    const h = style.height

    // Background rounded rect
    ctx.beginPath()
    const r = 3
    ctx.moveTo(sx - w / 2 + r, sy - h / 2)
    ctx.lineTo(sx + w / 2 - r, sy - h / 2)
    ctx.arcTo(sx + w / 2, sy - h / 2, sx + w / 2, sy - h / 2 + r, r)
    ctx.lineTo(sx + w / 2, sy + h / 2 - r)
    ctx.arcTo(sx + w / 2, sy + h / 2, sx + w / 2 - r, sy + h / 2, r)
    ctx.lineTo(sx - w / 2 + r, sy + h / 2)
    ctx.arcTo(sx - w / 2, sy + h / 2, sx - w / 2, sy + h / 2 - r, r)
    ctx.lineTo(sx - w / 2, sy - h / 2 + r)
    ctx.arcTo(sx - w / 2, sy - h / 2, sx - w / 2 + r, sy - h / 2, r)
    ctx.closePath()
    ctx.fillStyle = style.bgColor
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = style.borderColor
    ctx.stroke()

    // Icon
    if (edge.type === 'elevator') {
      drawElevatorIcon(ctx, sx, sy, w, style.iconColor)
    } else {
      drawStairIcon(ctx, sx, sy, w, style.iconColor)
    }

    // Floor label below indicator
    const label = `F${fromNode.floor}→F${toNode.floor}`
    ctx.font = style.labelFont
    ctx.fillStyle = style.labelColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(label, sx, sy + h / 2 + 2)
  }
}
