import { describe, expect, it } from 'vitest'
import type { CampusDocument, RoomDoor } from '@navi/core'
import { buildDuplicatedDoor } from '../duplicate-helpers'
import { doorCreateHandler, doorDeleteHandler, doorDuplicateHandler, doorRouteConnectHandler } from '../feature-handlers'

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

function sourceDoor(overrides: Partial<RoomDoor> = {}): RoomDoor {
  return { id: 'door-src', doorType: 'standard', position: { x: 2, y: 2 }, width: 1.2, metadata: {}, ...overrides }
}

function floorOf(document: CampusDocument) {
  return document.buildings[0].floors[0]
}

describe('buildDuplicatedDoor', () => {
  it('assigns the given id, applies the offset, and translates rectangle geometry', () => {
    const source = sourceDoor({ geometry: rectangle(1, 3) })

    const duplicate = buildDuplicatedDoor(source, 'door-copy', { x: 0.5, y: 0.5 })

    expect(duplicate.id).toBe('door-copy')
    expect(duplicate.position).toEqual({ x: 2.5, y: 2.5 })
    expect(duplicate.geometry).toEqual({
      type: 'rectangle',
      min: { x: 1.5, y: 1.5 },
      max: { x: 3.5, y: 3.5 },
      rotation: 0,
    })
    expect(source.position).toEqual({ x: 2, y: 2 })
    expect(source.geometry).toEqual(rectangle(1, 3))
  })

  it('copies doorType/width/depth/rotation/name and deep-clones metadata when present', () => {
    const source = sourceDoor({
      doorType: 'opening', width: 1.4, depth: 0.3, rotation: 0.25, name: 'Lab Door',
      metadata: { tags: ['a'], nested: { level: 2 } },
    })

    const duplicate = buildDuplicatedDoor(source, 'door-copy', { x: 0, y: 0 })

    expect(duplicate).toMatchObject({
      id: 'door-copy', doorType: 'opening', width: 1.4, depth: 0.3, rotation: 0.25,
      name: 'Lab Door', connectedToType: 'room',
    })
    expect(duplicate.metadata).toEqual({ tags: ['a'], nested: { level: 2 } })
    expect(duplicate.metadata).not.toBe(source.metadata)
    const duplicatedTags = duplicate.metadata.tags as string[]
    duplicatedTags.push('b')
    expect(source.metadata.tags).toEqual(['a'])
  })

  it('copies the door leaf angle when present and omits it when absent', () => {
    const withAngle = buildDuplicatedDoor(sourceDoor({ angle: 45 }), 'door-copy', { x: 0, y: 0 })
    expect(withAngle.angle).toBe(45)

    const withoutAngle = buildDuplicatedDoor(sourceDoor(), 'door-copy', { x: 0, y: 0 })
    expect('angle' in withoutAngle).toBe(false)
  })

  it('omits optional fields absent on the source and defaults connectedToType to room', () => {
    const duplicate = buildDuplicatedDoor(sourceDoor(), 'door-copy', { x: 0, y: 0 })

    expect('depth' in duplicate).toBe(false)
    expect('rotation' in duplicate).toBe(false)
    expect('geometry' in duplicate).toBe(false)
    expect('name' in duplicate).toBe(false)
    expect(duplicate.connectedToType).toBe('room')
  })

  it('never copies routeConnection, connectedToId, route connection, or room identity', () => {
    const source = sourceDoor({
      roomId: 'r1', ownership: { status: 'assigned' }, connectedToId: 'r2', connectedToType: 'hallway',
      routeConnection: { anchorNodeId: 'anchor-1', targetRouteNodeId: 'route-1', connectorEdgeId: 'edge-1' },
    })

    const duplicate = buildDuplicatedDoor(source, 'door-copy', { x: 0, y: 0 })

    expect('routeConnection' in duplicate).toBe(false)
    expect('connectedToId' in duplicate).toBe(false)
    expect('roomId' in duplicate).toBe(false)
    expect('ownership' in duplicate).toBe(false)
    expect(JSON.stringify(duplicate)).not.toContain('anchor-1')
    expect(duplicate.connectedToType).toBe('hallway')
  })
})

describe('door.duplicate', () => {
  it('appends a fresh-id duplicate at the default offset and journals it as created', () => {
    const document = doc()
    const floor = floorOf(document)
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 1.2, geometry: rectangle(1, 3), metadata: {} } })
    const journalLength = document._changeJournal?.length ?? 0

    const result = doorDuplicateHandler.execute(document, { doorId: 'd' })

    expect(result.success).toBe(true)
    expect(result.entityId).toBeTruthy()
    expect(result.entityId).not.toBe('d')
    expect(floor.doors).toHaveLength(2)
    const duplicate = floor.doors?.find(door => door.id === result.entityId)
    expect(duplicate).toMatchObject({ position: { x: 2.5, y: 2.5 }, width: 1.2 })
    expect(duplicate?.geometry).toEqual({ type: 'rectangle', min: { x: 1.5, y: 1.5 }, max: { x: 3.5, y: 3.5 }, rotation: 0 })
    expect(result.data).toMatchObject({ buildingId: 'b', floorId: 'f', roomId: 'r1' })
    expect((document._changeJournal ?? []).slice(journalLength)).toEqual([
      { entityId: result.entityId, entityType: 'door', operation: 'created' },
    ])
  })

  it('re-evaluates room ownership at the duplicate position (inside room B, then unassigned outside)', () => {
    const document = doc()
    const floor = floorOf(document)
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 1, metadata: {} } })
    expect(floor.doors?.[0]).toMatchObject({ roomId: 'r1', ownership: { status: 'assigned' } })

    const inside = doorDuplicateHandler.execute(document, { doorId: 'd', offset: { x: 5, y: 0 } })
    const inRoomB = floor.doors?.find(door => door.id === inside.entityId)
    expect(inRoomB).toMatchObject({ position: { x: 7, y: 2 }, roomId: 'r2', ownership: { status: 'assigned' } })
    expect(inside.data).toMatchObject({ roomId: 'r2' })

    const outside = doorDuplicateHandler.execute(document, { doorId: 'd', offset: { x: 20, y: 20 } })
    const unassigned = floor.doors?.find(door => door.id === outside.entityId)
    expect(unassigned?.position).toEqual({ x: 22, y: 22 })
    expect('roomId' in (unassigned ?? {})).toBe(false)
    expect(unassigned?.ownership).toEqual({ status: 'unassigned' })
    expect(outside.data?.roomId).toBeUndefined()

    expect(floor.doors?.[0]).toMatchObject({ position: { x: 2, y: 2 }, roomId: 'r1' })
  })

  it('never inherits a source route connection or connectedToId', () => {
    const document = doc()
    const floor = floorOf(document)
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 1, connectedToId: 'r2', connectedToType: 'room', metadata: {} } })
    doorRouteConnectHandler.execute(document, { doorId: 'd', routeNodeId: 'route-1' })
    const sourceConnection = floor.doors?.[0].routeConnection
    expect(sourceConnection).toBeTruthy()
    const networkBefore = JSON.stringify(floor.routeNetwork)

    const result = doorDuplicateHandler.execute(document, { doorId: 'd' })

    const duplicate = floor.doors?.find(door => door.id === result.entityId)
    expect('routeConnection' in (duplicate ?? {})).toBe(false)
    expect('connectedToId' in (duplicate ?? {})).toBe(false)
    expect(JSON.stringify(duplicate)).not.toContain(sourceConnection!.anchorNodeId)
    expect(JSON.stringify(duplicate)).not.toContain(sourceConnection!.connectorEdgeId)
    expect(JSON.stringify(floor.routeNetwork)).toBe(networkBefore)
  })

  it('rejects invalid offsets without mutating the document', () => {
    const document = doc()
    doorCreateHandler.execute(document, { buildingId: 'b', floorId: 'f', door: { id: 'd', doorType: 'standard', position: { x: 2, y: 2 }, width: 1, metadata: {} } })
    const before = JSON.stringify(document)

    for (const offset of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
      { x: '1', y: 2 },
      { x: 0, y: null },
      {},
      'nope',
    ]) {
      const result = doorDuplicateHandler.execute(document, { doorId: 'd', offset })
      expect(result.success).toBe(false)
    }
    expect(JSON.stringify(document)).toBe(before)
  })

  it('fails for an unknown door id without mutating the document', () => {
    const document = doc()
    const before = JSON.stringify(document)

    const result = doorDuplicateHandler.execute(document, { doorId: 'ghost' })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/door not found/i)
    expect(JSON.stringify(document)).toBe(before)
  })

  it('undoes through door.delete, restoring floor.doors byte-exact', () => {
    const document = doc()
    const floor = floorOf(document)
    doorCreateHandler.execute(document, {
      buildingId: 'b', floorId: 'f',
      door: {
        id: 'd', doorType: 'opening', position: { x: 2, y: 2 }, width: 1.2, depth: 0.3, rotation: 0.25,
        name: 'Main Door', geometry: rectangle(1, 3), connectedToId: 'r2', connectedToType: 'room',
        metadata: { tagged: true },
      },
    })
    const before = JSON.stringify(floor.doors)

    const result = doorDuplicateHandler.execute(document, { doorId: 'd' })
    expect(floor.doors).toHaveLength(2)

    const inverse = doorDuplicateHandler.inverse!({ doorId: 'd' }, result)
    expect(inverse).not.toBeNull()
    expect(inverse?.id).toBe('door.delete')
    expect(inverse?.label).toBe('Undo Duplicate Door')

    const undone = doorDeleteHandler.execute(document, inverse!.payload)
    expect(undone.success).toBe(true)
    expect(JSON.stringify(floor.doors)).toBe(before)
    expect(floor.doors).toHaveLength(1)
  })
})
