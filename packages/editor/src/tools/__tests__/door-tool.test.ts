import { describe, expect, it, vi } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { DoorTool } from '../door-tool'
import type { ToolContext, ToolPointerEvent } from '../types'

function event(x: number, y: number): ToolPointerEvent {
  return { x, y, lng: x, lat: y, button: 0, shiftKey: false, ctrlKey: false, altKey: false }
}

function document(): CampusDocument {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'c', name: 'C', description: '', lastModified: '', editorVersion: '' },
    buildings: [{
      id: 'b', name: 'B', code: 'B', category: 'academic', description: '', footprint: { points: [] },
      baseElevation: 0, height: 3, color: '#000', aliases: [], metadata: {}, verticalConnectors: [],
      floors: [{ id: 'f', level: 0, label: 'GF', elevation: 0, height: 3, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

function context(execute = vi.fn()): ToolContext {
  return {
    document: document(),
    services: { dispatcher: { execute }, viewport: { activeBuildingId: 'b', activeFloorId: 'f' } } as unknown as ToolContext['services'],
  }
}

describe('DoorTool rectangle authoring', () => {
  it('does not create until a rectangle drag is released', () => {
    const execute = vi.fn()
    const tool = new DoorTool()
    const ctx = context(execute)
    tool.onPointerDown(event(2, 3), ctx)
    tool.onPointerMove(event(6, 5), ctx)
    expect(execute).not.toHaveBeenCalled()
    expect(tool.state.phase).toBe('dragging')
    expect(tool.preview).toEqual([{ x: 2, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 5 }, { x: 2, y: 5 }])
  })

  it('creates a spatial Door without requiring a wall hit', () => {
    const execute = vi.fn()
    const tool = new DoorTool()
    const ctx = context(execute)
    tool.onPointerDown(event(6, 5), ctx)
    tool.onPointerUp(event(2, 3), ctx)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).toEqual({
      id: 'door.create', label: 'Create Door',
      payload: {
        buildingId: 'b', floorId: 'f',
        door: {
          name: 'Door', doorType: 'standard', position: { x: 4, y: 4 }, width: 4, depth: 2, rotation: 0,
          geometry: { type: 'rectangle', min: { x: 2, y: 3 }, max: { x: 6, y: 5 }, rotation: 0 }, metadata: {},
        },
      },
    })
    expect(tool.state.phase).toBe('idle')
  })

  it('rejects a collapsed drag and cancels on Escape', () => {
    const execute = vi.fn()
    const tool = new DoorTool()
    const ctx = context(execute)
    tool.onPointerDown(event(1, 1), ctx)
    tool.onPointerUp(event(1.1, 1.1), ctx)
    expect(execute).not.toHaveBeenCalled()
    tool.onPointerDown(event(1, 1), ctx)
    tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)
    expect(tool.state.phase).toBe('idle')
  })
})
