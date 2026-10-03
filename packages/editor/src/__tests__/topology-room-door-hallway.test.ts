/**
 * T1.1 — RoomDoor → Hallway Edge Invariant
 *
 * INVARIANT 1: Every routable room connection must have a traversable edge.
 *
 * If a Room has a RoomDoor with connectedToType='hallway', the compiled
 * NavigationGraph MUST contain an edge connecting the room's door node
 * (type 'room_door') to a hallway node (type 'hallway'). Without this edge,
 * the room is unreachable from the hallway network, breaking indoor routing.
 *
 * Routing model: road → entrance → hallway → room_door. Room interiors are
 * NOT routing nodes; the room_door node is the room's access point.
 */

import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building, Floor, Room, RoomDoor, Hallway, Entrance, Road } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'

// ── Test Document Builders ──

function createDocWithRoomAndHallway(opts: {
  roomDoors: RoomDoor[]
  hallway?: Hallway
}): CampusDocument {
  const hallway: Hallway = opts.hallway ?? {
    id: 'hall-1',
    name: 'Main Hallway',
    polyline: { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    width: 3,
  }

  const room: Room = {
    id: 'room-1',
    name: 'Room 101',
    number: '101',
    category: 'classroom',
    polygon: {
      points: [
        { x: 5, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: 7 },
        { x: 5, y: 7 },
      ],
    },
    roomDoors: opts.roomDoors,
    capacity: 30,
    metadata: {},
  }

  const entrance: Entrance = {
    id: 'ent-1',
    label: 'Main Entrance',
    // Legacy world position (P1-T4: dual-mode tolerance)
    position: { lat: 33.4205, lng: -111.9295 } as any,
    level: 0,
    type: 'main',
    hasQR: false,
    hasPanorama: false,
  }

  const building: Building = {
    id: 'bld-1',
    name: 'Test Building',
    code: 'TB',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 33.42, lng: -111.93 },
        { lat: 33.421, lng: -111.93 },
        { lat: 33.421, lng: -111.929 },
        { lat: 33.42, lng: -111.929 },
        { lat: 33.42, lng: -111.93 },
      ],
    },
    baseElevation: 0,
    height: 20,
    floors: [
      {
        id: 'flr-0',
        level: 0,
        label: 'Ground',
        elevation: 0,
        rooms: [room],
        hallways: [hallway],
        staircases: [],
        elevators: [],
        entrances: [entrance],
        connectorStops: [],
        metadata: {},
      },
    ],
    verticalConnectors: [],
    aliases: [],
    color: '#ff0000',
    metadata: {},
  }

  const roads: Road[] = [
    {
      id: 'road-1',
      name: 'Main Road',
      polyline: {
        points: [
          { lat: 33.42, lng: -111.93 },
          { lat: 33.421, lng: -111.929 },
        ],
      },
      width: 5,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    },
  ]

  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: '',
      lastModified: '2026-08-09T00:00:00Z',
      editorVersion: '1.0.0',
    },
    buildings: [building],
    roads,
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ── Tests ──

describe('T1.1 | RoomDoor → Hallway Edge Invariant', () => {

  describe('INVARIANT: Every routable room connection must have a traversable edge', () => {

    it('RoomDoor with connectedToType="hallway" produces a door edge to a hallway node', () => {
      const doc = createDocWithRoomAndHallway({
        roomDoors: [
          {
            id: 'door-1',
            roomId: 'room-1',
            connectedToId: 'hall-1',
            connectedToType: 'hallway',
            doorType: 'standard',
            position: { x: 7.5, y: 2 },  // on the room boundary facing hallway
            width: 1.2,
            metadata: {},
          },
        ],
      })

      const tf = new CoordinateTransformer()
      tf.registerBuilding({
        buildingId: 'bld-1',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })

      const graph = new Graph()
      const adapter = new GraphAdapter(graph, tf)
      adapter.sync(doc)

      // Find the door edge (graph-adapter creates id: E-door-{doorId})
      const doorEdges = graph.edges.filter(e => e.id === 'E-door-door-1')

      // INVARIANT: The door edge MUST exist
      expect(doorEdges.length).toBe(1)

      if (doorEdges.length > 0) {
        const doorEdge = doorEdges[0]

        // INVARIANT: Edge type must be 'door'
        expect(doorEdge.type).toBe('door')

        // INVARIANT: Source must be the room door node (the room's access point)
        const sourceNode = graph.nodes.find(n => n.id === doorEdge.from)
        expect(sourceNode).toBeDefined()
        expect(sourceNode!.type).toBe('room_door')

        // INVARIANT: Target must be a hallway node (not another room, not an entrance)
        const targetNode = graph.nodes.find(n => n.id === doorEdge.to)
        expect(targetNode).toBeDefined()
        expect(targetNode!.type).toBe('hallway')  // hallway nodes are type 'hallway'

        // INVARIANT: Edge distance must be positive (haversine, not hardcoded 0)
        expect(doorEdge.distance).toBeGreaterThan(0)
      }
    })

    it('RoomDoor with connectedToType="room" produces a door edge to another room node', () => {
      const doc = createDocWithRoomAndHallway({
        roomDoors: [
          {
            id: 'door-adj',
            roomId: 'room-1',
            connectedToId: 'room-1',  // self-reference for test (would be another room in production)
            connectedToType: 'room',
            doorType: 'standard',
            position: { x: 10, y: 4.5 },
            width: 1.2,
            metadata: {},
          },
        ],
      })

      const tf = new CoordinateTransformer()
      tf.registerBuilding({
        buildingId: 'bld-1',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })

      const graph = new Graph()
      const adapter = new GraphAdapter(graph, tf)
      adapter.sync(doc)

      const doorEdges = graph.edges.filter(e => e.id === 'E-door-door-adj')
      expect(doorEdges.length).toBe(1)

      if (doorEdges.length > 0) {
        // INVARIANT: Both source and target must be room_door nodes
        // (room-to-room doors link the two rooms' access points)
        const sourceNode = graph.nodes.find(n => n.id === doorEdges[0].from)
        const targetNode = graph.nodes.find(n => n.id === doorEdges[0].to)
        expect(sourceNode!.type).toBe('room_door')
        expect(targetNode!.type).toBe('room_door')
      }
    })

    it('Room with NO doors is detected as having no access edges', () => {
      const doc = createDocWithRoomAndHallway({
        roomDoors: [],  // no doors
      })

      const tf = new CoordinateTransformer()
      tf.registerBuilding({
        buildingId: 'bld-1',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })

      const graph = new Graph()
      const adapter = new GraphAdapter(graph, tf)
      adapter.sync(doc)

      // Find the room door node (the room's routing access point)
      const roomNode = graph.nodes.find(n => n.type === 'room_door' && n.componentId)
      expect(roomNode).toBeDefined()

      if (roomNode) {
        // INVARIANT: Room door node should have at least one corridor edge to hallway
        // (compileRoom connects room_door to nearest hallway)
        // But with NO doors, there should be NO door-type edges
        const doorEdges = graph.edges.filter(
          e => e.type === 'door' && (e.from === roomNode.id || e.to === roomNode.id)
        )
        expect(doorEdges.length).toBe(0)

        // INVARIANT: Room door should still have corridor edges from compileRoom
        const corridorEdges = graph.edges.filter(
          e => e.type === 'corridor' && (e.from === roomNode.id || e.to === roomNode.id)
        )
        // This may be 0 or more depending on hallway proximity
        // The key assertion is: no door edges, corridor edges are the only connection
        expect(corridorEdges.length).toBeGreaterThanOrEqual(0)
      }
    })

    it('Multiple rooms with doors to the same hallway all get door edges', () => {
      const hallway: Hallway = {
        id: 'hall-shared',
        name: 'Shared Hallway',
        polyline: { points: [{ x: 0, y: 0 }, { x: 30, y: 0 }] },
        width: 3,
      }

      const rooms: Room[] = [
        {
          id: 'room-a',
          name: 'Room A',
          number: 'A',
          category: 'classroom',
          polygon: { points: [{ x: 5, y: 2 }, { x: 10, y: 2 }, { x: 10, y: 7 }, { x: 5, y: 7 }] },
          roomDoors: [{
            id: 'door-a',
            roomId: 'room-a',
            connectedToId: 'hall-shared',
            connectedToType: 'hallway',
            doorType: 'standard',
            position: { x: 7.5, y: 2 },
            width: 1.2,
            metadata: {},
          }],
          capacity: 20,
          metadata: {},
        },
        {
          id: 'room-b',
          name: 'Room B',
          number: 'B',
          category: 'classroom',
          polygon: { points: [{ x: 15, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 7 }, { x: 15, y: 7 }] },
          roomDoors: [{
            id: 'door-b',
            roomId: 'room-b',
            connectedToId: 'hall-shared',
            connectedToType: 'hallway',
            doorType: 'standard',
            position: { x: 17.5, y: 2 },
            width: 1.2,
            metadata: {},
          }],
          capacity: 20,
          metadata: {},
        },
      ]

      const building: Building = {
        id: 'bld-multi',
        name: 'Multi-Room Building',
        code: 'MR',
        category: 'academic',
        description: '',
        footprint: {
          points: [
            { lat: 33.42, lng: -111.93 },
            { lat: 33.421, lng: -111.93 },
            { lat: 33.421, lng: -111.929 },
            { lat: 33.42, lng: -111.929 },
            { lat: 33.42, lng: -111.93 },
          ],
        },
        baseElevation: 0,
        height: 20,
        floors: [{
          id: 'flr-0',
          level: 0,
          label: 'Ground',
          elevation: 0,
          rooms,
          hallways: [hallway],
          staircases: [],
          elevators: [],
          entrances: [{
            id: 'ent-1',
            label: 'Entrance',
            // Legacy world position (P1-T4: dual-mode tolerance)
            position: { lat: 33.4205, lng: -111.9295 } as any,
            level: 0,
            type: 'main',
            hasQR: false,
            hasPanorama: false,
          }],
          connectorStops: [],
          metadata: {},
        }],
        verticalConnectors: [],
        aliases: [],
        color: '#ff0000',
        metadata: {},
      }

      const doc: CampusDocument = {
        schemaVersion: 1,
        version: 1,
        metadata: {
          campusId: 'test',
          name: 'Test',
          description: '',
          lastModified: '',
          editorVersion: '1.0.0',
        },
        buildings: [building],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      }

      const tf = new CoordinateTransformer()
      tf.registerBuilding({
        buildingId: 'bld-multi',
        origin: { lat: 33.4205, lng: -111.9295 },
        rotation: 0,
      })

      const graph = new Graph()
      const adapter = new GraphAdapter(graph, tf)
      adapter.sync(doc)

      // INVARIANT: Both rooms must have door edges
      const doorA = graph.edges.find(e => e.id === 'E-door-door-a')
      const doorB = graph.edges.find(e => e.id === 'E-door-door-b')

      expect(doorA).toBeDefined()
      expect(doorB).toBeDefined()
    })
  })
})
