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

function createMapProbe() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  let previewSource: { setData: ReturnType<typeof vi.fn> } | null = null
  const dragPan = { disable: vi.fn(), enable: vi.fn() }

  const map = {
    isStyleLoaded: vi.fn(() => true),
    getSource: vi.fn(() => previewSource),
    addSource: vi.fn((id: string) => {
      if (id === 'floor-draw-preview') previewSource = { setData: vi.fn() }
    }),
    addLayer: vi.fn(),
    getLayer: vi.fn((id: string) => ({ id })),
    queryRenderedFeatures: vi.fn(() => []),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn(),
    once: vi.fn(),
    dragPan,
  } as unknown as import('maplibre-gl').Map

  return {
    map,
    dragPan,
    click(lat: number, lng: number, detail = 1) {
      handlers.get('click')?.({
        lngLat: { lat, lng },
        point: { x: 0, y: 0 },
        originalEvent: { detail },
      })
    },
    previewFeatures() {
      return (previewSource?.setData.mock.calls.at(-1)?.[0] as { features: unknown[] } | undefined)?.features ?? []
    },
  }
}

const anchor = { entranceId: 'ENT01', outdoorNodeId: 'OUT01', position: { lat: 11.8195, lng: 122.0920 } }

function renderDrawing(tool = 'hallway') {
  const probe = createMapProbe()
  const view = renderHook(() => useFloorDrawing({
    map: probe.map,
    buildingId: 'BLD01',
    campusId: 'C1',
    floor: 0,
    tool,
    mapReady: true,
    pendingRouteAnchor: anchor,
  }))
  return { probe, view }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Route multi-click reliability', () => {
  it('keeps a fast second corner click when it lands at a different position (reproduction)', async () => {
    const { probe } = renderDrawing()

    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(2))

    act(() => { probe.click(11.8195, 122.0922, 1) })
    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(3))

    // The browser reports the second click of a fast click-pair as detail=2,
    // but this click is a distinct corner and must still add a vertex.
    act(() => { probe.click(11.8200, 122.0930, 2) })
    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(4))
  })

  it('does not add a duplicate vertex for a same-position double-click reminder', async () => {
    const { probe } = renderDrawing()

    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(2))

    act(() => { probe.click(11.8195, 122.0922, 1) })
    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(3))

    act(() => { probe.click(11.8195, 122.0922, 2) })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(probe.previewFeatures()).toHaveLength(3)
  })

  it('disables map drag-pan while the Route tool is active and restores it on tool change', async () => {
    const probe = createMapProbe()
    const { rerender } = renderHook(
      ({ tool }: { tool: string }) => useFloorDrawing({
        map: probe.map,
        buildingId: 'BLD01',
        campusId: 'C1',
        floor: 0,
        tool,
        mapReady: true,
      }),
      { initialProps: { tool: 'hallway' } },
    )

    await waitFor(() => expect(probe.dragPan.disable).toHaveBeenCalled())

    rerender({ tool: 'select' })
    await waitFor(() => expect(probe.dragPan.enable).toHaveBeenCalled())
  })

  it('keeps map drag-pan disabled when an active Route drawing is cancelled', async () => {
    const { probe, view } = renderDrawing()

    await waitFor(() => expect(probe.dragPan.disable).toHaveBeenCalled())
    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(2))

    act(() => { probe.click(11.8195, 122.0922, 1) })
    await waitFor(() => expect(probe.previewFeatures()).toHaveLength(3))

    act(() => { view.result.current.cancel() })

    expect(probe.dragPan.enable).not.toHaveBeenCalled()
    expect(view.result.current.drawMode).toBe('idle')
  })
})
