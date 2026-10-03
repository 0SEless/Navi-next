import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { authoredFingerprint, canonicalizeAuthoredDocument, deserializeAuthoredDocument, serializeAuthoredDocument, CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'

function makeAuthoredFixture(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 7,
    metadata: {
      campusId: 'phase3a1-campus',
      name: 'Phase 3A.1 Campus',
      description: 'Durable authored fixture',
      lastModified: '2026-09-21T00:00:00.000Z',
      editorVersion: 'phase3a1-test',
    },
    buildings: [{
      id: 'building-1',
      name: 'Main Hall',
      code: 'MH',
      category: 'academic',
      description: 'Authored building',
      department: 'Engineering',
      footprint: { points: [
        { lat: 14.5995, lng: 120.9842 },
        { lat: 14.5995, lng: 120.9852 },
        { lat: 14.6005, lng: 120.9852 },
        { lat: 14.6005, lng: 120.9842 },
      ] },
      baseElevation: 12,
      height: 24,
      rotation: 8,
      color: '#123456',
      aliases: ['MH', 'Engineering Hall'],
      metadata: { owner: 'engineering' },
      verticalConnectors: [{
        id: 'connector-1',
        type: 'staircase',
        name: 'North Stair',
        stopIds: ['stop-1'],
        accessible: true,
        metadata: { authored: true },
      }],
      floors: [{
        id: 'floor-1',
        level: 0,
        label: 'Ground',
        shortLabel: 'G',
        elevation: 0,
        height: 4,
        offset: { x: 2, y: 3 },
        rotation: 12,
        planImageId: 'plan-1',
        planAlignment: { offset: { x: 1, y: 2 }, scale: 1.25, rotation: 4, opacity: 0.75 },
        visible: false,
        locked: true,
        floorPlanState: 'locked',
        rooms: [{
          id: 'room-1',
          name: 'Lab',
          polygon: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
          roomDoors: [],
        }],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [{
          id: 'stop-1',
          connectorId: 'connector-1',
          label: 'Ground landing',
          position: { x: 5, y: 6 },
          rotation: 18,
          anchors: [{
            id: 'anchor-panorama',
            label: 'Landing panorama',
            position: { x: 5, y: 6 },
            heading: 90,
            imageAssetId: 'pano-asset',
            hotspots: [{
              hotspotType: 'information',
              target: { type: 'url', targetId: 'https://example.test' },
              position: { pitch: 0, yaw: 15 },
              label: 'Info',
              content: { title: 'Landing' },
            }],
          }, {
            id: 'anchor-qr',
            label: 'Landing QR',
            position: { x: 6, y: 6 },
            code: 'qr://landing',
            metadata: { authored: true },
          }],
          accessible: true,
          metadata: { authored: true },
        }],
        walls: [{ id: 'wall-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2, height: 4, metadata: { material: 'concrete' } }],
        openings: [{ id: 'opening-1', type: 'door', wallId: 'wall-1', offset: 4, width: 1, metadata: { authored: true } }],
        windows: [{ id: 'window-1', wallId: 'wall-1', offset: 2, width: 1.5, sillHeight: 1, metadata: { authored: true } }],
        roomAttributes: [{ faceId: 'face-1', name: 'Lab', searchable: true }],
        entranceAccess: [{ entranceId: 'entrance-1', outdoorNodeId: 'road-node-1', indoorRouteNodeId: 'route-node-1' }],
        routeNetwork: { nodes: [{ id: 'route-node-1', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 }], edges: [] },
        pois: [{ id: 'poi-1', name: 'Lab marker', category: 'other', position: { x: 3, y: 3 } }],
      }],
    } as unknown as CampusDocument['buildings'][number]],
    roads: [{
      id: 'road-1',
      name: 'North Road',
      polyline: { points: [{ lat: 14.599, lng: 120.984 }, { lat: 14.601, lng: 120.986 }] },
      width: 6,
      surface: 'paved',
      type: 'arterial',
      displayMode: 'navigation-only',
      routing: { walkable: true, slope: 'level' },
      metadata: { authored: true },
    } as unknown as CampusDocument['roads'][number]],
    panoramas: [{
      id: 'panorama-top-level',
      label: 'Main view',
      position: { x: 4, y: 4 },
      heading: 135,
      imageAssetId: 'asset-1',
      buildingId: 'building-1',
      floor: 0,
      hotspots: [{
        hotspotType: 'information',
        target: { type: 'room', targetId: 'room-1' },
        position: { pitch: 5, yaw: 20 },
        label: 'Room',
        content: { title: 'Room 1' },
      }],
    }],
    qrCheckpoints: [{
      id: 'qr-top-level',
      label: 'Main QR',
      position: { x: 3, y: 3 },
      floor: 0,
      buildingId: 'building-1',
      code: 'navi://phase3a1',
      metadata: { authored: true },
    }],
    areas: [{ id: 'area-1', name: 'Plaza', points: [{ lat: 14.599, lng: 120.984 }, { lat: 14.6, lng: 120.985 }], color: '#abcdef' }],
    pois: [{ id: 'outdoor-poi-1', scope: 'outdoor', name: 'Gate', category: 'other', geometry: { type: 'point', position: { lat: 14.599, lng: 120.984 } } }],
    roadJunctions: [{ id: 'junction-1', position: { lat: 14.6, lng: 120.985 }, roadIds: ['road-1', 'road-2'], source: 'authored' }],
    separatedCrossings: [{ id: 'crossing-1', roadIds: ['road-1', 'road-2'], position: { lat: 14.6, lng: 120.985 } }],
    boundary: { points: [{ lat: 14.598, lng: 120.983 }, { lat: 14.602, lng: 120.987 }] },
    connectivitySemanticsVersion: 'phase3a1',
  } as unknown as CampusDocument
}

function registerTransformer(document: CampusDocument): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  for (const building of document.buildings) {
    const points = building.footprint.points
    transformer.registerBuilding({
      buildingId: building.id,
      origin: { lat: (points[0].lat + points[2].lat) / 2, lng: (points[0].lng + points[2].lng) / 2 },
      rotation: building.rotation ?? 0,
    })
    for (const floor of building.floors) {
      transformer.registerFloor(building.id, floor.level, { offset: floor.offset ?? { x: 0, y: 0 }, rotation: floor.rotation ?? 0 })
    }
  }
  return transformer
}

describe('Phase 3A.1 canonical authored snapshot hard gate', () => {
  it('round-trips the complete authored document with zero canonical differences', () => {
    const original = makeAuthoredFixture()
    const restored = deserializeAuthoredDocument(serializeAuthoredDocument(original))

    expect(authoredFingerprint(restored)).toBe(authoredFingerprint(original))
    expect(canonicalizeAuthoredDocument(restored)).toEqual(canonicalizeAuthoredDocument(original))
    expect(restored.metadata.name).toBe('Phase 3A.1 Campus')
    expect(restored.metadata.description).toBe('Durable authored fixture')
    expect(restored.buildings[0].verticalConnectors?.[0].id).toBe('connector-1')
    expect(restored.buildings[0].floors[0].connectorStops?.[0].id).toBe('stop-1')
    expect(restored.panoramas).toHaveLength(1)
    expect(restored.panoramas[0].id).toBe('panorama-top-level')
    expect(restored.panoramas[0].heading).toBe(135)
    expect(restored.panoramas[0].imageAssetId).toBe('asset-1')
    expect(restored.panoramas[0].hotspots).toHaveLength(1)
    expect(restored.qrCheckpoints).toHaveLength(1)
    expect(restored.qrCheckpoints[0].id).toBe('qr-top-level')
    expect(restored.qrCheckpoints[0].code).toBe('navi://phase3a1')
    expect(restored.qrCheckpoints[0].metadata?.authored).toBe(true)
  })

  it('derives a valid Graph projection from the restored authored document', () => {
    const restored = deserializeAuthoredDocument(serializeAuthoredDocument(makeAuthoredFixture()))
    const graph = new Graph()
    graph.campusId = restored.metadata.campusId
    new GraphAdapter(graph, registerTransformer(restored)).sync(restored)

    expect(graph.campusId).toBe('phase3a1-campus')
    expect(graph.buildings.some((building) => building.id === 'building-1')).toBe(true)
    expect(graph.traces.some((trace) => trace.id === 'road-1')).toBe(true)
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.components.some((component) => component.id === 'room-1')).toBe(true)
  })
})
