import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type maplibregl from 'maplibre-gl'
import { roadFillPaint, roadOutlinePaint, RoadStyle } from '@navi/core'
import type { CampusPOI, TracePath } from '@/types/nav-types'
import { AuthoredRoadLayer } from '../AuthoredRoadLayer'
import { POILayer } from '../POILayer'
import { BuildingLayer } from '../BuildingLayer'
import type { BuildingRenderData } from '@/components/map/NavigationRenderModel'

afterEach(() => {
  cleanup()
})

function makeMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn>; data: unknown }>()
  const layers = new Map<string, { id: string; [key: string]: unknown }>()
  const layerAdds: string[] = []
  const listeners = new Map<string, Set<() => void>>()
  let styleLoaded = false

  const map = {
    isStyleLoaded: vi.fn(() => styleLoaded),
    on: vi.fn((event: string, layerOrListener: string | (() => void), listener?: () => void) => {
      const handler = typeof layerOrListener === 'function' ? layerOrListener : listener
      if (handler) {
        const eventListeners = listeners.get(event) ?? new Set()
        eventListeners.add(handler)
        listeners.set(event, eventListeners)
      }
    }),
    off: vi.fn((event: string, layerOrListener: string | (() => void), listener?: () => void) => {
      const handler = typeof layerOrListener === 'function' ? layerOrListener : listener
      if (handler) listeners.get(event)?.delete(handler)
    }),
    emit(event: string) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler()
    },
    setStyleLoaded(value: boolean) {
      styleLoaded = value
    },
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, source: { data: unknown }) => {
      sources.set(id, { data: source.data, setData: vi.fn() })
    }),
    removeSource: vi.fn((id: string) => { sources.delete(id) }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((layer: { id: string; [key: string]: unknown }) => {
      layerAdds.push(layer.id)
      layers.set(layer.id, layer)
    }),
    removeLayer: vi.fn((id: string) => { layers.delete(id) }),
    triggerRepaint: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
  }
  return Object.assign(map, { layerAdds }) as unknown as maplibregl.Map & typeof map & { layerAdds: string[] }
}

describe('public MapLibre layer style readiness', () => {
  const building: BuildingRenderData = {
    id: 'campus-building', name: 'Campus building', color: '#059669', height: 9, floors: 3,
    footprint: [{ lat: 10, lng: 20 }, { lat: 10.001, lng: 20 }, { lat: 10, lng: 20.001 }, { lat: 10, lng: 20 }],
    entrances: [], nodeIds: [],
  }

  it('attaches buildings after the one-shot load already fired and sibling sources delayed readiness', () => {
    const map = makeMap()
    map.emit('load')
    const { rerender } = render(createElement(BuildingLayer, { map, buildings: [building] }))
    const updatedBuilding = { ...building, name: 'Latest campus building' }
    rerender(createElement(BuildingLayer, { map, buildings: [updatedBuilding] }))
    expect(map.getSource('buildings')).toBeUndefined()

    act(() => {
      map.setStyleLoaded(true)
      map.emit('idle')
    })

    const source = map.getSource('buildings') as maplibregl.GeoJSONSource
    expect(source).toBeDefined()
    expect(map.getLayer('buildings-fill')).toBeDefined()
    expect(map.getLayer('buildings-outline')).toBeDefined()
    expect(source.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: building.id, properties: expect.objectContaining({ name: 'Latest campus building' }) })],
    }))
  })

  it('populates buildings when load completes without requiring another React render', () => {
    const map = makeMap()
    render(createElement(BuildingLayer, { map, buildings: [building] }))
    act(() => {
      map.setStyleLoaded(true)
      map.emit('load')
    })
    const source = map.getSource('buildings') as maplibregl.GeoJSONSource
    expect(source).toBeDefined()
    expect(source.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: building.id })],
    }))
  })

  it('initializes outdoor POIs when style readiness follows a late map mount', () => {
    const map = makeMap()
    map.emit('load')
    const outdoorPoi: CampusPOI = {
      id: 'poi-outdoor-test',
      label: 'Outdoor marker',
      category: 'landmark',
      scope: 'outdoor',
      position: { lat: 10, lng: 20 },
      properties: {},
      geometry: { type: 'point', position: { lat: 10, lng: 20 } },
    }

    render(createElement(POILayer, { map, pois: [], outdoorPois: [outdoorPoi] }))
    expect(map.addSource).not.toHaveBeenCalled()

    act(() => {
      map.setStyleLoaded(true)
      map.emit('style.load')
    })

    const source = map.getSource('pois') as maplibregl.GeoJSONSource
    expect(source).toBeDefined()
    expect(map.getLayer('pois-layer')).toBeDefined()
    expect(source.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: 'poi-outdoor-test' })],
    }))
    const markerLayer = map.getLayer('pois-layer') as unknown as { filter: unknown; paint: Record<string, unknown> }
    const shapeLayer = map.getLayer('pois-outdoor-fill') as unknown as { filter: unknown; paint: Record<string, unknown> }
    const extrusionLayer = map.getLayer('pois-outdoor-extrusion') as unknown as { filter: unknown; paint: Record<string, unknown> }
    expect(markerLayer.filter).toEqual(['==', ['get', 'appearanceMode'], 'marker'])
    expect(markerLayer.paint['circle-color']).toEqual(['coalesce', ['get', 'appearanceColor'], '#F59E0B'])
    expect(shapeLayer.filter).toEqual(expect.arrayContaining([['==', ['get', 'appearanceMode'], '2d']]))
    expect(shapeLayer.paint['fill-color']).toEqual(['coalesce', ['get', 'appearanceColor'], '#F59E0B'])
    expect(extrusionLayer.type).toBe('fill-extrusion')
    expect(extrusionLayer.filter).toEqual(expect.arrayContaining([['==', ['get', 'appearanceMode'], '2.5d']]))
    expect(extrusionLayer.paint['fill-extrusion-height']).toEqual(['get', 'appearanceHeight'])
    expect(map.layerAdds.indexOf('pois-outdoor-fill')).toBeLessThan(map.layerAdds.indexOf('pois-outdoor-extrusion'))
    expect(map.layerAdds.indexOf('pois-outdoor-extrusion')).toBeLessThan(map.layerAdds.indexOf('pois-outdoor-outline'))
    expect(map.layerAdds.indexOf('pois-outdoor-outline')).toBeLessThan(map.layerAdds.indexOf('pois-layer'))
  })

  it('initializes authored roads when style readiness follows a late map mount', () => {
    const map = makeMap()
    map.emit('load')
    const trace: TracePath = {
      id: 'trace-outdoor-test',
      name: 'Campus path',
      type: 'arterial',
      roadType: 'arterial',
      floor: 0,
      points: [{ lat: 10, lng: 20 }, { lat: 10.001, lng: 20.001 }],
      displayMode: 'visible',
      width: 12,
      color: '#2563EB',
    }

    render(createElement(AuthoredRoadLayer, { map, traces: [trace] }))
    expect(map.addSource).not.toHaveBeenCalled()

    act(() => {
      map.setStyleLoaded(true)
      map.emit('style.load')
    })

    const source = map.getSource('authored-roads') as maplibregl.GeoJSONSource
    expect(source).toBeDefined()
    expect(map.getLayer('authored-roads-outline')).toBeDefined()
    expect(map.getLayer('authored-roads-fill')).toBeDefined()
    expect(source.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: 'trace-outdoor-test' })],
    }))

    const outline = map.getLayer('authored-roads-outline') as unknown as { paint: Record<string, unknown> }
    const fill = map.getLayer('authored-roads-fill') as unknown as { paint: Record<string, unknown> }
    const path = map.getLayer('authored-roads-path') as unknown as { paint: Record<string, unknown> }
    expect(outline.paint).toMatchObject(roadOutlinePaint())
    expect(fill.paint['line-width']).toEqual(roadFillPaint()['line-width'])
    expect(fill.paint['line-opacity']).toBe(roadFillPaint()['line-opacity'])
    expect(fill.paint['line-color']).toEqual([
      'case', ['all', ['has', 'color'], ['!=', ['get', 'color'], '']], ['get', 'color'], RoadStyle.fillColor,
    ])
    expect(path.paint).toEqual({ 'line-color': '#64748B', 'line-width': 2, 'line-opacity': 0.7 })
    expect(map.layerAdds.indexOf('authored-roads-outline')).toBeLessThan(map.layerAdds.indexOf('authored-roads-fill'))
  })

  it('keeps canonical pedestrian traces separate and omits navigation-only traces', () => {
    const map = makeMap()
    const traces: TracePath[] = [
      {
        id: 'road-main', name: 'Main road', type: 'arterial', roadType: 'arterial', floor: 0,
        points: [{ lat: 10, lng: 20 }, { lat: 10.001, lng: 20.001 }], displayMode: 'visible', width: 14,
      },
      {
        id: 'path-walk', name: 'Walkway', type: 'connector', roadType: 'pedestrian', floor: 0,
        points: [{ lat: 10, lng: 20 }, { lat: 10.001, lng: 20.001 }], displayMode: 'visible', width: 2,
      },
      {
        id: 'nav-only', name: 'Navigation connector', type: 'connector', roadType: 'connector', floor: 0,
        points: [{ lat: 10, lng: 20 }, { lat: 10.001, lng: 20.001 }], displayMode: 'navigation-only', width: 2,
      },
    ]

    render(createElement(AuthoredRoadLayer, { map, traces }))

    const source = map.getSource('authored-roads') as maplibregl.GeoJSONSource | undefined
    expect(source).toBeUndefined()
    act(() => {
      map.setStyleLoaded(true)
      map.emit('style.load')
    })
    const initializedSource = map.getSource('authored-roads') as maplibregl.GeoJSONSource
    const data = (initializedSource.setData as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection
    expect(data.features.map((feature) => feature.id)).toEqual(['road-main', 'path-walk'])
    const pathLayer = map.getLayer('authored-roads-path') as unknown as { filter: unknown }
    expect(pathLayer.filter).toEqual(expect.arrayContaining([['==', ['get', 'road_type'], 'pedestrian']]))
    const physicalLayer = map.getLayer('authored-roads-fill') as unknown as { filter: unknown }
    expect(physicalLayer.filter).toEqual(expect.arrayContaining([['!=', ['get', 'road_type'], 'pedestrian']]))
  })

  it('allows outdoor POIs at the observed narrow campus overview zoom', () => {
    const map = makeMap()
    map.setStyleLoaded(true)
    render(createElement(POILayer, { map, pois: [], outdoorPois: [{ id: 'mobile-poi', label: 'Campus landmark', category: 'landmark', scope: 'outdoor', position: { lat: 10, lng: 20 }, properties: {}, geometry: { type: 'point', position: { lat: 10, lng: 20 } } }] }))
    // The real 390px campus fit is zoom 15.346. MapLibre excludes a layer
    // below its minzoom even when its source is populated and loaded.
    for (const id of ['pois-layer', 'pois-outdoor-fill', 'pois-outdoor-outline', 'pois-outdoor-extrusion']) {
      const layer = map.getLayer(id)
      expect(layer?.minzoom ?? 0).toBeLessThanOrEqual(15.346)
    }
  })
})
