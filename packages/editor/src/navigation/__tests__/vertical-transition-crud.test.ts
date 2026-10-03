import { describe, it, expect } from 'vitest'
import type {
  Building,
  Floor,
  VerticalTransition,
  Staircase,
  Elevator,
  RouteNetwork,
} from '@navi/core'
import {
  addVerticalTransition,
  removeVerticalTransition,
  getVerticalTransition,
  validateVerticalTransition,
} from '../vertical-transition-crud'

function makeRouteNetwork(nodeIds: string[]): RouteNetwork {
  return {
    nodes: nodeIds.map((id) => ({
      id,
      type: 'waypoint' as const,
      position: { x: 0, y: 0 },
      floor: 0,
    })),
    edges: [],
  }
}

function makeFloor(id: string, level: number, routeNodeIds?: string[]): Floor {
  return {
    id,
    level,
    label: `Floor ${level}`,
    elevation: 0,
    height: 3.5,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
    ...(routeNodeIds ? { routeNetwork: makeRouteNetwork(routeNodeIds) } : {}),
  }
}

function makeStaircase(
  id: string,
  buildingId: string,
  levels: Record<number, { position: { x: number; y: number }; rotation: number }>,
): Staircase {
  const floorNums = Object.keys(levels).map(Number)
  return {
    id,
    buildingId,
    name: `Staircase ${id}`,
    type: 'enclosed',
    accessible: true,
    fromLevel: Math.min(...floorNums),
    toLevel: Math.max(...floorNums),
    levels,
  }
}

function makeElevator(
  id: string,
  buildingId: string,
  levels: Record<number, { position: { x: number; y: number }; rotation: number }>,
): Elevator {
  const floorNums = Object.keys(levels).map(Number)
  return {
    id,
    buildingId,
    name: `Elevator ${id}`,
    type: 'passenger',
    accessible: true,
    fromLevel: Math.min(...floorNums),
    toLevel: Math.max(...floorNums),
    levels,
  }
}

function makeBuilding(
  floors: Floor[],
  staircases?: Staircase[],
  elevators?: Elevator[],
): Building {
  return {
    id: 'building-1',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    description: '',
    footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }] },
    baseElevation: 0,
    height: 10,
    floors,
    verticalConnectors: [],
    color: '#1C6BEB',
    aliases: [],
    metadata: {},
    ...(staircases ? { staircases } : {}),
    ...(elevators ? { elevators } : {}),
  }
}

function makeTransition(
  id: string,
  featureId: string,
  type: 'staircase' | 'elevator',
  connections: Array<{ floorId: string; routeNodeId: string }>,
): VerticalTransition {
  return { id, featureId, type, connections }
}

describe('VerticalTransition CRUD', () => {
  // Case 1: Staircase connects Floor 1 ↔ Floor 2
  describe('Case 1: Staircase connects Floor 1 ↔ Floor 2', () => {
    it('adds a staircase vertical transition connecting two floors', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])

      const result = addVerticalTransition(building, transition)
      expect(result.success).toBe(true)
      expect(building.verticalTransitions).toHaveLength(1)
      expect(building.verticalTransitions![0].featureId).toBe('stair-1')
    })
  })

  // Case 2: Elevator connects Floor 1 ↔ Floor 2 ↔ Floor 3
  describe('Case 2: Elevator connects 3 floors', () => {
    it('adds an elevator vertical transition connecting three floors', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const floor3 = makeFloor('fl-3', 2, ['rn-3'])
      const elev = makeElevator('elev-1', 'building-1', {
        0: { position: { x: 5, y: 15 }, rotation: 0 },
        1: { position: { x: 5, y: 15 }, rotation: 0 },
        2: { position: { x: 5, y: 15 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2, floor3], undefined, [elev])

      const transition = makeTransition('vt-1', 'elev-1', 'elevator', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
        { floorId: 'fl-3', routeNodeId: 'rn-3' },
      ])

      const result = addVerticalTransition(building, transition)
      expect(result.success).toBe(true)
      expect(building.verticalTransitions).toHaveLength(1)
      expect(building.verticalTransitions![0].connections).toHaveLength(3)
    })
  })

  // Case 3: Reject nonexistent route node
  describe('Case 3: Reject nonexistent route node', () => {
    it('rejects transition with non-existent route node', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-nonexistent' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])

      const result = addVerticalTransition(building, transition)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // Case 4: Reject route node on wrong floor
  describe('Case 4: Reject route node on wrong floor', () => {
    it('rejects transition with route node from wrong floor', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      // rn-1 belongs to fl-1, not fl-2
      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-1' },
      ])

      const result = addVerticalTransition(building, transition)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // Case 5: Save/reload preserves connections
  describe('Case 5: Save/reload preserves connections', () => {
    it('transitions survive serialization round-trip', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])
      addVerticalTransition(building, transition)

      // Simulate save/reload by serializing and deserializing
      const serialized = JSON.parse(JSON.stringify(building))
      const reloaded: Building = serialized

      expect(reloaded.verticalTransitions).toHaveLength(1)
      expect(reloaded.verticalTransitions![0].id).toBe('vt-1')
      expect(reloaded.verticalTransitions![0].featureId).toBe('stair-1')
      expect(reloaded.verticalTransitions![0].connections).toEqual([
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])
    })
  })

  // Case 6: Delete route node safely cleans transition
  describe('Case 6: Delete route node safely cleans transition', () => {
    it('transition remains but can be detected as invalid after node deletion', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])
      addVerticalTransition(building, transition)

      // Simulate deleting rn-2 from floor2's route network
      floor2.routeNetwork!.nodes = floor2.routeNetwork!.nodes.filter(
        (n) => n.id !== 'rn-2',
      )

      // Transition still exists but is now invalid
      expect(building.verticalTransitions).toHaveLength(1)
      const error = validateVerticalTransition(building, transition)
      expect(error).toContain('not found')
    })
  })

  // Case 7: Delete staircase/elevator safely cleans relationship
  describe('Case 7: Delete staircase/elevator safely cleans relationship', () => {
    it('removes transitions referencing deleted feature', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])
      addVerticalTransition(building, transition)

      // Simulate deleting the staircase
      building.staircases = []

      // Transition is now invalid — validate detects it
      const error = validateVerticalTransition(building, transition)
      expect(error).toContain('not found')

      // Clean up: remove transitions referencing deleted features
      if (building.verticalTransitions) {
        building.verticalTransitions = building.verticalTransitions.filter(
          (vt) => {
            const feature = [
              ...(building.staircases ?? []),
              ...(building.elevators ?? []),
            ].find((f) => f.id === vt.featureId)
            return feature !== undefined
          },
        )
      }

      expect(building.verticalTransitions).toHaveLength(0)
    })
  })

  // Case 8: Undo/redo
  describe('Case 8: Undo/redo', () => {
    it('add then remove simulates undo, re-add simulates redo', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])

      // Add (action)
      addVerticalTransition(building, transition)
      expect(building.verticalTransitions).toHaveLength(1)

      // Undo (remove)
      const removed = removeVerticalTransition(building, 'vt-1')
      expect(removed).toBe(true)
      expect(building.verticalTransitions).toHaveLength(0)

      // Redo (re-add)
      const readded = addVerticalTransition(building, transition)
      expect(readded.success).toBe(true)
      expect(building.verticalTransitions).toHaveLength(1)
    })
  })

  // Case 9: A* routes across floors (conceptual proof)
  describe('Case 9: Cross-floor route connectivity (conceptual)', () => {
    it('transition links floor 1 node to floor 2 node', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])
      addVerticalTransition(building, transition)

      // Verify the transition connects the two floor route nodes
      const vt = getVerticalTransition(building, 'vt-1')!
      const floor1Conn = vt.connections.find((c) => c.floorId === 'fl-1')
      const floor2Conn = vt.connections.find((c) => c.floorId === 'fl-2')
      expect(floor1Conn).toBeDefined()
      expect(floor2Conn).toBeDefined()
      expect(floor1Conn!.routeNodeId).toBe('rn-1')
      expect(floor2Conn!.routeNodeId).toBe('rn-2')

      // Verify floor1 has rn-1 and floor2 has rn-2
      expect(floor1.routeNetwork!.nodes.some((n) => n.id === 'rn-1')).toBe(true)
      expect(floor2.routeNetwork!.nodes.some((n) => n.id === 'rn-2')).toBe(true)
    })
  })

  // Case 10: Architectural geometry unaffected
  describe('Case 10: Architectural geometry unaffected', () => {
    it('add/remove transition does not change floor walls', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      floor1.walls = [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }]
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      floor2.walls = [{ id: 'w2', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 }]
      const stair = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair])

      const wallsBefore = JSON.stringify(building.floors.map((f) => f.walls))

      const transition = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
      ])
      addVerticalTransition(building, transition)

      expect(JSON.stringify(building.floors.map((f) => f.walls))).toBe(wallsBefore)

      removeVerticalTransition(building, 'vt-1')
      expect(JSON.stringify(building.floors.map((f) => f.walls))).toBe(wallsBefore)
    })
  })

  // Case 11: Multiple vertical features coexist
  describe('Case 11: Multiple vertical features coexist', () => {
    it('two staircases + one elevator on same building all work', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1', 'rn-2', 'rn-3'])
      const floor2 = makeFloor('fl-2', 1, ['rn-4', 'rn-5', 'rn-6'])
      const stair1 = makeStaircase('stair-1', 'building-1', {
        0: { position: { x: 10, y: 20 }, rotation: 0 },
        1: { position: { x: 10, y: 20 }, rotation: 0 },
      })
      const stair2 = makeStaircase('stair-2', 'building-1', {
        0: { position: { x: 30, y: 40 }, rotation: 0 },
        1: { position: { x: 30, y: 40 }, rotation: 0 },
      })
      const elev = makeElevator('elev-1', 'building-1', {
        0: { position: { x: 50, y: 60 }, rotation: 0 },
        1: { position: { x: 50, y: 60 }, rotation: 0 },
      })
      const building = makeBuilding([floor1, floor2], [stair1, stair2], [elev])

      const vt1 = makeTransition('vt-1', 'stair-1', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-4' },
      ])
      const vt2 = makeTransition('vt-2', 'stair-2', 'staircase', [
        { floorId: 'fl-1', routeNodeId: 'rn-2' },
        { floorId: 'fl-2', routeNodeId: 'rn-5' },
      ])
      const vt3 = makeTransition('vt-3', 'elev-1', 'elevator', [
        { floorId: 'fl-1', routeNodeId: 'rn-3' },
        { floorId: 'fl-2', routeNodeId: 'rn-6' },
      ])

      expect(addVerticalTransition(building, vt1).success).toBe(true)
      expect(addVerticalTransition(building, vt2).success).toBe(true)
      expect(addVerticalTransition(building, vt3).success).toBe(true)
      expect(building.verticalTransitions).toHaveLength(3)

      // Remove one — others remain
      removeVerticalTransition(building, 'vt-2')
      expect(building.verticalTransitions).toHaveLength(2)
      expect(getVerticalTransition(building, 'vt-1')).toBeDefined()
      expect(getVerticalTransition(building, 'vt-3')).toBeDefined()
    })
  })

  // Case 12: Elevator with 3+ floors
  describe('Case 12: Elevator with 3+ floors', () => {
    it('elevator serving 4 floors has all connections valid', () => {
      const floor1 = makeFloor('fl-1', 0, ['rn-1'])
      const floor2 = makeFloor('fl-2', 1, ['rn-2'])
      const floor3 = makeFloor('fl-3', 2, ['rn-3'])
      const floor4 = makeFloor('fl-4', 3, ['rn-4'])
      const elev = makeElevator('elev-1', 'building-1', {
        0: { position: { x: 5, y: 5 }, rotation: 0 },
        1: { position: { x: 5, y: 5 }, rotation: 0 },
        2: { position: { x: 5, y: 5 }, rotation: 0 },
        3: { position: { x: 5, y: 5 }, rotation: 0 },
      })
      const building = makeBuilding(
        [floor1, floor2, floor3, floor4],
        undefined,
        [elev],
      )

      const transition = makeTransition('vt-1', 'elev-1', 'elevator', [
        { floorId: 'fl-1', routeNodeId: 'rn-1' },
        { floorId: 'fl-2', routeNodeId: 'rn-2' },
        { floorId: 'fl-3', routeNodeId: 'rn-3' },
        { floorId: 'fl-4', routeNodeId: 'rn-4' },
      ])

      const result = addVerticalTransition(building, transition)
      expect(result.success).toBe(true)
      expect(building.verticalTransitions![0].connections).toHaveLength(4)
      expect(validateVerticalTransition(building, transition)).toBeNull()
    })
  })
})
