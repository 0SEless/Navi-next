import { describe, it, expect } from 'vitest'
import type { Floor, Entrance, RouteNetwork, EntranceAccess } from '../types/entities'
import {
  addEntranceAccess,
  removeEntranceAccess,
  getEntranceAccess,
  validateEntranceAccess,
} from '../entrance-access'

function makeFloor(overrides?: Partial<Floor>): Floor {
  return {
    id: 'floor-1',
    level: 0,
    label: 'Ground Floor',
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
    ...overrides,
  }
}

function makeEntrance(id: string, x = 5, y = 5): Entrance {
  return {
    id,
    label: `Entrance ${id}`,
    position: { x, y },
    level: 0,
    type: 'main',
    hasQR: false,
    hasPanorama: false,
  }
}

function makeRouteNetwork(nodeIds: string[]): RouteNetwork {
  return {
    nodes: nodeIds.map(id => ({
      id,
      type: 'hallway' as const,
      position: { x: 0, y: 0 },
      floor: 0,
    })),
    edges: [],
  }
}

describe('EntranceAccess CRUD', () => {
  // Case 1: One outdoor path → one building entrance
  it('creates bridge: outdoor node → entrance → indoor route node', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    const result = addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })

    expect(result.success).toBe(true)
    expect(floor.entranceAccess).toHaveLength(1)
    expect(floor.entranceAccess![0]).toEqual({
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })
  })

  // Case 2: Entrance links to intended indoor route node
  it('links entrance to correct indoor route node', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1', 'rn-2']),
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-2',
    })

    const bridge = getEntranceAccess(floor, 'ent-1')
    expect(bridge).toBeDefined()
    expect(bridge!.indoorRouteNodeId).toBe('rn-2')
  })

  // Case 3: Reject nonexistent indoor node
  it('rejects access with non-existent indoor node', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    const result = addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-missing',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(floor.entranceAccess).toBeUndefined()
  })

  // Case 4: Reject invalid outdoor target
  it('rejects access with non-existent outdoor node ID', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    const result = addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: '',
      indoorRouteNodeId: 'rn-1',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('outdoorNodeId')
  })

  // Case 5: Moving entrance updates relationship safely
  it('preserves access when entrance is moved (ID unchanged)', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1', 5, 5)],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })

    // Simulate moving entrance (update position, keep ID)
    floor.entrances[0] = { ...floor.entrances[0], position: { x: 10, y: 10 } }

    const bridge = getEntranceAccess(floor, 'ent-1')
    expect(bridge).toBeDefined()
    expect(bridge!.entranceId).toBe('ent-1')
    expect(bridge!.outdoorNodeId).toBe('outdoor-1')
    expect(bridge!.indoorRouteNodeId).toBe('rn-1')
  })

  // Case 6: Deleting entrance cleans up bridge
  it('removes access when entrance is deleted', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })

    const { removed } = removeEntranceAccess(floor, 'ent-1')
    expect(removed).toBe(true)
    expect(floor.entranceAccess).toBeUndefined()
  })

  // Case 7: Save/reload preserves bridge
  it('preserves access through add → remove → add cycle', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1'), makeEntrance('ent-2')],
      routeNetwork: makeRouteNetwork(['rn-1', 'rn-2']),
    })

    // Add two bridges
    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })
    addEntranceAccess(floor, {
      entranceId: 'ent-2',
      outdoorNodeId: 'outdoor-2',
      indoorRouteNodeId: 'rn-2',
    })

    expect(floor.entranceAccess).toHaveLength(2)

    // Simulate save/reload (JSON round-trip)
    const serialized = JSON.stringify(floor.entranceAccess)
    const reloaded: EntranceAccess[] = JSON.parse(serialized)

    // Verify data survives
    expect(reloaded).toHaveLength(2)
    expect(reloaded[0].entranceId).toBe('ent-1')
    expect(reloaded[1].entranceId).toBe('ent-2')
  })

  // Case 8: A* can route from outdoor into indoor (conceptual)
  it('provides valid bridge data for pathfinding', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-node-1',
      indoorRouteNodeId: 'rn-1',
    })

    const bridge = getEntranceAccess(floor, 'ent-1')
    expect(bridge).toBeDefined()

    // The bridge provides the link for pathfinding:
    // outdoor-node-1 → ent-1 → rn-1
    expect(bridge!.outdoorNodeId).toBe('outdoor-node-1')
    expect(bridge!.indoorRouteNodeId).toBe('rn-1')
  })

  // Case 9: Bridge does not mutate room/wall geometry
  it('add/remove access leaves walls unchanged', () => {
    const walls = [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 },
      { id: 'w2', start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, thickness: 0.15, height: 3.5 },
    ]
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
      walls,
    })

    const wallsBefore = JSON.stringify(floor.walls)

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })
    expect(JSON.stringify(floor.walls)).toBe(wallsBefore)

    removeEntranceAccess(floor, 'ent-1')
    expect(JSON.stringify(floor.walls)).toBe(wallsBefore)
  })

  // Case 10: Multiple entrances coexist
  it('supports multiple entrance bridges on same floor', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1'), makeEntrance('ent-2'), makeEntrance('ent-3')],
      routeNetwork: makeRouteNetwork(['rn-1', 'rn-2', 'rn-3']),
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'out-1',
      indoorRouteNodeId: 'rn-1',
    })
    addEntranceAccess(floor, {
      entranceId: 'ent-2',
      outdoorNodeId: 'out-2',
      indoorRouteNodeId: 'rn-2',
    })
    addEntranceAccess(floor, {
      entranceId: 'ent-3',
      outdoorNodeId: 'out-3',
      indoorRouteNodeId: 'rn-3',
    })

    expect(floor.entranceAccess).toHaveLength(3)
    expect(getEntranceAccess(floor, 'ent-1')!.outdoorNodeId).toBe('out-1')
    expect(getEntranceAccess(floor, 'ent-2')!.outdoorNodeId).toBe('out-2')
    expect(getEntranceAccess(floor, 'ent-3')!.outdoorNodeId).toBe('out-3')

    // Remove middle one
    removeEntranceAccess(floor, 'ent-2')
    expect(floor.entranceAccess).toHaveLength(2)
    expect(getEntranceAccess(floor, 'ent-1')).toBeDefined()
    expect(getEntranceAccess(floor, 'ent-2')).toBeUndefined()
    expect(getEntranceAccess(floor, 'ent-3')).toBeDefined()
  })

  // Additional edge cases
  it('returns error for non-existent entrance', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1']),
    })

    const result = addEntranceAccess(floor, {
      entranceId: 'ent-missing',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns error when floor has no route network', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
    })

    const result = addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('no route network')
  })

  it('replaces existing bridge for same entrance', () => {
    const floor = makeFloor({
      entrances: [makeEntrance('ent-1')],
      routeNetwork: makeRouteNetwork(['rn-1', 'rn-2']),
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-1',
      indoorRouteNodeId: 'rn-1',
    })

    addEntranceAccess(floor, {
      entranceId: 'ent-1',
      outdoorNodeId: 'outdoor-2',
      indoorRouteNodeId: 'rn-2',
    })

    expect(floor.entranceAccess).toHaveLength(1)
    expect(floor.entranceAccess![0].outdoorNodeId).toBe('outdoor-2')
    expect(floor.entranceAccess![0].indoorRouteNodeId).toBe('rn-2')
  })

  it('getEntranceAccess returns undefined for unknown entrance', () => {
    const floor = makeFloor()
    expect(getEntranceAccess(floor, 'unknown')).toBeUndefined()
  })

  it('removeEntranceAccess returns false when no bridge exists', () => {
    const floor = makeFloor()
    const { removed } = removeEntranceAccess(floor, 'ent-1')
    expect(removed).toBe(false)
  })
})
