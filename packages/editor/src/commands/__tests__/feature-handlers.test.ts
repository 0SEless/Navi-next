import { describe, it, expect } from 'vitest'
import type { CampusDocument, Building, PointOfInterest, Room } from '@navi/core'
import {
  featureCreateHandler,
  featureUpdateHandler,
  featureModeTransitionHandler,
  featureDeleteHandler,
  featureReplaceHandler,
  poiCreateHandler,
  poiUpdateHandler,
  poiDeleteHandler,
  doorCreateHandler,
  doorUpdateHandler,
  doorDeleteHandler,
} from '../feature-handlers'

function createTestDoc(): CampusDocument {
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
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
    ],
    verticalConnectors: [],
    aliases: [],
    color: '#ff0000',
    metadata: {},
  }

  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'test-campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('Feature Handlers (P1 Commands)', () => {
  it('feature.create creates a staircase feature with stable ID and R3 placement range defaults', () => {
    const doc = createTestDoc()
    const result = featureCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      featureType: 'staircase',
      floor: 0,
      position: { x: 10, y: 10 },
      drawing: {
        definitionId: 'stair',
        properties: { stepCount: 12, stepWidth: 1.2, stepDepth: 0.3, direction: 'up', preset: 'straight' },
      },
    })

    expect(result.success).toBe(true)
    expect(result.entityId).toBeDefined()

    const building = doc.buildings[0]
    expect(building.staircases).toBeDefined()
    expect(building.staircases!.length).toBe(1)

    const st = building.staircases![0]
    expect(st.id).toBe(result.entityId)
    expect(st.fromLevel).toBe(0)
    expect(st.toLevel).toBe(1)
    expect(st.levels[0]).toBeDefined()
    expect(st.levels[0].position).toEqual({ x: 10, y: 10 })
    expect(st.levels[0].polygon).toBeDefined()

    // Test inverse undo
    const inverseCmd = featureCreateHandler.inverse!({ id: st.id }, result)
    expect(inverseCmd).toBeDefined()
    expect(inverseCmd!.id).toBe('feature.delete')
    expect(inverseCmd!.payload.featureId).toBe(st.id)

    const undoResult = featureDeleteHandler.execute(doc, inverseCmd!.payload)
    expect(undoResult.success).toBe(true)
    expect(building.staircases!.length).toBe(0)
  })

  it('feature.update modifies per-level geometry without altering featureId', () => {
    const doc = createTestDoc()
    const createRes = featureCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      featureType: 'staircase',
      floor: 0,
      position: { x: 5, y: 5 },
      drawing: {
        definitionId: 'stair',
        properties: { stepCount: 10, stepWidth: 1.0, stepDepth: 0.3, direction: 'up', preset: 'straight' },
      },
    })

    const featureId = createRes.entityId!
    const updateRes = featureUpdateHandler.execute(doc, {
      featureId,
      level: 0,
      patch: {
        name: 'Renamed Stair',
        fromLevel: -1,
        toLevel: 3,
        position: { x: 15, y: 15 },
        rotation: 45,
        drawing: { properties: { stepWidth: 2.0 } },
      },
    })

    expect(updateRes.success).toBe(true)
    const st = doc.buildings[0].staircases![0]
    expect(st.id).toBe(featureId)
    expect(st.levels[0].position).toEqual({ x: 15, y: 15 })
    expect(st.levels[0].rotation).toBe(45)
    expect(st.levels[0].drawing?.properties.stepWidth).toBe(2.0)
    expect(st.levels[0].polygon).toBeDefined()
    expect(st).toMatchObject({ name: 'Renamed Stair', fromLevel: -1, toLevel: 3 })

    // Undo update
    const inverseCmd = featureUpdateHandler.inverse!({ featureId, level: 0 }, updateRes)
    expect(inverseCmd).toBeDefined()
    featureUpdateHandler.execute(doc, inverseCmd!.payload)

    expect(st.levels[0].position).toEqual({ x: 5, y: 5 })
    expect(st.levels[0].rotation).toBe(0)
    expect(st.levels[0].drawing?.properties.stepWidth).toBe(1.0)
    expect(st).toMatchObject({ name: 'Staircase', fromLevel: 0, toLevel: 1 })
  })

  it('feature.modeTransition converts parametric level to freeform and vice versa', () => {
    const doc = createTestDoc()
    const createRes = featureCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      featureType: 'staircase',
      floor: 0,
      position: { x: 5, y: 5 },
      drawing: {
        definitionId: 'stair',
        properties: { stepCount: 10, stepWidth: 1.0, stepDepth: 0.3, direction: 'up', preset: 'straight' },
      },
    })

    const featureId = createRes.entityId!
    const st = doc.buildings[0].staircases![0]

    // Convert to freeform
    const transRes = featureModeTransitionHandler.execute(doc, {
      featureId,
      level: 0,
      mode: 'freeform',
    })

    expect(transRes.success).toBe(true)
    expect(st.levels[0].drawing).toBeUndefined()
    expect(st.levels[0].polygon).toBeDefined()

    // Convert back to parametric
    const transBackRes = featureModeTransitionHandler.execute(doc, {
      featureId,
      level: 0,
      mode: 'parametric',
    })

    expect(transBackRes.success).toBe(true)
    expect(st.levels[0].drawing).toBeDefined()
    expect(st.levels[0].drawing?.definitionId).toBe('stair')
  })

  it('feature.replace converts staircase to elevator with new ID carrying geometry', () => {
    const doc = createTestDoc()
    const createRes = featureCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      featureType: 'staircase',
      floor: 0,
      position: { x: 8, y: 8 },
      rotation: 90,
      drawing: {
        definitionId: 'stair',
        properties: { stepCount: 10, stepWidth: 1.0, stepDepth: 0.3, direction: 'up', preset: 'straight' },
      },
    })

    const oldId = createRes.entityId!
    const replaceRes = featureReplaceHandler.execute(doc, {
      featureId: oldId,
      newType: 'elevator',
    })

    expect(replaceRes.success).toBe(true)
    expect(doc.buildings[0].staircases?.length ?? 0).toBe(0)
    expect(doc.buildings[0].elevators?.length ?? 0).toBe(1)

    const el = doc.buildings[0].elevators![0]
    expect(el.id).not.toBe(oldId)
    expect(el.levels[0].position).toEqual({ x: 8, y: 8 })
    expect(el.levels[0].rotation).toBe(90)
    expect(el.levels[0].drawing?.definitionId).toBe('elevator')
  })
})

// ── P1-T5 (R2.2): POIs + POICategory ──

describe('POI Handlers (P1-T5)', () => {
  it('poi.create creates a POI with enum category, building-local position, and optional metadata', () => {
    const doc = createTestDoc()
    const result = poiCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      name: 'Vending Machine',
      category: 'vending_machine',
      position: { x: 3.5, y: 7.25 },
      metadata: { vendor: 'acme' },
    })

    expect(result.success).toBe(true)
    expect(result.entityId).toBeDefined()
    const pois = doc.buildings[0].floors[0].pois!
    expect(pois).toHaveLength(1)
    const poi = pois[0]
    expect(poi.id).toBe(result.entityId)
    expect(poi.name).toBe('Vending Machine')
    expect(poi.category).toBe('vending_machine')
    // R2.2: positions are building-local meters — never world LatLng
    expect(poi.position).toEqual({ x: 3.5, y: 7.25 })
    expect(poi.position).not.toHaveProperty('lat')
    expect(poi.metadata).toEqual({ vendor: 'acme' })
  })

  it('poi.create defaults id via genId and metadata to {} when absent', () => {
    const doc = createTestDoc()
    const result = poiCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      category: 'restroom',
      position: { x: 1, y: 2 },
    })
    expect(result.success).toBe(true)
    const poi = doc.buildings[0].floors[0].pois![0]
    expect(poi.id).toBeTruthy()
    expect(poi.id).toMatch(/^poi-/)
    expect(poi.name).toBe('')
    expect(poi.metadata).toEqual({})
  })

  it('poi.create rejects a category outside the closed enum', () => {
    const doc = createTestDoc()
    const result = poiCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      name: 'Teleporter',
      category: 'teleporter',
      position: { x: 0, y: 0 },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/category/i)
    expect(doc.buildings[0].floors[0].pois ?? []).toHaveLength(0)
  })

  it('poi.create rejects unknown building/floor', () => {
    const doc = createTestDoc()
    const result = poiCreateHandler.execute(doc, {
      buildingId: 'nope',
      floorId: 'flr-0',
      category: 'food',
      position: { x: 0, y: 0 },
    })
    expect(result.success).toBe(false)
  })

  it('poi.update renames, recategorizes, and moves; inverse restores all three', () => {
    const doc = createTestDoc()
    const createRes = poiCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      name: 'Water Fountain',
      category: 'water_fountain',
      position: { x: 4, y: 4 },
    })
    const poiId = createRes.entityId as string

    const updateRes = poiUpdateHandler.execute(doc, {
      poiId,
      patch: { name: 'Drinking Fountain', category: 'other', position: { x: 5, y: 6 } },
    })
    expect(updateRes.success).toBe(true)
    const poi = doc.buildings[0].floors[0].pois![0]
    expect(poi.name).toBe('Drinking Fountain')
    expect(poi.category).toBe('other')
    expect(poi.position).toEqual({ x: 5, y: 6 })

    const inverse = poiUpdateHandler.inverse?.({ poiId }, updateRes) ?? null
    expect(inverse).not.toBeNull()
    const undoRes = poiUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undoRes.success).toBe(true)
    const restored = doc.buildings[0].floors[0].pois![0]
    expect(restored.name).toBe('Water Fountain')
    expect(restored.category).toBe('water_fountain')
    expect(restored.position).toEqual({ x: 4, y: 4 })
  })

  it('poi.update rejects an invalid category in the patch', () => {
    const doc = createTestDoc()
    const createRes = poiCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      category: 'atm',
      position: { x: 1, y: 1 },
    })
    const updateRes = poiUpdateHandler.execute(doc, {
      poiId: createRes.entityId as string,
      patch: { category: 'gold_plated' },
    })
    expect(updateRes.success).toBe(false)
    expect(updateRes.error).toMatch(/category/i)
    // unchanged
    expect(doc.buildings[0].floors[0].pois![0].category).toBe('atm')
  })

  it('poi.delete removes the POI and its inverse re-creates it verbatim', () => {
    const doc = createTestDoc()
    const createRes = poiCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      id: 'poi-fixed-1',
      name: 'Printer',
      category: 'printer',
      position: { x: 9, y: -2 },
      metadata: { floorLabel: 'HP-3rd' },
    })
    expect(createRes.success).toBe(true)

    const delRes = poiDeleteHandler.execute(doc, { poiId: 'poi-fixed-1' })
    expect(delRes.success).toBe(true)
    expect(doc.buildings[0].floors[0].pois).toHaveLength(0)

    const inverse = poiDeleteHandler.inverse?.({ poiId: 'poi-fixed-1' }, delRes) ?? null
    expect(inverse).not.toBeNull()
    const undoRes = poiCreateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undoRes.success).toBe(true)
    const poi = doc.buildings[0].floors[0].pois![0]
    expect(poi.id).toBe('poi-fixed-1')
    expect(poi.name).toBe('Printer')
    expect(poi.category).toBe('printer')
    expect(poi.position).toEqual({ x: 9, y: -2 })
    expect(poi.metadata).toEqual({ floorLabel: 'HP-3rd' })
  })

  it('poi.delete fails cleanly for an unknown id', () => {
    const doc = createTestDoc()
    const res = poiDeleteHandler.execute(doc, { poiId: 'ghost' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })

  it('POI and Room remain distinct types (compile-time): PointOfInterest is not assignable to Room', () => {
    const poi: PointOfInterest = {
      id: 'poi-x', name: 'Study Area', category: 'study_area', position: { x: 0, y: 0 },
    }
    expect(poi.category).toBe('study_area')
    // @ts-expect-error — a POI must never be usable where a Room is required
    const room: Room = poi
    expect(room).toBeDefined()
  })
})

describe('Door Handlers (P1-T6)', () => {
  /** Fixture with one room so doors have an owner; roomDoors stays empty —
   *  P1-T6 doors live at Floor.doors (extracted from Room nesting). */
  function createDocWithRoom(): CampusDocument {
    const doc = createTestDoc()
    doc.buildings[0].floors[0].rooms.push({
      id: 'room-1',
      name: 'Room One',
      number: '101',
      category: 'classroom',
      polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }] },
      roomDoors: [],
      metadata: {},
    })
    return doc
  }

  it('door.create appends an independent door entity to Floor.doors (not the room) with defaults', () => {
    const doc = createDocWithRoom()
    const result = doorCreateHandler.execute(doc, {
      buildingId: 'bld-1',
      floorId: 'flr-0',
      roomId: 'room-1',
      door: { position: { x: 5, y: 0 } },
    })
    expect(result.success).toBe(true)
    const floor = doc.buildings[0].floors[0]
    expect(floor.doors).toHaveLength(1)
    const door = floor.doors![0]
    expect(door.id).toMatch(/^door-/)
    expect(door.roomId).toBe('room-1')
    expect(door.doorType).toBe('standard')
    expect(door.width).toBe(0.9)
    expect(door.connectedToType).toBe('room')
    expect(door.position).toEqual({ x: 5, y: 0 })
    expect(door.position).not.toHaveProperty('lat')
    expect(door.metadata).toEqual({})
    // Independence of storage: the owning room's nested array stays empty
    expect(floor.rooms[0].roomDoors).toHaveLength(0)
  })

  it('door.create generates unique ids across calls (R15.6 shared genId)', () => {
    const doc = createDocWithRoom()
    const a = doorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1', door: { position: { x: 1, y: 0 } } })
    const b = doorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1', door: { position: { x: 2, y: 0 } } })
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
    expect(a.entityId).not.toBe(b.entityId)
  })

  it('door.create validates doorType against the closed enum (incl. opening)', () => {
    const doc = createDocWithRoom()
    const bad = doorCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1',
      door: { position: { x: 3, y: 0 }, doorType: 'revolving' as never },
    })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/doorType/i)
    expect(doc.buildings[0].floors[0].doors ?? []).toHaveLength(0)

    const opening = doorCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1',
      door: { position: { x: 3, y: 0 }, doorType: 'opening' },
    })
    expect(opening.success).toBe(true)
    expect(doc.buildings[0].floors[0].doors![0].doorType).toBe('opening')
  })

  it('door.create rejects unknown building/floor/room', () => {
    const doc = createDocWithRoom()
    expect(doorCreateHandler.execute(doc, { buildingId: 'nope', floorId: 'flr-0', roomId: 'room-1', door: { position: { x: 0, y: 0 } } }).success).toBe(false)
    expect(doorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'nope', roomId: 'room-1', door: { position: { x: 0, y: 0 } } }).success).toBe(false)
    const noRoom = doorCreateHandler.execute(doc, { buildingId: 'bld-1', floorId: 'flr-0', roomId: 'ghost-room', door: { position: { x: 0, y: 0 } } })
    expect(noRoom.success).toBe(false)
    expect(noRoom.error).toMatch(/not found/i)
  })

  it('door.update mutates only the door; inverse restores all editable fields; room untouched', () => {
    const doc = createDocWithRoom()
    const createRes = doorCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1',
      door: { id: 'door-fixed-1', position: { x: 5, y: 0 }, width: 0.9, doorType: 'standard' },
    })
    expect(createRes.success).toBe(true)
    const roomBefore = JSON.parse(JSON.stringify(doc.buildings[0].floors[0].rooms[0]))

    const updateRes = doorUpdateHandler.execute(doc, {
      doorId: 'door-fixed-1',
      patch: { doorType: 'fire', width: 1.2, position: { x: 6, y: 0 }, connectedToId: 'hall-9', connectedToType: 'hallway' },
    })
    expect(updateRes.success).toBe(true)
    const door = doc.buildings[0].floors[0].doors![0]
    expect(door.doorType).toBe('fire')
    expect(door.width).toBe(1.2)
    expect(door.position).toEqual({ x: 6, y: 0 })
    expect(door.connectedToId).toBe('hall-9')
    expect(door.connectedToType).toBe('hallway')

    // Owning room untouched by the door edit path
    expect(doc.buildings[0].floors[0].rooms[0]).toEqual(roomBefore)

    const inverse = doorUpdateHandler.inverse?.({ doorId: 'door-fixed-1' }, updateRes) ?? null
    expect(inverse).not.toBeNull()
    const undoRes = doorUpdateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undoRes.success).toBe(true)
    const restored = doc.buildings[0].floors[0].doors![0]
    expect(restored.doorType).toBe('standard')
    expect(restored.width).toBe(0.9)
    expect(restored.position).toEqual({ x: 5, y: 0 })
    expect(restored.connectedToId).toBeUndefined()
    expect(restored.connectedToType).toBe('room')
  })

  it('door.update rejects an invalid doorType and leaves the document unchanged', () => {
    const doc = createDocWithRoom()
    doorCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1',
      door: { id: 'door-fixed-1', position: { x: 5, y: 0 }, doorType: 'sliding' },
    })
    const res = doorUpdateHandler.execute(doc, { doorId: 'door-fixed-1', patch: { doorType: 'golden' as never } })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/doorType/i)
    expect(doc.buildings[0].floors[0].doors![0].doorType).toBe('sliding')
  })

  it('door.delete removes the door and its inverse re-creates it verbatim', () => {
    const doc = createDocWithRoom()
    doorCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-0', roomId: 'room-1',
      door: {
        id: 'door-fixed-1', position: { x: 5, y: 0 }, width: 1.8, doorType: 'double',
        connectedToId: 'room-2', connectedToType: 'room', metadata: { label: 'Main entry' },
      },
    })
    const delRes = doorDeleteHandler.execute(doc, { doorId: 'door-fixed-1' })
    expect(delRes.success).toBe(true)
    expect(doc.buildings[0].floors[0].doors).toHaveLength(0)

    const inverse = doorDeleteHandler.inverse?.({ doorId: 'door-fixed-1' }, delRes) ?? null
    expect(inverse).not.toBeNull()
    const undoRes = doorCreateHandler.execute(doc, inverse!.payload as Record<string, unknown>)
    expect(undoRes.success).toBe(true)
    const door = doc.buildings[0].floors[0].doors![0]
    expect(door.id).toBe('door-fixed-1')
    expect(door.doorType).toBe('double')
    expect(door.width).toBe(1.8)
    expect(door.position).toEqual({ x: 5, y: 0 })
    expect(door.connectedToId).toBe('room-2')
    expect(door.metadata).toEqual({ label: 'Main entry' })
  })

  it('door.delete fails cleanly for an unknown id', () => {
    const doc = createDocWithRoom()
    const res = doorDeleteHandler.execute(doc, { doorId: 'ghost-door' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })
})
