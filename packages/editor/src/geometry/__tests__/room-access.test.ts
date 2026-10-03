import { describe, it, expect } from 'vitest'
import {
  validateRoomAccess,
  addRoomAccess,
  removeRoomAccess,
  setPrimaryAccess,
  getPrimaryAccess,
  resolveRoomAccess,
  sanitizeAccessForOpeningDeletion,
  sanitizeAccessForNodeDeletion,
} from '../semantic-room-store'
import type { RoomAttributes, RoomAccess, Opening, RouteNetwork } from '@navi/core'

// ── Helpers ──

function makeDoor(id: string): Opening {
  return { id, type: 'door', wallId: `wall-${id}`, offset: 0, width: 1.0 }
}

function makeWindow(id: string): Opening {
  return { id, type: 'window', wallId: `wall-${id}`, offset: 0, width: 1.0, sillHeight: 0.9 }
}

function makeRouteNetwork(nodeIds: string[]): RouteNetwork {
  return {
    nodes: nodeIds.map(id => ({
      id,
      type: 'waypoint' as const,
      position: { x: 0, y: 0 },
      floor: 0,
    })),
    edges: [],
  }
}

function makeRoomAttributes(id: string, accessPoints?: RoomAccess[]): RoomAttributes {
  return {
    faceId: id,
    name: `Room ${id}`,
    searchable: true,
    accessPoints,
  }
}

// ── Case 1: One-door room → one RoomAccess ──

describe('W9 Case 1: One-door room', () => {
  it('add first access → primary = true automatically', () => {
    const attrs = makeRoomAttributes('face-0')
    const openings = [makeDoor('door-0')]
    const network = makeRouteNetwork(['node-0'])

    const result = addRoomAccess(attrs, {
      openingId: 'door-0',
      routeNodeId: 'node-0',
      primary: false, // should be overridden to true
    }, openings, network)

    expect(result.error).toBeNull()
    expect(result.accessPoints).toHaveLength(1)
    expect(result.accessPoints![0].primary).toBe(true)
  })
})

// ── Case 2: Two-door room → multiple access points, one primary ──

describe('W9 Case 2: Two-door room', () => {
  it('add two doors → set one primary → getPrimary returns it', () => {
    const openings = [makeDoor('door-0'), makeDoor('door-1')]
    const network = makeRouteNetwork(['node-0', 'node-1'])

    let attrs = makeRoomAttributes('face-0')
    const r1 = addRoomAccess(attrs, { openingId: 'door-0', routeNodeId: 'node-0', primary: false }, openings, network)
    expect(r1.error).toBeNull()
    attrs = { ...attrs, accessPoints: r1.accessPoints! }

    const r2 = addRoomAccess(attrs, { openingId: 'door-1', routeNodeId: 'node-1', primary: false }, openings, network)
    expect(r2.error).toBeNull()
    attrs = { ...attrs, accessPoints: r2.accessPoints! }

    // First door is primary (auto)
    expect(getPrimaryAccess(attrs)?.openingId).toBe('door-0')

    // Switch primary to door-1
    const updated = setPrimaryAccess(attrs, 'door-1')
    expect(updated).not.toBeNull()
    attrs = { ...attrs, accessPoints: updated! }

    expect(getPrimaryAccess(attrs)?.openingId).toBe('door-1')
  })
})

// ── Case 3: Reject Window as access ──

describe('W9 Case 3: Reject Window as access', () => {
  it('try to add window opening → OPENING_NOT_DOOR', () => {
    const attrs = makeRoomAttributes('face-0')
    const openings = [makeWindow('win-0')]
    const network = makeRouteNetwork(['node-0'])

    const result = addRoomAccess(attrs, {
      openingId: 'win-0',
      routeNodeId: 'node-0',
      primary: true,
    }, openings, network)

    expect(result.error).toBe('OPENING_NOT_DOOR')
    expect(result.accessPoints).toBeNull()
  })
})

// ── Case 4: Reject Door not on room boundary ──
// Note: Adjacency validation requires geometry; we validate opening existence.

describe('W9 Case 4: Reject nonexistent opening', () => {
  it('opening not in Floor.openings → OPENING_NOT_FOUND', () => {
    const attrs = makeRoomAttributes('face-0')
    const openings = [makeDoor('door-0')]
    const network = makeRouteNetwork(['node-0'])

    const result = addRoomAccess(attrs, {
      openingId: 'door-999',
      routeNodeId: 'node-0',
      primary: true,
    }, openings, network)

    expect(result.error).toBe('OPENING_NOT_FOUND')
    expect(result.accessPoints).toBeNull()
  })
})

// ── Case 5: Reject nonexistent Route Node ──

describe('W9 Case 5: Reject nonexistent Route Node', () => {
  it('node not in Floor.routeNetwork → ROUTE_NODE_NOT_FOUND', () => {
    const attrs = makeRoomAttributes('face-0')
    const openings = [makeDoor('door-0')]
    const network = makeRouteNetwork(['node-0'])

    const result = addRoomAccess(attrs, {
      openingId: 'door-0',
      routeNodeId: 'node-999',
      primary: true,
    }, openings, network)

    expect(result.error).toBe('ROUTE_NODE_NOT_FOUND')
    expect(result.accessPoints).toBeNull()
  })

  it('no routeNetwork at all → ROUTE_NODE_NOT_FOUND', () => {
    const attrs = makeRoomAttributes('face-0')
    const openings = [makeDoor('door-0')]

    const result = addRoomAccess(attrs, {
      openingId: 'door-0',
      routeNodeId: 'node-0',
      primary: true,
    }, openings, undefined)

    expect(result.error).toBe('ROUTE_NODE_NOT_FOUND')
    expect(result.accessPoints).toBeNull()
  })
})

// ── Case 6: Changing primary access ──

describe('W9 Case 6: Changing primary access', () => {
  it('two access points → switch primary → getPrimary returns new one', () => {
    const openings = [makeDoor('door-0'), makeDoor('door-1')]
    const network = makeRouteNetwork(['node-0', 'node-1'])

    let attrs = makeRoomAttributes('face-0')
    const r1 = addRoomAccess(attrs, { openingId: 'door-0', routeNodeId: 'node-0', primary: false }, openings, network)
    attrs = { ...attrs, accessPoints: r1.accessPoints! }
    const r2 = addRoomAccess(attrs, { openingId: 'door-1', routeNodeId: 'node-1', primary: false }, openings, network)
    attrs = { ...attrs, accessPoints: r2.accessPoints! }

    expect(getPrimaryAccess(attrs)?.openingId).toBe('door-0')

    const updated = setPrimaryAccess(attrs, 'door-1')
    attrs = { ...attrs, accessPoints: updated! }

    expect(getPrimaryAccess(attrs)?.openingId).toBe('door-1')
    // door-0 should no longer be primary
    expect(attrs.accessPoints!.find(a => a.openingId === 'door-0')?.primary).toBe(false)
  })

  it('setPrimaryAccess on nonexistent opening → null', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
    ])

    const result = setPrimaryAccess(attrs, 'door-999')
    expect(result).toBeNull()
  })
})

// ── Case 7: Deleting access door (sanitize) ──

describe('W9 Case 7: Deleting access door', () => {
  it('delete opening → access relationship removed safely', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
      { openingId: 'door-1', routeNodeId: 'node-1', primary: false },
    ])

    const sanitized = sanitizeAccessForOpeningDeletion(attrs, 'door-0')
    expect(sanitized).toHaveLength(1)
    expect(sanitized![0].openingId).toBe('door-1')
  })

  it('delete opening not referenced → returns undefined (no change)', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
    ])

    const sanitized = sanitizeAccessForOpeningDeletion(attrs, 'door-999')
    expect(sanitized).toBeUndefined()
  })

  it('no accessPoints → returns undefined', () => {
    const attrs = makeRoomAttributes('face-0')
    const sanitized = sanitizeAccessForOpeningDeletion(attrs, 'door-0')
    expect(sanitized).toBeUndefined()
  })
})

// ── Case 8: Deleting referenced Route Node (sanitize) ──

describe('W9 Case 8: Deleting referenced Route Node', () => {
  it('delete route node → access relationship removed safely', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
      { openingId: 'door-1', routeNodeId: 'node-1', primary: false },
    ])

    const sanitized = sanitizeAccessForNodeDeletion(attrs, 'node-0')
    expect(sanitized).toHaveLength(1)
    expect(sanitized![0].routeNodeId).toBe('node-1')
  })

  it('delete node not referenced → returns undefined (no change)', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
    ])

    const sanitized = sanitizeAccessForNodeDeletion(attrs, 'node-999')
    expect(sanitized).toBeUndefined()
  })
})

// ── Case 9: Save/reload ──

describe('W9 Case 9: Save/reload round-trip', () => {
  it('add access → serialize → deserialize → access preserved', () => {
    const attrs: RoomAttributes = {
      faceId: 'face-0',
      name: 'Lab',
      searchable: true,
      accessPoints: [
        { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
        { openingId: 'door-1', routeNodeId: 'node-1', primary: false },
      ],
    }

    const serialized = JSON.stringify(attrs)
    const reloaded: RoomAttributes = JSON.parse(serialized)

    expect(reloaded.accessPoints).toHaveLength(2)
    expect(reloaded.accessPoints![0].openingId).toBe('door-0')
    expect(reloaded.accessPoints![0].primary).toBe(true)
    expect(reloaded.accessPoints![1].openingId).toBe('door-1')
    expect(reloaded.accessPoints![1].primary).toBe(false)
  })
})

// ── Case 10: Search resolution ──

describe('W9 Case 10: Search resolution', () => {
  it('room with primary access → resolveRoomAccess returns correct routeNodeId', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: false },
      { openingId: 'door-1', routeNodeId: 'node-1', primary: true },
    ])

    const resolved = resolveRoomAccess(attrs)
    expect(resolved).toBe('node-1')
  })

  it('no access points → resolveRoomAccess returns undefined', () => {
    const attrs = makeRoomAttributes('face-0')
    const resolved = resolveRoomAccess(attrs)
    expect(resolved).toBeUndefined()
  })
})

// ── Case 11: No RouteNetwork geometry change ──

describe('W9 Case 11: No RouteNetwork geometry change', () => {
  it('add/remove access → Floor.routeNetwork unchanged', () => {
    const network: RouteNetwork = {
      nodes: [
        { id: 'node-0', type: 'waypoint', position: { x: 1, y: 2 }, floor: 0 },
        { id: 'node-1', type: 'waypoint', position: { x: 3, y: 4 }, floor: 0 },
      ],
      edges: [{ id: 'edge-0', from: 'node-0', to: 'node-1', type: 'walk', distance: 5 }],
    }
    const networkSnapshot = JSON.stringify(network)

    const openings = [makeDoor('door-0'), makeDoor('door-1')]
    let attrs = makeRoomAttributes('face-0')

    // Add two access points
    const r1 = addRoomAccess(attrs, { openingId: 'door-0', routeNodeId: 'node-0', primary: false }, openings, network)
    attrs = { ...attrs, accessPoints: r1.accessPoints! }
    const r2 = addRoomAccess(attrs, { openingId: 'door-1', routeNodeId: 'node-1', primary: false }, openings, network)
    attrs = { ...attrs, accessPoints: r2.accessPoints! }

    // Remove one
    const remaining = removeRoomAccess(attrs, 'door-0')
    attrs = { ...attrs, accessPoints: remaining }

    // Network should be untouched
    expect(JSON.stringify(network)).toBe(networkSnapshot)
  })
})

// ── Duplicate rejection ──

describe('W9 Duplicate opening rejection', () => {
  it('try to add same opening twice → DUPLICATE_OPENING', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
    ])
    const openings = [makeDoor('door-0')]
    const network = makeRouteNetwork(['node-0'])

    const result = addRoomAccess(attrs, {
      openingId: 'door-0',
      routeNodeId: 'node-0',
      primary: false,
    }, openings, network)

    expect(result.error).toBe('DUPLICATE_OPENING')
    expect(result.accessPoints).toBeNull()
  })
})

// ── removeRoomAccess ──

describe('W9 removeRoomAccess', () => {
  it('remove existing access → array shrinks', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
      { openingId: 'door-1', routeNodeId: 'node-1', primary: false },
    ])

    const result = removeRoomAccess(attrs, 'door-0')
    expect(result).toHaveLength(1)
    expect(result[0].openingId).toBe('door-1')
  })

  it('remove nonexistent → same array', () => {
    const attrs = makeRoomAttributes('face-0', [
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
    ])

    const result = removeRoomAccess(attrs, 'door-999')
    expect(result).toHaveLength(1)
  })
})

// ── validateRoomAccess standalone ──

describe('W9 validateRoomAccess', () => {
  it('valid access → null', () => {
    const openings = [makeDoor('door-0')]
    const network = makeRouteNetwork(['node-0'])
    const result = validateRoomAccess(
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
      openings,
      network,
    )
    expect(result).toBeNull()
  })

  it('missing opening → OPENING_NOT_FOUND', () => {
    const result = validateRoomAccess(
      { openingId: 'door-999', routeNodeId: 'node-0', primary: true },
      [makeDoor('door-0')],
      makeRouteNetwork(['node-0']),
    )
    expect(result).toBe('OPENING_NOT_FOUND')
  })

  it('window opening → OPENING_NOT_DOOR', () => {
    const result = validateRoomAccess(
      { openingId: 'win-0', routeNodeId: 'node-0', primary: true },
      [makeWindow('win-0')],
      makeRouteNetwork(['node-0']),
    )
    expect(result).toBe('OPENING_NOT_DOOR')
  })

  it('missing route node → ROUTE_NODE_NOT_FOUND', () => {
    const result = validateRoomAccess(
      { openingId: 'door-0', routeNodeId: 'node-999', primary: true },
      [makeDoor('door-0')],
      makeRouteNetwork(['node-0']),
    )
    expect(result).toBe('ROUTE_NODE_NOT_FOUND')
  })

  it('no network → ROUTE_NODE_NOT_FOUND', () => {
    const result = validateRoomAccess(
      { openingId: 'door-0', routeNodeId: 'node-0', primary: true },
      [makeDoor('door-0')],
      undefined,
    )
    expect(result).toBe('ROUTE_NODE_NOT_FOUND')
  })
})
