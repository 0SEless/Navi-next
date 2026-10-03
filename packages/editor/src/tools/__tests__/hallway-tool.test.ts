import { describe, it, expect } from 'vitest'
import { HallwayTool } from '../hallway-tool'

function mockCtx() {
  return { services: {} } as any
}

describe('HallwayTool', () => {
  it('has correct id and label', () => {
    const tool = new HallwayTool()
    expect(tool.id).toBe('hallway')
    expect(tool.label).toBe('Hallway')
    expect(tool.cursor).toBe('crosshair')
  })

  it('starts in idle state', () => {
    const tool = new HallwayTool()
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
    expect(tool.state.width).toBe(3)
  })

  it('enters drawing state on pointerDown', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 1, y: 2 } as any, mockCtx())
    expect(tool.state.drawing).toBe(true)
    expect(tool.state.vertices).toHaveLength(1)
  })

  it('canConfirm() requires at least 2 vertices', () => {
    const tool = new HallwayTool()
    expect(tool.canConfirm()).toBe(false)
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    expect(tool.canConfirm()).toBe(false)
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    expect(tool.canConfirm()).toBe(true)
  })

  it('finalize() returns vertices and resets', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 10 } as any, mockCtx())
    const result = tool.finalize()
    expect(result).toHaveLength(2)
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
  })

  it('finalize() returns null when fewer than 2 vertices', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    const result = tool.finalize()
    expect(result).toBeNull()
  })

  it('width can be set and retrieved', () => {
    const tool = new HallwayTool()
    tool.setWidth(5)
    expect(tool.getWidth()).toBe(5)
    expect(tool.state.width).toBe(5)
  })

  it('width is clamped to minimum 0.5', () => {
    const tool = new HallwayTool()
    tool.setWidth(0.1)
    expect(tool.getWidth()).toBe(0.5)
  })

  it('Escape resets state', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onKeyDown({ key: 'Escape' } as any, mockCtx())
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
  })

  it('Backspace removes last vertex', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 20, y: 0 } as any, mockCtx())
    tool.onKeyDown({ key: 'Backspace' } as any, mockCtx())
    expect(tool.state.vertices).toHaveLength(2)
  })

  it('cancel() resets state', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.cancel()
    expect(tool.state.drawing).toBe(false)
  })

  it('onActivate resets state', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onActivate(mockCtx())
    expect(tool.state.drawing).toBe(false)
  })

  it('onDeactivate resets state', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onDeactivate(mockCtx())
    expect(tool.state.drawing).toBe(false)
  })

  it('getVertices returns a copy', () => {
    const tool = new HallwayTool()
    tool.onPointerDown({ x: 5, y: 5 } as any, mockCtx())
    const verts = tool.getVertices()
    verts.push({ x: 99, y: 99 })
    expect(tool.state.vertices).toHaveLength(1)
  })
})
