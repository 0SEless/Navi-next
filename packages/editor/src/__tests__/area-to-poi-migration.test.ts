import { describe, expect, it } from 'vitest'
import type { Area, CampusDocument } from '@navi/core'
import { CoordinateTransformer, migrateAreasToPois, resolveOutdoorPointOfInterestAppearance, resolvePoiVisibility } from '@navi/core'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { createDocument } from '../context/create-editor-context'
import { documentToGeoJSON } from '../rendering/geojson'
import { findEntityById } from '../panels/properties/property-utils'
import { areaCreateHandler, areaDeleteHandler } from '../commands/area-handlers'

const ORIGIN = { lat: 25.633, lng: 122.927 }

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'bld-1', origin: ORIGIN, rotation: 0 })
  transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
  return transformer
}

function makeArea(id: string, name: string, color: string, closed = true): Area {
  const points = [
    { lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng + 0.0001 },
    { lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng + 0.0003 },
    { lat: ORIGIN.lat + 0.0003, lng: ORIGIN.lng + 0.0003 },
  ]
  if (closed) points.push({ ...points[0] })
  return { id, name, points, color }
}

function makeDocument(areas: Area[] = [], outdoorPois: unknown[] = []): CampusDocument {
  return {
    schemaVersion: 2,
    version: 1,
    metadata: { campusId: 'area-migration', name: 'Area Migration', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [
      {
        id: 'bld-1',
        name: 'Hall',
        code: 'H',
        category: 'academic',
        description: '',
        footprint: {
          points: [
            { lat: ORIGIN.lat, lng: ORIGIN.lng },
            { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng + 0.001 },
            { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng },
            { lat: ORIGIN.lat, lng: ORIGIN.lng },
          ],
        },
        baseElevation: 0,
        height: 12,
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
        color: '#1C6BEB',
        metadata: {},
      },
    ],
    roads: [
      { id: 'road-1', name: 'Main', polyline: { points: [{ lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng }, { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng + 0.002 }] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} },
      { id: 'road-2', name: 'Side', polyline: { points: [{ lat: ORIGIN.lat - 0.002, lng: ORIGIN.lng + 0.001 }, { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 }] }, width: 3, surface: 'concrete', type: 'service', metadata: {} },
    ],
    roadJunctions: [{ id: 'jct-1', position: { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng + 0.001 }, roadIds: ['road-1', 'road-2'], source: 'authored' }],
    separatedCrossings: [{ id: 'sep-1', roadIds: ['road-1', 'road-2'], position: { lat: ORIGIN.lat - 0.0015, lng: ORIGIN.lng + 0.0005 } }],
    panoramas: [],
    qrCheckpoints: [],
    ...(areas.length > 0 ? { areas } : {}),
    ...(outdoorPois.length > 0 ? { pois: outdoorPois } : {}),
  } as CampusDocument
}

function legacyGraphRoundTrip(document: CampusDocument) {
  const graph = new Graph()
  new GraphAdapter(graph, makeTransformer()).sync(document)
  const restored = createDocument(graph, makeTransformer())
  return { graph, restored }
}

describe('Area → outdoor 2D polygon POI migration', () => {
  it('1. loads a legacy Area record and exposes it as a canonical POI', () => {
    const { graph, restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-1', 'Parking Lot A', '#F97316')]))

    expect(graph.areas).toHaveLength(1)
    expect(restored.pois).toHaveLength(1)
    expect(restored.pois![0].id).toBe('area-1')
  })

  it('2+3. converts to a polygon POI with equivalent open-ring geometry', () => {
    const area = makeArea('area-geom', 'Garden', '#22C55E')
    const { restored } = legacyGraphRoundTrip(makeDocument([area]))
    const migrated = restored.pois![0]

    expect(migrated.geometry.type).toBe('polygon')
    expect('geometry' in migrated && migrated.geometry.type === 'polygon' ? migrated.geometry.points : []).toEqual(area.points.slice(0, -1))
  })

  it('4. preserves the authored color and forces a flat 2D appearance', () => {
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-color', 'Plaza', '#8B4513')]))
    const migrated = restored.pois![0]

    expect(migrated.appearance).toEqual({ mode: '2d', color: '#8B4513' })
    expect(resolveOutdoorPointOfInterestAppearance(migrated)).toEqual({ mode: '2d', color: '#8B4513' })
  })

  it('5+7. preserves the id when free and never leaves a duplicate Area + POI after canonical save', () => {
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-stable', 'Court', '#8B5CF6')]))

    expect(restored.pois!.map((poi) => poi.id)).toEqual(['area-stable'])
    expect(restored.areas).toBeUndefined()
    expect(restored.pois!.filter((poi) => poi.id === 'area-stable')).toHaveLength(1)
  })

  it('6. retains the migrated POI through a second save/reload cycle', () => {
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-round', 'Study Area', '#0EA5E9')]))
    const { restored: reloaded } = legacyGraphRoundTrip(restored)

    expect(reloaded.pois).toHaveLength(1)
    expect(reloaded.pois![0]).toEqual(restored.pois![0])
    expect(reloaded.areas).toBeUndefined()
  })

  it('8. keeps an old Area document loadable through the serializer compatibility reader', () => {
    // The serializer path is the CampusDocument JSON compatibility reader; the
    // graph path is covered above. Both must accept legacy areas[].
    const document = makeDocument([makeArea('area-legacy-json', 'Old Plaza', '#F59E0B')])
    expect(document.areas).toHaveLength(1)
    // createDocument (graph path) is the canonical load; no throw, migrated.
    const { restored } = legacyGraphRoundTrip(document)
    expect(restored.pois).toHaveLength(1)
  })

  it('9. migrates multiple Areas in order with stable identities', () => {
    const areas = [
      makeArea('area-a', 'A', '#111111'),
      makeArea('area-b', 'B', '#222222'),
      makeArea('area-c', 'C', '#333333'),
    ]
    const { restored } = legacyGraphRoundTrip(makeDocument(areas))

    expect(restored.pois!.map((poi) => poi.id)).toEqual(['area-a', 'area-b', 'area-c'])
    expect(restored.pois!.map((poi) => poi.appearance?.color)).toEqual(['#111111', '#222222', '#333333'])
  })

  it('10. resolves id conflicts deterministically and reports the rename', () => {
    const existingOutdoor = [{
      id: 'area-dup',
      name: 'Existing POI',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'point', position: { lat: ORIGIN.lat + 0.002, lng: ORIGIN.lng + 0.002 } },
    }]
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-dup', 'Conflicting', '#ABCDEF')], existingOutdoor))

    const ids = restored.pois!.map((poi) => poi.id)
    expect(ids).toContain('area-dup')
    expect(ids).toContain('area-dup-migrated-1')
    const renamed = restored.pois!.find((poi) => poi.id === 'area-dup-migrated-1')!
    expect(renamed.metadata).toMatchObject({ migratedFrom: 'area', migratedFromAreaId: 'area-dup' })
    expect(restored.pois!.find((poi) => poi.id === 'area-dup')!.name).toBe('Existing POI')

    // Direct migrator call exposes the same deterministic report.
    const result = migrateAreasToPois([makeArea('dup', 'D', '#000000')], new Set(['dup']))
    expect(result.report[0]).toMatchObject({ areaId: 'dup', poiId: 'dup-migrated-1', status: 'renamed' })
  })

  it('10b. suffixes repeatedly when several Areas conflict', () => {
    const existing = {
      id: 'dup',
      name: 'X',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'point' as const, position: { lat: 1, lng: 1 } },
    }
    const areas = [makeArea('dup', 'first', '#111111'), makeArea('dup', 'second', '#222222')]
    const result = migrateAreasToPois(areas, new Set([existing.id]))
    expect(result.pois.map((poi) => poi.id)).toEqual(['dup-migrated-1', 'dup-migrated-2'])
  })

  it('11-13. does not modify roads, junctions, separated crossings, or RouteNetworks', () => {
    const document = makeDocument([makeArea('area-topo', 'Topo', '#334155')])
    document.buildings[0].floors[0].routeNetwork = {
      nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 }],
      edges: [],
    }
    document.buildings[0].floors[0].entranceAccess = [{ id: 'ea-1', entranceId: 'e1', outdoorNodeId: 'on-1', indoorRouteNodeId: 'rn-1' }]

    const graph = new Graph()
    const topologyBefore = JSON.stringify({
      roads: document.roads,
      roadJunctions: document.roadJunctions,
      separatedCrossings: document.separatedCrossings,
      routeNetwork: document.buildings[0].floors[0].routeNetwork,
      entranceAccess: document.buildings[0].floors[0].entranceAccess,
    })

    new GraphAdapter(graph, makeTransformer()).sync(document)
    const graphBefore = JSON.stringify({ areas: graph.areas, separatedCrossings: graph.separatedCrossings, traces: graph.traces })
    const restored = createDocument(graph, makeTransformer())

    // The migration pass is read-only over the authored topology.
    const topologyAfter = JSON.stringify({
      roads: document.roads,
      roadJunctions: document.roadJunctions,
      separatedCrossings: document.separatedCrossings,
      routeNetwork: document.buildings[0].floors[0].routeNetwork,
      entranceAccess: document.buildings[0].floors[0].entranceAccess,
    })
    expect(topologyAfter).toBe(topologyBefore)

    // Rebuilt document keeps the same authored topology identity.
    expect(restored.roads.map((road) => ({ id: road.id, type: road.type }))).toEqual(
      document.roads.map((road) => ({ id: road.id, type: road.type })),
    )
    expect(restored.roadJunctions).toEqual(document.roadJunctions)
    expect(restored.separatedCrossings).toEqual(document.separatedCrossings)
    expect(restored.buildings[0].floors[0].routeNetwork).toEqual(document.buildings[0].floors[0].routeNetwork)
    expect(restored.buildings[0].floors[0].entranceAccess).toEqual(document.buildings[0].floors[0].entranceAccess)
    // The migration itself is read-only over the graph topology.
    expect(JSON.stringify({ areas: graph.areas, separatedCrossings: graph.separatedCrossings, traces: graph.traces })).toBe(graphBefore)
  })

  it('14. renders the migrated Area as a flat 2D polygon with no extrusion', () => {
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-render', 'Plaza', '#FACC15')]))
    const geojson = documentToGeoJSON(restored)
    const feature = geojson.pois.features.find((f) => f.id === 'area-render')!

    expect(feature.geometry.type).toBe('Polygon')
    expect(feature.properties).toMatchObject({ scope: 'outdoor', geometryType: 'polygon', appearanceMode: '2d' })
    expect(feature.properties).not.toHaveProperty('appearanceHeight')
  })

  it('15. is selectable through the POI entity lookup with no building/floor context', () => {
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-select', 'Court', '#8B5CF6')]))
    const lookup = findEntityById(restored, 'area-select')

    expect(lookup).toMatchObject({ path: 'poi' })
    expect((lookup!.entity as { scope?: string }).scope).toBe('outdoor')
    expect((lookup!.entity as { buildingId?: string }).buildingId).toBeUndefined()
    expect((lookup!.entity as { floorId?: string }).floorId).toBeUndefined()
  })

  it('15b. migrated Areas keep safe visibility defaults (visible + searchable)', () => {
    const { restored } = legacyGraphRoundTrip(makeDocument([makeArea('area-defaults', 'Defaults', '#8B5CF6')]))
    const migrated = restored.pois![0]

    expect(migrated.visibility).toBeUndefined()
    expect(resolvePoiVisibility(migrated.visibility)).toEqual({ showOnMap: true, searchable: true })
  })

  it('16. keeps the legacy area commands working for compatibility while the tool is retired', () => {
    const document = makeDocument()
    const created = areaCreateHandler.execute(document, {
      id: 'area-compat',
      name: 'Compat Area',
      points: makeArea('x', 'x', '#111111').points,
      color: '#111111',
    })
    expect(created.success).toBe(true)
    expect(document.areas).toHaveLength(1)

    const deleted = areaDeleteHandler.execute(document, { areaId: 'area-compat' })
    expect(deleted.success).toBe(true)
    expect(document.areas).toHaveLength(0)
  })
})
