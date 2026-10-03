import { describe, expect, it } from 'vitest'
import { SEMANTIC_ROOM_ID_PREFIX } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import { doorCreateHandler, doorRouteConnectHandler, doorRouteDisconnectHandler, doorUpdateHandler } from '../feature-handlers'
import { deriveRooms } from '../../geometry/room-derivation'
import { wallsToSegments } from '../../geometry/wall-to-segment'

function doc(): CampusDocument {
  return {
    schemaVersion: 1, version: 0,
    metadata: { campusId: 'c', name: 'C', description: '', lastModified: '', editorVersion: '' },
    buildings: [{ id: 'b', name: 'B', code: 'B', category: 'academic', description: '', footprint: { points: [] }, baseElevation: 0, height: 3, verticalConnectors: [], color: '#000', aliases: [], metadata: {}, floors: [{
      id: 'f', level: 0, label: 'GF', elevation: 0, height: 3,
      rooms: [
        { id: 'r1', name: 'One', number: '1', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }, roomDoors: [], metadata: {} },
        { id: 'r2', name: 'Two', number: '2', category: 'classroom', polygon: { points: [{ x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 6, y: 4 }] }, roomDoors: [], metadata: {} },
      ],
      hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
      routeNetwork: { nodes: [{ id: 'route-1', type: 'waypoint', position: { x: 8, y: 2 }, floor: 0 }], edges: [] },
    }] }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

const rectangle = (minX: number, maxX: number) => ({ type: 'rectangle' as const, min: { x: minX, y: 1 }, max: { x: maxX, y: 3 }, rotation: 0 })

/** Floor whose only room is an attribute-only wall-derived face (no assigned roomId). */
function semanticDoc(): { document: CampusDocument; canonicalId: string } {
  const document = doc()
  const floor = document.buildings[0].floors[0]
  const walls = [
    { id: 'w1', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.15, height: 3 },
    { id: 'w2', start: { x: 4, y: 0 }, end: { x: 4, y: 4 }, thickness: 0.15, height: 3 },
    { id: 'w3', start: { x: 4, y: 4 }, end: { x: 0, y: 4 }, thickness: 0.15, height: 3 },
    { id: 'w4', start: { x: 0, y: 4 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3 },
  ]
  const faceId = deriveRooms(wallsToSegments(walls), [])[0]?.faceId
  if (!faceId) throw new Error('semantic fixture did not derive an enclosed face')
  floor.rooms = []
  floor.walls = walls
  floor.roomAttributes = [{ faceId, name: 'Unassigned Lab', searchable: false }]
  return { document, canonicalId: `${SEMANTIC_ROOM_ID_PREFIX}${faceId}` }
}

describe('spatial Door commands', () => {
  it('assigns, reparents, and clears Room ownership from rectangle containment', () => {
    const document = doc()
    expect(doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', name: 'Main Door', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 2, rotation: 0, geometry: rectangle(1, 3), metadata: {} } }).success).toBe(true)
    expect(document.buildings[0].floors[0].doors?.[0]).toMatchObject({ roomId: 'r1', ownership: { status: 'assigned' } })

    doorUpdateHandler.execute(document, { doorId: 'd', patch: { position: { x: 8, y: 2 }, geometry: rectangle(7, 9) } })
    expect(document.buildings[0].floors[0].doors?.[0]).toMatchObject({ roomId: 'r2', ownership: { status: 'assigned' } })

    doorUpdateHandler.execute(document, { doorId: 'd', patch: { position: { x: 5, y: 8 }, geometry: { type: 'rectangle', min: { x: 4.5, y: 7.5 }, max: { x: 5.5, y: 8.5 }, rotation: 0 } } })
    expect(document.buildings[0].floors[0].doors?.[0].roomId).toBeUndefined()
    expect(document.buildings[0].floors[0].doors?.[0].ownership).toEqual({ status: 'unassigned' })
  })

  it('creates a Door anchor and connector only to the explicitly selected route node', () => {
    const document = doc()
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, rotation: 0, geometry: rectangle(1, 3), metadata: {} } })

    const result = doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-1' })
    const floor = document.buildings[0].floors[0]
    const door = floor.doors?.[0]
    expect(result.success).toBe(true)
    expect(door?.routeConnection?.targetRouteNodeId).toBe('route-1')
    expect(floor.routeNetwork?.nodes.find(node => node.id === door?.routeConnection?.anchorNodeId)).toMatchObject({ type: 'portal', position: { x: 2, y: 2 } })
    expect(floor.routeNetwork?.edges.find(edge => edge.id === door?.routeConnection?.connectorEdgeId)).toMatchObject({ from: door?.routeConnection?.anchorNodeId, to: 'route-1', type: 'walk' })
    expect(floor.routeNetwork?.nodes).toHaveLength(2)
    expect(floor.routeNetwork?.edges).toHaveLength(1)
  })

  it('moves its owned route anchor with the Door and restores topology on undo', () => {
    const document = doc()
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-1' })
    const floor = document.buildings[0].floors[0]
    const connection = floor.doors?.[0].routeConnection

    const result = doorUpdateHandler.execute(document, { doorId: 'd', patch: { position: { x: 4, y: 2 }, geometry: rectangle(3, 5) } })
    expect(floor.routeNetwork?.nodes.find(node => node.id === connection?.anchorNodeId)?.position).toEqual({ x: 4, y: 2 })
    expect(floor.routeNetwork?.edges.find(edge => edge.id === connection?.connectorEdgeId)?.distance).toBe(4)

    const inverse = doorUpdateHandler.inverse({ doorId: 'd' }, result)
    expect(inverse).not.toBeNull()
    doorUpdateHandler.execute(document, inverse!.payload)
    expect(floor.doors?.[0].position).toEqual({ x: 2, y: 2 })
    expect(floor.routeNetwork?.nodes.find(node => node.id === connection?.anchorNodeId)?.position).toEqual({ x: 2, y: 2 })
    expect(floor.routeNetwork?.edges.find(edge => edge.id === connection?.connectorEdgeId)?.distance).toBeCloseTo(Math.hypot(6, 0))
  })

  it('connects a Door to a route segment through a real shared junction', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })

    const result = doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 5, y: 2 } } })

    expect(result.success).toBe(true)
    const door = floor.doors?.[0]
    const junctionId = door?.routeConnection?.targetRouteNodeId
    expect(junctionId).toBeTruthy()
    expect(floor.routeNetwork?.edges.find(e => e.id === 'edge-1-2')).toBeUndefined()
    expect(floor.routeNetwork?.nodes.find(n => n.id === junctionId)).toMatchObject({ type: 'waypoint', position: { x: 5, y: 2 } })
    expect(floor.routeNetwork?.edges.filter(e => e.from === junctionId || e.to === junctionId)).toHaveLength(3)
  })

  it('restores the split network byte-exact when a segment Door connection is undone', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    const before = JSON.parse(JSON.stringify(floor))

    const result = doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 5, y: 2 } } })
    const inverse = doorRouteConnectHandler.inverse({ doorId: 'd' }, result)
    expect(inverse).not.toBeNull()
    doorRouteConnectHandler.execute(document, inverse!.payload as Record<string, unknown>)

    expect(JSON.parse(JSON.stringify(floor))).toEqual(before)
  })

  it('disconnect removes only the Door link and rejoins an orphaned junction', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 4, y: 2 } } })
    const junctionId = floor.doors?.[0].routeConnection?.targetRouteNodeId

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    expect(floor.doors?.[0].routeConnection).toBeUndefined()
    expect(floor.routeNetwork?.nodes.find(n => n.id === junctionId)).toBeUndefined()
    expect(floor.routeNetwork?.edges).toHaveLength(1)
    expect(floor.routeNetwork?.edges[0]).toMatchObject({ from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
  })

  it('keeps a junction that another Door still references', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd1', doorType: 'standard', position: { x: 2, y: 2 }, width: 1, depth: 1, geometry: rectangle(1.5, 2.5), metadata: {} } })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd2', doorType: 'standard', position: { x: 6, y: 2 }, width: 1, depth: 1, geometry: rectangle(5.5, 6.5), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd1', segment: { edgeId: 'edge-1-2', position: { x: 3, y: 2 } } })
    const junctionId = floor.doors?.find(d => d.id === 'd1')?.routeConnection?.targetRouteNodeId
    doorRouteConnectHandler.execute(document, { doorId: 'd2', routeNodeId: junctionId! })

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd1' })

    expect(result.success).toBe(true)
    expect(floor.routeNetwork?.nodes.find(n => n.id === junctionId)).toBeDefined()
    expect(floor.doors?.find(d => d.id === 'd2')?.routeConnection?.targetRouteNodeId).toBe(junctionId)
  })

  it('disconnect is byte-exact reversible', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-1' })
    const before = JSON.parse(JSON.stringify(floor))

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })
    const inverse = doorRouteDisconnectHandler.inverse({ doorId: 'd' }, result)
    expect(inverse).not.toBeNull()
    doorRouteDisconnectHandler.execute(document, inverse!.payload as Record<string, unknown>)

    expect(JSON.parse(JSON.stringify(floor))).toEqual(before)
  })

  it('keeps an authored corner junction whose neighbors are not collinear', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    const network = floor.routeNetwork!
    network.nodes = [
      { id: 'corner-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
      { id: 'corner-j', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
      { id: 'corner-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
    ]
    network.edges = [
      { id: 'edge-aj', from: 'corner-a', to: 'corner-j', type: 'walk', distance: Math.hypot(5, 5) },
      { id: 'edge-jb', from: 'corner-j', to: 'corner-b', type: 'walk', distance: Math.hypot(5, 5) },
    ]
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, rotation: 0, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'corner-j' })
    const journalLength = document._changeJournal?.length ?? 0

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    expect(floor.doors?.[0].routeConnection).toBeUndefined()
    expect(network.nodes.find(n => n.id === 'corner-j')).toBeDefined()
    expect(network.edges).toHaveLength(2)
    expect(network.edges.find(e => e.id === 'edge-aj')).toMatchObject({ from: 'corner-a', to: 'corner-j' })
    expect(network.edges.find(e => e.id === 'edge-jb')).toMatchObject({ from: 'corner-j', to: 'corner-b' })
    expect(network.edges.some(e => (e.from === 'corner-a' && e.to === 'corner-b') || (e.from === 'corner-b' && e.to === 'corner-a'))).toBe(false)
    expect((document._changeJournal ?? []).slice(journalLength).filter(entry => entry.entityType === 'route-edge' && entry.operation === 'created')).toHaveLength(0)
  })

  it('keeps a split junction still referenced by floor.entranceAccess', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, rotation: 0, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 5, y: 2 } } })
    const junctionId = floor.doors?.[0].routeConnection?.targetRouteNodeId
    const connectorEdgeId = floor.doors?.[0].routeConnection?.connectorEdgeId
    const splitEdgeIds = floor.routeNetwork!.edges
      .filter(e => (e.from === junctionId || e.to === junctionId) && e.id !== connectorEdgeId)
      .map(e => e.id)
    floor.entranceAccess = [{ entranceId: 'ent-1', outdoorNodeId: 'out-1', indoorRouteNodeId: junctionId! }]

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    expect(floor.doors?.[0].routeConnection).toBeUndefined()
    expect(floor.routeNetwork?.nodes.find(n => n.id === junctionId)).toBeDefined()
    expect(floor.routeNetwork?.edges.map(e => e.id).sort()).toEqual([...splitEdgeIds].sort())
  })

  it('keeps a split junction still referenced by a room access point', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, rotation: 0, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 5, y: 2 } } })
    const junctionId = floor.doors?.[0].routeConnection?.targetRouteNodeId
    const connectorEdgeId = floor.doors?.[0].routeConnection?.connectorEdgeId
    const splitEdgeIds = floor.routeNetwork!.edges
      .filter(e => (e.from === junctionId || e.to === junctionId) && e.id !== connectorEdgeId)
      .map(e => e.id)
    floor.roomAttributes = [{
      faceId: 'face-1',
      name: 'Room One',
      searchable: false,
      accessPoints: [{ routeNodeId: junctionId!, primary: true }],
    }]

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    expect(floor.doors?.[0].routeConnection).toBeUndefined()
    expect(floor.routeNetwork?.nodes.find(n => n.id === junctionId)).toBeDefined()
    expect(floor.routeNetwork?.edges.map(e => e.id).sort()).toEqual([...splitEdgeIds].sort())
  })

  it('journals the merged edge as created when a disconnect rejoins an orphaned junction', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 4, y: 2 } } })
    const journalLength = document._changeJournal?.length ?? 0

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    const mergedEdge = floor.routeNetwork?.edges[0]
    expect(mergedEdge).toMatchObject({ from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    const createdEdges = (document._changeJournal ?? [])
      .slice(journalLength)
      .filter(entry => entry.entityType === 'route-edge' && entry.operation === 'created')
    expect(createdEdges).toHaveLength(1)
    expect(createdEdges[0].entityId).toBe(mergedEdge?.id)
  })

  // ── Final review: door connectors are not junction targets; anchors are removed wholesale ──

  it('rejects a segment junction targeting a door connector edge without mutating the floor', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd1', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd1', routeNodeId: 'route-1' })
    const connectorEdgeId = floor.doors?.[0].routeConnection?.connectorEdgeId as string
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd2', doorType: 'standard', position: { x: 6, y: 2 }, width: 2, depth: 1, geometry: rectangle(5, 7), metadata: {} } })
    const before = JSON.parse(JSON.stringify(floor))

    const result = doorRouteConnectHandler.execute(document, { doorId: 'd2', segment: { edgeId: connectorEdgeId, position: { x: 2, y: 2 } } })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/door connector and cannot be a junction target/i)
    expect(JSON.parse(JSON.stringify(floor))).toEqual(before)
  })

  it('reconnect removes every edge incident to a stale anchor, not only the recorded connector id', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-1' })
    const door = floor.doors?.[0]
    const staleAnchorNodeId = door?.routeConnection?.anchorNodeId as string
    door!.routeConnection!.connectorEdgeId = 'route-edge-stale'

    const result = doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-2' })

    expect(result.success).toBe(true)
    const nodeIds = new Set(floor.routeNetwork!.nodes.map(node => node.id))
    expect(nodeIds.has(staleAnchorNodeId)).toBe(false)
    expect(floor.routeNetwork!.edges.some(edge => edge.from === staleAnchorNodeId || edge.to === staleAnchorNodeId)).toBe(false)
    expect(floor.routeNetwork!.edges.every(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))).toBe(true)
  })

  it('disconnect removes the real connector even when the recorded connector id is stale', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-1' })
    const door = floor.doors?.[0]
    const staleAnchorNodeId = door?.routeConnection?.anchorNodeId as string
    door!.routeConnection!.connectorEdgeId = 'route-edge-stale'

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    const nodeIds = new Set(floor.routeNetwork!.nodes.map(node => node.id))
    expect(nodeIds.has(staleAnchorNodeId)).toBe(false)
    expect(floor.routeNetwork!.edges.some(edge => edge.from === staleAnchorNodeId || edge.to === staleAnchorNodeId)).toBe(false)
    expect(floor.routeNetwork!.edges.every(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))).toBe(true)
  })

  it('keeps a collinear split junction referenced by a vertical transition connection', () => {
    const document = doc()
    const floor = document.buildings[0].floors[0]
    floor.routeNetwork!.nodes.push({ id: 'route-2', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 })
    floor.routeNetwork!.edges.push({ id: 'edge-1-2', from: 'route-1', to: 'route-2', type: 'walk', distance: 6 })
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 2, depth: 1, geometry: rectangle(1, 3), metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', segment: { edgeId: 'edge-1-2', position: { x: 5, y: 2 } } })
    const junctionId = floor.doors?.[0].routeConnection?.targetRouteNodeId
    const connectorEdgeId = floor.doors?.[0].routeConnection?.connectorEdgeId
    const splitEdgeIds = floor.routeNetwork!.edges
      .filter(edge => (edge.from === junctionId || edge.to === junctionId) && edge.id !== connectorEdgeId)
      .map(edge => edge.id)
    document.buildings[0].verticalTransitions = [{
      id: 'vt-1',
      featureId: 'stair-1',
      type: 'staircase',
      connections: [{ floorId: 'f', routeNodeId: junctionId! }],
    }]

    const result = doorRouteDisconnectHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    expect(floor.doors?.[0].routeConnection).toBeUndefined()
    expect(floor.routeNetwork?.nodes.find(node => node.id === junctionId)).toBeDefined()
    expect(floor.routeNetwork?.edges.map(edge => edge.id).sort()).toEqual([...splitEdgeIds].sort())
    expect(document.buildings[0].verticalTransitions).toHaveLength(1)
  })

  // ── Canonical room ids: legacy + semantic identities share one accepted set ──

  it('accepts a canonical fallback room id on create and update, rejecting unknown ids', () => {
    const { document, canonicalId } = semanticDoc()
    const floor = document.buildings[0].floors[0]

    const created = doorCreateHandler.execute(document, {
      buildingId: 'b', floorId: 'f', roomId: canonicalId,
      door: { id: 'd', position: { x: 2, y: 2 }, width: 0.9, metadata: {} },
    })
    expect(created.success).toBe(true)
    expect(floor.doors?.[0]).toMatchObject({ roomId: canonicalId, ownership: { status: 'assigned' } })

    const updated = doorUpdateHandler.execute(document, { doorId: 'd', patch: { roomId: canonicalId } })
    expect(updated.success).toBe(true)
    expect(floor.doors?.[0].roomId).toBe(canonicalId)

    const unknown = doorUpdateHandler.execute(document, { doorId: 'd', patch: { roomId: 'ghost-room' } })
    expect(unknown.success).toBe(false)
    expect(unknown.error).toMatch(/not found/i)
    expect(floor.doors?.[0].roomId).toBe(canonicalId)
  })

  it('assigns the canonical id to a containment-created door inside an attribute-only room', () => {
    const { document, canonicalId } = semanticDoc()
    const floor = document.buildings[0].floors[0]

    const result = doorCreateHandler.execute(document, {
      buildingId: 'b', floorId: 'f',
      door: { id: 'd', position: { x: 2, y: 2 }, width: 0.9, geometry: rectangle(1, 3), metadata: {} },
    })

    expect(result.success).toBe(true)
    expect(result.data?.roomId).toBe(canonicalId)
    expect(floor.doors?.[0]).toMatchObject({ roomId: canonicalId, ownership: { status: 'assigned' } })
  })
})
