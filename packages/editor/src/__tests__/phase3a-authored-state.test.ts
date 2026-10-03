import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { createDocument } from '../context/create-editor-context'
import { GraphAdapter } from '../graph-adapter'

type Difference = { path: string; expected: unknown; actual: unknown }

function diffValues(expected: unknown, actual: unknown, path = '$'): Difference[] {
  if (Object.is(expected, actual)) return []
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return [{ path, expected, actual }]
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) return [{ path, expected, actual }]
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const differences: Difference[] = []
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index += 1) {
      differences.push(...diffValues(expected[index], actual[index], `${path}[${index}]`))
    }
    return differences
  }
  const expectedRecord = expected as Record<string, unknown>
  const actualRecord = actual as Record<string, unknown>
  const keys = new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])
  return [...keys].sort().flatMap((key) => diffValues(expectedRecord[key], actualRecord[key], `${path}.${key}`))
}

function authoredComparable(document: CampusDocument): unknown {
  const copy = structuredClone(document) as Record<string, any>
  delete copy.schemaVersion
  delete copy.version
  delete copy._changeJournal
  delete copy.metadata.lastModified
  delete copy.metadata.editorVersion
  for (const building of copy.buildings ?? []) {
    for (const floor of building.floors ?? []) delete floor.parametricComponents
  }
  for (const road of copy.roads ?? []) {
    if (road.metadata?.surface === road.surface) delete road.metadata.surface
    if (road.displayMode === 'visible' && !('displayMode' in (document.roads.find((candidate) => candidate.id === road.id) ?? {}))) {
      delete road.displayMode
    }
  }
  return copy
}

function makeRoundTripDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 7,
    metadata: {
      campusId: 'phase3a-campus',
      name: 'Phase 3A Campus',
      description: 'Round-trip fixture',
      lastModified: '2026-09-21T00:00:00.000Z',
      editorVersion: 'phase3a-test',
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
        textureId: 'texture-1',
        svgOverlayId: 'svg-1',
        visible: false,
        locked: true,
        floorPlanState: 'locked',
        rooms: [],
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
          connectedHallwayId: 'hall-1',
          anchors: [{
            id: 'anchor-1',
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
            id: 'anchor-2',
            label: 'Landing QR',
            position: { x: 6, y: 6 },
            code: 'qr-code',
            metadata: { authored: true },
          }],
          accessible: true,
          metadata: { authored: true },
        }],
        metadata: { authored: true },
        walls: [{ id: 'wall-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2, height: 4, metadata: { material: 'concrete' } }],
        windows: [{ id: 'window-1', wallId: 'wall-1', offset: 2, width: 1.5, sillHeight: 1, metadata: { authored: true } }],
        openings: [{ id: 'opening-1', type: 'door', wallId: 'wall-1', offset: 4, width: 1, metadata: { authored: true } }],
        roomAttributes: [{ faceId: 'face-1', name: 'Lab', searchable: true }],
        entranceAccess: [{ entranceId: 'entrance-1', outdoorNodeId: 'road-node-1', indoorRouteNodeId: 'route-node-1' }],
        routeNetwork: {
          nodes: [{ id: 'route-node-1', type: 'waypoint', position: { x: 2, y: 2 }, floor: 0 }],
          edges: [],
        },
        pois: [{ id: 'poi-1', name: 'Lab marker', category: 'other', position: { x: 3, y: 3 } }],
      }],
    }],
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
    }, {
      id: 'road-2',
      name: 'South Road',
      polyline: { points: [{ lat: 14.598, lng: 120.984 }, { lat: 14.599, lng: 120.986 }] },
      width: 5,
      surface: 'paved',
      type: 'arterial',
      displayMode: 'visible',
      metadata: { authored: true },
    }],
    panoramas: [{
      id: 'panorama-1',
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
      id: 'qr-1',
      label: 'Main QR',
      position: { x: 3, y: 3 },
      floor: 0,
      buildingId: 'building-1',
      code: 'navi://phase3a',
      metadata: { authored: true },
    }],
    areas: [{ id: 'area-1', name: 'Plaza', points: [{ lat: 14.599, lng: 120.984 }, { lat: 14.6, lng: 120.985 }], color: '#abcdef' }],
    pois: [{ id: 'outdoor-poi-1', scope: 'outdoor', name: 'Gate', category: 'other', geometry: { type: 'point', position: { lat: 14.599, lng: 120.984 } } }],
    roadJunctions: [{ id: 'junction-1', position: { lat: 14.6, lng: 120.985 }, roadIds: ['road-1', 'road-2'], source: 'authored' }],
    separatedCrossings: [{ id: 'crossing-1', roadIds: ['road-1', 'road-2'], position: { lat: 14.6, lng: 120.985 } }],
    boundary: { points: [{ lat: 14.598, lng: 120.983 }, { lat: 14.602, lng: 120.987 }] },
    connectivitySemanticsVersion: 'phase3a',
  } as unknown as CampusDocument
}

function graphRoundTrip(document: CampusDocument): CampusDocument {
  const graph = new Graph()
  graph.campusId = document.metadata.campusId
  const transformer = new CoordinateTransformer()
  const building = document.buildings[0]
  const footprint = building.footprint.points
  transformer.registerBuilding({
    buildingId: building.id,
    origin: { lat: (footprint[0].lat + footprint[2].lat) / 2, lng: (footprint[0].lng + footprint[2].lng) / 2 },
    rotation: building.rotation ?? 0,
  })
  for (const floor of building.floors) {
    transformer.registerFloor(building.id, floor.level, {
      offset: floor.offset ?? { x: 0, y: 0 },
      rotation: floor.rotation ?? 0,
    })
  }
  new GraphAdapter(graph, transformer).sync(document)
  const hydrated = Graph.fromJSON(JSON.parse(JSON.stringify(graph.toJSON())))
  return createDocument(hydrated, transformer)
}

describe('Phase 3A legacy Graph-only hydration characterization (LOSSY)', () => {
  it('documents authored fields lost by the legacy Graph-only persistence path', () => {
    const original = makeRoundTripDocument()
    const expected = structuredClone(original)
    const roundTripped = graphRoundTrip(original)

    expect(diffValues(authoredComparable(expected), authoredComparable(roundTripped)).length).toBeGreaterThan(0)
  })
})
