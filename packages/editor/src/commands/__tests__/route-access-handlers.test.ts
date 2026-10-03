import { describe, expect, it } from 'vitest'
import type { CampusDocument, Floor } from '@navi/core'
import {
  entranceAccessAssignHandler,
  entranceAccessUnassignHandler,
  roomAccessAssignHandler,
  roomAccessUnassignHandler,
} from '../route-access-handlers'

function makeFloor(id: string, level: number): Floor {
  const firstNodeId = level === 0 ? 'route-node-1' : `route-node-floor-${level}`
  const secondNodeId = level === 0 ? 'route-node-2' : `route-node-floor-${level}-2`
  return {
    id,
    level,
    label: level === 0 ? 'Ground' : `Floor ${level}`,
    elevation: level * 4,
    height: 4,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: level === 0
      ? [{ id: 'entrance-1', label: 'Main Entrance', position: { x: 0, y: 0 }, level, type: 'main', hasQR: true, hasPanorama: false }]
      : [],
    connectorStops: [],
    parametricComponents: [],
    walls: [{ id: 'wall-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2, height: 3 }],
    openings: [{ id: 'door-1', type: 'door', wallId: 'wall-1', offset: 2, width: 1 }],
    roomAttributes: [{ faceId: 'face-1', roomId: 'room-1', name: 'Room One', searchable: true }],
    routeNetwork: {
      nodes: [
        { id: firstNodeId, type: 'waypoint', position: { x: 2, y: 2 }, floor: level },
        { id: secondNodeId, type: 'waypoint', position: { x: 8, y: 2 }, floor: level },
      ],
      edges: [{ id: `route-edge-${level}`, from: firstNodeId, to: secondNodeId, type: 'walk', distance: 6 }],
    },
    metadata: {},
  } as Floor
}

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'campus-1', name: 'Campus', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [{
      id: 'building-1',
      name: 'Building',
      footprint: { points: [] },
      baseElevation: 0,
      height: 10,
      floors: [makeFloor('floor-0', 0), makeFloor('floor-1', 1)],
      verticalConnectors: [],
      aliases: [],
      metadata: {},
    } as any],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function roomAttributes(doc: CampusDocument) {
  return doc.buildings[0].floors[0].roomAttributes![0]
}

describe('Route access command handlers', () => {
  it('assigns point-only RoomAccess without creating legacy room geometry', () => {
    const doc = makeDocument()

    const result = roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1',
    })

    expect(result.success).toBe(true)
    expect(roomAttributes(doc).accessPoints).toEqual([{ routeNodeId: 'route-node-1', primary: true }])
    expect(doc.buildings[0].floors[0].rooms).toEqual([])
  })

  it('accepts a legacy/detail RoomAccess when the referenced opening is a door', () => {
    const doc = makeDocument()

    const result = roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1', openingId: 'door-1',
    })

    expect(result.success).toBe(true)
    expect(roomAttributes(doc).accessPoints).toEqual([{ openingId: 'door-1', routeNodeId: 'route-node-1', primary: true }])
  })

  it('replaces the previous primary when a second access point is marked primary', () => {
    const doc = makeDocument()
    roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1',
    })

    const result = roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-2', primary: true,
    })

    expect(result.success).toBe(true)
    expect(roomAttributes(doc).accessPoints).toEqual([
      { routeNodeId: 'route-node-1', primary: false },
      { routeNodeId: 'route-node-2', primary: true },
    ])
  })

  it('unassigns RoomAccess and its inverse restores the exact previous access list', () => {
    const doc = makeDocument()
    roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1',
    })
    const before = structuredClone(roomAttributes(doc).accessPoints)

    const result = roomAccessUnassignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1',
    })
    expect(result.success).toBe(true)
    expect(roomAttributes(doc).accessPoints).toBeUndefined()

    const inverse = roomAccessUnassignHandler.inverse!({
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1',
    }, result)
    expect(inverse).not.toBeNull()
    roomAccessUnassignHandler.execute(doc, inverse!.payload)
    expect(roomAttributes(doc).accessPoints).toEqual(before)
  })

  it('rejects missing, wrong-floor, and non-door RoomAccess references before mutation', () => {
    const doc = makeDocument()
    const floor = doc.buildings[0].floors[0]
    floor.openings!.push({ id: 'window-1', type: 'window', wallId: 'wall-1', offset: 5, width: 1 })

    const missingNode = roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'missing-node',
    })
    const wrongFloorNode = roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-floor-1',
    })
    const nonDoor = roomAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', faceId: 'face-1', routeNodeId: 'route-node-1', openingId: 'window-1',
    })

    expect(missingNode.success).toBe(false)
    expect(wrongFloorNode.success).toBe(false)
    expect(nonDoor.success).toBe(false)
    expect(roomAttributes(doc).accessPoints).toBeUndefined()
  })

  it('assigns and unassigns an EntranceAccess bridge using an indoor node and external outdoor id', () => {
    const doc = makeDocument()
    const assign = entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'route-node-1',
    })

    expect(assign.success).toBe(true)
    expect(doc.buildings[0].floors[0].entranceAccess).toEqual([{
      entranceId: 'entrance-1', outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'route-node-1',
    }])

    const remove = entranceAccessUnassignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
    })
    expect(remove.success).toBe(true)
    expect(doc.buildings[0].floors[0].entranceAccess).toBeUndefined()
  })

  it('assigns one of three entrances without altering either sibling bridge', () => {
    const doc = makeDocument()
    const floor = doc.buildings[0].floors[0]
    floor.entrances = [
      { id: 'entrance-a', label: 'A', position: { x: 0, y: 0 }, level: 0, type: 'main', hasQR: false, hasPanorama: false },
      { id: 'entrance-b', label: 'B', position: { x: 1, y: 0 }, level: 0, type: 'side', hasQR: false, hasPanorama: false },
      { id: 'entrance-c', label: 'C', position: { x: 2, y: 0 }, level: 0, type: 'emergency', hasQR: false, hasPanorama: false },
    ]
    floor.entranceAccess = [
      { entranceId: 'entrance-b', outdoorNodeId: 'outdoor-b', indoorRouteNodeId: 'route-node-1' },
      { entranceId: 'entrance-c', outdoorNodeId: 'outdoor-c', indoorRouteNodeId: 'route-node-2' },
    ]

    const beforeB = structuredClone(floor.entranceAccess[0])
    const beforeC = structuredClone(floor.entranceAccess[1])
    const result = entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-a',
      outdoorNodeId: 'outdoor-a', indoorRouteNodeId: 'route-node-1',
    })

    expect(result.success).toBe(true)
    expect(floor.entrances.map(entrance => entrance.id)).toEqual(['entrance-a', 'entrance-b', 'entrance-c'])
    expect(floor.entranceAccess).toEqual([
      beforeB,
      beforeC,
      { entranceId: 'entrance-a', outdoorNodeId: 'outdoor-a', indoorRouteNodeId: 'route-node-1' },
    ])
  })

  it('stores a source-first route-segment target with a stable access junction id', () => {
    const doc = makeDocument()
    const outdoorPosition = { lat: 14.5997, lng: 120.9845 }

    const assign = entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
      outdoorNodeId: 'segment:road-edge-1', outdoorRouteId: 'road-1', outdoorPosition,
      indoorRouteNodeId: 'route-node-1',
    })

    expect(assign.success).toBe(true)
    expect(doc.buildings[0].floors[0].entranceAccess).toEqual([{
      entranceId: 'entrance-1',
      outdoorNodeId: 'N-entrance-access-entrance-1',
      indoorRouteNodeId: 'route-node-1',
      outdoorRouteId: 'road-1',
      outdoorPosition,
    }])
  })

  it('rejects an EntranceAccess with an unknown indoor or cross-floor node', () => {
    const doc = makeDocument()
    const missing = entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'missing-node',
    })
    const wrongFloor = entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'route-node-floor-1',
    })
    const missingOutdoor = entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
      outdoorNodeId: '', indoorRouteNodeId: 'route-node-1',
    })

    expect(missing.success).toBe(false)
    expect(wrongFloor.success).toBe(false)
    expect(missingOutdoor.success).toBe(false)
    expect(doc.buildings[0].floors[0].entranceAccess).toBeUndefined()
  })

  it('entrance unassign inverse restores the prior bridge exactly', () => {
    const doc = makeDocument()
    entranceAccessAssignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
      outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'route-node-1',
    })
    const result = entranceAccessUnassignHandler.execute(doc, {
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
    })
    const inverse = entranceAccessUnassignHandler.inverse!({
      buildingId: 'building-1', floorId: 'floor-0', entranceId: 'entrance-1',
    }, result)

    expect(result.success).toBe(true)
    expect(inverse).not.toBeNull()
    entranceAccessUnassignHandler.execute(doc, inverse!.payload)
    expect(doc.buildings[0].floors[0].entranceAccess).toEqual([{
      entranceId: 'entrance-1', outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'route-node-1',
    }])
  })
})
