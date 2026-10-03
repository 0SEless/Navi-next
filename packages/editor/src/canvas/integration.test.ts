import { describe, it, expect } from 'vitest'
import {
  createCamera,
  worldToScreen,
  screenToWorld,
  applyCamera,
  resetCamera,
  type CameraState,
  type CanvasSize,
} from './viewport'
import { renderFloor, renderInteractionOverlays, type FloorRenderContext } from './floor-renderer'
import { hitTestFloor } from './hit-test'
import { handleCanvasClick } from './selection'
import { handleKeyboard } from './keyboard-nav'
import type { FloorGeometryFloor } from '@navi/core'

// ── Integration test: full pipeline ──

describe('P2 integration: floor geometry → render → hit-test → selection', () => {
  const floor: FloorGeometryFloor = {
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    offset: { x: 0, y: 0 },
    rooms: [
      {
        id: 'r1',
        name: 'Room 101',
        number: '101',
        polygon: {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 8 },
            { x: 0, y: 8 },
          ],
        },
      },
      {
        id: 'r2',
        name: 'Room 102',
        number: '102',
        polygon: {
          points: [
            { x: 12, y: 0 },
            { x: 22, y: 0 },
            { x: 22, y: 8 },
            { x: 12, y: 8 },
          ],
        },
      },
    ],
    hallways: [
      {
        id: 'h1',
        name: 'Main Hall',
        polyline: {
          points: [
            { x: 10, y: -2 },
            { x: 10, y: 10 },
          ],
        },
      },
    ],
    staircases: [
      {
        id: 's1',
        name: 'Stair A',
        position: { x: 25, y: 4 },
        rotation: 0,
        polygon: {
          points: [
            { x: 24, y: 2 },
            { x: 26, y: 2 },
            { x: 26, y: 6 },
            { x: 24, y: 6 },
          ],
        },
      },
    ],
    elevators: [
      {
        id: 'e1',
        name: 'Elevator 1',
        position: { x: 28, y: 4 },
        rotation: 0,
      },
    ],
    doors: [],
    pois: [],
    qrCheckpoints: [],
  }

  const canvas: CanvasSize = { width: 800, height: 600 }
  const camera = createCamera()
  const renderStyle: FloorRenderContext = {
    strokeStyle: '#333',
    fillStyle: 'rgba(200,200,255,0.3)',
    lineWidth: 1,
  }

  it('renders floor geometry without errors', () => {
    const ctx = mockRenderCtx()
    renderFloor(ctx as any, floor, renderStyle)
    // Should have created paths for rooms + hallways + stairs
    expect(ctx._calls.length).toBeGreaterThan(0)
  })

  it('hit-test returns correct entity for room center', () => {
    const result = hitTestFloor({ x: 5, y: 4 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('room')
    expect(result!.id).toBe('r1')
  })

  it('hit-test returns correct entity for second room', () => {
    const result = hitTestFloor({ x: 17, y: 4 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('room')
    expect(result!.id).toBe('r2')
  })

  it('hit-test returns hallway for point near center line', () => {
    const result = hitTestFloor({ x: 10, y: 5 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('hallway')
    expect(result!.id).toBe('h1')
  })

  it('hit-test returns staircase for point inside polygon', () => {
    const result = hitTestFloor({ x: 25, y: 4 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('staircase')
    expect(result!.id).toBe('s1')
  })

  it('hit-test returns elevator for point near position', () => {
    const result = hitTestFloor({ x: 28, y: 4 }, floor)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('elevator')
    expect(result!.id).toBe('e1')
  })

  it('full pipeline: screen click → world → hit-test → selection', () => {
    // Click at screen center = world (0,0) = inside room r1
    const result = handleCanvasClick(
      { clientX: 400, clientY: 300 },
      camera,
      canvas,
      floor,
    )
    expect(result).not.toBeNull()
    expect(result!.type).toBe('room')
    expect(result!.id).toBe('r1')
  })

  it('full pipeline with zoom: zoom=2 doubles screen distance', () => {
    const zoomedCamera = createCamera({ zoom: 2 })
    // World (5, 4) at zoom=2: screen = (400 + 5*2, 300 - 4*2) = (410, 292)
    const result = handleCanvasClick(
      { clientX: 410, clientY: 292 },
      zoomedCamera,
      canvas,
      floor,
    )
    expect(result).not.toBeNull()
    expect(result!.id).toBe('r1')
  })

  it('keyboard navigation updates camera correctly', () => {
    const result = handleKeyboard('ArrowRight', camera)
    expect(result).not.toBeNull()
    expect(result!.center!.x).toBeCloseTo(1)
  })

  it('overlay rendering works with selection', () => {
    const ctx = mockRenderCtx()
    renderInteractionOverlays(
      ctx as any,
      { type: 'room', id: 'r1', name: 'Room 101' },
      null,
      floor,
    )
    expect(ctx._calls.length).toBeGreaterThan(0)
  })

  it('empty floor handled gracefully', () => {
    const emptyFloor: FloorGeometryFloor = {
      ...floor,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
    }
    expect(hitTestFloor({ x: 5, y: 5 }, emptyFloor)).toBeNull()
    const ctx = mockRenderCtx()
    renderFloor(ctx as any, emptyFloor, renderStyle)
    expect(ctx._calls).toHaveLength(0)
  })
})

// ── Minimal mock for render verification ──

function mockRenderCtx() {
  const calls: Array<{ op: string }> = []
  return {
    _calls: calls,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    save() { calls.push({ op: 'save' }) },
    restore() { calls.push({ op: 'restore' }) },
    beginPath() { calls.push({ op: 'beginPath' }) },
    moveTo(_x: number, _y: number) { calls.push({ op: 'moveTo' }) },
    lineTo(_x: number, _y: number) { calls.push({ op: 'lineTo' }) },
    closePath() { calls.push({ op: 'closePath' }) },
    stroke() { calls.push({ op: 'stroke' }) },
    fill() { calls.push({ op: 'fill' }) },
    fillText(_t: string, _x: number, _y: number) { calls.push({ op: 'fillText' }) },
    arc(_x: number, _y: number, _r: number, _s: number, _e: number) { calls.push({ op: 'arc' }) },
    setLineDash(_s: number[]) {},
  }
}
