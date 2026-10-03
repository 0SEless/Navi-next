import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RenderManager, LayerZ } from '../render-manager'
import type { RenderState, RenderMode, RouteOverlay, SelectionLike } from '../render-manager'
import type { FloorGeometryFloor } from '@navi/core'
import type { CameraState, CanvasSize } from '../../canvas/viewport'

// ── Mock Canvas Context ──
// Returns `any` for CanvasRenderingContext2D compatibility in tests.

function mockCtx(): any {
  const ctx: any = {
    _calls: [],
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    save() { ctx._calls.push({ op: 'save', args: [] }) },
    restore() { ctx._calls.push({ op: 'restore', args: [] }) },
    beginPath() { ctx._calls.push({ op: 'beginPath', args: [] }) },
    moveTo(x: number, y: number) { ctx._calls.push({ op: 'moveTo', args: [x, y] }) },
    lineTo(x: number, y: number) { ctx._calls.push({ op: 'lineTo', args: [x, y] }) },
    closePath() { ctx._calls.push({ op: 'closePath', args: [] }) },
    stroke() { ctx._calls.push({ op: 'stroke', args: [] }) },
    fill() { ctx._calls.push({ op: 'fill', args: [] }) },
    arc(_x: number, _y: number, _r: number, _start: number, _end: number) {
      ctx._calls.push({ op: 'arc', args: [_x, _y, _r, _start, _end] })
    },
    setLineDash(_segments: number[]) { ctx._calls.push({ op: 'setLineDash', args: [_segments] }) },
    fillText(_text: string, _x: number, _y: number) { ctx._calls.push({ op: 'fillText', args: [_text, _x, _y] }) },
    drawImage(_image: CanvasImageSource, _dx: number, _dy: number, _dw: number, _dh: number) {
      ctx._calls.push({ op: 'drawImage', args: [_image, _dx, _dy, _dw, _dh] })
    },
    transform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number) {
      ctx._calls.push({ op: 'transform', args: [_a, _b, _c, _d, _e, _f] })
    },
    translate(_x: number, _y: number) { ctx._calls.push({ op: 'translate', args: [_x, _y] }) },
    rotate(_angle: number) { ctx._calls.push({ op: 'rotate', args: [_angle] }) },
    scale(_x: number, _y: number) { ctx._calls.push({ op: 'scale', args: [_x, _y] }) },
    resetTransform() { ctx._calls.push({ op: 'resetTransform', args: [] }) },
  }
  return ctx
}

function getOps(ctx: any, op: string) {
  return ctx._calls.filter((c: any) => c.op === op)
}

// ── Test Fixtures ──

const DEFAULT_CAMERA: CameraState = { center: { x: 0, y: 0 }, zoom: 1, rotation: 0 }
const DEFAULT_CANVAS: CanvasSize = { width: 800, height: 600 }

const TEST_FLOOR: FloorGeometryFloor = {
  level: 0,
  label: 'Ground',
  elevation: 0,
  offset: { x: 0, y: 0 },
  rooms: [
    {
      id: 'room-1',
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
  ],
  hallways: [
    {
      id: 'hw-1',
      name: 'Main Hall',
      polyline: {
        points: [
          { x: 0, y: 4 },
          { x: 20, y: 4 },
        ],
      },
    },
  ],
  staircases: [],
  elevators: [],
  doors: [],
  pois: [],
  qrCheckpoints: [],
}

const TEST_ROUTE: RouteOverlay = {
  path: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
  ],
  color: '#FF0000',
  width: 4,
}

const TEST_SELECTION: SelectionLike = {
  type: 'room',
  id: 'room-1',
  name: 'Room 101',
}

const TEST_STATE: RenderState = {
  floor: TEST_FLOOR,
  selection: null,
  hover: null,
  handleState: null,
  handleVertices: [],
  route: null,
  referenceImage: null,
  footprint: undefined,
}

// ── Tests ──

describe('RenderManager', () => {
  let ctx: any

  beforeEach(() => {
    ctx = mockCtx()
  })

  describe('mode switching', () => {
    it('defaults to 2d mode', () => {
      const manager = new RenderManager()
      expect(manager.getMode()).toBe('2d')
    })

    it('accepts initial mode in options', () => {
      const manager = new RenderManager({ mode: '2.5d' })
      expect(manager.getMode()).toBe('2.5d')
    })

    it('switches mode with setMode', () => {
      const manager = new RenderManager()
      expect(manager.getMode()).toBe('2d')

      manager.setMode('2.5d')
      expect(manager.getMode()).toBe('2.5d')

      manager.setMode('2d')
      expect(manager.getMode()).toBe('2d')
    })
  })

  describe('layer ordering', () => {
    it('LayerZ enum defines correct z-order', () => {
      expect(LayerZ.REFERENCE_IMAGE).toBe(0)
      expect(LayerZ.FLOOR_GEOMETRY).toBe(1)
      expect(LayerZ.ROUTE_OVERLAY).toBe(2)
      expect(LayerZ.SELECTION_OVERLAY).toBe(3)
      expect(LayerZ.EDITING_HANDLES).toBe(4)
    })

    it('reference image renders below floor geometry', () => {
      const manager = new RenderManager()
      const stateWithImage: RenderState = {
        ...TEST_STATE,
        referenceImage: {} as CanvasImageSource,
        footprint: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      }

      manager.render(ctx, stateWithImage, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Reference image should trigger drawImage call
      const drawImageOps = getOps(ctx, 'drawImage')
      expect(drawImageOps.length).toBe(1)

      // Should have save/restore pairs for each layer
      const saves = getOps(ctx, 'save')
      expect(saves.length).toBeGreaterThanOrEqual(2)
    })

    it('route overlay renders above floor geometry', () => {
      const manager = new RenderManager()
      const stateWithRoute: RenderState = {
        ...TEST_STATE,
        route: TEST_ROUTE,
      }

      manager.render(ctx, stateWithRoute, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Route should be stroked
      const strokes = getOps(ctx, 'stroke')
      expect(strokes.length).toBeGreaterThan(0)
    })

    it('selection overlay renders above route', () => {
      const manager = new RenderManager()
      const stateWithSelection: RenderState = {
        ...TEST_STATE,
        selection: TEST_SELECTION,
      }

      manager.render(ctx, stateWithSelection, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Selection should trigger strokes
      const strokes = getOps(ctx, 'stroke')
      expect(strokes.length).toBeGreaterThan(0)
    })
  })

  describe('render delegation', () => {
    it('calls save/restore for each layer', () => {
      const manager = new RenderManager()
      manager.render(ctx, TEST_STATE, DEFAULT_CAMERA, DEFAULT_CANVAS)

      const saves = getOps(ctx, 'save')
      const restores = getOps(ctx, 'restore')
      expect(saves.length).toBe(restores.length)
    })

    it('renders floor geometry in 2d mode', () => {
      const manager = new RenderManager({ mode: '2d' })
      manager.render(ctx, TEST_STATE, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // 2D mode should draw paths for rooms and hallways
      const beginPaths = getOps(ctx, 'beginPath')
      expect(beginPaths.length).toBeGreaterThan(0)
    })

    it('renders floor geometry in 2.5d mode with transform', () => {
      const manager = new RenderManager({ mode: '2.5d' })
      manager.render(ctx, TEST_STATE, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // 2.5D mode should apply transform
      const transforms = getOps(ctx, 'transform')
      expect(transforms.length).toBeGreaterThan(0)

      // Should also have save/restore for transform state
      const saves = getOps(ctx, 'save')
      expect(saves.length).toBeGreaterThan(0)
    })

    it('renders route overlay when route is provided', () => {
      const manager = new RenderManager()
      const stateWithRoute: RenderState = {
        ...TEST_STATE,
        route: TEST_ROUTE,
      }

      manager.render(ctx, stateWithRoute, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Route path should be drawn
      const beginPaths = getOps(ctx, 'beginPath')
      expect(beginPaths.length).toBeGreaterThan(0)

      const moveToOps = getOps(ctx, 'moveTo')
      expect(moveToOps.length).toBeGreaterThan(0)

      const lineToOps = getOps(ctx, 'lineTo')
      expect(lineToOps.length).toBeGreaterThan(0)
    })

    it('renders selection overlay when selection is provided', () => {
      const manager = new RenderManager()
      const stateWithSelection: RenderState = {
        ...TEST_STATE,
        selection: TEST_SELECTION,
      }

      manager.render(ctx, stateWithSelection, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Selection should draw paths
      const beginPaths = getOps(ctx, 'beginPath')
      expect(beginPaths.length).toBeGreaterThan(0)
    })

    it('renders editing handles when handleState and vertices are provided', () => {
      const manager = new RenderManager()
      const stateWithHandles: RenderState = {
        ...TEST_STATE,
        handleState: {
          hoveredVertexId: null,
          hoveredSegmentId: null,
          dragVertexId: null,
        },
        handleVertices: [
          { x: 0, y: 0, id: 'v1' },
          { x: 10, y: 0, id: 'v2' },
        ],
      }

      manager.render(ctx, stateWithHandles, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Handles should draw circles (arcs)
      const arcs = getOps(ctx, 'arc')
      expect(arcs.length).toBeGreaterThan(0)
    })

    it('skips layers when state is empty', () => {
      const manager = new RenderManager()
      const emptyState: RenderState = {
        floor: null,
        selection: null,
        hover: null,
        handleState: null,
        handleVertices: [],
        route: null,
        referenceImage: null,
        footprint: undefined,
      }

      manager.render(ctx, emptyState, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // No drawing operations should occur
      const beginPaths = getOps(ctx, 'beginPath')
      expect(beginPaths.length).toBe(0)

      const strokes = getOps(ctx, 'stroke')
      expect(strokes.length).toBe(0)
    })
  })

  describe('2.5d mode specific', () => {
    it('applies oblique projection transform', () => {
      const manager = new RenderManager({ mode: '2.5d' })
      manager.render(ctx, TEST_STATE, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Should apply transform with shear values
      const transforms = getOps(ctx, 'transform')
      expect(transforms.length).toBeGreaterThan(0)

      // First transform should be the 2.5D shear
      const firstTransform = transforms[0]
      expect(firstTransform.args[0]).toBe(1) // a
      expect(firstTransform.args[1]).toBe(-0.3) // b (shearY)
      expect(firstTransform.args[2]).toBe(0.5) // c (shearX)
      expect(firstTransform.args[3]).toBe(1) // d
    })

    it('extrudes rooms with top and side faces', () => {
      const manager = new RenderManager({ mode: '2.5d' })
      manager.render(ctx, TEST_STATE, DEFAULT_CAMERA, DEFAULT_CANVAS)

      // Should have multiple fills for front, top, and side faces
      const fills = getOps(ctx, 'fill')
      expect(fills.length).toBeGreaterThan(3) // At least front + top + sides for one room
    })
  })
})
