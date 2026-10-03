import { describe, it, expect } from 'vitest'
import { buildRoomGeoJSON } from '../RoomLayer'
import { buildHallwayGeoJSON } from '../HallwayLayer'
import { buildStairGeoJSON } from '../StaircaseLayer'
import { buildElevatorGeoJSON } from '../ElevatorLayer'
import { buildDoorGeoJSON } from '../DoorLayer'
import { buildWallGeoJSON } from '../WallLayer'
import { buildOpeningGeoJSON } from '../OpeningLayer'
import type { RoomRenderData, HallwayRenderData, StairRenderData, ElevatorRenderData, DoorRenderData, WallRenderData, OpeningRenderData } from '@/components/map/NavigationRenderModel'

// ── Test fixtures ──────────────────────────────────────────────

const mockRoom: RoomRenderData = {
  id: 'room-1',
  name: 'Room 101',
  buildingId: 'bld-1',
  floor: 0,
  polygon: [
    { lat: 11.819, lng: 122.168 },
    { lat: 11.819, lng: 122.169 },
    { lat: 11.820, lng: 122.169 },
    { lat: 11.820, lng: 122.168 },
  ],
  center: { lat: 11.8195, lng: 122.1685 },
}

const mockHallway: HallwayRenderData = {
  id: 'hall-1',
  name: 'Main Hallway',
  buildingId: 'bld-1',
  floor: 0,
  polygon: [
    { lat: 11.819, lng: 122.168 },
    { lat: 11.819, lng: 122.169 },
    { lat: 11.8195, lng: 122.169 },
    { lat: 11.8195, lng: 122.168 },
  ],
  center: { lat: 11.81925, lng: 122.1685 },
}

const mockStair: StairRenderData = {
  id: 'stair-1',
  name: 'Stair A',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8197, lng: 122.1685 },
}

const mockElevator: ElevatorRenderData = {
  id: 'elev-1',
  name: 'Elevator 1',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8197, lng: 122.1688 },
}

const mockDoor: DoorRenderData = {
  id: 'door-1',
  roomId: 'room-1',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8195, lng: 122.1686 },
  width: 1.2,
  connectedToId: 'hall-1',
  isExterior: false,
}

const mockExteriorDoor: DoorRenderData = {
  id: 'door-ext-1',
  roomId: 'room-1',
  buildingId: 'bld-1',
  floor: 0,
  position: { lat: 11.8194, lng: 122.1684 },
  width: 1.5,
  connectedToId: '',
  isExterior: true,
}

const mockWall: WallRenderData = {
  id: 'wall-1',
  buildingId: 'bld-1',
  floor: 0,
  start: { lat: 11.819, lng: 122.168 },
  end: { lat: 11.819, lng: 122.169 },
  thickness: 0.15,
  height: 3,
}

const mockWallDiagonal: WallRenderData = {
  id: 'wall-2',
  buildingId: 'bld-1',
  floor: 0,
  start: { lat: 11.819, lng: 122.168 },
  end: { lat: 11.820, lng: 122.169 },
  thickness: 0.2,
  height: 3,
}

const mockDoorOpening: OpeningRenderData = {
  id: 'opening-door-1',
  buildingId: 'bld-1',
  floor: 0,
  type: 'door',
  wallId: 'wall-1',
  offset: 0.5,
  width: 1.2,
  height: 2.1,
  sillHeight: 0,
}

const mockWindowOpening: OpeningRenderData = {
  id: 'opening-window-1',
  buildingId: 'bld-1',
  floor: 0,
  type: 'window',
  wallId: 'wall-2',
  offset: 0.8,
  width: 1.5,
  height: 1.2,
  sillHeight: 0.9,
}

// ── RoomLayer GeoJSON tests ────────────────────────────────────

describe('buildRoomGeoJSON', () => {
  it('converts rooms to Polygon features', () => {
    const geojson = buildRoomGeoJSON([mockRoom])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Polygon')
    expect(geojson.features[0].properties.id).toBe('room-1')
    expect(geojson.features[0].properties.name).toBe('Room 101')
  })

  it('filters out rooms with fewer than 3 polygon points', () => {
    const badRoom: RoomRenderData = {
      ...mockRoom,
      polygon: [{ lat: 11.819, lng: 122.168 }, { lat: 11.820, lng: 122.169 }],
    }
    const geojson = buildRoomGeoJSON([badRoom])
    expect(geojson.features).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    const geojson = buildRoomGeoJSON([])
    expect(geojson.features).toHaveLength(0)
  })

  it('includes buildingId and floor in properties', () => {
    const geojson = buildRoomGeoJSON([mockRoom])
    expect(geojson.features[0].properties.buildingId).toBe('bld-1')
    expect(geojson.features[0].properties.floor).toBe(0)
  })
})

// ── HallwayLayer GeoJSON tests ─────────────────────────────────

describe('buildHallwayGeoJSON', () => {
  it('converts hallways to Polygon features', () => {
    const geojson = buildHallwayGeoJSON([mockHallway])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Polygon')
    expect(geojson.features[0].properties.id).toBe('hall-1')
  })

  it('filters out hallways with fewer than 3 polygon points', () => {
    const badHall: HallwayRenderData = {
      ...mockHallway,
      polygon: [{ lat: 11.819, lng: 122.168 }, { lat: 11.820, lng: 122.169 }],
    }
    const geojson = buildHallwayGeoJSON([badHall])
    expect(geojson.features).toHaveLength(0)
  })
})

// ── StaircaseLayer GeoJSON tests ───────────────────────────────

describe('buildStairGeoJSON', () => {
  it('converts stairs to Point features', () => {
    const geojson = buildStairGeoJSON([mockStair])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Point')
    expect(geojson.features[0].geometry.coordinates).toEqual([122.1685, 11.8197])
  })

  it('includes buildingId and floor', () => {
    const geojson = buildStairGeoJSON([mockStair])
    expect(geojson.features[0].properties.buildingId).toBe('bld-1')
    expect(geojson.features[0].properties.floor).toBe(0)
  })
})

// ── ElevatorLayer GeoJSON tests ────────────────────────────────

describe('buildElevatorGeoJSON', () => {
  it('converts elevators to Point features', () => {
    const geojson = buildElevatorGeoJSON([mockElevator])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Point')
    expect(geojson.features[0].geometry.coordinates).toEqual([122.1688, 11.8197])
  })

  it('returns empty for empty input', () => {
    const geojson = buildElevatorGeoJSON([])
    expect(geojson.features).toHaveLength(0)
  })
})

// ── DoorLayer GeoJSON tests ────────────────────────────────────

describe('buildDoorGeoJSON', () => {
  it('converts doors to LineString wall-opening features', () => {
    const geojson = buildDoorGeoJSON([mockDoor])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('LineString')
    // width 1.2 -> half 0.6, angle default 0 -> horizontal opening centered on position.
    expect(geojson.features[0].geometry.coordinates).toEqual([
      [122.1686 - 0.6, 11.8195],
      [122.1686 + 0.6, 11.8195],
    ])
  })

  it('includes door-specific properties', () => {
    const geojson = buildDoorGeoJSON([mockDoor])
    const props = geojson.features[0].properties
    expect(props.roomId).toBe('room-1')
    expect(props.width).toBe(1.2)
    expect(props.connectedToId).toBe('hall-1')
    expect(props.isExterior).toBe(false)
  })

  it('marks exterior doors correctly', () => {
    const geojson = buildDoorGeoJSON([mockExteriorDoor])
    expect(geojson.features[0].properties.isExterior).toBe(true)
  })

  it('handles multiple doors', () => {
    const geojson = buildDoorGeoJSON([mockDoor, mockExteriorDoor])
    expect(geojson.features).toHaveLength(2)
  })
})

// ── WallLayer GeoJSON tests ────────────────────────────────────

describe('buildWallGeoJSON', () => {
  it('converts horizontal walls to Polygon features', () => {
    const geojson = buildWallGeoJSON([mockWall])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Polygon')
    expect(geojson.features[0].properties.id).toBe('wall-1')
  })

  it('converts diagonal walls to Polygon features', () => {
    const geojson = buildWallGeoJSON([mockWallDiagonal])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Polygon')
    // Diagonal wall should produce a valid polygon with 5 coordinates (closed ring)
    const coords = (geojson.features[0].geometry as any).coordinates[0]
    expect(coords).toHaveLength(5)
    // First and last should be the same (closed ring)
    expect(coords[0]).toEqual(coords[4])
  })

  it('includes buildingId and floor in properties', () => {
    const geojson = buildWallGeoJSON([mockWall])
    expect(geojson.features[0].properties.buildingId).toBe('bld-1')
    expect(geojson.features[0].properties.floor).toBe(0)
  })

  it('includes thickness in properties', () => {
    const geojson = buildWallGeoJSON([mockWall])
    expect(geojson.features[0].properties.thickness).toBe(0.15)
  })

  it('filters out zero-length walls', () => {
    const zeroWall: WallRenderData = {
      ...mockWall,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.168 },
    }
    const geojson = buildWallGeoJSON([zeroWall])
    expect(geojson.features).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    const geojson = buildWallGeoJSON([])
    expect(geojson.features).toHaveLength(0)
  })

  it('handles multiple walls', () => {
    const geojson = buildWallGeoJSON([mockWall, mockWallDiagonal])
    expect(geojson.features).toHaveLength(2)
  })

  // ── Wall splitting at openings ───────────────────────────────

  it('splits wall into two segments when door opening present', () => {
    // Wall from lng 122.168 to 122.169 (length ~0.001 degrees ≈ ~111m)
    // Door at offset 0.5, width 1.2 → splits wall
    const wall: WallRenderData = {
      id: 'w-split',
      buildingId: 'bld-1',
      floor: 0,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.178 },
      thickness: 0.15,
      height: 3.5,
    }
    const door: OpeningRenderData = {
      id: 'door-split-1',
      buildingId: 'bld-1',
      floor: 0,
      type: 'door',
      wallId: 'w-split',
      offset: 30,
      width: 10,
    }
    const geojson = buildWallGeoJSON([wall], [door])
    // Should produce 2 segments (before + after the door)
    expect(geojson.features.length).toBeGreaterThanOrEqual(2)
    // All segments reference the same wall
    for (const f of geojson.features) {
      expect(f.properties.wallId).toBe('w-split')
    }
  })

  it('produces full wall when no openings match', () => {
    const geojson = buildWallGeoJSON([mockWall], [])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].properties.id).toBe('wall-1')
  })

  it('backward compatible: no openings param returns full wall', () => {
    const geojson = buildWallGeoJSON([mockWall])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Polygon')
  })

  it('door at wall start produces one segment after the opening', () => {
    const wall: WallRenderData = {
      id: 'w-start',
      buildingId: 'bld-1',
      floor: 0,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.178 },
      thickness: 0.15,
      height: 3.5,
    }
    const door: OpeningRenderData = {
      id: 'door-start',
      buildingId: 'bld-1',
      floor: 0,
      type: 'door',
      wallId: 'w-start',
      offset: 0,
      width: 10,
    }
    const geojson = buildWallGeoJSON([wall], [door])
    // One segment after the opening
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].properties.wallId).toBe('w-start')
  })

  it('door at wall end produces one segment before the opening', () => {
    const wallLen = Math.hypot(122.178 - 122.168, 0) * 111320 // ~1113m
    const wall: WallRenderData = {
      id: 'w-end',
      buildingId: 'bld-1',
      floor: 0,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.178 },
      thickness: 0.15,
      height: 3.5,
    }
    const door: OpeningRenderData = {
      id: 'door-end',
      buildingId: 'bld-1',
      floor: 0,
      type: 'door',
      wallId: 'w-end',
      offset: wallLen - 5,
      width: 5,
    }
    const geojson = buildWallGeoJSON([wall], [door])
    // One segment before the opening
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].properties.wallId).toBe('w-end')
  })

  it('multiple openings on same wall produce multiple segments', () => {
    const wall: WallRenderData = {
      id: 'w-multi',
      buildingId: 'bld-1',
      floor: 0,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.178 },
      thickness: 0.15,
      height: 3.5,
    }
    const openings: OpeningRenderData[] = [
      { id: 'd1', buildingId: 'bld-1', floor: 0, type: 'door', wallId: 'w-multi', offset: 20, width: 10 },
      { id: 'd2', buildingId: 'bld-1', floor: 0, type: 'door', wallId: 'w-multi', offset: 50, width: 10 },
    ]
    const geojson = buildWallGeoJSON([wall], openings)
    // Should produce 3 segments: before d1, between d1-d2, after d2
    expect(geojson.features.length).toBeGreaterThanOrEqual(3)
    for (const f of geojson.features) {
      expect(f.properties.wallId).toBe('w-multi')
    }
  })

  it('opening on different wall does not split target wall', () => {
    const geojson = buildWallGeoJSON([mockWall], [mockWindowOpening])
    // mockWindowOpening.wallId is 'wall-2', not 'wall-1'
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].properties.id).toBe('wall-1')
  })

  it('segment features have hasOpening property', () => {
    const wall: WallRenderData = {
      id: 'w-props',
      buildingId: 'bld-1',
      floor: 0,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.178 },
      thickness: 0.15,
      height: 3.5,
    }
    const door: OpeningRenderData = {
      id: 'door-props',
      buildingId: 'bld-1',
      floor: 0,
      type: 'door',
      wallId: 'w-props',
      offset: 30,
      width: 10,
    }
    const geojson = buildWallGeoJSON([wall], [door])
    for (const f of geojson.features) {
      expect(f.properties.hasOpening).toBe(true)
    }
  })

  it('segments are valid closed polygons', () => {
    const wall: WallRenderData = {
      id: 'w-valid',
      buildingId: 'bld-1',
      floor: 0,
      start: { lat: 11.819, lng: 122.168 },
      end: { lat: 11.819, lng: 122.178 },
      thickness: 0.15,
      height: 3.5,
    }
    const door: OpeningRenderData = {
      id: 'door-valid',
      buildingId: 'bld-1',
      floor: 0,
      type: 'door',
      wallId: 'w-valid',
      offset: 30,
      width: 10,
    }
    const geojson = buildWallGeoJSON([wall], [door])
    for (const f of geojson.features) {
      const coords = (f.geometry as any).coordinates[0]
      // Closed ring: first === last, at least 5 points
      expect(coords.length).toBeGreaterThanOrEqual(5)
      expect(coords[0]).toEqual(coords[coords.length - 1])
      // All valid numbers
      for (const [lng, lat] of coords) {
        expect(Number.isFinite(lng)).toBe(true)
        expect(Number.isFinite(lat)).toBe(true)
      }
    }
  })
})

// ── OpeningLayer GeoJSON tests ─────────────────────────────────

describe('buildOpeningGeoJSON', () => {
  it('converts door openings to Point features', () => {
    const geojson = buildOpeningGeoJSON([mockDoorOpening])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Point')
    expect(geojson.features[0].properties.id).toBe('opening-door-1')
    expect(geojson.features[0].properties.type).toBe('door')
  })

  it('converts window openings to Point features', () => {
    const geojson = buildOpeningGeoJSON([mockWindowOpening])
    expect(geojson.features).toHaveLength(1)
    expect(geojson.features[0].geometry.type).toBe('Point')
    expect(geojson.features[0].properties.type).toBe('window')
  })

  it('includes wall attachment properties', () => {
    const geojson = buildOpeningGeoJSON([mockDoorOpening])
    const props = geojson.features[0].properties
    expect(props.wallId).toBe('wall-1')
    expect(props.offset).toBe(0.5)
    expect(props.width).toBe(1.2)
  })

  it('includes buildingId and floor', () => {
    const geojson = buildOpeningGeoJSON([mockDoorOpening])
    expect(geojson.features[0].properties.buildingId).toBe('bld-1')
    expect(geojson.features[0].properties.floor).toBe(0)
  })

  it('returns empty for empty input', () => {
    const geojson = buildOpeningGeoJSON([])
    expect(geojson.features).toHaveLength(0)
  })

  it('handles mixed door and window openings', () => {
    const geojson = buildOpeningGeoJSON([mockDoorOpening, mockWindowOpening])
    expect(geojson.features).toHaveLength(2)
    const types = geojson.features.map(f => f.properties.type)
    expect(types).toContain('door')
    expect(types).toContain('window')
  })
})
