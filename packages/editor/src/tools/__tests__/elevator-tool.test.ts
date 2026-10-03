import { describe, expect, it, vi } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { ElevatorTool } from '../elevator-tool'
import type { ToolContext, ToolPointerEvent } from '../types'

const event = (x: number, y: number): ToolPointerEvent => ({ x, y, lng: x, lat: y, button: 0, shiftKey: false, ctrlKey: false, altKey: false })
const doc: CampusDocument = { schemaVersion: 1, version: 0, metadata: { campusId: 'c', name: 'C', description: '', lastModified: '', editorVersion: '' }, buildings: [{ id: 'b', name: 'B', code: 'B', category: 'academic', description: '', footprint: { points: [] }, baseElevation: 0, height: 3, floors: [{ id: 'f', level: 2, label: '2F', elevation: 6, height: 3, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {} }], verticalConnectors: [], color: '#000', aliases: [], metadata: {} }], roads: [], panoramas: [], qrCheckpoints: [] }
const context = (execute = vi.fn()): ToolContext => ({ document: doc, services: { dispatcher: { execute }, viewport: { activeBuildingId: 'b', activeFloorId: 'f' } } as unknown as ToolContext['services'] })

describe('ElevatorTool rectangle authoring', () => {
  it('previews then creates a footprint through the canonical feature command', () => {
    const execute = vi.fn()
    const tool = new ElevatorTool()
    const ctx = context(execute)
    tool.onPointerDown(event(4, 8), ctx)
    tool.onPointerMove(event(1, 2), ctx)
    expect(tool.preview).toHaveLength(4)
    tool.onPointerUp(event(1, 2), ctx)
    expect(execute.mock.calls[0][0]).toMatchObject({
      id: 'feature.create',
      payload: { buildingId: 'b', floor: 2, featureType: 'elevator', fromLevel: 2, toLevel: 3, position: { x: 2.5, y: 5 }, rotation: 0, polygon: { points: [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 8 }, { x: 1, y: 8 }] } },
    })
  })
})
