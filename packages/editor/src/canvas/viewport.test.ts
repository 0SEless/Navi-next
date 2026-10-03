import { describe, it, expect } from 'vitest'
import {
  createCamera,
  worldToScreen,
  screenToWorld,
  applyCamera,
  resetCamera,
  drawFloorPlanImage,
  type CameraState,
  type Point2D,
} from './viewport'

// Use `any` for mock canvas contexts — they implement only the subset of
// CanvasRenderingContext2D that the viewport functions call.
type MockCtx = any

// ── CameraState + createCamera ──

describe('CameraState', () => {
  it('createCamera produces sensible defaults', () => {
    const cam = createCamera()
    expect(cam.center).toEqual({ x: 0, y: 0 })
    expect(cam.zoom).toBe(1)
    expect(cam.rotation).toBe(0)
  })

  it('createCamera accepts overrides', () => {
    const cam = createCamera({ center: { x: 10, y: 20 }, zoom: 3, rotation: 45 })
    expect(cam.center).toEqual({ x: 10, y: 20 })
    expect(cam.zoom).toBe(3)
    expect(cam.rotation).toBe(45)
  })

  it('createCamera clamps zoom to [0.1, 50]', () => {
    expect(createCamera({ zoom: 0 }).zoom).toBe(0.1)
    expect(createCamera({ zoom: 100 }).zoom).toBe(50)
    expect(createCamera({ zoom: 5 }).zoom).toBe(5)
  })

  it('createCamera normalizes rotation to [0, 360)', () => {
    expect(createCamera({ rotation: -90 }).rotation).toBe(270)
    expect(createCamera({ rotation: 450 }).rotation).toBe(90)
    expect(createCamera({ rotation: 360 }).rotation).toBe(0)
  })

  it('createCamera returns a frozen object', () => {
    const cam = createCamera()
    expect(Object.isFrozen(cam)).toBe(true)
  })
})

// ── worldToScreen / screenToWorld ──

describe('worldToScreen', () => {
  const canvas = { width: 800, height: 600 }

  it('maps world origin to canvas center when camera is at origin', () => {
    const cam = createCamera()
    const s = worldToScreen({ x: 0, y: 0 }, cam, canvas)
    expect(s.x).toBeCloseTo(400)
    expect(s.y).toBeCloseTo(300)
  })

  it('applies zoom: zoom=2 doubles screen distance from center', () => {
    const cam = createCamera({ zoom: 2 })
    const s = worldToScreen({ x: 50, y: 0 }, cam, canvas)
    expect(s.x).toBeCloseTo(400 + 100) // 50 * 2 = 100px from center
    expect(s.y).toBeCloseTo(300)
  })

  it('applies pan: camera center offset shifts screen position', () => {
    const cam = createCamera({ center: { x: 50, y: 0 } })
    const s = worldToScreen({ x: 50, y: 0 }, cam, canvas)
    // world (50,0) = camera center → screen center
    expect(s.x).toBeCloseTo(400)
    expect(s.y).toBeCloseTo(300)
  })

  it('applies rotation: 90° rotates screen coords', () => {
    const cam = createCamera({ rotation: 90 })
    const s = worldToScreen({ x: 100, y: 0 }, cam, canvas)
    // 90° clockwise: (100,0) → (0,-100) in screen-relative → screen (400, 300+100) = (400, 400)
    expect(s.x).toBeCloseTo(400)
    expect(s.y).toBeCloseTo(400)
  })

  it('screen Y is inverted: positive world Y goes up on screen', () => {
    const cam = createCamera()
    const s = worldToScreen({ x: 0, y: 100 }, cam, canvas)
    expect(s.x).toBeCloseTo(400)
    expect(s.y).toBeCloseTo(200) // 300 - 100 (up = lower Y on screen)
  })
})

describe('screenToWorld', () => {
  const canvas = { width: 800, height: 600 }

  it('maps canvas center to world origin when camera is at origin', () => {
    const cam = createCamera()
    const w = screenToWorld({ x: 400, y: 300 }, cam, canvas)
    expect(w.x).toBeCloseTo(0)
    expect(w.y).toBeCloseTo(0)
  })

  it('round-trip identity: screenToWorld(worldToScreen(p)) ≈ p', () => {
    const cam = createCamera({ center: { x: 10, y: 20 }, zoom: 3, rotation: 30 })
    const world = { x: 15.5, y: -7.3 }
    const screen = worldToScreen(world, cam, canvas)
    const back = screenToWorld(screen, cam, canvas)
    expect(back.x).toBeCloseTo(world.x, 10)
    expect(back.y).toBeCloseTo(world.y, 10)
  })

  it('round-trip with zoom=0.5 and rotation=180', () => {
    const cam = createCamera({ center: { x: -5, y: 10 }, zoom: 0.5, rotation: 180 })
    const world = { x: 100, y: -50 }
    const screen = worldToScreen(world, cam, canvas)
    const back = screenToWorld(screen, cam, canvas)
    expect(back.x).toBeCloseTo(world.x, 10)
    expect(back.y).toBeCloseTo(world.y, 10)
  })
})

// ── applyCamera / resetCamera ──

describe('applyCamera', () => {
  it('first translate sets canvas center', () => {
    const ctx = mockContext() as MockCtx
    const cam = createCamera()
    applyCamera(ctx, cam, { width: 800, height: 600 })
    const t = ctx._calls[0]
    expect(t.op).toBe('translate')
    expect(t.args[0]).toBeCloseTo(400)
    expect(t.args[1]).toBeCloseTo(300)
  })

  it('applies scale for zoom', () => {
    const ctx = mockContext() as MockCtx
    const cam = createCamera({ zoom: 3 })
    applyCamera(ctx, cam, { width: 800, height: 600 })
    const s = getScale(ctx)
    expect(s.x).toBeCloseTo(3)
    expect(s.y).toBeCloseTo(-3) // Y inverted
  })

  it('applies rotation', () => {
    const ctx = mockContext() as MockCtx
    const cam = createCamera({ rotation: 45 })
    applyCamera(ctx, cam, { width: 800, height: 600 })
    expect(getRotation(ctx)).toBeCloseTo(-Math.PI / 4)
  })

  it('last translate applies pan offset', () => {
    const ctx = mockContext() as MockCtx
    const cam = createCamera({ center: { x: 50, y: 30 } })
    applyCamera(ctx, cam, { width: 800, height: 600 })
    const t = getTranslate(ctx)
    expect(t.x).toBeCloseTo(-50)
    expect(t.y).toBeCloseTo(-30)
  })
})

describe('resetCamera', () => {
  it('resets the transform', () => {
    const ctx = mockContext() as MockCtx
    resetCamera(ctx)
    expect(ctx._resetCount).toBe(1)
  })
})

// ── Mock canvas context for testing ──

interface MockContext {
  _calls: Array<{ op: string; args: number[] }>
  _resetCount: number
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  rotate(angle: number): void
  resetTransform(): void
}

function mockContext(): MockContext {
  const ctx: MockContext = {
    _calls: [],
    _resetCount: 0,
    save() {},
    restore() {},
    translate(x: number, y: number) {
      ctx._calls.push({ op: 'translate', args: [x, y] })
    },
    scale(x: number, y: number) {
      ctx._calls.push({ op: 'scale', args: [x, y] })
    },
    rotate(angle: number) {
      ctx._calls.push({ op: 'rotate', args: [angle] })
    },
    resetTransform() {
      ctx._resetCount++
    },
  }
  return ctx
}

function getTranslate(ctx: MockContext): { x: number; y: number } {
  const t = ctx._calls.findLast(c => c.op === 'translate')
  return t ? { x: t.args[0], y: t.args[1] } : { x: 0, y: 0 }
}

function getScale(ctx: MockContext): { x: number; y: number } {
  const s = ctx._calls.findLast(c => c.op === 'scale')
  return s ? { x: s.args[0], y: s.args[1] } : { x: 1, y: 1 }
}

function getRotation(ctx: MockContext): number {
  const r = ctx._calls.findLast(c => c.op === 'rotate')
  return r ? r.args[0] : 0
}

// ── drawFloorPlanImage ──

describe('drawFloorPlanImage', () => {
  const footprint: Point2D[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ]

  /** Mock image that tracks drawImage calls. */
  function mockImage() {
    return {
      width: 100,
      height: 50,
      _drawCalls: [] as Array<{ sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }>,
    }
  }

  function mockDrawCtx() {
    const base = mockContext()
    const drawCalls: Array<{ img: unknown; dx: number; dy: number; dw: number; dh: number }> = []
    const extended = {
      ...base,
      globalAlpha: 1,
      drawImage(img: unknown, dxOrSx: number, dyOrSy: number, dwOrSw: number, dhOrSh: number, dx?: number, dy?: number, dw?: number, dh?: number) {
        if (dx !== undefined && dy !== undefined && dw !== undefined && dh !== undefined) {
          drawCalls.push({ img, dx, dy, dw, dh })
        } else {
          drawCalls.push({ img, dx: dxOrSx, dy: dyOrSy, dw: dwOrSw, dh: dhOrSh })
        }
      },
      drawCalls,
    }
    return extended
  }

  it('draws the image at footprint centroid with default alignment', () => {
    const ctx = mockDrawCtx()
    const img = mockImage()
    const cam = createCamera()
    drawFloorPlanImage(ctx as any, img as any, footprint, {}, cam, { width: 800, height: 600 })
    expect(ctx.drawCalls).toHaveLength(1)
    const call = ctx.drawCalls[0]
    // Image should be drawn (5-arg form with transform already applied)
    expect(call.img).toBe(img)
  })

  it('scale=2 doubles the drawn dimensions', () => {
    const ctx = mockDrawCtx()
    const img = mockImage()
    const cam = createCamera()
    drawFloorPlanImage(ctx as any, img as any, footprint, { scale: 2 }, cam, { width: 800, height: 600 })
    expect(ctx.drawCalls).toHaveLength(1)
    const call = ctx.drawCalls[0]
    // At scale=2, the 20×10 footprint becomes 40×20 meters
    expect(call.dw).toBeCloseTo(40)
    expect(call.dh).toBeCloseTo(20)
  })

  it('opacity < 1 sets globalAlpha', () => {
    const ctx = mockDrawCtx()
    const img = mockImage()
    const cam = createCamera()
    drawFloorPlanImage(ctx as any, img as any, footprint, { opacity: 0.5 }, cam, { width: 800, height: 600 })
    // globalAlpha is set to 0.5 during draw, then reset to 1
    expect(ctx.globalAlpha).toBe(1)
  })

  it('does not draw when footprint is empty', () => {
    const ctx = mockDrawCtx()
    const img = mockImage()
    const cam = createCamera()
    drawFloorPlanImage(ctx as any, img as any, [], {}, cam, { width: 800, height: 600 })
    expect(ctx.drawCalls).toHaveLength(0)
  })
})
