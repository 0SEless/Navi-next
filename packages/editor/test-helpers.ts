import type { CampusDocument, Building, Floor, Room } from '@navi/core'

export function createDocument(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'Test Campus',
      name: 'Test Campus',
      description: '',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [
      createBuilding({ id: 'bld-1', name: 'Building A' }),
      createBuilding({ id: 'bld-2', name: 'Building B' }),
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}

export function createBuilding(overrides?: Partial<Building>): Building {
  return {
    id: 'bld-test',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 1, lng: 1 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 0 },
      ],
    },
    baseElevation: 0,
    height: 20,
    floors: [],
    verticalConnectors: [],
    color: '#cccccc',
    aliases: [],
    metadata: {},
    ...overrides,
  }
}

export function createFloor(overrides?: Partial<Floor>): Floor {
  return {
    id: 'flr-test',
    level: 0,
    label: 'Ground Floor',
    elevation: 0,
    height: 3.5,
    rooms: [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: [],
    connectorStops: [],
    metadata: {},
    ...overrides,
  }
}

export function createRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room-test',
    name: 'Room 101',
    number: '101',
    category: 'classroom',
    polygon: {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
    },
    capacity: 30,
    roomDoors: [],
    metadata: {},
    ...overrides,
  }
}
