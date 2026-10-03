import { describe, expect, it, vi } from 'vitest'
import { CoordinateTransformer, type CampusDocument } from '@navi/core'
import { DocumentEventBus } from '../eventbus'
import { SelectionManager } from '../selection'
import { Viewport } from '../viewport'
import { EntityRenderer } from '../rendering/entity-renderer'
import { documentToGeoJSON } from '../rendering/geojson'
import { findEntityById } from '../panels/properties/property-utils'

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'test',
      name: 'POI Studio fixture',
      description: '',
      lastModified: '',
      editorVersion: '0.1.0',
    },
    buildings: [{
      id: 'bld-1',
      name: 'Main',
      code: 'MAIN',
      category: 'academic',
      description: '',
      footprint: {
        points: [
          { lat: 14, lng: 121 },
          { lat: 14, lng: 121.001 },
          { lat: 14.001, lng: 121.001 },
          { lat: 14.001, lng: 121 },
          { lat: 14, lng: 121 },
        ],
      },
      baseElevation: 0,
      height: 20,
      color: '#4A90D9',
      aliases: [],
      metadata: {},
      verticalConnectors: [],
      floors: [{
        id: 'floor-1',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 3.5,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        parametricComponents: [],
        pois: [{
          id: 'poi-1',
          name: 'Study Table',
          category: 'study_area',
          position: { x: 12, y: -4 },
          metadata: { source: '3a-test' },
        }],
      }],
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  } as CampusDocument
}

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({
    buildingId: 'bld-1',
    origin: { lat: 14, lng: 121 },
    rotation: 0,
  })
  transformer.registerFloor('bld-1', 0, {
    offset: { x: 8, y: -4 },
    rotation: 20,
  })
  return transformer
}

function makeMap() {
  const sources: Record<string, any> = {}
  const layers = new Set<string>()
  const map = {
    on: vi.fn(),
    loaded: () => true,
    getSource: vi.fn((id: string) => sources[id] ?? null),
    addSource: vi.fn((id: string, definition: any) => {
      const source = {
        ...definition,
        setData: (data: any) => { source.data = data },
      }
      sources[id] = source
    }),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : null),
    addLayer: vi.fn((definition: { id: string }) => { layers.add(definition.id) }),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
  }
  return { map, sources, layers }
}

describe('Phase 3A point POI Studio seams', () => {
  it('resolves a point POI through the Inspector entity lookup', () => {
    const result = findEntityById(makeDocument(), 'poi-1')

    expect(result).toMatchObject({ path: 'poi' })
    expect(result?.entity).toMatchObject({ id: 'poi-1', name: 'Study Table' })
  })

  it('renders point POIs from floor-local coordinates through the floor transform', () => {
    const document = makeDocument()
    const transformer = makeTransformer()
    const expectedWorld = transformer.floorLocalToWorld({ x: 12, y: -4 }, 'bld-1', 0)
    const result = documentToGeoJSON(document, { transformer })

    expect(result.pois).toBeDefined()
    expect(result.pois.features).toHaveLength(1)
    expect(result.pois.features[0]).toMatchObject({
      id: 'poi-1',
      properties: {
        id: 'poi-1',
        name: 'Study Table',
        category: 'study_area',
        buildingId: 'bld-1',
        floorId: 'floor-1',
        floor: 0,
        entityType: 'poi',
      },
      geometry: {
        type: 'Point',
        coordinates: [expectedWorld!.lng, expectedWorld!.lat],
      },
    })
  })

  it('keeps the canonical renderer source populated for point POIs', () => {
    const document = makeDocument()
    const eventBus = new DocumentEventBus()
    const selection = new SelectionManager(document, eventBus)
    const viewport = new Viewport(eventBus)
    const { map } = makeMap()
    const renderer = new EntityRenderer({
      map: map as any,
      document,
      eventBus,
      selection,
      viewport,
      transformer: makeTransformer(),
    })

    renderer.init()

    const poiSource = map.getSource('navi-pois')
    expect(poiSource).not.toBeNull()
    expect(poiSource.promoteId).toBe('id')
    expect(poiSource.data.features).toHaveLength(1)
    expect(map.getLayer('navi-poi-icon')).not.toBeNull()
  })

  it('filters point POIs by the active floor without creating a second collection', () => {
    const document = makeDocument()
    document.buildings[0].floors.push({
      id: 'floor-2',
      level: 1,
      label: 'First',
      elevation: 3.5,
      height: 3.5,
      rooms: [],
      hallways: [],
      staircases: [],
      elevators: [],
      entrances: [],
      connectorStops: [],
      parametricComponents: [],
      pois: [{ id: 'poi-2', name: 'Printer', category: 'printer', position: { x: 2, y: 3 } }],
    } as any)
    const eventBus = new DocumentEventBus()
    const selection = new SelectionManager(document, eventBus)
    const viewport = new Viewport(eventBus)
    const { map } = makeMap()
    const renderer = new EntityRenderer({
      map: map as any,
      document,
      eventBus,
      selection,
      viewport,
      transformer: makeTransformer(),
    })

    renderer.init()
    expect(map.getSource('navi-pois').data.features.map((feature: any) => feature.id)).toEqual(['poi-1'])

    renderer.setActiveFloor(1)

    expect(map.getSource('navi-pois').data.features.map((feature: any) => feature.id)).toEqual(['poi-2'])
  })
})
