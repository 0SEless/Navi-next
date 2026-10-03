import { describe, expect, it } from 'vitest'
import { buildFloorRectangleCommand, buildFloorRectangleEditCommand, rectangleRotationHandleScreenPoint } from '../floor-rectangle-authoring'

const rectangle = { min: { x: 1, y: 2 }, max: { x: 5, y: 4 }, center: { x: 3, y: 3 }, width: 4, depth: 2, points: [{ x: 1, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 1, y: 4 }] }

describe('production Floor rectangle authoring commands', () => {
  it('builds Door creation without a wall dependency', () => {
    expect(buildFloorRectangleCommand('door', rectangle, { buildingId: 'b', floorId: 'f', floorLevel: 0, entityId: 'd' })).toEqual({
      command: { id: 'door.create', label: 'Create Door', payload: { buildingId: 'b', floorId: 'f', door: { id: 'd', name: 'Door', doorType: 'standard', position: { x: 3, y: 3 }, width: 4, depth: 2, rotation: 0, geometry: { type: 'rectangle', min: { x: 1, y: 2 }, max: { x: 5, y: 4 }, rotation: 0 }, metadata: {} } } },
      selectedId: 'd',
    })
  })

  it.each([['stairs', 'staircase'], ['elevator', 'elevator']] as const)('builds %s footprint with vertical identity', (tool, featureType) => {
    expect(buildFloorRectangleCommand(tool, rectangle, { buildingId: 'b', floorId: 'f', floorLevel: 2, entityId: 'v' })).toEqual({
      command: { id: 'feature.create', label: featureType === 'staircase' ? 'Create Staircase' : 'Create Elevator', payload: { buildingId: 'b', floor: 2, id: 'v', featureType, position: { x: 3, y: 3 }, rotation: 0, polygon: { points: rectangle.points }, fromLevel: 2, toLevel: 3 } },
      selectedId: 'v-2',
    })
  })

  it('routes Door edits to door.update and vertical edits to feature.update', () => {
    const points = [{ x: 3, y: -1 }, { x: 3, y: 3 }, { x: 1, y: 3 }, { x: 1, y: -1 }]
    expect(buildFloorRectangleEditCommand({ id: 'd', type: 'door', floor: 0 }, points)).toMatchObject({
      id: 'door.update', payload: { doorId: 'd', patch: { position: { x: 2, y: 1 }, width: 4, depth: 2, rotation: Math.PI / 2 } },
    })
    expect(buildFloorRectangleEditCommand({ id: 's-0', featureId: 's', type: 'stair', floor: 0 }, points)).toEqual({
      id: 'feature.update', label: 'Edit stair', payload: { featureId: 's', level: 0, patch: { position: { x: 2, y: 1 }, rotation: Math.PI / 2, polygon: { points } } },
    })
  })

  it('keeps the rotation handle at a fixed readable screen distance', () => {
    expect(rectangleRotationHandleScreenPoint({ x: 100, y: 100 }, { x: 100, y: 80 })).toEqual({ x: 100, y: 56 })
    expect(Math.hypot(100 - 100, 80 - 56)).toBe(24)
  })
})
