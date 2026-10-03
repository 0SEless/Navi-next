import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { poiCreateHandler, poiDeleteHandler, poiUpdateHandler } from '../feature-handlers'

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'Test', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [{
      id: 'building-1',
      name: 'Main',
      code: 'MAIN',
      category: 'academic',
      description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0,
      height: 20,
      color: '#4A90D9',
      aliases: [],
      metadata: {},
      verticalConnectors: [],
      floors: [{
        id: 'floor-1',
        level: 0,
        label: 'Ground',
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
        routeNetwork: {
          nodes: [{ id: 'node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }],
          edges: [{ id: 'edge-1', from: 'node-1', to: 'node-1', type: 'walk', distance: 0 }],
        },
        entranceAccess: [{ entranceId: 'entrance-1', outdoorNodeId: 'outdoor-1', indoorRouteNodeId: 'node-1' }],
      }],
    }],
    roads: [{
      id: 'road-1',
      name: 'Main Road',
      polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] },
      width: 6,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    }],
    roadJunctions: [{ id: 'junction-1', roadIds: ['road-1', 'road-2'], position: { lat: 0, lng: 0 } }],
    separatedCrossings: [{ id: 'crossing-1', roadIds: ['road-1', 'road-2'], position: { lat: 0, lng: 0 } }],
    areas: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function topologySignature(document: CampusDocument): string {
  return JSON.stringify({
    roads: document.roads,
    roadJunctions: document.roadJunctions,
    separatedCrossings: document.separatedCrossings,
    areas: document.areas,
    routeNetworks: document.buildings.flatMap(building => building.floors.map(floor => ({
      routeNetwork: floor.routeNetwork,
      entranceAccess: floor.entranceAccess,
    }))),
  })
}

describe('Phase 3C POI geometry topology neutrality', () => {
  it('keeps roads, Areas, crossings, route networks, and access unchanged through the POI lifecycle', () => {
    const document = createDocument()
    const before = topologySignature(document)

    const created = poiCreateHandler.execute(document, {
      id: 'poi-shape-1',
      buildingId: 'building-1',
      floorId: 'floor-1',
      name: 'Plaza Marker',
      category: 'other',
      geometry: { type: 'polygon', points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }] },
    })
    expect(created.success).toBe(true)

    const updated = poiUpdateHandler.execute(document, {
      poiId: 'poi-shape-1',
      patch: { geometry: { type: 'circle', center: { x: 2, y: 2 }, radius: 1 } },
    })
    expect(updated.success).toBe(true)

    const deleted = poiDeleteHandler.execute(document, { poiId: 'poi-shape-1' })
    expect(deleted.success).toBe(true)
    expect(topologySignature(document)).toBe(before)
  })
})
