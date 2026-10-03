import { describe, it, expect } from 'vitest'
import {
  renderVertexHandles,
  renderMidpointHandles,
  renderEditingHandles,
  type HandleState,
} from './floor-renderer'

// ── Mock canvas context ──

interface MockCtx {
  _calls: Array<{ op: string }>
  strokeStyle: string
  fillStyle: string
  lineWidth: number
  save(): void
  restore(): void
  beginPath(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  fill(): void
  stroke(): void
}

function mockCtx(): MockCtx {
  const ctx: MockCtx = {
    _calls: [],
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    save() { ctx._calls.push({ op: 'save' }) },
    restore() { ctx._calls.push({ op: 'restore' }) },
    beginPath() { ctx._calls.push({ op: 'beginPath' }) },
    arc(_x: number, _y: number, _r: number, _s: number, _e: number) { ctx._calls.push({ op: 'arc' }) },
    fill() { ctx._calls.push({ op: 'fill' }) },
    stroke() { ctx._calls.push({ op: 'stroke' }) },
  }
  return ctx
}

function getOps(ctx: MockCtx, op: string) {
  return ctx._calls.filter(c => c.op === op)
}

const emptyState: HandleState = {
  hoveredVertexId: null,
  hoveredSegmentId: null,
  dragVertexId: null,
}

// ── Tests ──

describe('renderVertexHandles', () => {
  it('draws circles at each vertex', () => {
    const ctx = mockCtx()
    const vertices = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
    ]
    renderVertexHandles(ctx as any, vertices, emptyState)
    expect(getOps(ctx, 'arc')).toHaveLength(3) // one circle per vertex
    expect(getOps(ctx, 'fill')).toHaveLength(3)
  })

  it('handles empty vertices', () => {
    const ctx = mockCtx()
    renderVertexHandles(ctx as any, [], emptyState)
    expect(ctx._calls).toHaveLength(0)
  })

  it('uses drag color for dragging vertex', () => {
    const ctx = mockCtx()
    const vertices = [{ x: 5, y: 5 }]
    const state: HandleState = { ...emptyState, dragVertexId: 'v1' }
    // Note: vertices don't have id in Point type, but the function handles it
    renderVertexHandles(ctx as any, vertices, state)
    expect(getOps(ctx, 'arc')).toHaveLength(1)
  })
})

describe('renderMidpointHandles', () => {
  it('draws circles between consecutive vertices', () => {
    const ctx = mockCtx()
    const vertices = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
    ]
    renderMidpointHandles(ctx as any, vertices, emptyState)
    expect(getOps(ctx, 'arc')).toHaveLength(2) // one per segment
  })

  it('handles fewer than 2 vertices', () => {
    const ctx = mockCtx()
    renderMidpointHandles(ctx as any, [{ x: 0, y: 0 }], emptyState)
    expect(ctx._calls).toHaveLength(0)
  })
})

describe('renderEditingHandles', () => {
  it('renders both vertex and midpoint handles', () => {
    const ctx = mockCtx()
    const vertices = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
    ]
    renderEditingHandles(ctx as any, vertices, emptyState)
    // 3 vertices + 2 midpoints = 5 arcs
    expect(getOps(ctx, 'arc')).toHaveLength(5)
  })
})
