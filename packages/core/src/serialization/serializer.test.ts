import { describe, it, expect } from 'vitest'
import { serializeDocument, deserializeDocument, roundTrip } from './serializer'
import type { CampusDocument } from '../types'
import type { BuildingCategory } from '../types'

function makeTestDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'ASU Ibajay',
      name: 'ASU Ibajay',
      description: 'Test campus',
      lastModified: new Date('2026-07-08').toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: [
      {
        id: 'bld-main',
        name: 'Main Building',
        code: 'MAIN',
        category: 'academic' as BuildingCategory,
        description: 'Main academic building',
        footprint: {
          points: [
            { lat: 33.42, lng: -111.93 },
            { lat: 33.43, lng: -111.93 },
            { lat: 33.43, lng: -111.92 },
            { lat: 33.42, lng: -111.92 },
            { lat: 33.42, lng: -111.93 },
          ],
        },
        baseElevation: 0,
        height: 15,
        floors: [
          {
            id: 'flr-g',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'rm-101',
                name: 'Room 101',
                number: '101',
                category: 'classroom',
                polygon: {
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 8 },
                    { x: 0, y: 8 },
                    { x: 0, y: 0 },
                  ],
                },
                capacity: 40,
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [
              {
                id: 'ent-main',
                label: 'Main Entrance',
                // P1-T4 (D9): entrances are stored building-local.
                position: { x: 12, y: -8 },
                level: 0,
                type: 'main',
                hasQR: true,
                hasPanorama: false,
              },
            ],
            connectorStops: [
              {
                id: 'cs-main',
                connectorId: 'conn-stairA',
                position: { x: 15, y: 20 },
                anchors: [],
                accessible: true,
                metadata: {},
              },
            ],
            metadata: {},
          },
        ],
        color: '#336699',
        aliases: [],
        verticalConnectors: [],
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('serialization', () => {
  it('serializes and deserializes round-trip', () => {
    const doc = makeTestDoc()
    const result = roundTrip(doc)
    expect(result.success).toBe(true)
  })

  it('throws on invalid JSON', () => {
    expect(() => deserializeDocument('not json')).toThrow()
  })

  it('throws on missing buildings array', () => {
    expect(() => deserializeDocument('{"schemaVersion":1,"version":0,"metadata":{},"roads":[],"panoramas":[],"qrCheckpoints":[]}')).toThrow('buildings')
  })

  it('preserves all fields through round-trip', () => {
    const doc = makeTestDoc()
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    expect(restored.metadata.name).toBe('ASU Ibajay')
    expect(restored.buildings).toHaveLength(1)
    expect(restored.buildings[0].floors).toHaveLength(1)
    expect(restored.buildings[0].floors[0].rooms).toHaveLength(1)
    expect(restored.buildings[0].floors[0].rooms[0].name).toBe('Room 101')
    expect(restored.buildings[0].floors[0].rooms[0].polygon.points).toHaveLength(5)
    expect(restored.buildings[0].floors[0].entrances).toHaveLength(1)
  })

  it('preserves ConnectorStop fields through round-trip', () => {
    const doc = makeTestDoc()
    const building = doc.buildings[0]
    const floor = building.floors[0]
    floor.connectorStops = [
      {
        id: 'cs-stairA-f1',
        connectorId: 'conn-stairA',
        label: 'Stair A Landing',
        position: { x: 15, y: 20 },
        rotation: 90,
        landingPolygon: {
          points: [
            { x: 14, y: 19 },
            { x: 16, y: 19 },
            { x: 16, y: 21 },
            { x: 14, y: 21 },
            { x: 14, y: 19 },
          ],
        },
        connectedHallwayId: 'hw-main',
        anchors: [
          {
            id: 'anchor-pan-stairA',
            label: 'Stair A Landing View',
            position: { x: 15, y: 20 },
            heading: 180,
            imageAssetId: 'panorama-stairA-f1',
            hotspots: [],
          } as const,
          {
            id: 'anchor-qr-stairA',
            label: 'Stair A QR',
            position: { x: 15.5, y: 20 },
            code: 'navi://stairA/f1',
            metadata: {},
          } as const,
        ],
        accessible: true,
        metadata: {},
      },
      {
        id: 'cs-elev1-f1',
        connectorId: 'conn-elev1',
        position: { x: 30, y: 40 },
        anchors: [],
        accessible: true,
        metadata: { lobby: 'north' },
      },
    ]

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    const stops = restored.buildings[0].floors[0].connectorStops
    expect(stops).toHaveLength(2)
    expect(stops[0].id).toBe('cs-stairA-f1')
    expect(stops[0].connectorId).toBe('conn-stairA')
    expect(stops[0].label).toBe('Stair A Landing')
    expect(stops[0].position).toEqual({ x: 15, y: 20 })
    expect(stops[0].rotation).toBe(90)
    expect(stops[0].landingPolygon!.points).toHaveLength(5)
    expect(stops[0].connectedHallwayId).toBe('hw-main')
    expect(stops[0].accessible).toBe(true)

    // Anchor hierarchy round-trip
    const anchors = stops[0].anchors
    expect(anchors).toHaveLength(2)
    const panAnchor = anchors.find((a) => a.id === 'anchor-pan-stairA')
    expect(panAnchor).toBeDefined()
    if (panAnchor && 'heading' in panAnchor) {
      expect(panAnchor.heading).toBe(180)
      expect(panAnchor.imageAssetId).toBe('panorama-stairA-f1')
    }
    const qrAnchor = anchors.find((a) => a.id === 'anchor-qr-stairA')
    expect(qrAnchor).toBeDefined()
    if (qrAnchor && 'code' in qrAnchor) {
      expect(qrAnchor.code).toBe('navi://stairA/f1')
    }

    expect(stops[1].id).toBe('cs-elev1-f1')
    expect(stops[1].metadata!.lobby).toBe('north')
  })

  it('preserves VerticalConnector fields through round-trip', () => {
    const doc = makeTestDoc()
    doc.buildings[0].verticalConnectors = [
      {
        id: 'conn-stairA',
        type: 'staircase',
        name: 'Stairwell A',
        stopIds: ['cs-stairA-f1', 'cs-stairA-f2'],
        accessible: true,
        metadata: {},
      },
      {
        id: 'conn-elev1',
        type: 'elevator',
        name: 'Main Elevator',
        stopIds: ['cs-elev1-f1'],
        accessible: true,
        metadata: { capacity: 15 },
      },
    ]

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    const conns = restored.buildings[0].verticalConnectors
    expect(conns).toHaveLength(2)
    expect(conns[0].id).toBe('conn-stairA')
    expect(conns[0].type).toBe('staircase')
    expect(conns[0].stopIds).toEqual(['cs-stairA-f1', 'cs-stairA-f2'])
    expect(conns[1].type).toBe('elevator')
    expect(conns[1].metadata!.capacity).toBe(15)
  })

  it('preserves RoomDoor fields through round-trip', () => {
    const doc = makeTestDoc()
    const room = doc.buildings[0].floors[0].rooms[0]
    room.roomDoors = [
      {
        id: 'door-101-102',
        roomId: room.id,
        connectedToId: 'room-102',
        connectedToType: 'room',
        doorType: 'standard',
        position: { x: 5, y: 10 },
        width: 0.9,
        metadata: {},
      },
      {
        id: 'door-101-hw',
        roomId: room.id,
        connectedToId: 'hw-main',
        connectedToType: 'hallway',
        doorType: 'double',
        position: { x: 5, y: 0 },
        width: 1.6,
        metadata: { fire: 'rated' },
      },
    ]

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    const doors = restored.buildings[0].floors[0].rooms[0].roomDoors
    expect(doors).toHaveLength(2)
    expect(doors[0].id).toBe('door-101-102')
    expect(doors[0].doorType).toBe('standard')
    expect(doors[0].connectedToType).toBe('room')
    expect(doors[0].width).toBe(0.9)
    expect(doors[1].connectedToId).toBe('hw-main')
    expect(doors[1].connectedToType).toBe('hallway')
    expect(doors[1].doorType).toBe('double')
    expect(doors[1].metadata!.fire).toBe('rated')
  })

  it('coordinate types survive round-trip', () => {
    const doc = makeTestDoc()
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)

    const room = restored.buildings[0].floors[0].rooms[0]
    expect(room.polygon.points[0]).toHaveProperty('x')
    expect(room.polygon.points[0]).toHaveProperty('y')
    expect(room.polygon.points[0]).not.toHaveProperty('lat')

    const entrance = restored.buildings[0].floors[0].entrances[0]
    // P1-T4 (D9): entrances are building-local — no world LatLng storage.
    expect(entrance.position).toHaveProperty('x')
    expect(entrance.position).toHaveProperty('y')
    expect(entrance.position).not.toHaveProperty('lat')
    expect(entrance.position).not.toHaveProperty('lng')
  })

  it('backward-compat: old doc without new fields gets defaults (T10)', () => {
    const oldJson = JSON.stringify({
      schemaVersion: 1,
      version: 0,
      metadata: { campusId: 'Legacy', name: 'Legacy', description: '', lastModified: '', editorVersion: '0.0.1' },
      buildings: [{
        id: 'bld-old',
        name: 'Old',
        code: 'OLD',
        category: 'academic',
        description: '',
        footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }, { lat: 0, lng: 0 }] },
        baseElevation: 0,
        height: 10,
        floors: [{
          id: 'flr-0',
          level: 0,
          label: 'Floor',
          elevation: 0,
          rooms: [{ id: 'rm-1', name: 'Old Room', number: '1', category: 'classroom', polygon: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }] }, capacity: 10, metadata: {} }],
          hallways: [],
          staircases: [],
          elevators: [],
          entrances: [],
        }],
        color: '#ccc',
        aliases: [],
        metadata: {},
      }],
      roads: [],
      panoramas: [],
      qrCheckpoints: [],
    })
    const restored = deserializeDocument(oldJson)
    expect(restored.buildings[0].verticalConnectors).toEqual([])
    expect(restored.buildings[0].floors[0].connectorStops).toEqual([])
    expect(restored.buildings[0].floors[0].rooms[0].roomDoors).toEqual([])
  })

  it('integration smoke test: full document with all new entity types (T9)', () => {
    const doc = makeTestDoc()
    const bld = doc.buildings[0]
    const floor = bld.floors[0]
    const room = floor.rooms[0]

    floor.connectorStops = [{
      id: 'cs-stair',
      connectorId: 'conn-stair',
      position: { x: 10, y: 10 },
      anchors: [{ id: 'a1', label: 'Pan', position: { x: 10, y: 10 }, heading: 0, imageAssetId: 'pano1', hotspots: [] } as const],
      accessible: true,
      metadata: {},
    }]
    bld.verticalConnectors = [{
      id: 'conn-stair',
      type: 'staircase',
      name: 'Stair A',
      stopIds: ['cs-stair'],
      accessible: true,
      metadata: {},
    }]
    room.roomDoors = [{
      id: 'door1',
      roomId: room.id,
      connectedToId: 'hw-main',
      connectedToType: 'hallway',
      doorType: 'standard',
      position: { x: 5, y: 0 },
      width: 0.9,
      metadata: {},
    }]

    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    expect(restored.buildings[0].verticalConnectors).toHaveLength(1)
    expect(restored.buildings[0].floors[0].connectorStops).toHaveLength(1)
    expect(restored.buildings[0].floors[0].rooms[0].roomDoors).toHaveLength(1)
    expect(roundTrip(doc).success).toBe(true)
  })
})
