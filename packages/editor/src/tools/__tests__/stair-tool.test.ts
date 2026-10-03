import { describe, expect, it, vi } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { StairTool } from '../stair-tool'
import type { ToolContext, ToolPointerEvent } from '../types'

const event = (x: number, y: number): ToolPointerEvent => ({ x, y, lng: x, lat: y, button: 0, shiftKey: false, ctrlKey: false, altKey: false })
const doc: CampusDocument = { schemaVersion: 1, version: 0, metadata: { campusId: 'c', name: 'C', description: '', lastModified: '', editorVersion: '' }, buildings: [{ id: 'b', name: 'B', code: 'B', category: 'academic', description: '', footprint: { points: [] }, baseElevation: 0, height: 3, floors: [{ id: 'f', level: 0, label: 'GF', elevation: 0, height: 3, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} }], verticalConnectors: [], color: '#000', aliases: [], metadata: {} }], roads: [], panoramas: [], qrCheckpoints: [] }
const context = (execute = vi.fn()): ToolContext => ({ document: doc, services: { dispatcher: { execute }, viewport: { activeBuildingId: 'b', activeFloorId: 'f' } } as unknown as ToolContext['services'] })

describe('StairTool rectangle authoring', () => {
  it('previews then creates a footprint while preserving vertical metadata', () => {
    const execute = vi.fn()
    const tool = new StairTool()
    const ctx = context(execute)
    tool.onPointerDown(event(1, 2), ctx)
    tool.onPointerMove(event(5, 4), ctx)
    expect(tool.preview).toHaveLength(4)
    expect(execute).not.toHaveBeenCalled()
    tool.onPointerUp(event(5, 4), ctx)
    expect(execute.mock.calls[0][0]).toMatchObject({
      id: 'feature.create',
      payload: { buildingId: 'b', floor: 0, featureType: 'staircase', fromLevel: 0, toLevel: 1, position: { x: 3, y: 3 }, rotation: 0, polygon: { points: [{ x: 1, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 1, y: 4 }] } },
    })
  })
})
