import { describe, expect, it } from 'vitest'
import type { Building, CampusDocument, WorldPOIGeometry } from '@navi/core'
import { resolveOutdoorPointOfInterestAppearance } from '@navi/core'
import { poiCreateHandler, poiDeleteHandler, poiUpdateHandler } from '../feature-handlers'

const latLng = (lat: number, lng: number) => ({ lat, lng })

const POINT: WorldPOIGeometry = { type: 'point', position: latLng(25.6328, 122.9278) }
const CIRCLE: WorldPOIGeometry = { type: 'circle', center: latLng(25.6328, 122.9278), radius: 9.5 }
const RECTANGLE: WorldPOIGeometry = {
  type: 'rectangle',
  points: [latLng(25.632, 122.927), latLng(25.632, 122.928), latLng(25.633, 122.928), latLng(25.633, 122.927)],
}
const POLYGON: WorldPOIGeometry = {
  type: 'polygon',
  points: [latLng(25.632, 122.927), latLng(25.633, 122.927), latLng(25.633, 122.928)],
}

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

function createOutdoor(doc: CampusDocument, geometry: WorldPOIGeometry, overrides: Record<string, unknown> = {}) {
  return poiCreateHandler.execute(doc, {
    id: 'poi-outdoor-1',
    scope: 'outdoor',
    name: 'Guard Post',
    category: 'other',
    geometry,
    metadata: { source: 'test' },
    ...overrides,
  })
}

describe('Outdoor POI command handlers', () => {
  it.each([
    ['point', POINT, 'marker'],
    ['circle', CIRCLE, '2d'],
    ['rectangle', RECTANGLE, '2d'],
    ['polygon', POLYGON, '2d'],
  ] as const)('creates an outdoor %s POI in CampusDocument.pois only', (_kind, geometry, mode) => {
    const doc = createTestDoc()
    const result = createOutdoor(doc, geometry)

    expect(result.success).toBe(true)
    expect(doc.pois).toHaveLength(1)
    const poi = doc.pois![0]
    expect(poi).toMatchObject({ id: 'poi-outdoor-1', name: 'Guard Post', category: 'other', scope: 'outdoor' })
    expect(poi.geometry).toEqual(geometry)
    // Indoor canonical collection is untouched.
    expect(doc.buildings[0].floors[0].pois ?? []).toHaveLength(0)

    // Appearance resolution mirrors the indoor contract (marker for point, 2d for shapes).
    expect(poi.appearance).toBeUndefined()
    expect(resolveOutdoorPointOfInterestAppearance(poi)).toEqual({ mode })
  })

  it('accepts explicit 2D/2.5D appearances for outdoor shapes and rejects marker', () => {
    const doc = createTestDoc()
    expect(createOutdoor(doc, CIRCLE, { appearance: { mode: '2.5d', height: 6 } }).success).toBe(true)
    expect(doc.pois![0].appearance).toEqual({ mode: '2.5d', height: 6 })

    const other = createTestDoc()
    expect(createOutdoor(other, CIRCLE, { appearance: { mode: 'marker' } }).success).toBe(false)
    expect(createOutdoor(other, POINT, { appearance: { mode: '2.5d', height: 3 } }).success).toBe(false)
    expect(createOutdoor(other, CIRCLE, { appearance: { mode: '2.5d', height: 0 } }).success).toBe(false)
  })

  it('rejects building/floor context, the indoor position form, and invalid world geometry', () => {
    const doc = createTestDoc()
    expect(createOutdoor(doc, POINT, { buildingId: 'bld-1' }).success).toBe(false)
    expect(createOutdoor(doc, POINT, { floorId: 'flr-0' }).success).toBe(false)
    expect(createOutdoor(doc, POINT, { position: { x: 1, y: 2 } }).success).toBe(false)
    expect(createOutdoor(doc, { type: 'circle', center: latLng(0, 0), radius: 0 } as WorldPOIGeometry).success).toBe(false)
    expect(createOutdoor(doc, { type: 'point', position: latLng(Number.NaN, 0) } as WorldPOIGeometry).success).toBe(false)
    expect(createOutdoor(doc, undefined as unknown as WorldPOIGeometry, { geometry: undefined }).success).toBe(false)
    expect(createOutdoor(doc, POINT, { category: 'not-a-category' }).success).toBe(false)
    expect(doc.pois ?? []).toHaveLength(0)
  })

  it('keeps POI identity globally unique across indoor and outdoor collections', () => {
    const doc = createTestDoc()
    poiCreateHandler.execute(doc, {
      id: 'shared-id',
      buildingId: 'bld-1',
      floorId: 'flr-0',
      name: 'Indoor',
      category: 'other',
      position: { x: 1, y: 1 },
    })
    const collision = createOutdoor(doc, POINT, { id: 'shared-id' })

    expect(collision.success).toBe(false)
    expect(collision.error).toContain('POI_ID_COLLISION')
    expect(doc.pois ?? []).toHaveLength(0)
  })

  it('updates name, category, geometry, and appearance of an outdoor POI', () => {
    const doc = createTestDoc()
    createOutdoor(doc, POINT)

    const updated = poiUpdateHandler.execute(doc, {
      poiId: 'poi-outdoor-1',
      patch: { name: 'Waiting Shed', category: 'restroom', geometry: CIRCLE, appearance: { mode: '2.5d', height: 4 } },
    })

    expect(updated.success).toBe(true)
    expect(doc.pois![0]).toMatchObject({ name: 'Waiting Shed', category: 'restroom' })
    expect(doc.pois![0].geometry).toEqual(CIRCLE)
    expect(doc.pois![0].appearance).toEqual({ mode: '2.5d', height: 4 })

    // Undo restores the previous state.
    const inverse = poiUpdateHandler.inverse({ poiId: 'poi-outdoor-1' }, updated)!
    poiUpdateHandler.execute(doc, inverse.payload)
    expect(doc.pois![0]).toMatchObject({ name: 'Guard Post', category: 'other' })
    expect(doc.pois![0].geometry).toEqual(POINT)
    expect(doc.pois![0].appearance).toBeUndefined()
  })

  it('clears outdoor appearance with null and rejects the indoor position patch', () => {
    const doc = createTestDoc()
    createOutdoor(doc, CIRCLE, { appearance: { mode: '2.5d', height: 5 } })

    expect(poiUpdateHandler.execute(doc, { poiId: 'poi-outdoor-1', patch: { position: { x: 1, y: 1 } } }).success).toBe(false)
    expect(poiUpdateHandler.execute(doc, { poiId: 'poi-outdoor-1', patch: { appearance: null } }).success).toBe(true)
    expect(doc.pois![0].appearance).toBeUndefined()
  })

  it('deletes an outdoor POI and recreates it verbatim through the inverse command', () => {
    const doc = createTestDoc()
    createOutdoor(doc, POLYGON, { appearance: { mode: '2.5d', height: 7 } })

    const deleted = poiDeleteHandler.execute(doc, { poiId: 'poi-outdoor-1' })
    expect(deleted.success).toBe(true)
    expect(doc.pois).toBeUndefined()
    expect(deleted.data?.scope).toBe('outdoor')

    const inverse = poiDeleteHandler.inverse({}, deleted)!
    expect(inverse.id).toBe('poi.create')
    const restored = poiCreateHandler.execute(doc, inverse.payload)

    expect(restored.success).toBe(true)
    expect(doc.pois).toHaveLength(1)
    expect(doc.pois![0].geometry).toEqual(POLYGON)
    expect(doc.pois![0].appearance).toEqual({ mode: '2.5d', height: 7 })
  })

  it('deletes indoor POIs through the same handler without touching the outdoor collection', () => {
    const doc = createTestDoc()
    createOutdoor(doc, POINT)
    poiCreateHandler.execute(doc, {
      id: 'poi-indoor-1',
      buildingId: 'bld-1',
      floorId: 'flr-0',
      name: 'Printer',
      category: 'printer',
      position: { x: 2, y: 3 },
    })

    const deleted = poiDeleteHandler.execute(doc, { poiId: 'poi-indoor-1' })
    expect(deleted.success).toBe(true)
    expect(doc.buildings[0].floors[0].pois).toHaveLength(0)
    expect(doc.pois).toHaveLength(1)

    const inverse = poiDeleteHandler.inverse({}, deleted)!
    expect(inverse.payload).toMatchObject({ buildingId: 'bld-1', floorId: 'flr-0' })
    poiCreateHandler.execute(doc, inverse.payload)
    expect(doc.buildings[0].floors[0].pois).toHaveLength(1)
  })

  it('does not mutate roads, junctions, crossings, or route networks', () => {
    const doc = createTestDoc()
    doc.roads = [
      {
        id: 'road-1',
        name: 'Main',
        polyline: { points: [latLng(25.6, 122.9), latLng(25.61, 122.9)] },
        width: 4,
        surface: 'paved',
        type: 'arterial',
        metadata: {},
      },
    ]
    doc.roadJunctions = [{ id: 'jct-1', position: latLng(25.6, 122.9), roadIds: ['road-1'], source: 'authored' }]
    doc.separatedCrossings = [{ id: 'sep-1', roadIds: ['road-1', 'road-2'], position: latLng(25.6, 122.9) }]
    doc.buildings[0].floors[0].routeNetwork = {
      nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }],
      edges: [],
    }

    const before = JSON.stringify({
      roads: doc.roads,
      roadJunctions: doc.roadJunctions,
      separatedCrossings: doc.separatedCrossings,
      routeNetwork: doc.buildings[0].floors[0].routeNetwork,
    })

    createOutdoor(doc, POINT)
    poiUpdateHandler.execute(doc, { poiId: 'poi-outdoor-1', patch: { name: 'ATM' } })
    poiDeleteHandler.execute(doc, { poiId: 'poi-outdoor-1' })

    const after = JSON.stringify({
      roads: doc.roads,
      roadJunctions: doc.roadJunctions,
      separatedCrossings: doc.separatedCrossings,
      routeNetwork: doc.buildings[0].floors[0].routeNetwork,
    })
    expect(after).toBe(before)
  })

  it('returns the same errors as before for indoor creates (regression compat)', () => {
    const doc = createTestDoc()
    expect(poiCreateHandler.execute(doc, { floorId: 'flr-0', category: 'other', position: { x: 1, y: 1 } }).error)
      .toBe('Building not found: undefined')
    expect(poiCreateHandler.execute(doc, { buildingId: 'bld-1', category: 'other', position: { x: 1, y: 1 } }).error)
      .toBe('Floor not found: undefined')
  })

  it('keeps Areas flat and untouched while authoring outdoor POIs', () => {
    const doc = createTestDoc()
    doc.areas = [{
      id: 'area-plaza',
      name: 'Plaza',
      points: [latLng(25.6, 122.9), latLng(25.6, 122.91), latLng(25.61, 122.91)],
      color: '#8B5CF6',
    }]
    const before = JSON.stringify(doc.areas)

    createOutdoor(doc, POINT)
    createOutdoor(doc, RECTANGLE, { id: 'poi-outdoor-2' })
    poiDeleteHandler.execute(doc, { poiId: 'poi-outdoor-1' })

    expect(JSON.stringify(doc.areas)).toBe(before)
    // Area remains the existing flat entity — no POI scope/geometry/appearance.
    expect(doc.areas[0]).not.toHaveProperty('scope')
    expect(doc.areas[0]).not.toHaveProperty('geometry')
    expect(doc.areas[0]).not.toHaveProperty('appearance')
    expect(doc.pois).toHaveLength(1)
  })
})
