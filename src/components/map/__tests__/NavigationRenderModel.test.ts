import { describe, it, expect } from 'vitest'
import { buildFromCampusBundle, type NavigationRenderModel } from '../NavigationRenderModel'
import type { Building, NavNode, NavEdge, Component, DoorData } from '@/types/nav-types'
import type { FloorGeometryArtifact } from '@navi/core'

// ── Test fixtures ──────────────────────────────────────────────

const mockBuilding: Building = {
  id: 'bld-1',
  name: 'Science Building',
  campusId: 'campus-1',
  floors: [0, 1],
  footprint: [
    { lat: 11.819, lng: 122.168 },
    { lat: 11.819, lng: 122.169 },
    { lat: 11.820, lng: 122.169 },
    { lat: 11.820, lng: 122.168 },
  ],
  baseElevation: 0,
  height: 9,
  entrances: [
    { id: 'ent-1', position: { lat: 11.819, lng: 122.168 }, floor: 0, label: 'Main Entrance' },
  ],
}

const mockNodes: NavNode[] = [
  { id: 'N1', label: 'Node 1', position: { lat: 11.8195, lng: 122.1685 }, floor: 0, buildingId: 'bld-1', campusId: 'campus-1', type: 'room', hasQr: false, hasPanorama: false },
  { id: 'N2', label: 'Node 2', position: { lat: 11.8195, lng: 122.1688 }, floor: 0, buildingId: 'bld-1', campusId: 'campus-1', type: 'hallway', hasQr: false, hasPanorama: false },
]

const mockEdges: NavEdge[] = [
  { id: 'E1', from: 'N1', to: 'N2', distance: 30, weight: 30, type: 'walkway', campusId: 'campus-1' },
]

const mockRoom: Component = {
  id: 'room-1',
  type: 'room',
  name: 'Room 101',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8195, lng: 122.1685 },
  polygon: [
    { lat: 11.8194, lng: 122.1684 },
    { lat: 11.8194, lng: 122.1686 },
    { lat: 11.8196, lng: 122.1686 },
    { lat: 11.8196, lng: 122.1684 },
  ],
}

const mockHallway: Component = {
  id: 'hall-1',
  type: 'hallway',
  name: 'Main Hallway',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8195, lng: 122.1687 },
  polygon: [
    { lat: 11.8194, lng: 122.1686 },
    { lat: 11.8194, lng: 122.1689 },
    { lat: 11.8196, lng: 122.1689 },
    { lat: 11.8196, lng: 122.1686 },
  ],
}

const mockStair: Component = {
  id: 'stair-1',
  type: 'stair',
  name: 'Stair A',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8197, lng: 122.1685 },
}

const mockElevator: Component = {
  id: 'elev-1',
  type: 'elevator',
  name: 'Elevator 1',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8197, lng: 122.1688 },
}

const mockEntranceComponent: Component = {
  id: 'ent-c-1',
  type: 'entrance',
  name: 'Main Door',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.819, lng: 122.168 },
}

const mockRestroom: Component = {
  id: 'rest-1',
  type: 'restroom',
  name: 'Restroom',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8197, lng: 122.169 },
}

const mockDoor: DoorData = {
  id: 'door-1',
  roomId: 'room-1',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8195, lng: 122.1686 },
  width: 1.2,
  connectedToId: 'hall-1',
}

const mockExteriorDoor: DoorData = {
  id: 'door-ext-1',
  roomId: 'room-1',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8194, lng: 122.1684 },
  width: 1.5,
  connectedToId: '',
  isExterior: true,
}

// ── Tests ──────────────────────────────────────────────────────

describe('NavigationRenderModel — indoor render data', () => {
  const baseBundle = {
    buildings: [mockBuilding],
    nodes: mockNodes,
    edges: mockEdges,
    boundingBox: { minLat: 11.819, maxLat: 11.820, minLng: 122.168, maxLng: 122.169 },
  }

  it('returns empty indoor when components is undefined', () => {
    const model = buildFromCampusBundle(baseBundle)
    expect(model.indoor).toEqual({ rooms: [], hallways: [], stairs: [], elevators: [], doors: [], pois: [], walls: [], openings: [] })
  })

  it('returns empty indoor when components is empty', () => {
    const model = buildFromCampusBundle({ ...baseBundle, components: [] })
    expect(model.indoor).toEqual({ rooms: [], hallways: [], stairs: [], elevators: [], doors: [], pois: [], walls: [], openings: [] })
  })

  it('transforms room components into RoomRenderData', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom],
    })
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.rooms[0]).toEqual({
      id: 'room-1',
      name: 'Room 101',
      buildingId: 'bld-1',
      floor: 0,
      polygon: mockRoom.polygon,
      center: mockRoom.position,
    })
  })

  it('transforms hallway components into HallwayRenderData', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockHallway],
    })
    expect(model.indoor.hallways).toHaveLength(1)
    expect(model.indoor.hallways[0]).toEqual({
      id: 'hall-1',
      name: 'Main Hallway',
      buildingId: 'bld-1',
      floor: 0,
      polygon: mockHallway.polygon,
      center: mockHallway.position,
    })
  })

  it('transforms stair components into StairRenderData', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockStair],
    })
    expect(model.indoor.stairs).toHaveLength(1)
    expect(model.indoor.stairs[0]).toEqual({
      id: 'stair-1',
      name: 'Stair A',
      buildingId: 'bld-1',
      floor: 0,
      position: mockStair.position,
    })
  })

  it('transforms elevator components into ElevatorRenderData', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockElevator],
    })
    expect(model.indoor.elevators).toHaveLength(1)
    expect(model.indoor.elevators[0]).toEqual({
      id: 'elev-1',
      name: 'Elevator 1',
      buildingId: 'bld-1',
      floor: 0,
      position: mockElevator.position,
    })
  })

  it('filters out entrance and restroom components from indoor data', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockEntranceComponent, mockRestroom],
    })
    expect(model.indoor.rooms).toHaveLength(0)
    expect(model.indoor.hallways).toHaveLength(0)
    expect(model.indoor.stairs).toHaveLength(0)
    expect(model.indoor.elevators).toHaveLength(0)
  })

  it('skips room with fewer than 3 polygon points', () => {
    const badRoom: Component = {
      ...mockRoom,
      polygon: [{ lat: 11.819, lng: 122.168 }, { lat: 11.820, lng: 122.169 }],
    }
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [badRoom],
    })
    expect(model.indoor.rooms).toHaveLength(0)
  })

  it('skips hallway with no polygon', () => {
    const badHall: Component = {
      ...mockHallway,
      polygon: undefined,
    }
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [badHall],
    })
    expect(model.indoor.hallways).toHaveLength(0)
  })

  it('preserves buildingId and floor for all indoor types', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [
        { ...mockRoom, buildingId: 'bld-X', floor: 2 },
        { ...mockHallway, buildingId: 'bld-X', floor: 2 },
        { ...mockStair, buildingId: 'bld-X', floor: 2 },
        { ...mockElevator, buildingId: 'bld-X', floor: 2 },
      ],
    })
    for (const room of model.indoor.rooms) {
      expect(room.buildingId).toBe('bld-X')
      expect(room.floor).toBe(2)
    }
    for (const hall of model.indoor.hallways) {
      expect(hall.buildingId).toBe('bld-X')
      expect(hall.floor).toBe(2)
    }
    for (const stair of model.indoor.stairs) {
      expect(stair.buildingId).toBe('bld-X')
      expect(stair.floor).toBe(2)
    }
    for (const elev of model.indoor.elevators) {
      expect(elev.buildingId).toBe('bld-X')
      expect(elev.floor).toBe(2)
    }
  })

  it('handles mixed component types correctly', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom, mockHallway, mockStair, mockElevator, mockEntranceComponent, mockRestroom],
    })
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.hallways).toHaveLength(1)
    expect(model.indoor.stairs).toHaveLength(1)
    expect(model.indoor.elevators).toHaveLength(1)
  })

  it('still produces buildings and edges alongside indoor data', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom],
    })
    expect(model.buildings.length).toBeGreaterThan(0)
    expect(model.edges.length).toBeGreaterThan(0)
    expect(model.indoor.rooms).toHaveLength(1)
  })

  // ── Door render data tests ──────────────────────────────────

  it('returns empty doors when doors is undefined', () => {
    const model = buildFromCampusBundle(baseBundle)
    expect(model.indoor.doors).toEqual([])
  })

  it('returns empty doors when doors is empty', () => {
    const model = buildFromCampusBundle({ ...baseBundle, doors: [] })
    expect(model.indoor.doors).toEqual([])
  })

  it('transforms DoorData into DoorRenderData', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      doors: [mockDoor],
    })
    expect(model.indoor.doors).toHaveLength(1)
    expect(model.indoor.doors[0]).toEqual({
      id: 'door-1',
      roomId: 'room-1',
      buildingId: 'bld-1',
      floor: 0,
      position: { lat: 11.8195, lng: 122.1686 },
      width: 1.2,
      connectedToId: 'hall-1',
      isExterior: false,
    })
  })

  it('preserves isExterior flag on doors', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      doors: [mockExteriorDoor],
    })
    expect(model.indoor.doors[0].isExterior).toBe(true)
  })

  it('defaults isExterior to false when not set', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      doors: [mockDoor],
    })
    expect(model.indoor.doors[0].isExterior).toBe(false)
  })

  it('handles multiple doors across floors', () => {
    const door2: DoorData = { ...mockDoor, id: 'door-2', floor: 1 }
    const model = buildFromCampusBundle({
      ...baseBundle,
      doors: [mockDoor, door2],
    })
    expect(model.indoor.doors).toHaveLength(2)
    expect(model.indoor.doors.map(d => d.floor)).toEqual([0, 1])
  })

  it('produces doors alongside rooms and components', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom],
      doors: [mockDoor],
    })
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.doors).toHaveLength(1)
    expect(model.indoor.doors[0].roomId).toBe('room-1')
  })
})

// ── W16B: floorGeometry Runtime Data Wiring ────────────────────

/** Shared floorGeometry fixture for W16B tests. */
const makeFloorGeometry = (): FloorGeometryArtifact => ({
  schemaVersion: 1,
  formatVersion: 0,
  campusId: 'campus-1',
  buildings: [
    {
      id: 'bld-1',
      name: 'Science Building',
      anchor: {
        origin: { lat: 11.8195, lng: 122.1685 },
        rotation: 0,
      },
      floors: [
        {
          level: 0,
          label: 'Ground Floor',
          elevation: 0,
          offset: { x: 0, y: 0 },
          rooms: [
            {
              id: 'fg-room-1',
              name: 'Room 101',
              number: '101',
              polygon: {
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 8 },
                  { x: 0, y: 8 },
                  { x: 0, y: 0 },
                ],
              },
            },
          ],
          hallways: [
            {
              id: 'fg-hall-1',
              name: 'Main Hallway',
              polyline: {
                points: [
                  { x: 10, y: 0 },
                  { x: 20, y: 0 },
                  { x: 20, y: 4 },
                ],
              },
            },
          ],
          staircases: [
            {
              id: 'fg-stair-1',
              name: 'Stair A',
              position: { x: 5, y: 10 },
              rotation: 0,
            },
          ],
          elevators: [
            {
              id: 'fg-elev-1',
              name: 'Elevator 1',
              position: { x: 15, y: 10 },
              rotation: 0,
            },
          ],
          doors: [
            {
              id: 'fg-door-1',
              roomId: 'fg-room-1',
              doorType: 'swing',
              position: { x: 10, y: 3 },
              width: 1.2,
            },
          ],
          pois: [
            {
              id: 'fg-poi-1',
              name: 'Info Desk',
              category: 'helpdesk',
              position: { x: 15, y: 5 },
            },
          ],
          qrCheckpoints: [],
          walls: [
            {
              id: 'fg-wall-1',
              start: { x: 0, y: 0 },
              end: { x: 10, y: 0 },
              thickness: 0.15,
              height: 3.5,
            },
          ],
          openings: [
            {
              id: 'fg-opening-1',
              type: 'door',
              wallId: 'fg-wall-1',
              offset: 5,
              width: 1.2,
              height: 2.4,
            },
          ],
          roomAttributes: [
            {
              faceId: 'face-1',
              roomId: 'fg-room-1',
              name: 'Room 101',
              number: '101',
              category: 'classroom',
              searchable: true,
            },
          ],
          routeNetwork: {
            nodes: [
              { id: 'rn-1', type: 'space', position: { x: 5, y: 4 }, floor: 0 },
            ],
            edges: [],
          },
          roomAccess: [
            { openingId: 'fg-opening-1', routeNodeId: 'rn-1', primary: true },
          ],
          entranceAccess: [],
        },
      ],
    },
  ],
})

describe('W16B — floorGeometry Runtime Data Wiring', () => {
  const baseBundle = {
    buildings: [mockBuilding],
    nodes: mockNodes,
    edges: mockEdges,
    boundingBox: { minLat: 11.819, maxLat: 11.820, minLng: 122.168, maxLng: 122.169 },
  }

  // ── T1: floorGeometry rooms ───────────────────────────────

  it('T1: uses floorGeometry rooms when floorGeometry is present', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.rooms[0].id).toBe('fg-room-1')
    expect(model.indoor.rooms[0].name).toBe('Room 101')
    expect(model.indoor.rooms[0].buildingId).toBe('bld-1')
    expect(model.indoor.rooms[0].floor).toBe(0)
  })

  // ── T2: floorGeometry rooms polygon is world coords ───────

  it('T2: floorGeometry room polygon is converted to world LatLng', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    const room = model.indoor.rooms[0]
    // Polygon should be LatLng objects (lat/lng numbers)
    expect(room.polygon.length).toBeGreaterThanOrEqual(3)
    for (const pt of room.polygon) {
      expect(typeof pt.lat).toBe('number')
      expect(typeof pt.lng).toBe('number')
      expect(pt.lat).not.toBeNaN()
      expect(pt.lng).not.toBeNaN()
    }
  })

  // ── T3: floorGeometry hallways ────────────────────────────

  it('T3: uses floorGeometry hallways', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.hallways).toHaveLength(1)
    expect(model.indoor.hallways[0].id).toBe('fg-hall-1')
    expect(model.indoor.hallways[0].name).toBe('Main Hallway')
    expect(model.indoor.hallways[0].buildingId).toBe('bld-1')
    expect(model.indoor.hallways[0].floor).toBe(0)
  })

  // ── T4: floorGeometry stairs ──────────────────────────────

  it('T4: uses floorGeometry staircases', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.stairs).toHaveLength(1)
    expect(model.indoor.stairs[0].id).toBe('fg-stair-1')
    expect(model.indoor.stairs[0].name).toBe('Stair A')
    expect(model.indoor.stairs[0].buildingId).toBe('bld-1')
    expect(model.indoor.stairs[0].floor).toBe(0)
    // Position should be world LatLng
    expect(typeof model.indoor.stairs[0].position.lat).toBe('number')
    expect(typeof model.indoor.stairs[0].position.lng).toBe('number')
  })

  // ── T5: floorGeometry elevators ───────────────────────────

  it('T5: uses floorGeometry elevators', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.elevators).toHaveLength(1)
    expect(model.indoor.elevators[0].id).toBe('fg-elev-1')
    expect(model.indoor.elevators[0].name).toBe('Elevator 1')
    expect(model.indoor.elevators[0].buildingId).toBe('bld-1')
    expect(model.indoor.elevators[0].floor).toBe(0)
    expect(typeof model.indoor.elevators[0].position.lat).toBe('number')
    expect(typeof model.indoor.elevators[0].position.lng).toBe('number')
  })

  // ── T6: floorGeometry doors ───────────────────────────────

  it('T6: uses floorGeometry doors', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.doors).toHaveLength(1)
    expect(model.indoor.doors[0].id).toBe('fg-door-1')
    expect(model.indoor.doors[0].roomId).toBe('fg-room-1')
    expect(model.indoor.doors[0].buildingId).toBe('bld-1')
    expect(model.indoor.doors[0].floor).toBe(0)
    expect(model.indoor.doors[0].width).toBe(1.2)
    expect(typeof model.indoor.doors[0].position.lat).toBe('number')
    expect(typeof model.indoor.doors[0].position.lng).toBe('number')
  })

  // ── T7: floorGeometry POIs ────────────────────────────────

  it('T7: uses floorGeometry POIs', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.pois).toHaveLength(1)
    expect(model.indoor.pois[0].id).toBe('fg-poi-1')
    expect(model.indoor.pois[0].name).toBe('Info Desk')
    expect(model.indoor.pois[0].category).toBe('helpdesk')
    expect(model.indoor.pois[0].buildingId).toBe('bld-1')
    expect(model.indoor.pois[0].floor).toBe(0)
  })

  // ── T8: floorGeometry walls ───────────────────────────────

  it('T8: uses floorGeometry walls', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.walls).toHaveLength(1)
    expect(model.indoor.walls[0].id).toBe('fg-wall-1')
    expect(model.indoor.walls[0].buildingId).toBe('bld-1')
    expect(model.indoor.walls[0].floor).toBe(0)
    expect(model.indoor.walls[0].thickness).toBe(0.15)
    expect(model.indoor.walls[0].height).toBe(3.5)
    // Start/end should be world LatLng
    expect(typeof model.indoor.walls[0].start.lat).toBe('number')
    expect(typeof model.indoor.walls[0].start.lng).toBe('number')
    expect(typeof model.indoor.walls[0].end.lat).toBe('number')
    expect(typeof model.indoor.walls[0].end.lng).toBe('number')
  })

  // ── T9: floorGeometry openings ────────────────────────────

  it('T9: uses floorGeometry openings', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.openings).toHaveLength(1)
    expect(model.indoor.openings[0].id).toBe('fg-opening-1')
    expect(model.indoor.openings[0].type).toBe('door')
    expect(model.indoor.openings[0].wallId).toBe('fg-wall-1')
    expect(model.indoor.openings[0].offset).toBe(5)
    expect(model.indoor.openings[0].width).toBe(1.2)
    expect(model.indoor.openings[0].height).toBe(2.4)
    expect(model.indoor.openings[0].buildingId).toBe('bld-1')
    expect(model.indoor.openings[0].floor).toBe(0)
  })

  // ── T10: routeNetwork hidden ──────────────────────────────

  it('T10: routeNetwork nodes are NOT exposed in render model', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    // RouteNetwork is not part of IndoorRenderData at all
    expect(model.indoor).not.toHaveProperty('routeNetwork')
    // Check that no route node IDs appear in any render entity
    const allIds = [
      ...model.indoor.rooms.map(r => r.id),
      ...model.indoor.hallways.map(h => h.id),
      ...model.indoor.stairs.map(s => s.id),
      ...model.indoor.elevators.map(e => e.id),
      ...model.indoor.doors.map(d => d.id),
    ]
    expect(allIds).not.toContain('rn-1')
  })

  // ── T11: routeNetwork roomAccess not exposed ──────────────

  it('T11: roomAccess is not exposed in render model', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor).not.toHaveProperty('roomAccess')
  })

  // ── T12: routeNetwork entranceAccess not exposed ──────────

  it('T12: entranceAccess is not exposed in render model', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor).not.toHaveProperty('entranceAccess')
  })

  // ── T13: fallback to components when no floorGeometry ─────

  it('T13: falls back to legacy components when floorGeometry is absent', () => {
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom],
      doors: [mockDoor],
    })
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.rooms[0].id).toBe('room-1')
    expect(model.indoor.doors).toHaveLength(1)
    expect(model.indoor.doors[0].id).toBe('door-1')
    // No walls/openings from legacy path
    expect(model.indoor.walls).toHaveLength(0)
    expect(model.indoor.openings).toHaveLength(0)
  })

  // ── T14: floorGeometry takes precedence over components ───

  it('T14: floorGeometry takes precedence over legacy components', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom],  // legacy room-1
      doors: [mockDoor],       // legacy door-1
      floorGeometry: fg,       // floorGeometry has fg-room-1, fg-door-1
    })
    // Should use floorGeometry data, not legacy
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.rooms[0].id).toBe('fg-room-1')
    expect(model.indoor.doors).toHaveLength(1)
    expect(model.indoor.doors[0].id).toBe('fg-door-1')
  })

  // ── T15: buildingId and floor preserved on all entities ───

  it('T15: preserves buildingId and floor on all floorGeometry entities', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    for (const room of model.indoor.rooms) {
      expect(room.buildingId).toBe('bld-1')
      expect(room.floor).toBe(0)
    }
    for (const hall of model.indoor.hallways) {
      expect(hall.buildingId).toBe('bld-1')
      expect(hall.floor).toBe(0)
    }
    for (const stair of model.indoor.stairs) {
      expect(stair.buildingId).toBe('bld-1')
      expect(stair.floor).toBe(0)
    }
    for (const elev of model.indoor.elevators) {
      expect(elev.buildingId).toBe('bld-1')
      expect(elev.floor).toBe(0)
    }
    for (const door of model.indoor.doors) {
      expect(door.buildingId).toBe('bld-1')
      expect(door.floor).toBe(0)
    }
    for (const wall of model.indoor.walls) {
      expect(wall.buildingId).toBe('bld-1')
      expect(wall.floor).toBe(0)
    }
    for (const opening of model.indoor.openings) {
      expect(opening.buildingId).toBe('bld-1')
      expect(opening.floor).toBe(0)
    }
  })

  // ── T16: empty floorGeometry buildings falls back ──────────

  it('T16: empty floorGeometry buildings array falls back to components', () => {
    const fg: FloorGeometryArtifact = {
      schemaVersion: 1,
      formatVersion: 0,
      campusId: 'campus-1',
      buildings: [],
    }
    const model = buildFromCampusBundle({
      ...baseBundle,
      components: [mockRoom],
      floorGeometry: fg,
    })
    // Empty buildings → fallback to components
    expect(model.indoor.rooms).toHaveLength(1)
    expect(model.indoor.rooms[0].id).toBe('room-1')
  })

  // ── T17: multi-floor floorGeometry ────────────────────────

  it('T17: handles multi-floor floorGeometry correctly', () => {
    const fg: FloorGeometryArtifact = {
      schemaVersion: 1,
      formatVersion: 0,
      campusId: 'campus-1',
      buildings: [
        {
          id: 'bld-1',
          name: 'Science Building',
          anchor: { origin: { lat: 11.8195, lng: 122.1685 }, rotation: 0 },
          floors: [
            {
              level: 0,
              label: 'Ground Floor',
              elevation: 0,
              offset: { x: 0, y: 0 },
              rooms: [
                {
                  id: 'r-gf',
                  name: 'GF Room',
                  number: '001',
                  polygon: {
                    points: [
                      { x: 0, y: 0 },
                      { x: 5, y: 0 },
                      { x: 5, y: 5 },
                      { x: 0, y: 5 },
                      { x: 0, y: 0 },
                    ],
                  },
                },
              ],
              hallways: [],
              staircases: [],
              elevators: [],
              doors: [],
              pois: [],
              qrCheckpoints: [],
            },
            {
              level: 1,
              label: 'First Floor',
              elevation: 3.5,
              offset: { x: 0, y: 0 },
              rooms: [
                {
                  id: 'r-1f',
                  name: '1F Room',
                  number: '101',
                  polygon: {
                    points: [
                      { x: 0, y: 0 },
                      { x: 5, y: 0 },
                      { x: 5, y: 5 },
                      { x: 0, y: 5 },
                      { x: 0, y: 0 },
                    ],
                  },
                },
              ],
              hallways: [],
              staircases: [],
              elevators: [],
              doors: [],
              pois: [],
              qrCheckpoints: [],
            },
          ],
        },
      ],
    }
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.rooms).toHaveLength(2)
    const floors = model.indoor.rooms.map(r => r.floor).sort()
    expect(floors).toEqual([0, 1])
    expect(model.indoor.rooms.find(r => r.floor === 0)?.id).toBe('r-gf')
    expect(model.indoor.rooms.find(r => r.floor === 1)?.id).toBe('r-1f')
  })

  // ── T18: wall start/end are world LatLng ──────────────────

  it('T18: wall start/end coordinates are valid world LatLng', () => {
    const fg = makeFloorGeometry()
    const model = buildFromCampusBundle({ ...baseBundle, floorGeometry: fg })
    expect(model.indoor.walls).toHaveLength(1)
    const wall = model.indoor.walls[0]
    // Verify start is valid LatLng (near building anchor)
    expect(wall.start.lat).toBeGreaterThan(11.81)
    expect(wall.start.lat).toBeLessThan(11.83)
    expect(wall.start.lng).toBeGreaterThan(122.16)
    expect(wall.start.lng).toBeLessThan(122.18)
    // Verify end is valid LatLng (offset from start by ~10m east)
    expect(wall.end.lat).toBeGreaterThan(11.81)
    expect(wall.end.lat).toBeLessThan(11.83)
    expect(wall.end.lng).toBeGreaterThan(wall.start.lng)
    // End should be east of start (positive x offset = east)
    expect(wall.end.lng).toBeGreaterThan(wall.start.lng)
  })
})
