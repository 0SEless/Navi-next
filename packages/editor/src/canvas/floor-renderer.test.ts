import { describe, it, expect } from 'vitest'
import {
  renderRooms,
  renderHallways,
  renderStairsElevators,
  renderFloor,
  renderSelectionOverlay,
  renderHoverOverlay,
  renderInteractionOverlays,
  type FloorRenderContext,
} from './floor-renderer'
import type { FloorGeometryFloor, FloorGeometryFeature } from '@navi/core'

// ── Mock canvas context ──

interface MockCtx {
  _calls: Array<{ op: string; args: unknown[] }>
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
  fillText(text: string, x: number, y: number): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  setLineDash(pattern: number[]): void
  strokeStyle: string
  fillStyle: string
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
}

function mockCtx(): MockCtx {
  const ctx: MockCtx = {
    _calls: [],
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    save() { ctx._calls.push({ op: 'save', args: [] }) },
    restore() { ctx._calls.push({ op: 'restore', args: [] }) },
    beginPath() { ctx._calls.push({ op: 'beginPath', args: [] }) },
    moveTo(x: number, y: number) { ctx._calls.push({ op: 'moveTo', args: [x, y] }) },
    lineTo(x: number, y: number) { ctx._calls.push({ op: 'lineTo', args: [x, y] }) },
    closePath() { ctx._calls.push({ op: 'closePath', args: [] }) },
    stroke() { ctx._calls.push({ op: 'stroke', args: [] }) },
    fill() { ctx._calls.push({ op: 'fill', args: [] }) },
    fillText(text: string, x: number, y: number) { ctx._calls.push({ op: 'fillText', args: [text, x, y] }) },
    arc(x: number, y: number, r: number, start: number, end: number) { ctx._calls.push({ op: 'arc', args: [x, y, r, start, end] }) },
    setLineDash(pattern: number[]) { ctx._calls.push({ op: 'setLineDash', args: [pattern] }) },
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
    { x: 0, y: 0 },
  ],
}

const hallwayPolyline = {
  points: [
    { x: 0, y: 5 },
    { x: 20, y: 5 },
  ],
}

const staircaseWithPolygon: FloorGeometryFeature = {
  id: 's1',
  name: 'Stair A',
  position: { x: 15, y: 3 },
  rotation: 0,
  polygon: {
    points: [
      { x: 14, y: 2 },
      { x: 16, y: 2 },
      { x: 16, y: 4 },
      { x: 14, y: 4 },
      { x: 14, y: 2 },
    ],
  },
}

const elevatorPositionOnly: FloorGeometryFeature = {
  id: 'e1',
  name: 'Elevator 1',
  position: { x: 5, y: 5 },
  rotation: 0,
}

function makeFloor(overrides?: Partial<FloorGeometryFloor>): FloorGeometryFloor {
  return {
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    offset: { x: 0, y: 0 },
    rooms: [
      { id: 'r1', name: 'Room 101', number: '101', polygon: roomPolygon },
    ],
    hallways: [
      { id: 'h1', name: 'Main Hall', polyline: hallwayPolyline },
    ],
    staircases: [staircaseWithPolygon],
    elevators: [elevatorPositionOnly],
    doors: [
      { id: 'd1', roomId: 'r1', doorType: 'single', position: { x: 10, y: 4 }, width: 1.2 },
    ],
    pois: [
      { id: 'p1', name: 'Vending Machine', category: 'amenity', position: { x: 20, y: 5 } },
    ],
    qrCheckpoints: [
      { id: 'q1', label: 'QR Entrance', code: 'navi.app/q/q1', position: { x: 25, y: 5 } },
    ],
    ...overrides,
  }
}

function makeCtx(): FloorRenderContext {
  return { strokeStyle: '#333', fillStyle: 'rgba(200,200,255,0.3)', lineWidth: 1 }
}

// ── renderRooms ──

describe('renderRooms', () => {
  it('draws a closed polygon path for each room', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderRooms(ctx as any, floor.rooms, makeCtx())

    const begins = getOps(ctx, 'beginPath')
    const moves = getOps(ctx, 'moveTo')
    const lines = getOps(ctx, 'lineTo')
    const closes = getOps(ctx, 'closePath')
    const strokes = getOps(ctx, 'stroke')

    expect(begins).toHaveLength(1)
    expect(moves).toHaveLength(1)
    expect(lines.length).toBeGreaterThan(0)
    expect(closes).toHaveLength(1)
    expect(strokes).toHaveLength(1)
  })

  it('draws room number label at centroid', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderRooms(ctx as any, floor.rooms, makeCtx())

    const texts = getOps(ctx, 'fillText')
    expect(texts).toHaveLength(1)
    expect(texts[0].args[0]).toBe('101')
  })

  it('handles empty rooms array', () => {
    const ctx = mockCtx()
    renderRooms(ctx as any, [], makeCtx())
    expect(ctx._calls).toHaveLength(0)
  })

  it('draws multiple rooms', () => {
    const ctx = mockCtx()
    const rooms = [
      { id: 'r1', name: 'Room 1', number: '101', polygon: roomPolygon },
      { id: 'r2', name: 'Room 2', number: '102', polygon: roomPolygon },
    ]
    renderRooms(ctx as any, rooms, makeCtx())
    expect(getOps(ctx, 'beginPath')).toHaveLength(2)
    expect(getOps(ctx, 'fillText')).toHaveLength(2)
  })
})

// ── renderHallways ──

describe('renderHallways', () => {
  it('draws a stroked polyline for each hallway', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHallways(ctx as any, floor.hallways, makeCtx())

    const begins = getOps(ctx, 'beginPath')
    const moves = getOps(ctx, 'moveTo')
    const lines = getOps(ctx, 'lineTo')
    const strokes = getOps(ctx, 'stroke')

    expect(begins).toHaveLength(1)
    expect(moves).toHaveLength(1)
    expect(lines.length).toBeGreaterThan(0)
    expect(strokes).toHaveLength(1)
  })

  it('handles empty hallways array', () => {
    const ctx = mockCtx()
    renderHallways(ctx as any, [], makeCtx())
    expect(ctx._calls).toHaveLength(0)
  })
})

// ── renderStairsElevators ──

describe('renderStairsElevators', () => {
  it('draws polygon for features with polygon', () => {
    const ctx = mockCtx()
    renderStairsElevators(ctx as any, [staircaseWithPolygon], [], makeCtx())

    const begins = getOps(ctx, 'beginPath')
    const closes = getOps(ctx, 'closePath')
    const fills = getOps(ctx, 'fill')
    expect(begins).toHaveLength(1)
    expect(closes).toHaveLength(1)
    expect(fills).toHaveLength(1)
  })

  it('draws circle marker for position-only features', () => {
    const ctx = mockCtx()
    renderStairsElevators(ctx as any, [], [elevatorPositionOnly], makeCtx())

    const arcs = getOps(ctx, 'arc')
    const fills = getOps(ctx, 'fill')
    expect(arcs).toHaveLength(1)
    expect(fills).toHaveLength(1)
  })

  it('draws label for position-only features', () => {
    const ctx = mockCtx()
    renderStairsElevators(ctx as any, [], [elevatorPositionOnly], makeCtx())

    const texts = getOps(ctx, 'fillText')
    expect(texts.length).toBeGreaterThanOrEqual(1)
    expect(texts[0].args[0]).toBe('Elevator 1')
  })

  it('handles empty arrays', () => {
    const ctx = mockCtx()
    renderStairsElevators(ctx as any, [], [], makeCtx())
    expect(ctx._calls).toHaveLength(0)
  })
})

// ── renderFloor ──

describe('renderFloor', () => {
  it('renders all geometry types in order', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderFloor(ctx as any, floor, makeCtx())

    const begins = getOps(ctx, 'beginPath')
    expect(begins.length).toBeGreaterThanOrEqual(3)
  })

  it('handles empty floor gracefully', () => {
    const ctx = mockCtx()
    const floor = makeFloor({
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
    })
    renderFloor(ctx as any, floor, makeCtx())
    expect(ctx._calls).toHaveLength(0)
  })
})

// ── renderSelectionOverlay ──

describe('renderSelectionOverlay', () => {
  it('draws polygon stroke for room selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'room', id: 'r1', name: 'Room 101' }, floor)

    const strokes = getOps(ctx, 'stroke')
    const lineDashes = getOps(ctx, 'setLineDash')
    expect(strokes).toHaveLength(1)
    expect(lineDashes).toHaveLength(1)
    expect(lineDashes[0].args[0]).toEqual([])
  })

  it('draws polyline stroke for hallway selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'hallway', id: 'h1', name: 'Main Hall' }, floor)

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })

  it('draws polygon stroke for staircase with polygon', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'staircase', id: 's1', name: 'Stair A' }, floor)

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })

  it('draws position marker for staircase without polygon', () => {
    const ctx = mockCtx()
    const floor = makeFloor({
      staircases: [{ id: 's2', name: 'Stair B', position: { x: 3, y: 3 }, rotation: 0 }],
    })
    renderSelectionOverlay(ctx as any, { type: 'staircase', id: 's2', name: 'Stair B' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('draws position marker for elevator selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'elevator', id: 'e1', name: 'Elevator 1' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('draws polygon stroke for door selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'door', id: 'd1', name: 'single' }, floor)

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })

  it('draws position marker for POI selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'poi', id: 'p1', name: 'Vending Machine' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('draws position marker for QR checkpoint selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, { type: 'qrCheckpoint', id: 'q1', name: 'QR Entrance' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('does nothing for null selection', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderSelectionOverlay(ctx as any, null, floor)
    expect(ctx._calls).toHaveLength(0)
  })
})

// ── renderHoverOverlay ──

describe('renderHoverOverlay', () => {
  it('draws dashed polygon stroke for room hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'room', id: 'r1', name: 'Room 101' }, floor)

    const strokes = getOps(ctx, 'stroke')
    const lineDashes = getOps(ctx, 'setLineDash')
    expect(strokes).toHaveLength(1)
    expect(lineDashes).toHaveLength(1)
    expect(lineDashes[0].args[0]).toEqual([4, 4])
  })

  it('draws dashed polyline stroke for hallway hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'hallway', id: 'h1', name: 'Main Hall' }, floor)

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })

  it('draws dashed polygon stroke for staircase hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'staircase', id: 's1', name: 'Stair A' }, floor)

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })

  it('draws position marker for elevator hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'elevator', id: 'e1', name: 'Elevator 1' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('draws polygon stroke for door hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'door', id: 'd1', name: 'single' }, floor)

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })

  it('draws position marker for POI hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'poi', id: 'p1', name: 'Vending Machine' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('draws position marker for QR checkpoint hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, { type: 'qrCheckpoint', id: 'q1', name: 'QR Entrance' }, floor)

    const arcs = getOps(ctx, 'arc')
    expect(arcs).toHaveLength(1)
  })

  it('does nothing for null hover', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderHoverOverlay(ctx as any, null, floor)
    expect(ctx._calls).toHaveLength(0)
  })
})

// ── renderInteractionOverlays ──

describe('renderInteractionOverlays', () => {
  it('renders both selection and hover overlays', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderInteractionOverlays(
      ctx as any,
      { type: 'room', id: 'r1', name: 'Room 101' },
      { type: 'hallway', id: 'h1', name: 'Main Hall' },
      floor,
    )

    const strokes = getOps(ctx, 'stroke')
    expect(strokes.length).toBeGreaterThanOrEqual(2)
  })

  it('renders only selection when hover is null', () => {
    const ctx = mockCtx()
    const floor = makeFloor()
    renderInteractionOverlays(
      ctx as any,
      { type: 'room', id: 'r1', name: 'Room 101' },
      null,
      floor,
    )

    const strokes = getOps(ctx, 'stroke')
    expect(strokes).toHaveLength(1)
  })
})
