import { describe, it, expect } from 'vitest'
import { RoomTool } from '../room-tool'

function mockCtx() {
  return { services: {} } as any
}

describe('RoomTool', () => {
  it('has correct id and label', () => {
    const tool = new RoomTool()
    expect(tool.id).toBe('space')
    expect(tool.label).toBe('Room')
    expect(tool.cursor).toBe('crosshair')
  })

  it('starts in idle state', () => {
    const tool = new RoomTool()
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
  })

  it('enters drawing state on pointerDown', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 1, y: 2 } as any, mockCtx())
    expect(tool.state.drawing).toBe(true)
    expect(tool.state.vertices).toHaveLength(1)
    expect(tool.state.vertices[0]).toEqual({ x: 1, y: 2 })
  })

  it('accumulates vertices on multiple pointerDown', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 8 } as any, mockCtx())
    expect(tool.state.vertices).toHaveLength(3)
    expect(tool.canConfirm()).toBe(true)
  })

  it('finalize() returns vertices and resets', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 8 } as any, mockCtx())
    const result = tool.finalize()
    expect(result).toHaveLength(3)
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
  })

  it('finalize() returns null when fewer than 3 vertices', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    const result = tool.finalize()
    expect(result).toBeNull()
  })

  it('canConfirm() returns false with fewer than 3 vertices', () => {
    const tool = new RoomTool()
    expect(tool.canConfirm()).toBe(false)
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    expect(tool.canConfirm()).toBe(false)
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    expect(tool.canConfirm()).toBe(false)
  })

  it('Escape key resets state', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onKeyDown({ key: 'Escape' } as any, mockCtx())
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
  })

  it('Backspace removes last vertex', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 0 } as any, mockCtx())
    tool.onPointerDown({ x: 10, y: 8 } as any, mockCtx())
    tool.onKeyDown({ key: 'Backspace' } as any, mockCtx())
    expect(tool.state.vertices).toHaveLength(2)
  })

  it('cancel() resets state', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.cancel()
    expect(tool.state.drawing).toBe(false)
    expect(tool.state.vertices).toEqual([])
  })

  it('onActivate resets state', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onActivate(mockCtx())
    expect(tool.state.drawing).toBe(false)
  })

  it('onDeactivate resets state', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 0, y: 0 } as any, mockCtx())
    tool.onDeactivate(mockCtx())
    expect(tool.state.drawing).toBe(false)
  })

  it('getVertices returns a copy', () => {
    const tool = new RoomTool()
    tool.onPointerDown({ x: 5, y: 5 } as any, mockCtx())
    const verts = tool.getVertices()
    verts.push({ x: 99, y: 99 })
    expect(tool.state.vertices).toHaveLength(1)
  })
})
