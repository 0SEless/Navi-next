import { describe, it, expect } from 'vitest'
import {
  renderSelectionOverlay,
  renderHoverOverlay,
  renderInteractionOverlays,
} from './floor-renderer'
import type { FloorGeometryFloor } from '@navi/core'

// ── Mock canvas context ──

interface MockCtx {
  _calls: Array<{ op: string; args: unknown[] }>
  strokeStyle: string
  fillStyle: string
  lineWidth: number
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  setLineDash(segments: number[]): void
}

function mockCtx(): MockCtx {
  const ctx: MockCtx = {
    _calls: [],
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    save() { ctx._calls.push({ op: 'save', args: [] }) },
    restore() { ctx._calls.push({ op: 'restore', args: [] }) },
    beginPath() { ctx._calls.push({ op: 'beginPath', args: [] }) },
    moveTo(x: number, y: number) { ctx._calls.push({ op: 'moveTo', args: [x, y] }) },
    lineTo(x: number, y: number) { ctx._calls.push({ op: 'lineTo', args: [x, y] }) },
    closePath() { ctx._calls.push({ op: 'closePath', args: [] }) },
    stroke() { ctx._calls.push({ op: 'stroke', args: [] }) },
    fill() { ctx._calls.push({ op: 'fill', args: [] }) },
    arc(x: number, y: number, r: number, start: number, end: number) {
      ctx._calls.push({ op: 'arc', args: [x, y, r, start, end] })
    },
    setLineDash(_segments: number[]) { /* no-op for testing */ },
  }
  return ctx
}

function getOps(ctx: MockCtx, op: string) {
  return ctx._calls.filter(c => c.op === op)
}

// ── Test data ──

const roomPolygon = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ],
}

const floor: FloorGeometryFloor = {
  level: 0,
  label: 'Ground Floor',
  elevation: 0,
  offset: { x: 0, y: 0 },
  rooms: [
    { id: 'r1', name: 'Room 101', number: '101', polygon: roomPolygon },
  ],
  hallways: [],
  staircases: [],
  elevators: [],
  doors: [],
  pois: [],
  qrCheckpoints: [],
}

// ── Tests ──

describe('renderSelectionOverlay', () => {
  it('draws a highlighted polygon for selected room', () => {
    const ctx = mockCtx()
    renderSelectionOverlay(ctx as any, { type: 'room', id: 'r1', name: 'Room 101' }, floor)
    expect(getOps(ctx, 'beginPath').length).toBeGreaterThanOrEqual(1)
    expect(getOps(ctx, 'stroke').length).toBeGreaterThanOrEqual(1)
  })

  it('does nothing when selection is null', () => {
    const ctx = mockCtx()
    renderSelectionOverlay(ctx as any, null, floor)
    expect(ctx._calls).toHaveLength(0)
  })

  it('does nothing when selected ID not found', () => {
    const ctx = mockCtx()
    renderSelectionOverlay(ctx as any, { type: 'room', id: 'nonexistent', name: 'X' }, floor)
    expect(ctx._calls).toHaveLength(0)
  })
})

describe('renderHoverOverlay', () => {
  it('draws a lighter highlight for hovered entity', () => {
    const ctx = mockCtx()
    renderHoverOverlay(ctx as any, { type: 'room', id: 'r1', name: 'Room 101' }, floor)
    expect(getOps(ctx, 'beginPath').length).toBeGreaterThanOrEqual(1)
  })

  it('does nothing when hover is null', () => {
    const ctx = mockCtx()
    renderHoverOverlay(ctx as any, null, floor)
    expect(ctx._calls).toHaveLength(0)
  })
})

describe('renderInteractionOverlays', () => {
  it('renders selection before hover (hover on top)', () => {
    const ctx = mockCtx()
    renderInteractionOverlays(
      ctx as any,
      { type: 'room', id: 'r1', name: 'Room 101' },
      { type: 'room', id: 'r1', name: 'Room 101' },
      floor,
    )
    const begins = getOps(ctx, 'beginPath')
    expect(begins.length).toBeGreaterThanOrEqual(2) // selection + hover
  })

  it('handles null selection and hover', () => {
    const ctx = mockCtx()
    renderInteractionOverlays(ctx as any, null, null, floor)
    expect(ctx._calls).toHaveLength(0)
  })
})
