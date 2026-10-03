import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RouteNode, RouteEdge } from '@navi/core'
import {
  renderRouteNodes,
  renderRouteEdges,
  renderTransitionIndicators,
  defaultRouteOverlayStyle,
  DEFAULT_ROUTE_NODE_STYLE,
  DEFAULT_ROUTE_EDGE_STYLE,
  DEFAULT_TRANSITION_INDICATOR_STYLE,
} from '../route-overlay'

function createMockCtx(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    closePath: vi.fn(),
    arcTo: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    globalAlpha: 1,
    lineCap: '' as CanvasLineCap,
    lineJoin: '' as CanvasLineJoin,
  } as unknown as CanvasRenderingContext2D
}

function createNode(overrides?: Partial<RouteNode>): RouteNode {
  return {
    id: 'rn-1',
    type: 'waypoint',
    position: { x: 10, y: 20 },
    floor: 0,
    ...overrides,
  }
}

function createEdge(overrides?: Partial<RouteEdge>): RouteEdge {
  return {
    id: 're-1',
    from: 'rn-1',
    to: 'rn-2',
    type: 'walk',
    distance: 15,
    ...overrides,
  }
}

describe('defaultRouteOverlayStyle', () => {
  it('returns style with provided projection function', () => {
    const proj = (x: number, y: number): [number, number] => [x * 2, y * 2]
    const style = defaultRouteOverlayStyle(proj)
    expect(style.projection).toBe(proj)
    expect(style.node).toEqual(DEFAULT_ROUTE_NODE_STYLE)
    expect(style.edge).toEqual(DEFAULT_ROUTE_EDGE_STYLE)
    expect(style.transition).toEqual(DEFAULT_TRANSITION_INDICATOR_STYLE)
  })

  it('projection function transforms coordinates', () => {
    const proj = (x: number, y: number): [number, number] => [x + 100, y + 50]
    const style = defaultRouteOverlayStyle(proj)
    const [px, py] = style.projection(10, 20)
    expect(px).toBe(110)
    expect(py).toBe(70)
  })
})

describe('renderRouteNodes', () => {
  let ctx: CanvasRenderingContext2D
  let style: ReturnType<typeof defaultRouteOverlayStyle>

  beforeEach(() => {
    ctx = createMockCtx()
    style = defaultRouteOverlayStyle((x, y) => [x, y])
  })

  it('draws a filled circle for each node', () => {
    const nodes = [createNode({ id: 'n1' }), createNode({ id: 'n2', position: { x: 30, y: 40 } })]
    renderRouteNodes(ctx, nodes, style)
    // Two nodes → two arc calls
    expect(ctx.arc).toHaveBeenCalledTimes(2)
    expect(ctx.fill).toHaveBeenCalledTimes(2)
  })

  it('uses node type color for fill', () => {
    const node = createNode({ type: 'entrance' })
    renderRouteNodes(ctx, [node], style)
    expect(ctx.fillStyle).toBe('#10B981')
  })

  it('uses transition color for transition nodes', () => {
    const node = createNode({ type: 'transition' })
    renderRouteNodes(ctx, [node], style)
    expect(ctx.fillStyle).toBe('#F59E0B')
  })

  it('draws label below node when labels map provides one', () => {
    const node = createNode({ id: 'n1' })
    const labels = new Map([['n1', 'Test Label']])
    renderRouteNodes(ctx, [node], style, labels)
    expect(ctx.fillText).toHaveBeenCalledWith(
      'Test Label',
      10,
      20 + DEFAULT_ROUTE_NODE_STYLE.labelOffset,
    )
  })

  it('skips label when labels map has no entry for node', () => {
    const node = createNode({ id: 'n1' })
    renderRouteNodes(ctx, [node], style)
    expect(ctx.fillText).not.toHaveBeenCalled()
  })

  it('handles empty node list', () => {
    renderRouteNodes(ctx, [], style)
    expect(ctx.arc).not.toHaveBeenCalled()
  })
})

describe('renderRouteEdges', () => {
  let ctx: CanvasRenderingContext2D
  let style: ReturnType<typeof defaultRouteOverlayStyle>
  let nodeMap: Map<string, RouteNode>

  beforeEach(() => {
    ctx = createMockCtx()
    style = defaultRouteOverlayStyle((x, y) => [x, y])
    nodeMap = new Map([
      ['rn-1', createNode({ id: 'rn-1', position: { x: 0, y: 0 } })],
      ['rn-2', createNode({ id: 'rn-2', position: { x: 100, y: 50 } })],
    ])
  })

  it('draws a line for each edge', () => {
    const edges = [createEdge({ from: 'rn-1', to: 'rn-2' })]
    renderRouteEdges(ctx, edges, nodeMap, style)
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0)
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 50)
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
  })

  it('uses transition color and dash for stairs edges', () => {
    const edge = createEdge({ type: 'stairs' })
    renderRouteEdges(ctx, [edge], nodeMap, style)
    expect(ctx.strokeStyle).toBe(DEFAULT_ROUTE_EDGE_STYLE.transitionColor)
    expect(ctx.setLineDash).toHaveBeenCalledWith(DEFAULT_ROUTE_EDGE_STYLE.transitionDashPattern)
  })

  it('uses transition color for elevator edges', () => {
    const edge = createEdge({ type: 'elevator' })
    renderRouteEdges(ctx, [edge], nodeMap, style)
    expect(ctx.strokeStyle).toBe(DEFAULT_ROUTE_EDGE_STYLE.transitionColor)
  })

  it('uses pink color for portal edges', () => {
    const edge = createEdge({ type: 'portal' })
    renderRouteEdges(ctx, [edge], nodeMap, style)
    expect(ctx.strokeStyle).toBe('#EC4899')
  })

  it('uses default color for walk edges', () => {
    const edge = createEdge({ type: 'walk' })
    renderRouteEdges(ctx, [edge], nodeMap, style)
    expect(ctx.strokeStyle).toBe(DEFAULT_ROUTE_EDGE_STYLE.color)
  })

  it('clears line dash after stroke', () => {
    const edge = createEdge({ type: 'walk' })
    renderRouteEdges(ctx, [edge], nodeMap, style)
    expect(ctx.setLineDash).toHaveBeenLastCalledWith([])
  })

  it('skips edges with missing nodes', () => {
    const missingMap = new Map<string, RouteNode>()
    const edges = [createEdge({ from: 'missing', to: 'rn-2' })]
    renderRouteEdges(ctx, edges, missingMap, style)
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('handles empty edge list', () => {
    renderRouteEdges(ctx, [], nodeMap, style)
    expect(ctx.stroke).not.toHaveBeenCalled()
  })
})

describe('renderTransitionIndicators', () => {
  let ctx: CanvasRenderingContext2D
  let nodeMap: Map<string, RouteNode>

  beforeEach(() => {
    ctx = createMockCtx()
    nodeMap = new Map([
      ['tr-stair-1-0', createNode({ id: 'tr-stair-1-0', type: 'transition', position: { x: 0, y: 0 }, floor: 0 })],
      ['tr-stair-1-1', createNode({ id: 'tr-stair-1-1', type: 'transition', position: { x: 10, y: 10 }, floor: 1 })],
    ])
  })

  it('draws a background rectangle for each transition', () => {
    const transitions = [createEdge({ from: 'tr-stair-1-0', to: 'tr-stair-1-1', type: 'stairs' })]
    renderTransitionIndicators(
      ctx,
      transitions,
      nodeMap,
      DEFAULT_TRANSITION_INDICATOR_STYLE,
      (x, y) => [x, y],
    )
    // beginPath + arcTo×4 + closePath for rounded rect
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
  })

  it('draws floor label below indicator', () => {
    const transitions = [createEdge({ from: 'tr-stair-1-0', to: 'tr-stair-1-1', type: 'stairs' })]
    renderTransitionIndicators(
      ctx,
      transitions,
      nodeMap,
      DEFAULT_TRANSITION_INDICATOR_STYLE,
      (x, y) => [x, y],
    )
    expect(ctx.fillText).toHaveBeenCalledWith(
      'F0→F1',
      expect.any(Number),
      expect.any(Number),
    )
  })

  it('handles elevator transitions', () => {
    const elevatorNodes = new Map([
      ['tr-elev-1-0', createNode({ id: 'tr-elev-1-0', type: 'transition', position: { x: 5, y: 5 }, floor: 0 })],
      ['tr-elev-1-2', createNode({ id: 'tr-elev-1-2', type: 'transition', position: { x: 15, y: 15 }, floor: 2 })],
    ])
    const transitions = [createEdge({ from: 'tr-elev-1-0', to: 'tr-elev-1-2', type: 'elevator' })]
    renderTransitionIndicators(
      ctx,
      transitions,
      elevatorNodes,
      DEFAULT_TRANSITION_INDICATOR_STYLE,
      (x, y) => [x, y],
    )
    expect(ctx.fillText).toHaveBeenCalledWith(
      'F0→F2',
      expect.any(Number),
      expect.any(Number),
    )
  })

  it('skips transitions with missing nodes', () => {
    const emptyMap = new Map<string, RouteNode>()
    const transitions = [createEdge({ from: 'missing', to: 'also-missing', type: 'stairs' })]
    renderTransitionIndicators(
      ctx,
      transitions,
      emptyMap,
      DEFAULT_TRANSITION_INDICATOR_STYLE,
      (x, y) => [x, y],
    )
    expect(ctx.fill).not.toHaveBeenCalled()
  })

  it('handles empty transitions list', () => {
    renderTransitionIndicators(
      ctx,
      [],
      nodeMap,
      DEFAULT_TRANSITION_INDICATOR_STYLE,
      (x, y) => [x, y],
    )
    expect(ctx.fill).not.toHaveBeenCalled()
  })
})
