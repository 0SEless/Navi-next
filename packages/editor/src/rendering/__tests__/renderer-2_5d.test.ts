import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Room, Hallway, Building, Floor } from '@navi/core'
import type { LocalCoord, LocalPolygon, LocalPolyline } from '@navi/core'
import { renderWalls2_5d, renderFloor2_5d, apply2_5dTransform, reset2_5dTransform, roomsToWalls2_5d, roomsToFloors2_5d, hallwaysToWalls2_5d, buildingToWalls2_5d, buildingToFloors2_5d, DEFAULT_STYLE_2_5D, type Wall2_5d, type Floor2_5d, type Style2_5d, } from '../renderer-2_5d'

function createMockCtx(): CanvasRenderingContext2D { return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillStyle: '', strokeStyle: '', lineWidth: 1, shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '', rotate: vi.fn(), scale: vi.fn(), } as unknown as CanvasRenderingContext2D }
function makeLocalCoord(x: number, y: number): LocalCoord { return { x, y } }
function makeRoom(id: string, points: LocalCoord[], category = 'classroom'): Room { return { id, name: `Room ${id}`, number: '101', category: category as any, polygon: { points: [...points, points[0]] } as LocalPolygon, roomDoors: [], capacity: 30, metadata: {} } }
function makeHallway(id: string, points: LocalCoord[], width = 2): Hallway { return { id, name: `Hallway ${id}`, polyline: { points } as LocalPolyline, width } }

describe('renderer-2_5d', () => {
  let ctx: CanvasRenderingContext2D
  beforeEach(() => { ctx = createMockCtx() })

  describe('apply2_5dTransform', () => {
    it('calls save, rotate, and scale', () => {
      apply2_5dTransform(ctx, 30, 0)
      expect(ctx.save).toHaveBeenCalledOnce()
      expect(ctx.rotate).toHaveBeenCalledOnce()
      expect(ctx.scale).toHaveBeenCalledOnce()
      const rotateAngle = (ctx.rotate as any).mock.calls[0][0]
      expect(rotateAngle).toBeCloseTo(0)
      const [scaleX, scaleY] = (ctx.scale as any).mock.calls[0]
      expect(scaleX).toBeCloseTo(Math.cos((30 * Math.PI) / 180))
      expect(scaleY).toBeCloseTo(Math.cos((30 * Math.PI) / 180) * 0.6)
    })
    it('applies rotation when tilt is 0', () => {
      apply2_5dTransform(ctx, 0, 45)
      const rotateAngle = (ctx.rotate as any).mock.calls[0][0]
      expect(rotateAngle).toBeCloseTo(-(45 * Math.PI) / 180)
    })
    it('combines tilt and rotation', () => {
      apply2_5dTransform(ctx, 45, 90)
      const rotateAngle = (ctx.rotate as any).mock.calls[0][0]
      expect(rotateAngle).toBeCloseTo(-(90 * Math.PI) / 180)
      const expectedTiltRad = (45 * Math.PI) / 180
      const [scaleX, scaleY] = (ctx.scale as any).mock.calls[0]
      expect(scaleX).toBeCloseTo(Math.cos(expectedTiltRad))
      expect(scaleY).toBeCloseTo(Math.cos(expectedTiltRad) * 0.6)
    })
  })
  describe('reset2_5dTransform', () => {
    it('calls restore', () => { reset2_5dTransform(ctx); expect(ctx.restore).toHaveBeenCalledOnce() })
  })
  describe('roomsToWalls2_5d', () => {
    it('extracts wall segments from room polygons', () => {
      const room = makeRoom('room-1', [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)])
      const walls = roomsToWalls2_5d([room], 3.5)
      expect(walls).toHaveLength(4)
      expect(walls[0].id).toBe('room-1-wall-0')
      expect(walls[0].points).toHaveLength(2)
      expect(walls[0].height).toBe(3.5)
    })
    it('skips rooms with fewer than 3 points', () => {
      const room = makeRoom('room-1', [])
      expect(roomsToWalls2_5d([room], 3.5)).toHaveLength(0)
    })
    it('handles multiple rooms', () => {
      const r1 = makeRoom('r1', [makeLocalCoord(0,0), makeLocalCoord(5,0), makeLocalCoord(5,5), makeLocalCoord(0,5)])
      const r2 = makeRoom('r2', [makeLocalCoord(6,0), makeLocalCoord(11,0), makeLocalCoord(11,5), makeLocalCoord(6,5)])
      expect(roomsToWalls2_5d([r1, r2], 3.5)).toHaveLength(8)
    })
    it('uses style wall color', () => {
      const room = makeRoom('room-1', [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)])
      const walls = roomsToWalls2_5d([room], 3.5, { ...DEFAULT_STYLE_2_5D, wallColor: '#FF0000' })
      expect(walls[0].color).toBe('#FF0000')
    })
  })
  describe('roomsToFloors2_5d', () => {
    it('extracts floor polygons', () => {
      const room = makeRoom('room-1', [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)])
      const floors = roomsToFloors2_5d([room])
      expect(floors).toHaveLength(1)
      expect(floors[0].id).toBe('room-1')
      expect(floors[0].points.length).toBeGreaterThanOrEqual(3)
    })
    it('uses style floor color', () => {
      const room = makeRoom('room-1', [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)])
      const floors = roomsToFloors2_5d([room], { ...DEFAULT_STYLE_2_5D, floorColor: '#00FF00' })
      expect(floors[0].color).toBe('#00FF00')
    })
  })
  describe('hallwaysToWalls2_5d', () => {
    it('creates left and right walls', () => {
      const hw = makeHallway('hw-1', [makeLocalCoord(0,0), makeLocalCoord(10,0)])
      const walls = hallwaysToWalls2_5d([hw], 3.5)
      expect(walls).toHaveLength(2)
      expect(walls[0].id).toBe('hw-1-wall-left')
      expect(walls[1].id).toBe('hw-1-wall-right')
    })
    it('handles multi-segment hallways', () => {
      const hw = makeHallway('hw-1', [makeLocalCoord(0,0), makeLocalCoord(5,0), makeLocalCoord(5,5), makeLocalCoord(10,5)])
      const walls = hallwaysToWalls2_5d([hw], 3.5)
      expect(walls).toHaveLength(2)
      expect(walls[0].points.length).toBeGreaterThanOrEqual(2)
    })
    it('skips hallways with fewer than 2 points', () => {
      const hw = makeHallway('hw-1', [makeLocalCoord(0,0)])
      expect(hallwaysToWalls2_5d([hw], 3.5)).toHaveLength(0)
    })
  })
  describe('buildingToWalls2_5d', () => {
    it('combines room and hallway walls', () => {
      const room = makeRoom('room-1', [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)])
      const hw = makeHallway('hw-1', [makeLocalCoord(5,0), makeLocalCoord(5,10)])
      const bld = { id: 'bld-1', name: 'Test', code: 'TB', category: 'academic', description: '', footprint: { points: [] }, baseElevation: 0, height: 20, color: '#4A90D9', floors: [], aliases: [], metadata: {} } as unknown as Building
      const floor = { id: 'f1', level: 0, label: 'Ground', elevation: 0, height: 3.5, rooms: [room], hallways: [hw], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} } as unknown as Floor
      expect(buildingToWalls2_5d(bld, floor)).toHaveLength(6)
    })
  })
  describe('buildingToFloors2_5d', () => {
    it('extracts floor polygons', () => {
      const room = makeRoom('room-1', [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)])
      const bld = { id: 'bld-1', name: 'Test' } as unknown as Building
      const floor = { id: 'f1', level: 0, label: 'Ground', elevation: 0, height: 3.5, rooms: [room], hallways: [], metadata: {} } as unknown as Floor
      const floors = buildingToFloors2_5d(bld, floor)
      expect(floors).toHaveLength(1)
      expect(floors[0].points.length).toBeGreaterThanOrEqual(3)
    })
  })
  describe('renderWalls2_5d', () => {
    it('calls Canvas 2D methods', () => {
      const walls: Wall2_5d[] = [{ id: 'w1', points: [{x:0,y:0},{x:10,y:0}], height: 3.5, color: '#4A90D9', opacity: 0.85 }]
      renderWalls2_5d(ctx, walls)
      expect(ctx.save).toHaveBeenCalledOnce()
      expect(ctx.restore).toHaveBeenCalledOnce()
      expect(ctx.beginPath).toHaveBeenCalled()
      expect(ctx.fill).toHaveBeenCalled()
      expect(ctx.stroke).toHaveBeenCalled()
    })
    it('renders multiple walls', () => {
      const walls: Wall2_5d[] = [{ id: 'w1', points: [{x:0,y:0},{x:10,y:0}], height: 3.5, color: '#4A90D9', opacity: 0.85 }, { id: 'w2', points: [{x:10,y:0},{x:10,y:10}], height: 3.5, color: '#4A90D9', opacity: 0.85 }]
      renderWalls2_5d(ctx, walls)
      expect(ctx.beginPath).toHaveBeenCalledTimes(2)
      expect(ctx.fill).toHaveBeenCalledTimes(2)
    })
    it('skips walls with fewer than 2 points', () => {
      renderWalls2_5d(ctx, [{ id: 'w1', points: [{x:0,y:0}], height: 3.5, color: '#4A90D9', opacity: 0.85 }])
      expect(ctx.beginPath).not.toHaveBeenCalled()
    })
  })
  describe('renderFloor2_5d', () => {
    it('calls Canvas 2D methods', () => {
      const floors: Floor2_5d[] = [{ id: 'f1', points: [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], color: '#87CEEB', opacity: 0.4 }]
      renderFloor2_5d(ctx, floors)
      expect(ctx.save).toHaveBeenCalledOnce()
      expect(ctx.restore).toHaveBeenCalledOnce()
      expect(ctx.beginPath).toHaveBeenCalled()
      expect(ctx.fill).toHaveBeenCalled()
      expect(ctx.stroke).toHaveBeenCalled()
    })
    it('skips floors with fewer than 3 points', () => {
      renderFloor2_5d(ctx, [{ id: 'f1', points: [{x:0,y:0},{x:10,y:0}], color: '#87CEEB', opacity: 0.4 }])
      expect(ctx.beginPath).not.toHaveBeenCalled()
    })
  })
  describe('same geometry as 2D renderer', () => {
    it('roomsToWalls2_5d produces walls matching room polygon edges', () => {
      const points: LocalCoord[] = [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)]
      const room = makeRoom('room-1', points)
      const walls = roomsToWalls2_5d([room], 3.5)
      expect(walls).toHaveLength(points.length)
      for (let i = 0; i < points.length; i++) {
        const wall = walls[i]
        expect(wall.points[0]).toEqual(points[i])
        expect(wall.points[1]).toEqual(points[(i + 1) % points.length])
      }
    })
    it('roomsToFloors2_5d produces floor matching room polygon', () => {
      const points: LocalCoord[] = [makeLocalCoord(0,0), makeLocalCoord(10,0), makeLocalCoord(10,10), makeLocalCoord(0,10)]
      const room = makeRoom('room-1', points)
      const floors = roomsToFloors2_5d([room])
      expect(floors).toHaveLength(1)
      expect(floors[0].points).toEqual(room.polygon.points)
    })
    it('hallwaysToWalls2_5d walls are offset from polyline by half width', () => {
      const hw = makeHallway('hw-1', [makeLocalCoord(0,0), makeLocalCoord(10,0)], 4)
      const walls = hallwaysToWalls2_5d([hw], 3.5)
      expect(walls).toHaveLength(2)
      const leftWall = walls.find((w: any) => w.id.includes('left'))!
      const rightWall = walls.find((w: any) => w.id.includes('right'))!
      const leftY = leftWall.points[0].y
      const rightY = rightWall.points[0].y
      expect(Math.abs(leftY)).toBe(2)
      expect(Math.abs(rightY)).toBe(2)
      expect(leftY).not.toBe(rightY)
    })
  })
  describe('DEFAULT_STYLE_2_5d', () => {
    it('has valid default values', () => {
      expect(DEFAULT_STYLE_2_5D.wallColor).toMatch(/^#[0-9A-F]{6}$/i)
      expect(DEFAULT_STYLE_2_5D.wallOpacity).toBeGreaterThan(0)
      expect(DEFAULT_STYLE_2_5D.wallOpacity).toBeLessThanOrEqual(1)
      expect(DEFAULT_STYLE_2_5D.floorColor).toMatch(/^#[0-9A-F]{6}$/i)
      expect(DEFAULT_STYLE_2_5D.floorOpacity).toBeGreaterThan(0)
      expect(DEFAULT_STYLE_2_5D.floorOpacity).toBeLessThanOrEqual(1)
      expect(DEFAULT_STYLE_2_5D.wallHeight).toBeGreaterThan(0)
      expect(DEFAULT_STYLE_2_5D.strokeWidth).toBeGreaterThan(0)
    })
  })
})
