import { describe, expect, it } from 'vitest'
import type { CampusDocument, Floor } from '@navi/core'
import { validateRouteNetwork } from '../rules/modules/route-network'

function makeFloor(overrides: Partial<Floor> = {}): Floor {
  return {
    id: 'floor-0',
    level: 0,
    label: 'Ground',
    elevation: 0,
    height: 4,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    metadata: {},
    ...overrides,
  } as Floor
}

function makeDocument(floor: Floor = makeFloor()): CampusDocument {
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
      floors: [floor],
      verticalConnectors: [],
      aliases: [],
      metadata: {},
    } as any],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

const route = (id: string, x: number, y: number, floor = 0) => ({ id, type: 'waypoint' as const, position: { x, y }, floor })
const edge = (id: string, from: string, to: string, distance = 5) => ({ id, from, to, type: 'walk' as const, distance })

describe('route-network validation', () => {
  it('keeps a legacy floor with no authored route network valid', () => {
    expect(validateRouteNetwork(makeDocument())).toEqual([])
  })

  it('reports malformed nodes, missing edge endpoints, and invalid edge distance', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [{ id: 'route-node-1', type: 'waypoint', position: { x: Number.NaN, y: 0 }, floor: 0 }],
        edges: [{ id: 'route-edge-1', from: 'route-node-1', to: 'missing-node', type: 'walk', distance: -1 }],
      },
    })

    const issues = validateRouteNetwork(makeDocument(floor))
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'route-network-structure', targets: expect.arrayContaining([expect.objectContaining({ entityId: 'route-edge-1' })]) }),
      expect.objectContaining({ ruleId: 'route-network-structure', targets: expect.arrayContaining([expect.objectContaining({ entityId: 'missing-node' })]) }),
    ]))
  })

  it('reports wrong-floor nodes through the floor-consistency rule', () => {
    const floor = makeFloor({
      routeNetwork: { nodes: [route('route-node-1', 0, 0, 1)], edges: [] },
    })

    const issues = validateRouteNetwork(makeDocument(floor))
    expect(issues).toContainEqual(expect.objectContaining({
      ruleId: 'route-floor-consistency',
      targets: expect.arrayContaining([expect.objectContaining({ entityId: 'route-node-1' })]),
    }))
  })

  it('makes disconnected and isolated authored nodes publish errors', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [route('route-node-1', 0, 0), route('route-node-2', 5, 0), route('route-node-isolated', 30, 30)],
        edges: [edge('route-edge-1', 'route-node-1', 'route-node-2')],
      },
    })

    const issues = validateRouteNetwork(makeDocument(floor), 'publish')
    const disconnected = issues.filter((issue) => issue.ruleId === 'route-network-disconnected')
    expect(disconnected.length).toBeGreaterThan(0)
    expect(disconnected.every((issue) => issue.severity === 'error')).toBe(true)
    expect(disconnected).toContainEqual(expect.objectContaining({
      targets: expect.arrayContaining([expect.objectContaining({ entityId: 'route-node-isolated' })]),
    }))
  })

  it('accepts point-only RoomAccess when its route node is on the connected graph', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [route('route-node-1', 0, 0), route('route-node-2', 5, 0)],
        edges: [edge('route-edge-1', 'route-node-1', 'route-node-2')],
      },
      roomAttributes: [{ faceId: 'face-1', roomId: 'room-1', name: 'Room 204', searchable: true, accessPoints: [{ routeNodeId: 'route-node-2', primary: true }] }],
    })

    expect(validateRouteNetwork(makeDocument(floor), 'publish')).toEqual([])
  })

  it('reports a missing or unreachable Room route access point', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [route('route-node-1', 0, 0), route('route-node-isolated', 30, 30)],
        edges: [],
      },
      roomAttributes: [
        { faceId: 'face-missing', roomId: 'room-missing', name: 'Room 203', searchable: true, accessPoints: [{ routeNodeId: 'missing-node', primary: true }] },
        { faceId: 'face-isolated', roomId: 'room-isolated', name: 'Room 204', searchable: true, accessPoints: [{ routeNodeId: 'route-node-isolated', primary: true }] },
      ],
    })

    const issues = validateRouteNetwork(makeDocument(floor), 'publish')
    expect(issues).toContainEqual(expect.objectContaining({ ruleId: 'route-room-access', message: expect.stringContaining('Room 203') }))
    expect(issues).toContainEqual(expect.objectContaining({ ruleId: 'route-room-access', message: expect.stringContaining('Room 204') }))
  })

  it('reports missing EntranceAccess endpoints and accepts the clean outside bridge', () => {
    const cleanFloor = makeFloor({
      entrances: [{ id: 'entrance-1', label: 'Main Entrance', position: { x: 0, y: 0 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
      routeNetwork: {
        nodes: [route('route-node-1', 0, 0), route('route-node-2', 5, 0)],
        edges: [edge('route-edge-1', 'route-node-1', 'route-node-2')],
      },
      roomAttributes: [{ faceId: 'face-1', roomId: 'room-1', name: 'Room 204', searchable: true, accessPoints: [{ routeNodeId: 'route-node-2', primary: true }] }],
      entranceAccess: [{ entranceId: 'entrance-1', outdoorNodeId: 'outdoor-node-1', indoorRouteNodeId: 'route-node-1' }],
    })
    expect(validateRouteNetwork(makeDocument(cleanFloor), 'publish')).toEqual([])

    const brokenFloor = makeFloor({
      entrances: cleanFloor.entrances,
      routeNetwork: cleanFloor.routeNetwork,
      entranceAccess: [{ entranceId: 'entrance-1', outdoorNodeId: '', indoorRouteNodeId: 'missing-node' }],
    })
    const broken = validateRouteNetwork(makeDocument(brokenFloor), 'publish')
    expect(broken).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'route-entrance-access', targets: expect.arrayContaining([expect.objectContaining({ entityId: 'entrance-1' })]) }),
    ]))
  })

  it('requires an explicit EntranceAccess assignment on a route-enabled floor', () => {
    const floor = makeFloor({
      entrances: [{ id: 'entrance-unassigned', label: 'Side Entrance', position: { x: 0, y: 0 }, level: 0, type: 'secondary', hasQR: false, hasPanorama: false }],
      routeNetwork: {
        nodes: [route('route-node-1', 0, 0), route('route-node-2', 5, 0)],
        edges: [edge('route-edge-1', 'route-node-1', 'route-node-2')],
      },
    })

    const issues = validateRouteNetwork(makeDocument(floor), 'publish')
    expect(issues).toContainEqual(expect.objectContaining({
      ruleId: 'route-entrance-access',
      severity: 'error',
      message: expect.stringContaining('no explicit outdoor route assignment'),
      targets: expect.arrayContaining([expect.objectContaining({ entityId: 'entrance-unassigned' })]),
    }))
  })
})
