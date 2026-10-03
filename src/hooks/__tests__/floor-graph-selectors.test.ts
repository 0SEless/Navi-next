import { describe, expect, it } from 'vitest'
import type { CampusDocument, CoordinateTransformer } from '@navi/core'
import { extractFloorComponents, resolveFloorScope } from '../floor-graph-selectors'

const transformer = {
  buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y, lng: point.x }),
} as unknown as CoordinateTransformer

const floors = [
  {
    id: 'floor-ground', level: -1, label: 'Ground Floor',
    rooms: [{ id: 'room-ground', name: 'Room-G', polygon: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } }],
    hallways: [], staircases: [], elevators: [], entrances: [],
  },
  {
    id: 'floor-one', level: 2, label: '1F',
    rooms: [{ id: 'room-one', name: 'Room-1', polygon: { points: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }] } }],
    hallways: [], staircases: [], elevators: [], entrances: [],
  },
  {
    id: 'floor-two', level: 7, label: '2F',
    rooms: [{ id: 'room-two', name: 'Room-2', polygon: { points: [{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }] } }],
    hallways: [], staircases: [], elevators: [], entrances: [],
  },
]

const doc = {
  buildings: [{ id: 'building-1', floors }],
} as unknown as CampusDocument

describe('active floor scope', () => {
  it('uses canonical floor identity when the floor index differs from Floor.level', () => {
    // Index 1 is the 1F floor, but its actual persisted level is 2.
    expect(resolveFloorScope(floors, 'floor-one', 1)?.level).toBe(2)
  })

  it('keeps the GF → 1F → 2F → GF component projection isolated by floor ID', () => {
    const expected = [
      ['floor-ground', 'room-ground'],
      ['floor-one', 'room-one'],
      ['floor-two', 'room-two'],
      ['floor-ground', 'room-ground'],
    ]

    for (const [floorId, expectedRoomId] of expected) {
      const floor = resolveFloorScope(floors, floorId)
      expect(floor).toBeDefined()
      const components = extractFloorComponents(doc, 'building-1', floor!, transformer)
      expect(components.map((component) => component.id)).toEqual([expectedRoomId])
    }
  })

  it('does not fall back to a different level when an explicit floor ID is missing', () => {
    expect(resolveFloorScope(floors, 'stale-floor-id', 2)).toBeUndefined()
  })
})
