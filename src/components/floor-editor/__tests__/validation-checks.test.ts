import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import type { Building, Component } from '@/types/nav-types'
import { runValidationChecks } from '../validation-checks'

function makeBuilding(): Building {
  return {
    id: 'building-1',
    name: 'Building',
    campusId: 'campus-1',
    floors: [0],
    footprint: [],
    baseElevation: 0,
    height: 10,
    floorData: [{ id: 'floor-0', level: 0 }],
  }
}

function makeDocument(routeNetwork: unknown, roomAttributes?: unknown[]): CampusDocument {
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
      floors: [{
        id: 'floor-0',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 4,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [{ id: 'entrance-1', label: 'Main', position: { x: 0, y: 0 }, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
        connectorStops: [],
        parametricComponents: [],
        metadata: {},
        routeNetwork,
        roomAttributes,
      }],
      verticalConnectors: [],
      aliases: [],
      metadata: {},
    } as any],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

const components: Component[] = [{
  id: 'entrance-1',
  type: 'entrance',
  name: 'Main',
  buildingId: 'building-1',
  floor: 0,
  position: { lat: 0, lng: 0 },
}]

describe('Floor Editor route validation projection', () => {
  it('projects disconnected navigation issues for the active floor', () => {
    const checks = runValidationChecks(
      makeBuilding(),
      0,
      components,
      undefined,
      [],
      makeDocument({
        nodes: [
          { id: 'route-node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'route-node-isolated', type: 'waypoint', position: { x: 20, y: 20 }, floor: 0 },
        ],
        edges: [],
      }),
    )

    expect(checks).toContainEqual(expect.objectContaining({
      code: 'ROUTE_NETWORK_DISCONNECTED',
      layer: 'navigation',
      buildingId: 'building-1',
      floorId: 'floor-0',
      entityId: 'route-node-isolated',
    }))
  })

  it('projects Room access issues into the Access layer', () => {
    const checks = runValidationChecks(
      makeBuilding(),
      0,
      components,
      undefined,
      [],
      makeDocument(
        {
          nodes: [{ id: 'route-node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }],
          edges: [],
        },
        [{ faceId: 'face-1', roomId: 'room-1', name: 'Room 204', searchable: true, accessPoints: [{ routeNodeId: 'missing-node', primary: true }] }],
      ),
    )

    expect(checks).toContainEqual(expect.objectContaining({
      code: 'ROUTE_ROOM_ACCESS',
      layer: 'access',
      entityId: 'room-1',
      entityType: 'room',
    }))
  })

  it('does not surface route issues from another floor', () => {
    const document = makeDocument({
      nodes: [
        { id: 'route-node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'route-node-2', type: 'waypoint', position: { x: 5, y: 0 }, floor: 0 },
      ],
      edges: [{ id: 'route-edge-1', from: 'route-node-1', to: 'route-node-2', type: 'walk', distance: 5 }],
    })
    document.buildings[0].floors.push({
      ...(document.buildings[0].floors[0] as any),
      id: 'floor-1',
      level: 1,
      routeNetwork: {
        nodes: [{ id: 'route-node-isolated', type: 'waypoint', position: { x: 20, y: 20 }, floor: 1 }],
        edges: [],
      },
    } as any)

    const checks = runValidationChecks(makeBuilding(), 0, components, undefined, [], document)
    expect(checks.some((check) => check.floorId === 'floor-1')).toBe(false)
  })

  it('does not infer an Entrance assignment from a nearby road', () => {
    const checks = runValidationChecks(
      makeBuilding(),
      0,
      components,
      undefined,
      [{ id: 'road-nearby', polyline: { points: [{ lat: 0, lng: 0.0001 }] } }],
      makeDocument({
        nodes: [
          { id: 'route-node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'route-node-2', type: 'waypoint', position: { x: 5, y: 0 }, floor: 0 },
        ],
        edges: [{ id: 'route-edge-1', from: 'route-node-1', to: 'route-node-2', type: 'walk', distance: 5 }],
      }),
    )

    expect(checks.some((check) => check.code === 'ENTRANCE_NO_ROAD')).toBe(false)
    expect(checks).toContainEqual(expect.objectContaining({
      code: 'ROUTE_ENTRANCE_ACCESS',
      entityId: 'entrance-1',
    }))
  })
})
