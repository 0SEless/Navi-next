import { describe, it, expect } from 'vitest'
import {
  renderDrawingTrace,
  renderDrawingCursor,
  renderDrawingPolygon,
  renderDrawingVertices,
  renderDrawingPreview,
} from '../drawing-preview-renderer'
import type { LocalCoord } from '@navi/core'

// ── Minimal mock canvas context ──

interface MockCtx extends CanvasRenderingContext2D {
  calls: string[]
}

function mockCtx(): MockCtx {
  const calls: string[] = []
  return {
    calls,
    save() { calls.push('save') },
    restore() { calls.push('restore') },
    beginPath() { calls.push('beginPath') },
    moveTo(_x: number, _y: number) { calls.push('moveTo') },
    lineTo(_x: number, _y: number) { calls.push('lineTo') },
    closePath() { calls.push('closePath') },
    stroke() { calls.push('stroke') },
    fill() { calls.push('fill') },
    arc(_x: number, _y: number, _r: number, _s: number, _e: number) { calls.push('arc') },
    setLineDash(_d: number[]) { calls.push('setLineDash') },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: '',
    lineCap: '',
  } as unknown as MockCtx
}

const pts: LocalCoord[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
]

describe('renderDrawingTrace', () => {
  it('does nothing with fewer than 2 points', () => {
    const ctx = mockCtx()
    renderDrawingTrace(ctx, [{ x: 0, y: 0 }])
    expect(ctx.calls).toHaveLength(0)
  })

  it('draws a dashed polyline with 2+ points', () => {
    const ctx = mockCtx()
    renderDrawingTrace(ctx, pts)
    expect(ctx.calls).toContain('save')
    expect(ctx.calls).toContain('beginPath')
    expect(ctx.calls).toContain('moveTo')
    expect(ctx.calls).toContain('lineTo')
    expect(ctx.calls).toContain('stroke')
    expect(ctx.calls).toContain('setLineDash')
    expect(ctx.calls).toContain('restore')
  })
})

describe('renderDrawingCursor', () => {
  it('draws a line between two points', () => {
    const ctx = mockCtx()
    renderDrawingCursor(ctx, { x: 0, y: 0 }, { x: 5, y: 5 })
    expect(ctx.calls).toContain('save')
    expect(ctx.calls).toContain('beginPath')
    expect(ctx.calls).toContain('moveTo')
    expect(ctx.calls).toContain('lineTo')
    expect(ctx.calls).toContain('stroke')
    expect(ctx.calls).toContain('restore')
  })
})

describe('renderDrawingPolygon', () => {
  it('does nothing with fewer than 3 points', () => {
    const ctx = mockCtx()
    renderDrawingPolygon(ctx, [{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(ctx.calls).toHaveLength(0)
  })

  it('draws filled polygon with 3+ points', () => {
    const ctx = mockCtx()
    renderDrawingPolygon(ctx, pts)
    expect(ctx.calls).toContain('fill')
    expect(ctx.calls).toContain('stroke')
    expect(ctx.calls).toContain('closePath')
  })
})

describe('renderDrawingVertices', () => {
  it('does nothing with empty points', () => {
    const ctx = mockCtx()
    renderDrawingVertices(ctx, [])
    expect(ctx.calls).toHaveLength(0)
  })

  it('draws circle for each vertex', () => {
    const ctx = mockCtx()
    renderDrawingVertices(ctx, pts)
    // 3 vertices × (beginPath + arc + fill + stroke) = 12 calls plus save/restore
    const arcs = ctx.calls.filter((c: string) => c === 'arc')
    expect(arcs).toHaveLength(3)
  })
})

describe('renderDrawingPreview', () => {
  it('renders trace, cursor, polygon, and vertices for 3+ points', () => {
    const ctx = mockCtx()
    renderDrawingPreview(ctx, pts, { x: 5, y: 5 })
    // Should have render calls for all layers
    const saves = ctx.calls.filter((c: string) => c === 'save')
    expect(saves.length).toBeGreaterThanOrEqual(3)
  })

  it('renders only trace and cursor for 2 points', () => {
    const ctx = mockCtx()
    renderDrawingPreview(ctx, pts.slice(0, 2), { x: 5, y: 5 })
    expect(ctx.calls.length).toBeGreaterThan(0)
  })

  it('does nothing with empty points', () => {
    const ctx = mockCtx()
    renderDrawingPreview(ctx, [], null)
    expect(ctx.calls).toHaveLength(0)
  })
})
