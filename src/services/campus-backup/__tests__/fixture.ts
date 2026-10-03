import type {
  CampusDocument,
  Elevator,
  Entrance,
  Floor,
  Road,
  Room,
  Staircase,
  Wall,
  WorldPolygon,
} from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import type { GraphSnapshot } from '@/types/nav-types'
import { GraphAdapter } from '../../../../packages/editor/src/graph-adapter'
import type { CampusMapData } from '../types'

export const CAMPUS_ID = 'campus-backup-fixture'
export const BUILDING_ID = 'bldg-alpha'
export const SOURCE_REVISION = 'rev-2026-09-15-01'
export const FIXED_EXPORTED_AT = '2026-09-15T12:00:00.000Z'

const footprint: WorldPolygon = {
  points: [
    { lat: 11.72, lng: 122.37 },
    { lat: 11.72, lng: 122.3708 },
    { lat: 11.7205, lng: 122.3708 },
    { lat: 11.7205, lng: 122.37 },
  ],
}

const entranceMain: Entrance = {
  id: 'ent-main',
  label: 'Main Entrance',
  position: { x: 11, y: 6 },
  level: 0,
  type: 'main',
  hasQR: true,
  hasPanorama: false,
  connectorRoadId: 'road-main',
}

function buildRoomA(): Room {
  return {
    id: 'room-a',
    name: 'Room A',
    number: '101',
    category: 'classroom',
    polygon: { points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }] },
    capacity: 40,
    roomDoors: [],
    metadata: { board: true },
  }
}

function buildRoomB(): Room {
  return {
    id: 'room-b',
    name: 'Room B',
    number: '102',
    category: 'lab',
    polygon: { points: [{ x: 0, y: 8 }, { x: 6, y: 8 }, { x: 6, y: 12 }, { x: 0, y: 12 }] },
    capacity: 24,
    roomDoors: [],
    metadata: {},
  }
}

function buildRoomC(): Room {
  return {
    id: 'room-c',
    name: 'Room C',
    number: '201',
    category: 'office',
    polygon: { points: [{ x: 20, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 5 }, { x: 20, y: 5 }] },
    roomDoors: [],
    metadata: { faculty: 'engineering' },
  }
}

const wallOne: Wall = {
  id: 'wall-1',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  thickness: 0.2,
  height: 3.5,
  metadata: { level: 'gf' },
}

const wallTwo: Wall = {
  id: 'wall-2',
  start: { x: 10, y: 0 },
  end: { x: 10, y: 5 },
  thickness: 0.2,
  height: 3.5,
  metadata: { level: 'gf' },
}

function buildGroundFloor(): Floor {
  return {
    id: 'flr-alpha-0',
    level: 0,
    label: 'Ground Floor',
    shortLabel: 'GF',
    elevation: 0,
    height: 3.5,
    offset: { x: 0, y: 0 },
    rotation: 0,
    planImageId: 'asset-floorplan-gf',
    floorPlanState: 'active',
    visible: true,
    locked: false,
    walls: [wallOne, wallTwo],
    windows: [
      { id: 'win-1', wallId: 'wall-2', offset: 1, width: 1.2, sillHeight: 0.9, metadata: { panes: 2 } },
    ],
    openings: [
      { id: 'open-1', type: 'door', wallId: 'wall-1', offset: 2, width: 0.9, height: 2.1, orientation: 0, metadata: { fireRating: 'A' } },
    ],
    roomAttributes: [
      {
        faceId: 'face-room-a',
        roomId: 'room-a',
        name: 'Room A',
        type: 'classroom',
        code: 'A101',
        number: '101',
        category: 'classroom',
        searchable: true,
        accessPoints: [{ openingId: 'open-1', routeNodeId: 'rn-a1', primary: true }],
      },
    ],
    rooms: [buildRoomA(), buildRoomB()],
    hallways: [
      {
        id: 'hall-a',
        name: 'Hall A',
        polyline: { points: [{ x: 0, y: 6 }, { x: 12, y: 6 }] },
        width: 2.4,
        color: '#8899aa',
      },
    ],
    staircases: [],
    elevators: [],
    entrances: [entranceMain],
    connectorStops: [],
    parametricComponents: [],
    pois: [
      {
        id: 'poi-indoor-1',
        name: 'Vending Machine',
        category: 'vending_machine',
        position: { x: 8, y: 6 },
        metadata: { floorNote: 'near hall A' },
      },
    ],
    doors: [
      {
        id: 'door-a',
        roomId: 'room-a',
        connectedToId: 'hall-a',
        connectedToType: 'hallway',
        doorType: 'standard',
        position: { x: 3, y: 0 },
        width: 0.9,
        metadata: { auto: false },
      },
    ],
    routeNetwork: {
      nodes: [
        { id: 'rn-a1', type: 'waypoint', position: { x: 3, y: 0 }, floor: 0 },
        { id: 'rn-a2', type: 'waypoint', position: { x: 10, y: 6 }, floor: 0 },
      ],
      edges: [{ id: 're-a1', from: 'rn-a1', to: 'rn-a2', type: 'walk', distance: 9.2 }],
    },
    entranceAccess: [
      {
        entranceId: 'ent-main',
        outdoorNodeId: 'N-access-ent-main',
        indoorRouteNodeId: 'rn-a2',
        outdoorRouteId: 'road-main',
        outdoorPosition: { lat: 11.7206, lng: 122.3698 },
      },
    ],
    metadata: { plan: 'subject to survey' },
  }
}

function buildUpperFloor(): Floor {
  return {
    id: 'flr-alpha-1',
    level: 1,
    label: 'Second Floor',
    shortLabel: '2F',
    elevation: 3.5,
    height: 3.5,
    offset: { x: 3, y: -2 },
    rotation: 0,
    visible: true,
    locked: false,
    walls: [
      { id: 'wall-3', start: { x: 20, y: 0 }, end: { x: 26, y: 0 }, thickness: 0.2, height: 3.5 },
    ],
    rooms: [buildRoomC()],
    hallways: [
      {
        id: 'hall-b',
        name: 'Hall B',
        polyline: { points: [{ x: 20, y: 6 }, { x: 26, y: 6 }] },
        width: 2,
      },
    ],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    parametricComponents: [],
    pois: [],
    routeNetwork: {
      nodes: [{ id: 'rn-b1', type: 'transition', position: { x: 5, y: 2 }, floor: 1 }],
      edges: [],
    },
    metadata: { plan: 'upper' },
  }
}

const staircaseFeature: Staircase = {
  id: 'stair-a',
  buildingId: BUILDING_ID,
  name: 'Stairwell A',
  type: 'open',
  accessible: true,
  fromLevel: 0,
  toLevel: 1,
  levels: {
    0: {
      position: { x: 2, y: 2 },
      rotation: 0,
      polygon: { points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }] },
      landing: { position: { x: 2, y: 2 }, rotation: 0 },
      drawing: {
        definitionId: 'stair',
        properties: { stepCount: 12, stepWidth: 1.2, stepDepth: 0.3, direction: 'north', preset: 'straight' },
      },
    },
    1: { position: { x: 2, y: 2.5 }, rotation: 0 },
  },
}

const elevatorFeature: Elevator = {
  id: 'elev-a',
  buildingId: BUILDING_ID,
  name: 'Elevator A',
  type: 'passenger',
  accessible: true,
  fromLevel: 0,
  toLevel: 1,
  levels: {
    0: {
      position: { x: 5, y: 2 },
      rotation: 0,
      drawing: {
        definitionId: 'elevator',
        properties: { width: 1.6, depth: 1.4, doorSide: 'east' },
      },
    },
    1: { position: { x: 5, y: 2 }, rotation: 0 },
  },
}

function buildRoadMain(): Road {
  return {
    id: 'road-main',
    name: 'Main Road',
    polyline: {
      points: [
        { lat: 11.7199, lng: 122.3695 },
        { lat: 11.7206, lng: 122.3698 },
        { lat: 11.7212, lng: 122.3701 },
      ],
    },
    width: 5,
    surface: 'concrete',
    type: 'arterial',
    displayMode: 'visible',
    connectorEntranceId: 'ent-main',
    routing: {
      feature: 'ramp',
      slope: 'gentle',
      direction: 'both',
      startElevationMeters: 12,
      endElevationMeters: 16,
      walkable: true,
      wheelchairAccessible: true,
    },
    metadata: { department: 'facilities' },
  }
}

function buildRoadCross(): Road {
  return {
    id: 'road-cross',
    name: 'Cross Path',
    polyline: {
      points: [
        { lat: 11.7206, lng: 122.369 },
        { lat: 11.7206, lng: 122.3698 },
        { lat: 11.7206, lng: 122.3706 },
      ],
    },
    width: 3,
    surface: 'brick',
    type: 'pedestrian',
    displayMode: 'navigation-only',
    routing: { feature: 'normal', slope: 'level', direction: 'both', walkable: true },
    metadata: {},
  }
}

function buildRoadSeparated(): Road {
  return {
    id: 'road-sep',
    name: 'Service Trace',
    polyline: {
      points: [
        { lat: 11.72005, lng: 122.36965 },
        { lat: 11.72045, lng: 122.36965 },
      ],
    },
    width: 2,
    surface: 'gravel',
    type: 'service',
    displayMode: 'visible',
    routing: { feature: 'normal', slope: 'moderate', direction: 'forward', walkable: true },
    metadata: { access: 'service' },
  }
}

export function buildCampusDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 7,
    metadata: {
      campusId: CAMPUS_ID,
      name: 'Backup Fixture Campus',
      description: 'Representative authored campus for backup round-trip tests',
      lastModified: '2026-09-15T10:00:00.000Z',
      editorVersion: 'test',
    },
    buildings: [
      {
        id: BUILDING_ID,
        name: 'Alpha Hall',
        code: 'ALP',
        category: 'academic',
        description: 'Main academic building',
        department: 'Engineering',
        rotation: 12,
        footprint,
        baseElevation: 12,
        height: 8,
        floors: [buildGroundFloor(), buildUpperFloor()],
        verticalConnectors: [],
        staircases: [staircaseFeature],
        elevators: [elevatorFeature],
        verticalTransitions: [
          {
            id: 'vt-1',
            featureId: 'elev-a',
            type: 'elevator',
            connections: [
              { floorId: 'flr-alpha-0', routeNodeId: 'rn-a1' },
              { floorId: 'flr-alpha-1', routeNodeId: 'rn-b1' },
            ],
          },
        ],
        color: '#AABBCC',
        aliases: ['Alpha Hall', 'Engineering Building'],
        metadata: { heritage: true },
      },
    ],
    roads: [buildRoadMain(), buildRoadCross(), buildRoadSeparated()],
    roadJunctions: [
      {
        id: 'junction-1',
        position: { lat: 11.7206, lng: 122.3698 },
        roadIds: ['road-main', 'road-cross'],
        source: 'authored',
      },
    ],
    separatedCrossings: [
      {
        id: 'sc-1',
        roadIds: ['road-main', 'road-sep'],
        position: { lat: 11.72025, lng: 122.36965 },
      },
    ],
    panoramas: [
      {
        id: 'pano-main',
        label: 'Main Lobby 360',
        position: { x: 9, y: 6 },
        heading: 135,
        imageAssetId: 'asset-pano-lobby',
        buildingId: BUILDING_ID,
        floor: 0,
        hotspots: [
          {
            hotspotType: 'navigation',
            target: { type: 'entrance', targetId: 'ent-main' },
            position: { pitch: 0, yaw: 45 },
            label: 'To Main Entrance',
          },
          {
            hotspotType: 'information',
            target: { type: 'url', targetId: 'https://example.test/about' },
            position: { pitch: 5, yaw: 90 },
            label: 'About',
            content: { title: 'About this building', description: 'Fixture hotspot' },
          },
        ],
      },
    ],
    qrCheckpoints: [
      {
        id: 'qr-lobby',
        label: 'Lobby QR',
        position: { x: 9, y: 5 },
        floor: 0,
        buildingId: BUILDING_ID,
        code: 'NAVI|bldg-alpha|0|lobby',
        metadata: { printed: '2026-09' },
      },
    ],
    pois: [
      {
        id: 'poi-out-1',
        name: 'Flag Pole',
        category: 'other',
        scope: 'outdoor',
        geometry: { type: 'point', position: { lat: 11.7202, lng: 122.3692 } },
        metadata: { heightMeters: 6 },
        appearance: { mode: 'marker', color: '#ff0000' },
        visibility: { showOnMap: true, searchable: true },
        navigation: { approachMode: 'automatic' },
      },
    ],
    areas: [
      {
        id: 'area-legacy',
        name: 'Old Plaza',
        points: [
          { lat: 11.7201, lng: 122.369 },
          { lat: 11.7203, lng: 122.3691 },
        ],
        color: '#8B5CF6',
      },
    ],
    boundary: {
      points: [
        { lat: 11.7195, lng: 122.3685 },
        { lat: 11.7195, lng: 122.3712 },
        { lat: 11.7216, lng: 122.3712 },
        { lat: 11.7216, lng: 122.3685 },
      ],
    },
    connectivitySemanticsVersion: '1.0.0',
  }
}

function computeCentroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  let lat = 0
  let lng = 0
  for (const point of points) {
    lat += point.lat
    lng += point.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

/** Registration mirrors createEditorContext (centroid origin + building rotation). */
export function createTransformerForDocument(document: CampusDocument): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  for (const building of document.buildings) {
    const points = building.footprint.points
    const origin = points.length > 0 ? computeCentroid(points) : { lat: 0, lng: 0 }
    transformer.registerBuilding({ buildingId: building.id, origin, rotation: building.rotation ?? 0 })
    for (const floor of building.floors) {
      transformer.registerFloor(building.id, floor.level, {
        offset: floor.offset ?? { x: 0, y: 0 },
        rotation: floor.rotation ?? 0,
      })
    }
  }
  return transformer
}

export interface CampusFixture {
  document: CampusDocument
  snapshot: GraphSnapshot
}

export function buildCampusFixture(): CampusFixture {
  const document = buildCampusDocument()
  const transformer = createTransformerForDocument(document)
  const graph = new Graph()
  graph.campusId = CAMPUS_ID
  new GraphAdapter(graph, transformer).sync(document)
  return { document, snapshot: graph.toJSON() }
}

export function buildCampusMapFixture(): CampusMapData {
  return {
    id: CAMPUS_ID,
    name: 'Backup Fixture Campus',
    schoolName: 'NAVI Test School',
    campusName: 'Fixture Campus',
    imageUrl: 'asset-campus-preview',
    boundary: [
      { lat: 11.7195, lng: 122.3685 },
      { lat: 11.7195, lng: 122.3712 },
      { lat: 11.7216, lng: 122.3712 },
      { lat: 11.7216, lng: 122.3685 },
    ],
    center: { lat: 11.7205, lng: 122.3698 },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    stats: { buildings: 1, nodes: 0, edges: 0 },
    landmarkTypes: [
      { id: 'ltype-gate', mapId: CAMPUS_ID, name: 'Gate', color: '#123456', icon: 'gate' },
    ],
    landmarkInstances: [
      {
        id: 'lminst-gate-1',
        mapId: CAMPUS_ID,
        typeId: 'ltype-gate',
        position: { lat: 11.7202, lng: 122.369 },
        label: 'Gate 1',
      },
    ],
  }
}
