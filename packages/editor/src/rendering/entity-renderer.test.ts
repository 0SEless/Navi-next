import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EntityRenderer } from './entity-renderer'
import { DocumentEventBus } from '../eventbus'
import { documentToGeoJSON } from './geojson'
import { SOURCE_IDS } from './layers'

vi.mock('./geojson', () => ({
  documentToGeoJSON: vi.fn().mockReturnValue({
    buildings: { type: 'FeatureCollection', features: [] },
    rooms: { type: 'FeatureCollection', features: [] },
    hallways: { type: 'FeatureCollection', features: [] },
    roads: { type: 'FeatureCollection', features: [] },
    entrances: { type: 'FeatureCollection', features: [] },
    staircases: { type: 'FeatureCollection', features: [] },
    elevators: { type: 'FeatureCollection', features: [] },
    panoramas: { type: 'FeatureCollection', features: [] },
    qr: { type: 'FeatureCollection', features: [] },
    pois: { type: 'FeatureCollection', features: [] },
  }),
  toPreviewFeature: vi.fn((geom: any) => ({ type: 'Feature', geometry: geom })),
}))

function createMockMap() {
  const sourceData = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  return {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    loaded: vi.fn().mockReturnValue(true),
    getSource: vi.fn((id: string) => sourceData.get(id)),
    addSource: vi.fn((id: string, _: any) => {
      sourceData.set(id, { setData: vi.fn() })
    }),
    removeSource: vi.fn((id: string) => sourceData.delete(id)),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    getLayer: vi.fn().mockReturnValue(undefined),
    setLayoutProperty: vi.fn(),
  }
}

function createOptions(map: ReturnType<typeof createMockMap>) {
  const eventBus = new DocumentEventBus()
  return {
    map: map as any,
    document: { metadata: { campusId: 'test', name: 'test' } } as any,
    eventBus,
    selection: { on: vi.fn() } as any,
    viewport: { on: vi.fn() } as any,
  }
}

describe('EntityRenderer', () => {
  let map: ReturnType<typeof createMockMap>
  let renderer: EntityRenderer
  let options: ReturnType<typeof createOptions>

  beforeEach(() => {
    vi.clearAllMocks()
    map = createMockMap()
    options = createOptions(map)
    renderer = new EntityRenderer(options)
  })

  it('stores options on construction', () => {
    expect(renderer).toBeInstanceOf(EntityRenderer)
  })

  it('init() adds sources and layers when map is loaded', () => {
    renderer.init()
    expect(map.addSource).toHaveBeenCalled()
    expect(map.addLayer).toHaveBeenCalled()
  })

  it('adds a hidden diagnostic layer for navigation-only roads', () => {
    renderer.init()
    const diagnosticLayer = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .find((layer: any) => layer.id === 'navi-navigation-only-road')
    expect(diagnosticLayer).toMatchObject({
      filter: ['==', ['get', 'displayMode'], 'navigation-only'],
      layout: { visibility: 'none' },
    })
  })

  it('adds point and polygon layers for the shared POI source', () => {
    renderer.init()
    const poiLayers = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .filter((layer: any) => ['navi-poi-icon', 'navi-poi-fill', 'navi-poi-extrusion', 'navi-poi-outline'].includes(layer.id))

    expect(poiLayers).toHaveLength(4)
    expect(poiLayers.every((layer: any) => layer.source === 'navi-pois')).toBe(true)
    expect(poiLayers.find((layer: any) => layer.id === 'navi-poi-fill')?.type).toBe('fill')
    expect(poiLayers.find((layer: any) => layer.id === 'navi-poi-extrusion')?.type).toBe('fill-extrusion')
    expect(poiLayers.find((layer: any) => layer.id === 'navi-poi-outline')?.type).toBe('line')
  })

  it('keeps the shared POI source scoped to the active floor', () => {
    const activeFloorFeature = {
      type: 'Feature', id: 'poi-ground', properties: { id: 'poi-ground', floor: 0 },
      geometry: { type: 'Point', coordinates: [0, 0] },
    }
    const otherFloorFeature = {
      type: 'Feature', id: 'poi-upper', properties: { id: 'poi-upper', floor: 1 },
      geometry: { type: 'Point', coordinates: [1, 1] },
    }
    vi.mocked(documentToGeoJSON).mockReturnValueOnce({
      pois: { type: 'FeatureCollection', features: [activeFloorFeature, otherFloorFeature] },
    } as any)

    renderer.init()

    expect(map.getSource(SOURCE_IDS.POIS)?.setData).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [activeFloorFeature],
    })
  })

  it('keeps outdoor/campus POIs visible on every active floor without unfiltering indoor POIs', () => {
    const outdoorFeature = {
      type: 'Feature', id: 'poi-guard-post',
      properties: { id: 'poi-guard-post', scope: 'outdoor' },
      geometry: { type: 'Point', coordinates: [2, 2] },
    }
    const upperFloorFeature = {
      type: 'Feature', id: 'poi-upper', properties: { id: 'poi-upper', floor: 1 },
      geometry: { type: 'Point', coordinates: [1, 1] },
    }
    vi.mocked(documentToGeoJSON).mockReturnValueOnce({
      pois: { type: 'FeatureCollection', features: [outdoorFeature, upperFloorFeature] },
    } as any)

    renderer.init()

    expect(map.getSource(SOURCE_IDS.POIS)?.setData).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [outdoorFeature],
    })
  })

  it('can reveal the navigation-only diagnostic layer without changing its data', () => {
    renderer.init()
    map.getLayer.mockImplementation((id: string) => id === 'navi-navigation-only-road' ? ({ id } as any) : undefined)
    ;(renderer as any).setShowNavigationOnlyRoutes(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('navi-navigation-only-road', 'visibility', 'visible')
  })

  it('init() registers load listener when map is not loaded', () => {
    map.loaded.mockReturnValue(false)
    renderer.init()
    // Code uses map.once('load', bootstrap) for the one-shot load handler
    expect(map.once).toHaveBeenCalledWith('load', expect.any(Function))
    // Also registers map.on('style.load', ...) for style reloads
    expect(map.on).toHaveBeenCalledWith('style.load', expect.any(Function))
  })

  it('init() does not run twice', () => {
    renderer.init()
    map.addSource.mockClear()
    renderer.init()
    expect(map.addSource).not.toHaveBeenCalled()
  })

  it('syncAll() updates sources from document', () => {
    renderer.init()
    expect(documentToGeoJSON).toHaveBeenCalled()
  })

  it('destroy() removes all layers and sources', () => {
    // Mock getLayer/getSource to return truthy so destroy() calls removeLayer/removeSource
    map.getLayer.mockReturnValue({ id: 'layer' } as any)
    renderer.init()
    map.removeLayer.mockClear()
    map.removeSource.mockClear()
    renderer.destroy()
    expect(map.removeLayer).toHaveBeenCalled()
    expect(map.removeSource).toHaveBeenCalled()
  })

  it('setPreview() updates preview source', () => {
    renderer.init()
    const geo = { type: 'Point' as const, coordinates: [0, 0] }
    renderer.setPreview(geo)
    const previewSource = map.getSource('navi-preview')
    expect(previewSource?.setData).toHaveBeenCalled()
  })

  it('clearPreview() updates preview source with empty collection', () => {
    renderer.init()
    renderer.clearPreview()
    const previewSource = map.getSource('navi-preview')
    expect(previewSource?.setData).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [],
    })
  })

  it('updateSelection() updates selection source', () => {
    renderer.init()
    renderer.updateSelection([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]])
    const selSource = map.getSource('navi-selection')
    expect(selSource?.setData).toHaveBeenCalled()
  })

  it('entity.created event triggers syncAll', () => {
    const spy = vi.spyOn(renderer, 'syncAll' as any)
    renderer.init()
    spy.mockClear()
    options.eventBus.emit('entity.created', { entityId: 'bld-1', entityType: 'building' })
    expect(spy).toHaveBeenCalled()
  })

  it('document.changed event triggers syncAll for history undo/redo', () => {
    const spy = vi.spyOn(renderer, 'syncAll' as any)
    renderer.init()
    spy.mockClear()
    options.eventBus.emit('document.changed', { version: 2 })
    expect(spy).toHaveBeenCalled()
  })
})
