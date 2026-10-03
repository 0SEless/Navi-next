import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { documentToGeoJSON, toPreviewFeature } from './geojson'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      floors: [{
        id: 'flr-1', level: 0, label: 'Ground', elevation: 0,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {},
        pois: [
          { id: 'poi-point', name: 'Point', category: 'other', position: { x: 1, y: 2 } },
          { id: 'poi-circle', name: 'Circle', category: 'other', geometry: { type: 'circle', center: { x: 4, y: 5 }, radius: 2 } },
          { id: 'poi-rectangle', name: 'Rectangle', category: 'other', geometry: { type: 'rectangle', min: { x: 6, y: 7 }, max: { x: 9, y: 11 } } },
          { id: 'poi-polygon', name: 'Polygon', category: 'other', geometry: { type: 'polygon', points: [{ x: 12, y: 13 }, { x: 15, y: 13 }, { x: 15, y: 16 }] } },
        ],
      }],
    }],
    roads: [{
      id: 'rd-1', name: 'Main Road', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] },
      width: 6, surface: 'paved', type: 'arterial', metadata: {},
    }],
    panoramas: [{
      id: 'pan-1', label: 'Entrance View', position: { lat: 0, lng: 0 } as any, heading: 90,
      imageAssetId: 'img-1', hotspots: [],
    }],
    qrCheckpoints: [{
      id: 'qr-1', label: 'QR-1', position: { lat: 0.001, lng: 0.001 } as any, floor: 0, buildingId: 'bld-1', code: 'navi://test', metadata: {},
    }],
  }
}

describe('documentToGeoJSON', () => {
  it('converts buildings to GeoJSON features', () => {
    const result = documentToGeoJSON(createDoc())
    expect(result.buildings.features).toHaveLength(1)
    const f = result.buildings.features[0]
    expect(f.geometry.type).toBe('Polygon')
    expect(f.id).toBe('bld-1')
    expect(f.properties?.name).toBe('Main')
  })

  it('converts roads to LineString features', () => {
    const result = documentToGeoJSON(createDoc())
    expect(result.roads.features).toHaveLength(1)
    const f = result.roads.features[0]
    expect(f.geometry.type).toBe('LineString')
    expect(f.id).toBe('rd-1')
  })

  it('carries a navigation-only display mode into the road feature', () => {
    const doc = createDoc()
    ;(doc.roads[0] as any).displayMode = 'navigation-only'
    const result = documentToGeoJSON(doc)
    expect(result.roads.features[0].properties?.displayMode).toBe('navigation-only')
  })

  it('converts panoramas to Point features', () => {
    const result = documentToGeoJSON(createDoc())
    expect(result.panoramas.features).toHaveLength(1)
    const f = result.panoramas.features[0]
    expect(f.geometry.type).toBe('Point')
    expect(f.id).toBe('pan-1')
  })

  it('converts QR checkpoints to Point features', () => {
    const result = documentToGeoJSON(createDoc())
    expect(result.qr.features).toHaveLength(1)
    const f = result.qr.features[0]
    expect(f.geometry.type).toBe('Point')
    expect(f.properties?.code).toBe('navi://test')
  })

  it('renders every canonical POI geometry as a point or display polygon', () => {
    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 0, lng: 0 }, rotation: 0 })
    transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })

    const result = documentToGeoJSON(createDoc(), { transformer })
    expect(result.pois.features).toHaveLength(4)
    expect(result.pois.features.map(feature => feature.geometry.type)).toEqual([
      'Point', 'Polygon', 'Polygon', 'Polygon',
    ])
    expect(result.pois.features.map(feature => feature.properties?.geometryType)).toEqual([
      'point', 'circle', 'rectangle', 'polygon',
    ])
    const polygon = result.pois.features.find(feature => feature.id === 'poi-polygon')!
    expect(polygon.geometry.type).toBe('Polygon')
    expect((polygon.geometry as GeoJSON.Polygon).coordinates[0][0]).toEqual(
      (polygon.geometry as GeoJSON.Polygon).coordinates[0].at(-1),
    )
  })

  it('emits resolved appearance mode, height, and building-plus-floor extrusion base', () => {
    const doc = createDoc()
    doc.buildings[0].baseElevation = 12
    doc.buildings[0].floors[0].elevation = 2
    ;(doc.buildings[0].floors[0].pois![2] as any).appearance = { mode: '2.5d', height: 4.5 }

    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 0, lng: 0 }, rotation: 0 })
    transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })

    const result = documentToGeoJSON(doc, { transformer })
    const point = result.pois.features.find(feature => feature.id === 'poi-point')!
    const circle = result.pois.features.find(feature => feature.id === 'poi-circle')!
    const rectangle = result.pois.features.find(feature => feature.id === 'poi-rectangle')!

    expect(point.properties).toMatchObject({ appearanceMode: 'marker' })
    expect(circle.properties).toMatchObject({ appearanceMode: '2d' })
    expect(rectangle.properties).toMatchObject({ appearanceMode: '2.5d', appearanceHeight: 4.5, base_elevation: 14 })
  })

  it('returns empty collections for entities without data', () => {
    const doc = createDoc()
    doc.buildings = []
    doc.roads = []
    doc.panoramas = []
    doc.qrCheckpoints = []
    const result = documentToGeoJSON(doc)
    expect(result.buildings.features).toHaveLength(0)
    expect(result.rooms.features).toHaveLength(0)
    expect(result.hallways.features).toHaveLength(0)
    expect(result.roads.features).toHaveLength(0)
  })
})

describe('documentToGeoJSON — outdoor/campus POIs', () => {
  function outdoorDoc(): CampusDocument {
    const doc = createDoc()
    doc.pois = [
      {
        id: 'poi-guard-post',
        name: 'Guard Post',
        category: 'other',
        scope: 'outdoor',
        geometry: { type: 'point', position: { lat: 14.01, lng: 121.01 } },
      },
      {
        id: 'poi-garden',
        name: 'Garden',
        category: 'other',
        scope: 'outdoor',
        geometry: { type: 'circle', center: { lat: 14.02, lng: 121.02 }, radius: 10 },
      },
      {
        id: 'poi-parking',
        name: 'Parking',
        category: 'other',
        scope: 'outdoor',
        geometry: {
          type: 'rectangle',
          points: [
            { lat: 14.03, lng: 121.03 },
            { lat: 14.03, lng: 121.031 },
            { lat: 14.031, lng: 121.031 },
            { lat: 14.031, lng: 121.03 },
          ],
        },
        appearance: { mode: '2.5d', height: 3.5 },
      },
      {
        id: 'poi-plaza',
        name: 'Plaza',
        category: 'other',
        scope: 'outdoor',
        geometry: {
          type: 'polygon',
          points: [
            { lat: 14.04, lng: 121.04 },
            { lat: 14.041, lng: 121.04 },
            { lat: 14.041, lng: 121.041 },
          ],
        },
        appearance: { mode: '2.5d', height: 2 },
      },
    ]
    // Remove indoor POIs so the assertion only sees outdoor features.
    doc.buildings[0].floors[0].pois = []
    return doc
  }

  it('emits every outdoor geometry as a world-space feature without a transformer', () => {
    const result = documentToGeoJSON(outdoorDoc())

    expect(result.pois.features).toHaveLength(4)
    expect(result.pois.features.map(feature => feature.geometry.type)).toEqual([
      'Point', 'Polygon', 'Polygon', 'Polygon',
    ])
    expect(result.pois.features.every(feature => feature.properties?.scope === 'outdoor')).toBe(true)

    const point = result.pois.features.find(feature => feature.id === 'poi-guard-post')!
    expect(point.geometry).toEqual({ type: 'Point', coordinates: [121.01, 14.01] })
    expect(point.properties).toMatchObject({ entityType: 'poi', geometryType: 'point', appearanceMode: 'marker' })

    const circle = result.pois.features.find(feature => feature.id === 'poi-garden')!
    expect(circle.properties).toMatchObject({ geometryType: 'circle', appearanceMode: '2d' })
    expect((circle.geometry as GeoJSON.Polygon).coordinates[0].length).toBeGreaterThan(3)

    const parking = result.pois.features.find(feature => feature.id === 'poi-parking')!
    expect(parking.properties).toMatchObject({ geometryType: 'rectangle', appearanceMode: '2.5d', appearanceHeight: 3.5, base_elevation: 0 })

    const plaza = result.pois.features.find(feature => feature.id === 'poi-plaza')!
    expect(plaza.properties).toMatchObject({ geometryType: 'polygon', appearanceMode: '2.5d' })
    expect((plaza.geometry as GeoJSON.Polygon).coordinates[0][0]).toEqual((plaza.geometry as GeoJSON.Polygon).coordinates[0].at(-1))
  })

  it('keeps indoor and outdoor POIs in the same source with distinct scope and coordinate spaces', () => {
    const doc = outdoorDoc()
    doc.buildings[0].floors[0].pois = [
      { id: 'poi-indoor', name: 'Indoor', category: 'other', position: { x: 1, y: 2 } },
    ]
    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 0, lng: 0 }, rotation: 0 })
    transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })

    const result = documentToGeoJSON(doc, { transformer })
    const indoor = result.pois.features.find(feature => feature.id === 'poi-indoor')!
    const outdoor = result.pois.features.find(feature => feature.id === 'poi-guard-post')!

    expect(indoor.properties?.scope).toBeUndefined()
    expect(indoor.properties?.buildingId).toBe('bld-1')
    expect(outdoor.properties?.scope).toBe('outdoor')
    expect(outdoor.properties?.buildingId).toBeUndefined()
    expect(outdoor.properties?.floor).toBeUndefined()
  })

  it('carries showOnMap visibility for indoor and outdoor POI features', () => {
    const doc = outdoorDoc()
    doc.buildings[0].floors[0].pois = [{
      id: 'poi-indoor',
      name: 'Indoor',
      category: 'other',
      position: { x: 1, y: 2 },
      visibility: { showOnMap: false, searchable: true },
    }]
    ;(doc.pois![0] as any).visibility = { showOnMap: false, searchable: true }

    const transformer = new CoordinateTransformer()
    transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 0, lng: 0 }, rotation: 0 })
    transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })

    const result = documentToGeoJSON(doc, { transformer })
    const indoor = result.pois.features.find(feature => feature.id === 'poi-indoor')!
    const outdoor = result.pois.features.find(feature => feature.id === 'poi-guard-post')!

    expect(indoor.properties?.showOnMap).toBe(false)
    expect(outdoor.properties?.showOnMap).toBe(false)

    const visible = result.pois.features.find(feature => feature.id === 'poi-garden')!
    expect(visible.properties?.showOnMap).toBe(true)
  })
})

describe('toPreviewFeature', () => {
  it('wraps geometry in a Feature', () => {
    const geom: GeoJSON.LineString = { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    const f = toPreviewFeature(geom)
    expect(f.type).toBe('Feature')
    expect(f.geometry).toEqual(geom)
  })

  it('includes properties', () => {
    const geom: GeoJSON.Point = { type: 'Point', coordinates: [0, 0] }
    const f = toPreviewFeature(geom, { temp: true })
    expect(f.properties?.temp).toBe(true)
  })
})
