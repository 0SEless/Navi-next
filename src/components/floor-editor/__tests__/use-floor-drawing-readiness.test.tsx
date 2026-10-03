import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFloorDrawing } from '../useFloorDrawing'

const mockDispatcherExecute = vi.fn()

vi.mock('@navi/editor', () => ({
  useEditor: () => ({
    document: { buildings: [], panoramas: [], roads: [], qrCheckpoints: [] },
    transformer: null,
    services: { get: () => ({ execute: mockDispatcherExecute }) },
  }),
  findBuilding: () => null,
  genId: () => 'generated-id',
  snapPoint: (position: { x: number; y: number }) => ({ position }),
}))

function createMapProbe(options: {
  throwBeforeStyle?: boolean
  missingLayers?: string[]
  throwOnMissingLayerQuery?: boolean
} = {}) {
  let styleReady = false
  let loadHandler: (() => void) | null = null
  let previewSource: { setData: ReturnType<typeof vi.fn> } | null = null
  const handlers = new Map<string, (...args: unknown[]) => void>()

  const map = {
    isStyleLoaded: vi.fn(() => styleReady),
    getSource: vi.fn(() => {
      if (!styleReady && options.throwBeforeStyle !== false) throw new Error('style is not ready')
      return previewSource
    }),
    addSource: vi.fn((id: string) => {
      if (id === 'floor-draw-preview') previewSource = { setData: vi.fn() }
    }),
    addLayer: vi.fn(),
    getLayer: vi.fn((id: string) => options.missingLayers?.includes(id) ? undefined : { id }),
    queryRenderedFeatures: vi.fn((_point: unknown, query?: { layers?: string[] }) => {
      if (options.throwOnMissingLayerQuery) {
        const missingLayer = query?.layers?.find((id) => options.missingLayers?.includes(id))
        if (missingLayer) throw new Error(`layer ${missingLayer} is not in the style`)
      }
      return []
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn(),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'load') loadHandler = handler
    }),
  } as unknown as import('maplibre-gl').Map

  return {
    map,
    click(lat: number, lng: number) {
      handlers.get('click')?.({
        lngLat: { lat, lng },
        point: { x: 0, y: 0 },
        originalEvent: { detail: 1 },
      })
    },
    previewData() {
      return previewSource?.setData.mock.calls.at(-1)?.[0] as { features: GeoJSON.Feature[] } | undefined
    },
    setStyleReady() {
      styleReady = true
    },
    makeStyleReady() {
      styleReady = true
      loadHandler?.()
    },
    trigger(event: string) {
      handlers.get(event)?.()
    },
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useFloorDrawing MapLibre readiness', () => {
  it('waits for the map style before creating or updating drawing sources', () => {
    const probe = createMapProbe()

    expect(() => renderHook(() => useFloorDrawing({
      map: probe.map,
      buildingId: 'BLD01',
      campusId: 'CAMPUS01',
      floor: 0,
      tool: 'select',
    }))).not.toThrow()

    expect(probe.map.getSource).not.toHaveBeenCalled()
    expect(probe.map.addSource).not.toHaveBeenCalled()

    probe.makeStyleReady()

    expect(probe.map.addSource).toHaveBeenCalledWith('floor-draw-preview', expect.any(Object))
  })

  it('waits for the parent map-ready lifecycle before initializing a loaded map', () => {
    const probe = createMapProbe({ throwBeforeStyle: false })

    const { rerender } = renderHook(({ mapReady }: { mapReady: boolean }) => useFloorDrawing({
      map: probe.map,
      buildingId: 'BLD01',
      campusId: 'CAMPUS01',
      floor: 0,
      tool: 'hallway',
      mapReady,
      pendingRouteAnchor: {
        entranceId: 'ENT01',
        outdoorNodeId: 'OUT01',
        position: { lat: 11.8195, lng: 122.0920 },
      },
    }), { initialProps: { mapReady: false } })

    expect(probe.map.addSource).not.toHaveBeenCalled()

    probe.setStyleReady()
    rerender({ mapReady: true })

    expect(probe.map.addSource).toHaveBeenCalledWith('floor-draw-preview', expect.any(Object))

    act(() => {
      probe.click(11.8195, 122.0922)
    })

    const previewData = probe.previewData()
    expect(previewData?.features).toHaveLength(3)
    expect(previewData?.features.map((feature) => feature.geometry.type)).toEqual([
      'LineString',
      'Point',
      'Point',
    ])
  })

  it('seeds the first Route vertex at the selected Entrance before the next authoring click', async () => {
    const probe = createMapProbe({ throwBeforeStyle: false })
    probe.setStyleReady()

    renderHook(() => useFloorDrawing({
      map: probe.map,
      buildingId: 'BLD01',
      campusId: 'CAMPUS01',
      floor: 0,
      tool: 'hallway',
      mapReady: true,
      pendingRouteAnchor: {
        entranceId: 'ENT01',
        outdoorNodeId: 'OUT01',
        position: { lat: 11.8195, lng: 122.0920 },
      },
    }))

    await waitFor(() => expect(probe.previewData()?.features).toHaveLength(2))
    expect(probe.previewData()?.features.map((feature) => feature.geometry.type)).toEqual(['LineString', 'Point'])
    expect(probe.previewData()?.features[1].geometry).toEqual({ type: 'Point', coordinates: [122.0920, 11.8195] })

    act(() => {
      probe.click(11.8195, 122.0922)
    })

    await waitFor(() => expect(probe.previewData()?.features).toHaveLength(3))
  })

  it('does not trust parent readiness while the underlying MapLibre style is still loading', () => {
    const probe = createMapProbe()

    expect(() => renderHook(() => useFloorDrawing({
      map: probe.map,
      buildingId: 'BLD01',
      campusId: 'CAMPUS01',
      floor: 0,
      tool: 'select',
      mapReady: true,
    }))).not.toThrow()

    expect(probe.map.getSource).not.toHaveBeenCalled()
    expect(probe.map.addSource).not.toHaveBeenCalled()

    probe.makeStyleReady()

    expect(probe.map.addSource).toHaveBeenCalledWith('floor-draw-preview', expect.any(Object))
  })

  it('retries initialization from idle when the parent load event was already consumed', () => {
    const probe = createMapProbe()

    renderHook(() => useFloorDrawing({
      map: probe.map,
      buildingId: 'BLD01',
      campusId: 'CAMPUS01',
      floor: 0,
      tool: 'select',
      mapReady: true,
    }))

    expect(probe.map.addSource).not.toHaveBeenCalled()

    act(() => {
      probe.setStyleReady()
      probe.trigger('idle')
    })

    expect(probe.map.addSource).toHaveBeenCalledWith('floor-draw-preview', expect.any(Object))
  })

  it('does not query draw layers that are absent during the readiness transition', () => {
    const probe = createMapProbe({
      throwBeforeStyle: false,
      missingLayers: ['floor-draw-placed'],
      throwOnMissingLayerQuery: true,
    })
    probe.setStyleReady()

    renderHook(() => useFloorDrawing({
      map: probe.map,
      buildingId: 'BLD01',
      campusId: 'CAMPUS01',
      floor: 0,
      tool: 'select',
      mapReady: true,
    }))

    expect(() => act(() => {
      probe.click(11.8195, 122.0920)
    })).not.toThrow()
  })
})
