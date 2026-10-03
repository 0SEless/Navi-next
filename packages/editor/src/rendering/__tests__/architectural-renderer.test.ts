import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  renderWalls,
  renderRooms,
  renderDoors,
  renderWindows,
  renderStairsElevators,
  renderEntrances,
  renderPOIs,
  DEFAULT_ARCHITECTURAL_STYLE,
} from '../architectural-renderer'
import type {
  Wall,
  Room,
  Door,
  Window,
  StairElevatorFeature,
  Entrance,
  POI,
} from '../architectural-renderer'

function createMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D
}

const WALLS: Wall[] = [
  { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { start: { x: 100, y: 0 }, end: { x: 100, y: 80 }, thickness: 6 },
]

const ROOMS: Room[] = [
  { polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], label: 'Room A' },
  { polygon: [{ x: 0, y: 0 }, { x: 50, y: 0 }], label: 'Degenerate' },
]

const DOORS: Door[] = [
  { position: { x: 50, y: 0 }, width: 12, orientation: 0 },
]

const WINDOWS: Window[] = [
  { position: { x: 30, y: 80 }, width: 14, orientation: 0 },
]

const FEATURES: StairElevatorFeature[] = [
  { type: 'stair', position: { x: 200, y: 200 }, label: 'Stairs 1' },
  { type: 'elevator', position: { x: 250, y: 200 }, label: 'Elevator 1' },
]

const ENTRANCES: Entrance[] = [
  { position: { x: 0, y: 40 }, label: 'Main' },
]

const POIS: POI[] = [
  { position: { x: 50, y: 50 }, label: 'Info Desk' },
]

describe('architectural-renderer', () => {
  let ctx: ReturnType<typeof createMockCtx>

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = createMockCtx()
  })

  describe('renderWalls', () => {
    it('draws each wall segment', () => {
      renderWalls(ctx, WALLS)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.moveTo).toHaveBeenCalledTimes(2)
      expect(ctx.lineTo).toHaveBeenCalledTimes(2)
      expect(ctx.stroke).toHaveBeenCalledTimes(2)
    })

    it('applies custom thickness from wall', () => {
      renderWalls(ctx, WALLS)
      const calls = (ctx as any).lineWidth as number
      // second wall has thickness: 6
      expect(calls).toBe(6)
    })

    it('uses default style values', () => {
      renderWalls(ctx, WALLS)
      expect(ctx.strokeStyle).toBe(DEFAULT_ARCHITECTURAL_STYLE.wallColor)
      expect(ctx.lineCap).toBe('round')
    })

    it('accepts style overrides', () => {
      renderWalls(ctx, WALLS, { wallColor: '#FF0000' })
      expect(ctx.strokeStyle).toBe('#FF0000')
    })

    it('handles empty walls array', () => {
      renderWalls(ctx, [])
      expect(ctx.moveTo).not.toHaveBeenCalled()
    })
  })

  describe('renderRooms', () => {
    it('fills and strokes valid room polygons', () => {
      renderRooms(ctx, ROOMS)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.fill).toHaveBeenCalledTimes(1)
      expect(ctx.stroke).toHaveBeenCalledTimes(1)
    })

    it('skips degenerate polygons with fewer than 3 points', () => {
      renderRooms(ctx, ROOMS)
      expect(ctx.fill).toHaveBeenCalledTimes(1)
    })

    it('draws room label at centroid', () => {
      renderRooms(ctx, ROOMS)
      expect(ctx.fillText).toHaveBeenCalledWith('Room A', 50, 40)
    })

    it('applies custom style', () => {
      const room: Room = { polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }
      renderRooms(ctx, [room], { roomFill: 'rgba(0,0,0,0.5)' })
      expect(ctx.fillStyle).toBe('rgba(0,0,0,0.5)')
    })

    it('handles empty rooms array', () => {
      renderRooms(ctx, [])
      expect(ctx.fill).not.toHaveBeenCalled()
    })
  })

  describe('renderDoors', () => {
    it('draws door line and hinge arc', () => {
      renderDoors(ctx, DOORS, WALLS)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.moveTo).toHaveBeenCalled()
      expect(ctx.lineTo).toHaveBeenCalled()
      expect(ctx.arc).toHaveBeenCalled()
      expect(ctx.stroke).toHaveBeenCalled()
    })

    it('applies door color from style', () => {
      renderDoors(ctx, DOORS, WALLS)
      expect(ctx.strokeStyle).toBe(DEFAULT_ARCHITECTURAL_STYLE.doorColor)
    })

    it('handles empty doors array', () => {
      renderDoors(ctx, [], WALLS)
      expect(ctx.moveTo).not.toHaveBeenCalled()
    })
  })

  describe('renderWindows', () => {
    it('draws window line with perpendicular end markers', () => {
      renderWindows(ctx, WINDOWS, WALLS)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.moveTo).toHaveBeenCalled()
      expect(ctx.lineTo).toHaveBeenCalled()
      expect(ctx.stroke).toHaveBeenCalled()
    })

    it('applies window color from style', () => {
      renderWindows(ctx, WINDOWS, WALLS)
      expect(ctx.strokeStyle).toBe(DEFAULT_ARCHITECTURAL_STYLE.windowColor)
    })

    it('handles empty windows array', () => {
      renderWindows(ctx, [], WALLS)
      expect(ctx.moveTo).not.toHaveBeenCalled()
    })
  })

  describe('renderStairsElevators', () => {
    it('draws stair rectangle with tread lines', () => {
      renderStairsElevators(ctx, FEATURES)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.fillRect).toHaveBeenCalled()
      expect(ctx.strokeRect).toHaveBeenCalled()
    })

    it('draws elevator with X marker', () => {
      renderStairsElevators(ctx, FEATURES)
      const fills = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length
      const strokes = (ctx.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length
      expect(fills).toBeGreaterThanOrEqual(2)
      expect(strokes).toBeGreaterThanOrEqual(2)
    })

    it('draws labels below features', () => {
      renderStairsElevators(ctx, FEATURES)
      expect(ctx.fillText).toHaveBeenCalledWith('Stairs 1', 200, 200 + DEFAULT_ARCHITECTURAL_STYLE.featureSize / 2 + 3)
      expect(ctx.fillText).toHaveBeenCalledWith('Elevator 1', 250, 200 + DEFAULT_ARCHITECTURAL_STYLE.featureSize * 0.9 / 2 + 3)
    })

    it('handles empty features array', () => {
      renderStairsElevators(ctx, [])
      expect(ctx.fillRect).not.toHaveBeenCalled()
    })
  })

  describe('renderEntrances', () => {
    it('draws entrance circles', () => {
      renderEntrances(ctx, ENTRANCES)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.arc).toHaveBeenCalled()
      expect(ctx.fill).toHaveBeenCalled()
    })

    it('draws entrance labels', () => {
      renderEntrances(ctx, ENTRANCES)
      expect(ctx.fillText).toHaveBeenCalledWith('Main', 0, 40 + DEFAULT_ARCHITECTURAL_STYLE.entranceSize + 3)
    })

    it('applies entrance color', () => {
      renderEntrances(ctx, ENTRANCES)
      expect(ctx.fillStyle).toBe(DEFAULT_ARCHITECTURAL_STYLE.entranceColor)
    })

    it('handles empty entrances array', () => {
      renderEntrances(ctx, [])
      expect(ctx.arc).not.toHaveBeenCalled()
    })
  })

  describe('renderPOIs', () => {
    it('draws POI pin markers', () => {
      renderPOIs(ctx, POIS)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
      expect(ctx.fill).toHaveBeenCalled()
      expect(ctx.stroke).toHaveBeenCalled()
    })

    it('draws POI labels', () => {
      renderPOIs(ctx, POIS)
      expect(ctx.fillText).toHaveBeenCalledWith('Info Desk', 50, 50 + DEFAULT_ARCHITECTURAL_STYLE.poiSize + 2)
    })

    it('applies POI color', () => {
      const poiNoLabel: POI = { position: { x: 50, y: 50 }, label: '' }
      renderPOIs(ctx, [poiNoLabel])
      expect(ctx.fillStyle).toBe(DEFAULT_ARCHITECTURAL_STYLE.poiColor)
    })

    it('handles empty pois array', () => {
      renderPOIs(ctx, [])
      expect(ctx.fill).not.toHaveBeenCalled()
    })
  })

  describe('style overrides', () => {
    it('DEFAULT_ARCHITECTURAL_STYLE has all required keys', () => {
      const s = DEFAULT_ARCHITECTURAL_STYLE
      expect(s.wallColor).toBeTruthy()
      expect(s.wallWidth).toBeGreaterThan(0)
      expect(s.roomFill).toBeTruthy()
      expect(s.doorColor).toBeTruthy()
      expect(s.windowColor).toBeTruthy()
      expect(s.featureFill).toBeTruthy()
      expect(s.entranceColor).toBeTruthy()
      expect(s.poiColor).toBeTruthy()
      expect(s.labelFont).toBeTruthy()
    })
  })
})
