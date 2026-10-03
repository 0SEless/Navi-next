import { describe, it, expect } from 'vitest'
import { deriveWorkspace } from '../projections/workspace'
import { asEntityId } from './entity-id'

describe('deriveWorkspace', () => {
  it('campus mode when nothing selected', () => {
    const ws = deriveWorkspace(null)
    expect(ws.mode).toBe('campus')
    expect(ws.activeBuildingId).toBeUndefined()
    expect(ws.activeFloorId).toBeUndefined()
  })

  it('building mode when a building is selected', () => {
    const ws = deriveWorkspace({ type: 'building', id: asEntityId('bld-1') })
    expect(ws.mode).toBe('building')
    expect(ws.activeBuildingId).toBe('bld-1')
    expect(ws.activeFloorId).toBeUndefined()
  })

  it('floor mode when a floor is selected', () => {
    const ws = deriveWorkspace({
      type: 'floor',
      id: asEntityId('flr-2'),
      buildingId: asEntityId('bld-1'),
    })
    expect(ws.mode).toBe('floor')
    expect(ws.activeBuildingId).toBe('bld-1')
    expect(ws.activeFloorId).toBe('flr-2')
  })

  it('floor mode when a room (nested entity) is selected', () => {
    const ws = deriveWorkspace({
      type: 'room',
      id: asEntityId('rm-1'),
      buildingId: asEntityId('bld-1'),
      floorId: asEntityId('flr-1'),
    })
    expect(ws.mode).toBe('floor')
    expect(ws.activeBuildingId).toBe('bld-1')
  })

  it('floor mode for hallway', () => {
    const ws = deriveWorkspace({
      type: 'hallway',
      id: asEntityId('hw-1'),
      buildingId: asEntityId('bld-1'),
      floorId: asEntityId('flr-1'),
    })
    expect(ws.mode).toBe('floor')
    expect(ws.activeBuildingId).toBe('bld-1')
  })

  it('floor mode for staircase', () => {
    const ws = deriveWorkspace({
      type: 'staircase',
      id: asEntityId('st-1'),
      buildingId: asEntityId('bld-1'),
      floorId: asEntityId('flr-1'),
    })
    expect(ws.mode).toBe('floor')
    expect(ws.activeBuildingId).toBe('bld-1')
  })

  it('floor mode for elevator', () => {
    const ws = deriveWorkspace({
      type: 'elevator',
      id: asEntityId('el-1'),
      buildingId: asEntityId('bld-1'),
      floorId: asEntityId('flr-1'),
    })
    expect(ws.mode).toBe('floor')
    expect(ws.activeBuildingId).toBe('bld-1')
  })

  it('floor mode for entrance', () => {
    const ws = deriveWorkspace({
      type: 'entrance',
      id: asEntityId('en-1'),
      buildingId: asEntityId('bld-1'),
      floorId: asEntityId('flr-1'),
    })
    expect(ws.mode).toBe('floor')
    expect(ws.activeBuildingId).toBe('bld-1')
  })

  it('campus mode for road', () => {
    const ws = deriveWorkspace({ type: 'road', id: asEntityId('rd-1') })
    expect(ws.mode).toBe('campus')
    expect(ws.activeBuildingId).toBeUndefined()
  })

  it('campus mode for panorama', () => {
    const ws = deriveWorkspace({ type: 'panorama', id: asEntityId('pan-1') })
    expect(ws.mode).toBe('campus')
  })

  it('campus mode for QR', () => {
    const ws = deriveWorkspace({ type: 'qr', id: asEntityId('qr-1') })
    expect(ws.mode).toBe('campus')
  })
})
