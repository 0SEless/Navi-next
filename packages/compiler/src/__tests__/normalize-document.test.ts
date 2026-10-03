import { describe, it, expect } from 'vitest'
import { normalizeDocument } from '../normalize'
import type { CampusDocument } from '@navi/core'

function makeMinimalDoc(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}

function makeBuildingDoc(): CampusDocument {
  return makeMinimalDoc({
    buildings: [{
      id: 'b1', name: 'Building A', code: 'BA', category: 'academic', description: '',
      footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.0, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121.0 }, { lat: 14.0, lng: 121.0 }] },
      baseElevation: 0, height: 10,
      floors: [{
        id: 'f1', level: 0, label: 'Ground', elevation: 0,
        rooms: [{
          id: 'r1', name: 'Room 101', number: '101', category: 'classroom',
          polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }] },
          roomDoors: [{ id: 'd1', roomId: 'r1', connectedToId: 'hw1', connectedToType: 'hallway', doorType: 'standard', position: { x: 5, y: 0 }, width: 1.2, metadata: {} }],
          capacity: 30, metadata: {},
        }],
        hallways: [{ id: 'hw1', name: 'Main Hall', polyline: { points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] }, width: 3 }],
        staircases: [], elevators: [],
        connectorStops: [{
          id: 'cs1', connectorId: 'vc1', position: { x: 5, y: 8 }, anchors: [], accessible: true, metadata: {},
        }],
        entrances: [{ id: 'e1', label: 'Main Door', position: { lat: 14.0005, lng: 121.0005 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false }],
        metadata: {},
      }],
      verticalConnectors: [{ id: 'vc1', type: 'staircase', name: 'Stair A', stopIds: ['cs1'], accessible: true, metadata: {} }],
      color: '#ccc', aliases: [], metadata: {},
    }],
  })
}

describe('normalizeDocument', () => {
  it('converts building-local x/y coordinates to world lat/lng', () => {
    const result = normalizeDocument(makeBuildingDoc())
    const floor = result.document.buildings[0]!.floors[0]!
    const room = floor.rooms[0]!

    // Centroid at local (5, 4) from building origin (14.0004, 121.0004)
    expect(room.centroid.lat).toBeCloseTo(14.0004, 3)
    expect(room.centroid.lng).toBeCloseTo(121.0004, 3)

    // Each polygon point converted from local coords via building origin
    expect(room.polygon.length).toBe(5)
    expect(room.polygon[0].lat).toBeCloseTo(14.0004, 6)
    expect(room.polygon[0].lng).toBeCloseTo(121.0004, 6)
  })

  it('converts roomDoor positions to world coordinates', () => {
    const result = normalizeDocument(makeBuildingDoc())
    const door = result.document.buildings[0]!.floors[0]!.rooms[0]!.doors[0]!
    expect(door.id).toBe('d1')
    expect(door.roomId).toBe('r1')
    expect(typeof door.position.lat).toBe('number')
    expect(typeof door.position.lng).toBe('number')
  })

  it('converts hallways to world coordinates', () => {
    const result = normalizeDocument(makeBuildingDoc())
    const hw = result.document.buildings[0]!.floors[0]!.hallways[0]!
    expect(hw.polyline.length).toBe(2)
    expect(hw.polyline[0].lat).toBeCloseTo(14.0004, 3)
  })

  it('converts connector stops to world coordinates with derived behavior', () => {
    const result = normalizeDocument(makeBuildingDoc())
    const cs = result.document.buildings[0]!.floors[0]!.connectorStops[0]!
    expect(cs.behavior).toBe('stairs') // staircase type → 'stairs'
    expect(cs.baseCost).toBe(15)
    expect(cs.connectorId).toBe('vc1')
  })

  it('sets elevator behavior for elevator-type connectors', () => {
    const doc = makeBuildingDoc()
    // Add elevator vertical connector
    const floor = doc.buildings[0]!.floors[0]!
    floor.connectorStops.push({ id: 'cs2', connectorId: 'vc2', position: { x: 3, y: 3 }, anchors: [], accessible: true, metadata: {} })
    doc.buildings[0]!.verticalConnectors.push({ id: 'vc2', type: 'elevator', name: 'Elev A', stopIds: ['cs2'], accessible: true, metadata: {} })
    const result = normalizeDocument(doc)
    const stops = result.document.buildings[0]!.floors[0]!.connectorStops
    const elevatorStop = stops.find(s => s.id === 'cs2')!
    expect(elevatorStop.behavior).toBe('elevator')
    expect(elevatorStop.baseCost).toBe(20)
  })

  it('converts entrances with indoor offset toward building centroid', () => {
    const result = normalizeDocument(makeBuildingDoc())
    const ent = result.document.buildings[0]!.floors[0]!.entrances[0]!
    expect(ent.label).toBe('Main Door')
    expect(ent.outdoorPosition.lat).toBe(14.0005)
    // indoorPosition should be offset ~2m inward from outdoorPosition toward building centroid
    expect(ent.indoorPosition.lat).not.toBe(ent.outdoorPosition.lat)
    expect(ent.indoorPosition.lng).not.toBe(ent.outdoorPosition.lng)
    // The offset should be small (~0.00002 degrees ≈ 2m at this latitude)
    const dLat = Math.abs(ent.indoorPosition.lat - ent.outdoorPosition.lat)
    const dLng = Math.abs(ent.indoorPosition.lng - ent.outdoorPosition.lng)
    expect(dLat).toBeGreaterThan(0)
    expect(dLat).toBeLessThan(0.001) // less than ~100m
    expect(dLng).toBeGreaterThan(0)
    expect(dLng).toBeLessThan(0.001)
  })

  it('emits a diagnostic when a building has no footprint', () => {
    const doc = makeMinimalDoc({
      buildings: [{
        id: 'b1', name: 'NoFP', code: 'NFP', category: 'academic', description: '',
        footprint: { points: [] },
        baseElevation: 0, height: 5,
        floors: [], verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
      }],
    })
    const result = normalizeDocument(doc)
    const diag = result.diagnostics.find(d => d.code === 'BUILDING_NO_FOOTPRINT')
    expect(diag).toBeDefined()
    expect(diag!.severity).toBe('error')
    expect(diag!.sourceEntityId).toBe('b1')
  })

  it('skips buildings with no footprint (no normalized output)', () => {
    const doc = makeMinimalDoc({
      buildings: [{
        id: 'b1', name: 'NoFP', code: 'NFP', category: 'academic', description: '',
        footprint: { points: [] },
        baseElevation: 0, height: 5,
        floors: [], verticalConnectors: [], color: '#ccc', aliases: [], metadata: {},
      }],
    })
    const result = normalizeDocument(doc)
    expect(result.document.buildings.length).toBe(0)
  })

  it('does NOT mutate the input document', () => {
    const doc = makeBuildingDoc()
    const before = JSON.stringify(doc)
    normalizeDocument(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('is deterministic: same input produces identical output', () => {
    const doc = makeBuildingDoc()
    const a = normalizeDocument(doc)
    const b = normalizeDocument(doc)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('normalizes roads unchanged (already in world coords)', () => {
    const doc = makeMinimalDoc({
      roads: [{ id: 'road1', name: 'Main Road', polyline: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.01, lng: 121.01 }] }, width: 5, surface: 'paved', type: 'arterial' }],
    })
    const result = normalizeDocument(doc)
    expect(result.document.roads.length).toBe(1)
    expect(result.document.roads[0]!.id).toBe('road1')
  })

  it('computes building origin from footprint centroid (averaging all 5 points incl closing vertex)', () => {
    const result = normalizeDocument(makeBuildingDoc())
    const bld = result.document.buildings[0]!
    expect(bld.position.lat).toBeCloseTo(14.0004, 4)
    expect(bld.position.lng).toBeCloseTo(121.0004, 4)
  })

  it('reports a room without doors as info diagnostic from extractor', () => {
    // roomDoors empty is a separate concern handled by room-extractor's ROOM_NO_DOOR
    // Normalize should pass through empty doors array without error
    const doc = makeBuildingDoc()
    doc.buildings[0]!.floors[0]!.rooms[0]!.roomDoors = []
    const result = normalizeDocument(doc)
    expect(result.document.buildings[0]!.floors[0]!.rooms[0]!.doors).toEqual([])
    expect(result.diagnostics.filter(d => d.code === 'ROOM_NO_DOOR').length).toBe(0) // not emitted by normalize
  })
})
