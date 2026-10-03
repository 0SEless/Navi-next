import type { CampusDocument } from '@navi/core'
import { CampusCompiler } from '@navi/compiler'
import { describe, expect, it } from 'vitest'
import { RoutingEngine } from '../routing-engine'
import {
  STANDARD_TERRAIN_PROFILE_V1,
  buildRoadTerrainContext,
  calculateTraversalCost,
} from '../traversal-cost'

function junctionCampus(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'phase6-junction-campus',
      name: 'Phase 6 Junction Campus',
      description: 'Compiled Road terrain context fixture',
      lastModified: '',
      editorVersion: '1.0',
    },
    buildings: [],
    roads: [
      {
        id: 'terrain-road',
        name: 'Terrain Road',
        polyline: {
          points: [
            { lat: 14.5, lng: 121 },
            { lat: 14.5, lng: 121.0009 },
          ],
        },
        width: 3,
        surface: 'paved',
        type: 'pedestrian',
        routing: {
          startElevationMeters: 20,
          endElevationMeters: 30,
        },
        metadata: {},
      },
      {
        id: 'crossing-road',
        name: 'Crossing Road',
        polyline: {
          points: [
            { lat: 14.4996, lng: 121.00045 },
            { lat: 14.5004, lng: 121.00045 },
          ],
        },
        width: 3,
        surface: 'paved',
        type: 'pedestrian',
        metadata: {},
      },
    ],
    roadJunctions: [{
      id: 'junction-1',
      position: { lat: 14.5, lng: 121.00045 },
      roadIds: ['terrain-road', 'crossing-road'],
      source: 'authored',
    }],
    panoramas: [],
    qrCheckpoints: [],
  } as CampusDocument
}

function unifiedCompiledCampus(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'phase6-unified-compiled-campus',
      name: 'Phase 6 Unified Compiled Campus',
      description: 'Real compiler to terrain runtime fixture',
      lastModified: '',
      editorVersion: '1.0',
    },
    buildings: [{
      id: 'building-1',
      name: 'Building 1',
      code: 'B1',
      category: 'academic',
      description: '',
      footprint: { points: [
        { lat: 14.5, lng: 121 },
        { lat: 14.5, lng: 121.001 },
        { lat: 14.501, lng: 121.001 },
        { lat: 14.501, lng: 121 },
      ] },
      baseElevation: 0,
      height: 10,
      floors: [{
        id: 'floor-0',
        level: 0,
        label: 'Ground',
        elevation: 0,
        rooms: [{
          id: 'room-1',
          name: 'Room 1',
          number: '101',
          category: 'classroom',
          polygon: { points: [
            { x: 8, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 8 }, { x: 8, y: 8 },
          ] },
          roomDoors: [],
          metadata: {},
        }],
        hallways: [],
        staircases: [],
        elevators: [],
        connectorStops: [],
        entrances: [{
          id: 'entrance-1',
          label: 'Main Entrance',
          position: { lat: 14.5005, lng: 121.0005 } as never,
          level: 0,
          type: 'main',
          hasQR: false,
          hasPanorama: false,
          connectorRoadId: 'terrain-road',
        }],
        routeNetwork: {
          nodes: [
            { id: 'route-entry', type: 'entrance', position: { x: 2, y: 5 }, floor: 0 },
            { id: 'route-room', type: 'waypoint', position: { x: 10, y: 5 }, floor: 0 },
          ],
          edges: [{
            id: 'indoor-hall',
            from: 'route-entry',
            to: 'route-room',
            type: 'walk',
            distance: 11,
          }],
        },
        entranceAccess: [{
          entranceId: 'entrance-1',
          outdoorNodeId: 'N-entrance-access-entrance-1',
          indoorRouteNodeId: 'route-entry',
          outdoorRouteId: 'terrain-road',
          outdoorPosition: { lat: 14.4999, lng: 121.0005 },
        }],
        roomAttributes: [{
          faceId: 'room-1',
          name: 'Room 1',
          number: '101',
          searchable: true,
          accessPoints: [{ openingId: 'opening-1', routeNodeId: 'route-room', primary: true }],
        }],
        metadata: {},
      }],
      verticalConnectors: [],
      color: '#cccccc',
      aliases: [],
      metadata: {},
    }],
    roads: [{
      id: 'terrain-road',
      name: 'Outdoor Stair Route',
      polyline: { points: [
        { lat: 14.4999, lng: 121 },
        { lat: 14.4999, lng: 121.001 },
      ] },
      width: 3,
      surface: 'paved',
      type: 'pedestrian',
      routing: { feature: 'stairs', slope: 'moderate', direction: 'both' },
      metadata: {},
    }],
    roadJunctions: [],
    panoramas: [],
    qrCheckpoints: [],
  } as CampusDocument
}

describe('compiled junction-split Road terrain context', () => {
  it('reconstructs one whole-Road length and charges elevation once', () => {
    const result = new CampusCompiler({ nodeInterval: 20 }).compileV2(junctionCampus())
    const graph = result.graph!
    const segments = graph.edges.filter(
      (edge) => edge.routing?.sourceRoadId === 'terrain-road',
    )
    const physicalRoadLength = segments.reduce((sum, edge) => sum + edge.distance, 0)
    const context = buildRoadTerrainContext(graph)

    expect(segments.length).toBeGreaterThan(2)
    expect(new Set(segments.map((edge) => edge.id)).size).toBe(segments.length)
    expect(context.totalRoadLengthBySourceRoadId.get('terrain-road')).toBeCloseTo(
      physicalRoadLength,
      10,
    )

    const productionCost = segments.reduce(
      (sum, edge) => sum + calculateTraversalCost(
        edge,
        edge.from,
        STANDARD_TERRAIN_PROFILE_V1,
        context,
      ),
      0,
    )
    const roadGradePenalty = Math.min(0.3, (10 / physicalRoadLength) * 1.5)
    const expectedWholeRoadCost = physicalRoadLength * (1 + roadGradePenalty)
    const incorrectRepeatedRiseCost = segments.reduce(
      (sum, edge) => sum + edge.distance * (1 + Math.min(0.3, (10 / edge.distance) * 1.5)),
      0,
    )

    expect(productionCost).toBeCloseTo(expectedWholeRoadCost, 8)
    expect(productionCost).not.toBeCloseTo(incorrectRepeatedRiseCost, 5)
    expect(segments.every((edge) => edge.routing?.authored.startElevationMeters === 20)).toBe(true)
    expect(segments.every((edge) => edge.routing?.authored.endElevationMeters === 30)).toBe(true)
  })

  it('routes a real compiled Road through canonical entrance, indoor route, and room access both ways', () => {
    const result = new CampusCompiler({ nodeInterval: 20 }).compileV2(unifiedCompiledCampus())
    expect(result.graph).not.toBeNull()
    expect(result.report.diagnostics.some((diagnostic) =>
      diagnostic.code === 'ENTRANCE_ACCESS_COMPILED')).toBe(true)
    expect(result.report.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code)).toEqual(['HALLWAY_DISCONNECTED'])
    const graph = result.graph!
    const roadEdges = graph.edges.filter((edge) => edge.routing?.sourceRoadId === 'terrain-road')
    const roomNode = graph.nodes.find((node) =>
      node.type === 'poi' && node.buildingId === 'building-1')
    const roadEndpointIds = new Set(roadEdges.flatMap((edge) => [edge.from, edge.to]))
    const accessNode = graph.nodes.find((node) =>
      roadEndpointIds.has(node.id)
      && graph.edges.some((edge) => {
        if (edge.routing) return false
        const otherId = edge.from === node.id ? edge.to : edge.to === node.id ? edge.from : undefined
        return otherId !== undefined
          && graph.nodes.find((candidate) => candidate.id === otherId)?.buildingId === 'building-1'
      }))
    const outdoorStart = graph.nodes.find((node) =>
      roadEndpointIds.has(node.id) && node.id !== accessNode?.id
      && roadEdges.filter((edge) => edge.from === node.id || edge.to === node.id).length === 1)

    expect(roadEdges.length).toBeGreaterThan(2)
    expect(roadEdges.every((edge) => edge.type === 'walk')).toBe(true)
    expect(accessNode).toBeDefined()
    expect(roomNode).toBeDefined()
    expect(outdoorStart).toBeDefined()

    const forward = new RoutingEngine(graph).findRoute(outdoorStart!.id, roomNode!.id)
    const reverse = new RoutingEngine(graph).findRoute(roomNode!.id, outdoorStart!.id)
    expect(forward).not.toBeNull()
    expect(reverse).not.toBeNull()
    expect(forward!.path.some((step) => step.nodeId === accessNode!.id)).toBe(true)
    expect(reverse!.path.map((step) => step.nodeId)).toEqual(
      [...forward!.path.map((step) => step.nodeId)].reverse(),
    )
    expect(reverse!.totalDistance).toBeCloseTo(forward!.totalDistance, 8)

    const indoorHall = graph.edges.find((edge) => {
      const endpoints = [edge.from, edge.to].map((id) =>
        graph.nodes.find((node) => node.id === id))
      return edge.distance === 11
        && endpoints.every((node) => node?.buildingId === 'building-1')
    })
    expect(indoorHall).toMatchObject({ distance: 11, weight: 11, type: 'walk' })
  })
})
