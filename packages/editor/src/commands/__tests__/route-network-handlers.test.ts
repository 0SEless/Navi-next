import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building } from '@navi/core'
import {
  routeNodeCreateHandler,
  routeNodeUpdateHandler,
  routeNodeDeleteHandler,
  routeEdgeCreateHandler,
  routeEdgeDeleteHandler,
  routePathCreateHandler,
} from '../route-network-handlers'

// P1-T7 (R2.5/R8.1/D3/D10): the route network is a first-class persisted
// entity authored per floor. These tests pin identity (namespaced ids,
// R15.6), floor ownership, node/edge invariants, and geometric isolation
// (network edits never touch room/hallway geometry and vice versa).

function createTestDoc(withGeometry = false): CampusDocument {
  const makeFloor = (id: string, level: number) => ({
    id,
    level,
    label: level === 0 ? 'Ground' : `Floor ${level}`,
    elevation: 0,
    height: 4,
    rooms: [] as never[],
    hallways: [] as never[],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
  })

  const building: Building = {
    id: 'bld-1',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 33.42, lng: -111.93 },
        { lat: 33.421, lng: -111.93 },
        { lat: 33.421, lng: -111.929 },
        { lat: 33.42, lng: -111.929 },
        { lat: 33.42, lng: -111.93 },
      ],
    },
    baseElevation: 0,
    height: 20,
    floors: [makeFloor('flr-0', 0), makeFloor('flr-1', 1)],
    verticalConnectors: [],
    aliases: [],
    color: '#ff0000',
    metadata: {},
  }

  if (withGeometry) {
    building.floors[0].rooms.push({
      id: 'room-1', name: 'Room One', number: '101', category: 'office',
      polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] },
      roomDoors: [], metadata: {},
    } as never)
    building.floors[0].hallways.push({
      id: 'hall-1', name: 'Main Hall',
      polyline: { points: [{ x: 0, y: 10 }, { x: 10, y: 10 }] }, width: 2, metadata: {},
    } as never)
  }

  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'test-campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function getNetwork(doc: CampusDocument, floorId: string): { nodes: unknown[]; edges: unknown[] } {
  const floor = doc.buildings[0].floors.find(f => f.id === floorId)!
  return (floor as unknown as { routeNetwork: { nodes: unknown[]; edges: unknown[] } }).routeNetwork
}

describe('Route Network Handlers (P1-T7)', () => {
  // ── node create ──

  it('creates a waypoint node with namespaced id, auto-creating the network (R15.6)', () => {
    const doc = createTestDoc()
    const result = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      node: { position: { x: 1, y: 2 } },
    })
    expect(result.success).toBe(true)
    const net = getNetwork(doc, 'flr-0')
    expect(net.nodes).toHaveLength(1)
    const node = net.nodes[0] as Record<string, unknown>
    // Namespaced id — never collides with compiler N-* / legacy ids (R15.6)
    expect(node.id).toMatch(/^route-node-/)
    expect(node.type).toBe('waypoint')
    expect(node.position).toEqual({ x: 1, y: 2 })
    // Floor ownership: floor is derived from the OWNING floor, not the payload
    expect(node.floor).toBe(0)
    expect(net.edges).toEqual([])
  })

  it('ignores a client-supplied floor on the node payload (floor ownership)', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      node: { position: { x: 0, y: 0 }, floor: 99 },
    })
    const node = getNetwork(doc, 'flr-1').nodes[0] as Record<string, unknown>
    expect(node.floor).toBe(1)
  })

  it('rejects unknown node types against the six-value vocabulary (D10)', () => {
    const doc = createTestDoc()
    const result = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      node: { position: { x: 0, y: 0 }, type: 'beacon' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/type/i)
    expect(getNetwork(doc, 'flr-0')).toBeUndefined()
  })

  it('rejects invalid positions and unknown buildings/floors', () => {
    const doc = createTestDoc()
    const badPos = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 'a' } as never },
    })
    expect(badPos.success).toBe(false)
    expect(badPos.error).toMatch(/position/i)

    const badBld = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-x', floorId: 'flr-0', node: { position: { x: 0, y: 0 } },
    })
    expect(badBld.success).toBe(false)
    expect(badBld.error).toMatch(/not found/i)

    const badFlr = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-x', node: { position: { x: 0, y: 0 } },
    })
    expect(badFlr.success).toBe(false)
    expect(badFlr.error).toMatch(/not found/i)
  })

  it('generates unique namespaced ids across creates (R15.6)', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 1, y: 0 } } })
    const ids = (getNetwork(doc, 'flr-0').nodes as Array<Record<string, unknown>>).map(n => n.id as string)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^route-node-/)
  })

  // ── node update ──

  it('updates node position/type and the inverse restores the old values', () => {
    const doc = createTestDoc()
    const created = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 1, y: 1 }, type: 'poi' },
    })
    const nodeId = created.entityId as string

    const result = routeNodeUpdateHandler.execute(doc, {
      nodeId, patch: { position: { x: 5, y: 6 }, type: 'entrance' },
    })
    expect(result.success).toBe(true)
    let node = getNetwork(doc, 'flr-0').nodes[0] as Record<string, unknown>
    expect(node.position).toEqual({ x: 5, y: 6 })
    expect(node.type).toBe('entrance')

    const inverse = routeNodeUpdateHandler.inverse?.({ nodeId }, result) ?? null
    expect(inverse).not.toBeNull()
    const undone = routeNodeUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    node = getNetwork(doc, 'flr-0').nodes[0] as Record<string, unknown>
    expect(node.position).toEqual({ x: 1, y: 1 })
    expect(node.type).toBe('poi')
  })

  it('rejects invalid patches on update and unknown node ids', () => {
    const doc = createTestDoc()
    const created = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 1, y: 1 } },
    })
    const badType = routeNodeUpdateHandler.execute(doc, {
      nodeId: created.entityId as string, patch: { type: 'teleporter' },
    })
    expect(badType.success).toBe(false)

    const missing = routeNodeUpdateHandler.execute(doc, {
      nodeId: 'route-node-none', patch: { position: { x: 0, y: 0 } },
    })
    expect(missing.success).toBe(false)
    expect(missing.error).toMatch(/not found/i)
  })

  // ── node delete (incident-edge cleanup) ──
  // NOTE (P1-T8/R8.2): degree-1 deletes remove node+edge; degree-2 MERGES the
  // two edges; degree-3+ requires `confirmed: true`. This T7-era test pins the
  // confirmed degree-3+ contract (delete node + ALL incident edges, no merge)
  // plus whole-network verbatim undo — the merge path is covered by the
  // dedicated P1-T8 describe below.

  it('deleting a degree-3+ node (confirmed) removes it AND its incident edges; inverse restores the network verbatim', () => {
    const doc = createTestDoc()
    const n1 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const n2 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })
    const n3 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 6, y: 0 } } })
    const n4 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 8 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: n2.entityId as string },
    })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n3.entityId as string, to: n2.entityId as string },
    })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n4.entityId as string, to: n2.entityId as string },
    })
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))

    const del = routeNodeDeleteHandler.execute(doc, { nodeId: n2.entityId as string, confirmed: true })
    expect(del.success).toBe(true)
    const net = getNetwork(doc, 'flr-0')
    expect(net.nodes).toHaveLength(3)
    // All three incident edges removed — no dangling references, no merge
    expect(net.edges).toHaveLength(0)

    const inverse = routeNodeDeleteHandler.inverse?.({ nodeId: n2.entityId as string }, del) ?? null
    expect(inverse).not.toBeNull()
    const undone = routeNodeDeleteHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(before)
  })

  // ── edge create/delete ──

  it('creates a walk edge with computed euclidean distance and validates endpoints', () => {
    const doc = createTestDoc()
    const n1 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const n2 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })

    const ok = routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: n2.entityId as string },
    })
    expect(ok.success).toBe(true)
    const edge = getNetwork(doc, 'flr-0').edges[0] as Record<string, unknown>
    expect(edge.id).toMatch(/^route-edge-/)
    expect(edge.type).toBe('walk')
    expect(edge.distance).toBeCloseTo(5, 9)

    const missing = routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: 'route-node-ghost' },
    })
    expect(missing.success).toBe(false)
    expect(missing.error).toMatch(/not found/i)
  })

  it('validates edge types against walk|stairs|elevator|portal and rejects bad distances', () => {
    const doc = createTestDoc()
    const n1 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const n2 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 1, y: 0 } } })

    const badType = routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: n2.entityId as string, type: 'teleport' },
    })
    expect(badType.success).toBe(false)
    expect(badType.error).toMatch(/type/i)

    const badDist = routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: n2.entityId as string, distance: -1 },
    })
    expect(badDist.success).toBe(false)
    expect(badDist.error).toMatch(/distance/i)
  })

  it('deletes an edge by id; inverse recreates it verbatim', () => {
    const doc = createTestDoc()
    const n1 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const n2 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })
    const made = routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: n2.entityId as string, type: 'portal', distance: 7 },
    })
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0').edges))

    const del = routeEdgeDeleteHandler.execute(doc, { edgeId: made.entityId as string })
    expect(del.success).toBe(true)
    expect(getNetwork(doc, 'flr-0').edges).toHaveLength(0)

    const inverse = routeEdgeDeleteHandler.inverse?.({ edgeId: made.entityId as string }, del) ?? null
    expect(inverse).not.toBeNull()
    const undone = routeEdgeDeleteHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0').edges))).toEqual(before)
  })

  // ── floor ownership across floors ──

  it('operations on one floor never touch another floor\'s network', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-1', node: { position: { x: 9, y: 9 }, type: 'outdoor' } })
    const f1Before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-1')))

    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const n = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 1, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: (getNetwork(doc, 'flr-0').nodes[0] as Record<string, unknown>).id as string, to: n.entityId as string },
    })

    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-1')))).toEqual(f1Before)
    expect(getNetwork(doc, 'flr-0').nodes).toHaveLength(2)
  })

  // ── geometric isolation (integration, R8.1/D3) ──

  it('route edits never touch room/hallway geometry; hallway edits never touch the network', () => {
    const doc = createTestDoc(true)
    const geometryBefore = JSON.stringify({ rooms: doc.buildings[0].floors[0].rooms, hallways: doc.buildings[0].floors[0].hallways })

    // Route-network edits…
    const n1 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 2, y: 12 } } })
    const n2 = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 8, y: 12 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: n1.entityId as string, to: n2.entityId as string },
    })
    routeNodeUpdateHandler.execute(doc, { nodeId: n1.entityId as string, patch: { position: { x: 2.5, y: 12 } } })

    // …leave rooms/hallways byte-identical
    expect(JSON.stringify({ rooms: doc.buildings[0].floors[0].rooms, hallways: doc.buildings[0].floors[0].hallways })).toBe(geometryBefore)

    // Hallway wall move (direct geometry edit)…
    const hall = doc.buildings[0].floors[0].hallways[0] as { polyline: { points: Array<{ x: number; y: number }> } }
    hall.polyline.points[1] = { x: 10, y: 14 }

    // …leaves the network byte-identical
    const netAfter = JSON.stringify(getNetwork(doc, 'flr-0'))
    expect(netAfter).toContain('"route-node-')
    expect(JSON.parse(netAfter).edges).toHaveLength(1)
  })
})

// ── P1-T8 (R8.2): topology operations — editing layer only ──
// Move-node refreshes incident edge distances O(degree); delete is degree-aware
// (1: node+edge, 2: merge, 3+: blocked until confirmed). Distances are DERIVED
// from node positions; undo restores previous state VERBATIM (authored edge
// distances included — never recomputed on undo).

describe('P1-T8: topology operations (R8.2)', () => {
  interface Chain { doc: CampusDocument; a: string; b: string; c: string }

  function makeChain(): Chain {
    const doc = createTestDoc()
    const a = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const b = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })
    const c = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 6, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: a.entityId as string, to: b.entityId as string },
    })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: b.entityId as string, to: c.entityId as string },
    })
return { doc, a: a.entityId as string, b: b.entityId as string, c: c.entityId as string }
  }

  it('moving a node updates the distance of incident edges to match the new position (R8.2)', () => {
    const { doc, a, b, c } = makeChain()
    routeNodeUpdateHandler.execute(doc, { nodeId: b, patch: { position: { x: 0, y: 4 } } })
    const edges = getNetwork(doc, 'flr-0').edges as Array<Record<string, unknown>>
    const eAb = edges.find(e => e.from === a && e.to === b)!
    const eBc = edges.find(e => e.from === b && e.to === c)!
    // a(0,0)→b(0,4): 4m; b(0,4)→c(6,0): √(36+16)=√52
    expect(eAb.distance).toBeCloseTo(4, 9)
    expect(eBc.distance).toBeCloseTo(Math.sqrt(52), 9)
  })

  it('moving a node leaves non-incident edges untouched', () => {
    const { doc, b } = makeChain()
    const d = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 10, y: 0 } } })
    const e = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 10, y: 3 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: d.entityId as string, to: e.entityId as string },
    })
    const deEdge = (getNetwork(doc, 'flr-0').edges as Array<Record<string, unknown>>).find(
      x => (x.from as string) === (d.entityId as string)
    )!
    expect(deEdge.distance).toBe(3)

    routeNodeUpdateHandler.execute(doc, { nodeId: b, patch: { position: { x: 0, y: 4 } } })
    const after = (getNetwork(doc, 'flr-0').edges as Array<Record<string, unknown>>).find(x => x.id === deEdge.id)!
    expect(after.distance).toBe(3)
  })

  it('node move preserves edge endpoints and identity (only distance mutates)', () => {
    const { doc, b } = makeChain()
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0').edges)) as Array<Record<string, unknown>>
    routeNodeUpdateHandler.execute(doc, { nodeId: b, patch: { position: { x: 0, y: 4 } } })
    const after = getNetwork(doc, 'flr-0').edges as Array<Record<string, unknown>>
    for (let i = 0; i < before.length; i++) {
      expect(after[i].id).toBe(before[i].id)
      expect(after[i].from).toBe(before[i].from)
      expect(after[i].to).toBe(before[i].to)
      expect(after[i].type).toBe(before[i].type)
    }
  })

it('undo of a move restores position AND authored distances verbatim (never recomputed)', () => {
    const { doc, b, c } = makeChain()
    // Re-author edge b→c with an EXPLICIT distance (7) that is NOT the euclidean 5
    const edges = getNetwork(doc, 'flr-0').edges as Array<Record<string, unknown>>
    const eBc = edges.find(e => (e.to as string) === c)!
    eBc.distance = 7
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))

    const moved = routeNodeUpdateHandler.execute(doc, { nodeId: b, patch: { position: { x: 0, y: 4 } } })
    expect(moved.success).toBe(true)
    // After the move both distances are geometry-derived
    const after = getNetwork(doc, 'flr-0').edges as Array<Record<string, unknown>>
    const d0 = after[0].distance as number
    const d1 = after[1].distance as number
    expect(Math.min(d0, d1)).toBeCloseTo(4, 9)

    const inverse = routeNodeUpdateHandler.inverse?.({ nodeId: b }, moved) ?? null
    expect(inverse).not.toBeNull()
    const undone = routeNodeUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    // Position AND authored distance restored verbatim — byte-for-byte
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(before)
  })

  // ── delete degree-1 ──

  it('deleting a degree-1 node removes the node and its single edge', () => {
    const doc = createTestDoc()
    const a = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const b = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: a.entityId as string, to: b.entityId as string },
    })
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: b.entityId as string })
    expect(del.success).toBe(true)
    const net = getNetwork(doc, 'flr-0')
    expect(net.nodes).toHaveLength(1)
    expect(net.edges).toHaveLength(0)
  })

  // ── delete degree-2 (merge) ──

  it('deleting a degree-2 node merges its two edges with euclidean distance', () => {
    const { doc, b } = makeChain()
    const beforeNodes = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0').nodes))
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: b })
    expect(del.success).toBe(true)
    const net = getNetwork(doc, 'flr-0')
    expect(net.nodes).toHaveLength(2)
    expect(net.edges).toHaveLength(1)
    const merged = net.edges[0] as Record<string, unknown>
    // Merged edge spans the two surviving neighbors a(0,0) and c(6,0)
    expect(merged.id).toMatch(/^route-edge-/)
    expect(merged.type).toBe('walk')
    expect(merged.distance).toBeCloseTo(6, 9)
    const surviving = new Set((net.nodes as Array<Record<string, unknown>>).map(n => n.id))
    expect(surviving).not.toContain(b)
    const origIds = new Set((beforeNodes as Array<Record<string, unknown>>).map(n => n.id))
    expect(surviving.size).toBe(origIds.size - 1)
  })

  it('degree-2 merge with differing edge types falls back to walk', () => {
    const doc = createTestDoc()
    const a = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const b = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })
    const c = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 6, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { from: a.entityId as string, to: b.entityId as string } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: b.entityId as string, to: c.entityId as string, type: 'stairs' },
    })
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: b.entityId as string })
    expect(del.success).toBe(true)
    const merged = (getNetwork(doc, 'flr-0').edges[0] as Record<string, unknown>)
    expect(merged.type).toBe('walk')
  })

  it('degree-2 with parallel edges to the same neighbor creates no self-loop', () => {
    const doc = createTestDoc()
    const a = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const b = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { from: a.entityId as string, to: b.entityId as string } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { from: b.entityId as string, to: a.entityId as string } })
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: b.entityId as string })
    expect(del.success).toBe(true)
    const net = getNetwork(doc, 'flr-0')
    expect(net.edges).toHaveLength(0)
  })

  // ── delete degree-3+ (blocked until confirmed) ──

  it('deleting a degree-3+ node is blocked until confirmed; cancel leaves the network untouched (R8.2)', () => {
    const doc = createTestDoc()
    const center = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const leaves = [1, 2, 3].map(i => routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 5 * i, y: 5 * i } },
    }))
    for (const leaf of leaves) {
      routeEdgeCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-0',
        edge: { from: center.entityId as string, to: leaf.entityId as string },
      })
    }
    const before = JSON.stringify(getNetwork(doc, 'flr-0'))

    const blocked = routeNodeDeleteHandler.execute(doc, { nodeId: center.entityId as string })
    expect(blocked.success).toBe(false)
    expect(blocked.error).toMatch(/confirm/i)
    expect(JSON.stringify(getNetwork(doc, 'flr-0'))).toBe(before)
  })

  it('confirmed degree-3+ delete removes the node and all incident edges (no merge)', () => {
    const doc = createTestDoc()
    const center = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const leaves = [1, 2, 3].map(i => routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 5 * i, y: 5 * i } },
    }))
    for (const leaf of leaves) {
      routeEdgeCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-0',
        edge: { from: center.entityId as string, to: leaf.entityId as string },
      })
    }
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: center.entityId as string, confirmed: true })
    expect(del.success).toBe(true)
    const net = getNetwork(doc, 'flr-0')
    expect(net.nodes).toHaveLength(3)
    expect(net.edges).toHaveLength(0)
  })

  // ── undo of deletes (verbatim whole-network restore) ──

  it('undo of a degree-2 delete restores the network verbatim (merged edge removed)', () => {
    const { doc, b } = makeChain()
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: b })
    expect(del.success).toBe(true)
    expect(getNetwork(doc, 'flr-0').edges).toHaveLength(1)

    const inverse = routeNodeDeleteHandler.inverse?.({ nodeId: b }, del) ?? null
    expect(inverse).not.toBeNull()
    const undone = routeNodeDeleteHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(before)
  })

  it('undo of a degree-1 delete restores the network verbatim', () => {
    const doc = createTestDoc()
    const a = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const b = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 3, y: 4 } } })
    routeEdgeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0',
      edge: { from: a.entityId as string, to: b.entityId as string },
    })
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: b.entityId as string })
    const inverse = routeNodeDeleteHandler.inverse?.({ nodeId: b.entityId as string }, del) ?? null
    const undone = routeNodeDeleteHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(before)
  })

  it('undo of a confirmed degree-3+ delete restores the network verbatim', () => {
    const doc = createTestDoc()
    const center = routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 0, y: 0 } } })
    const leaves = [1, 2, 3].map(i => routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', node: { position: { x: 5 * i, y: 5 * i } },
    }))
    for (const leaf of leaves) {
      routeEdgeCreateHandler.execute(doc, {
        buildingId: 'bld-1', floorId: 'flr-0',
        edge: { from: center.entityId as string, to: leaf.entityId as string },
      })
    }
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))
    const del = routeNodeDeleteHandler.execute(doc, { nodeId: center.entityId as string, confirmed: true })
    const inverse = routeNodeDeleteHandler.inverse?.({ nodeId: center.entityId as string }, del) ?? null
    const undone = routeNodeDeleteHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undone.success).toBe(true)
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(before)
  })
})

// ── V1 single Route tool path command ──
// The public authoring surface is one multi-click Route tool. These tests
// describe the atomic persistence contract: one path creates consecutive
// nodes/edges and invalid input leaves the floor untouched.
describe('V1: route.path.create', () => {
  it('creates one node-and-edge path from three points with safe defaults', () => {
    const doc = createTestDoc()

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 4 }],
    })

    expect(result.success).toBe(true)
    expect(result.data?.nodeIds).toHaveLength(3)
    expect(result.data?.edgeIds).toHaveLength(2)

    const network = getNetwork(doc, 'flr-0')!
    expect(network.nodes).toHaveLength(3)
    expect(network.edges).toHaveLength(2)
    expect(network.nodes.every((node) => node.type === 'waypoint' && node.floor === 0)).toBe(true)
    expect(network.edges.every((edge) => edge.type === 'walk')).toBe(true)
    expect(network.edges.map((edge) => edge.distance)).toEqual([5, 3])
    expect(network.edges[0].from).toBe(network.nodes[0].id)
    expect(network.edges[0].to).toBe(network.nodes[1].id)
    expect(network.edges[1].from).toBe(network.nodes[1].id)
    expect(network.edges[1].to).toBe(network.nodes[2].id)
  })

  it.each([
    ['10 cm apart', [{ x: 0, y: 0.1 }, { x: 4, y: 0.1 }]],
    ['exactly coincident', [{ x: 0, y: 0 }, { x: 4, y: 0 }]],
  ])('keeps an independent %s path on fresh node identities', (_label, points) => {
    const doc = createTestDoc()
    routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
    })

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points,
    })

    expect(result.success).toBe(true)
    const network = getNetwork(doc, 'flr-0')!
    expect(network.nodes).toHaveLength(4)
    expect(network.edges).toHaveLength(2)
    expect(new Set(network.nodes.map(node => node.id)).size).toBe(4)
  })

  it('reuses an existing node only when its identity is explicitly selected', () => {
    const doc = createTestDoc()
    const first = routeNodeCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      node: { id: 'selected-node', position: { x: 1, y: 1 } },
    })
    expect(first.success).toBe(true)

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [
        { x: 50, y: 50, existingNodeId: 'selected-node' },
        { x: 4, y: 1 },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.data?.nodeIds).toEqual(['selected-node', expect.any(String)])
    const network = getNetwork(doc, 'flr-0')!
    expect(network.nodes).toHaveLength(2)
    expect(network.edges[0]).toMatchObject({ from: 'selected-node', distance: 3 })
  })

  it('rejects an unknown explicitly selected node before mutation', () => {
    const doc = createTestDoc()
    const before = JSON.parse(JSON.stringify(doc))

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [
        { x: 0, y: 0, existingNodeId: 'missing-node' },
        { x: 1, y: 0 },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/selected route node not found/i)
    expect(doc).toEqual(before)
  })

  it('rejects fewer than two points without creating an empty route network', () => {
    const doc = createTestDoc()

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 0, y: 0 }],
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/at least two points/i)
    expect(getNetwork(doc, 'flr-0')).toBeUndefined()
  })

  it('rejects non-finite and duplicate consecutive points before mutation', () => {
    for (const points of [
      [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }],
      [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    ]) {
      const doc = createTestDoc()
      const result = routePathCreateHandler.execute(doc, {
        buildingId: 'bld-1',
        floorId: 'flr-0',
        points,
      })

      expect(result.success).toBe(false)
      expect(getNetwork(doc, 'flr-0')).toBeUndefined()
    }
  })

  it('rejects invalid ownership or route types without mutation', () => {
    const invalidInputs = [
      { buildingId: 'missing', floorId: 'flr-0', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { buildingId: 'bld-1', floorId: 'missing', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { buildingId: 'bld-1', floorId: 'flr-0', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], nodeType: 'teleport' },
      { buildingId: 'bld-1', floorId: 'flr-0', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], edgeType: 'teleport' },
    ]

    for (const payload of invalidInputs) {
      const doc = createTestDoc()
      const result = routePathCreateHandler.execute(doc, payload)

      expect(result.success).toBe(false)
      expect(getNetwork(doc, 'flr-0')).toBeUndefined()
    }
  })

  it('undoes the whole path as one command and restores an absent network', () => {
    const doc = createTestDoc()
    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    })

    const inverse = routePathCreateHandler.inverse?.({}, result)
    expect(inverse).not.toBeNull()
    routePathCreateHandler.execute(doc, inverse!.payload)

    expect(getNetwork(doc, 'flr-0')).toBeUndefined()
  })

  it('connects a path through a shared junction split on an existing edge', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'a', position: { x: 0, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'b', position: { x: 10, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { id: 'e-ab', from: 'a', to: 'b', type: 'walk' } })

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [
        { x: 4, y: 8 },
        { x: 4, y: 0.2, junction: { edgeId: 'e-ab', position: { x: 4, y: 0.2 } } },
      ],
    })

    expect(result.success).toBe(true)
    const network = getNetwork(doc, 'flr-0')!
    const nodeIds = result.data?.nodeIds as string[]
    const junctionId = nodeIds[1]
    const junction = network.nodes.find(n => n.id === junctionId)!
    expect(junction).toMatchObject({ type: 'waypoint', position: { x: 4, y: 0 }, floor: 0 })
    expect(network.edges.find(e => e.id === 'e-ab')).toBeUndefined()
    expect(network.edges.filter(e => e.from === 'a' || e.to === 'a')).toHaveLength(1)
    expect(network.edges.filter(e => e.from === 'b' || e.to === 'b')).toHaveLength(1)
    expect(network.edges.some(e => e.from === nodeIds[0] && e.to === junctionId)).toBe(true)
  })

  it('undo restores the network byte-exact after a junction split', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'a', position: { x: 0, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'b', position: { x: 10, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { id: 'e-ab', from: 'a', to: 'b', type: 'walk' } })
    const before = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 4, y: 8 }, { x: 4, y: 0, junction: { edgeId: 'e-ab', position: { x: 4, y: 0 } } }],
    })
    expect(result.success).toBe(true)

    const inverse = routePathCreateHandler.inverse?.({}, result)
    expect(inverse).not.toBeNull()
    routePathCreateHandler.execute(doc, inverse!.payload as Record<string, unknown>)

    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(before)
  })

  it('rejects a junction targeting a missing edge and leaves the document byte-identical', () => {
    const doc = createTestDoc()
    const before = JSON.parse(JSON.stringify(doc))

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 0, y: 0 }, { x: 1, y: 0, junction: { edgeId: 'missing', position: { x: 1, y: 0 } } }],
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/route edge not found/i)
    expect(doc).toEqual(before)
  })

  it('a later resolution failure after a successful junction split leaves network, version, and journal untouched', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'a', position: { x: 0, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'b', position: { x: 10, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { id: 'e-ab', from: 'a', to: 'b', type: 'walk' } })

    const networkBefore = JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))
    const versionBefore = doc.version
    const journalBefore = JSON.parse(JSON.stringify(doc._changeJournal ?? []))

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [
        { x: 4, y: 0, junction: { edgeId: 'e-ab', position: { x: 4, y: 0 } } },
        { x: 3, y: 3, existingNodeId: 'missing-node' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/selected route node not found/i)
    expect(JSON.parse(JSON.stringify(getNetwork(doc, 'flr-0')))).toEqual(networkBefore)
    expect(doc.version).toBe(versionBefore)
    expect(JSON.parse(JSON.stringify(doc._changeJournal ?? []))).toEqual(journalBefore)
  })

  it('treats a null junction as absent instead of throwing', () => {
    const doc = createTestDoc()
    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 0, y: 0 }, { x: 1, y: 0, junction: null }],
    })

    expect(result.success).toBe(true)
    const network = getNetwork(doc, 'flr-0')!
    expect(network.nodes).toHaveLength(2)
    expect(network.edges).toHaveLength(1)
  })
})

// ── Final review: door connector edges are not junction targets ──
// Door connector stubs are Door-owned; splitting one would orphan the Door's
// connectorEdgeId and leave a half-edge with a removed endpoint (INVALID).
describe('V1: route.path.create door connector guard', () => {
  function docWithDoorConnector() {
    const doc = createTestDoc()
    const floor = doc.buildings[0].floors[0]
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'n-a', position: { x: 0, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'n-b', position: { x: 10, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'door-anchor', type: 'portal', position: { x: 5, y: 1 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { id: 'e-ab', from: 'n-a', to: 'n-b' } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { id: 'e-connector', from: 'door-anchor', to: 'n-b' } })
    ;(floor as unknown as { doors: unknown[] }).doors = [{
      id: 'door-1',
      doorType: 'standard',
      position: { x: 5, y: 1 },
      width: 1,
      metadata: {},
      routeConnection: { anchorNodeId: 'door-anchor', targetRouteNodeId: 'n-b', connectorEdgeId: 'e-connector' },
    }]
    return doc
  }

  it('rejects a junction targeting a door connector and leaves the document byte-unchanged', () => {
    const doc = docWithDoorConnector()
    const before = JSON.parse(JSON.stringify(doc))

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [
        { x: 4, y: 8 },
        { x: 5, y: 1, junction: { edgeId: 'e-connector', position: { x: 5, y: 1 } } },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/e-connector is a door connector and cannot be a junction target/i)
    expect(doc).toEqual(before)
  })

  it('journals the split removed original edge as deleted', () => {
    const doc = createTestDoc()
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'a', position: { x: 0, y: 0 } } })
    routeNodeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', node: { id: 'b', position: { x: 10, y: 0 } } })
    routeEdgeCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', edge: { id: 'e-ab', from: 'a', to: 'b' } })

    const result = routePathCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      points: [{ x: 4, y: 8 }, { x: 4, y: 0, junction: { edgeId: 'e-ab', position: { x: 4, y: 0 } } }],
    })

    expect(result.success).toBe(true)
    expect(doc._changeJournal).toContainEqual({ entityId: 'e-ab', entityType: 'route-edge', operation: 'deleted' })
  })
})
