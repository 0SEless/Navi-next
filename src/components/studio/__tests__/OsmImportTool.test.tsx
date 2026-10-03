import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type maplibregl from 'maplibre-gl'
import { useOsmImportTool } from '../OsmImportTool'
import type { DrawingSessionValue } from '../useDrawingSession'

let currentTool = 'import-osm'

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => currentTool,
}))

function createDrawing(overrides?: Partial<DrawingSessionValue>): DrawingSessionValue {
  return {
    tracePoints: [],
    drawPoints: [],
    routeWidth: 8,
    roomDrag: null,
    pendingConfirm: null,
    addTracePoint: vi.fn(),
    setTracePoints: vi.fn(),
    undoLastPoint: vi.fn(),
    clearTracePoints: vi.fn(),
    addDrawPoint: vi.fn(),
    setDrawPoints: vi.fn(),
    undoLastDrawPoint: vi.fn(),
    clearDrawPoints: vi.fn(),
    setRoomDrag: vi.fn(),
    requestConfirm: vi.fn(),
    confirm: vi.fn(() => []),
    cancel: vi.fn(),
    setRouteWidth: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }
}

function createMap() {
  type MockMapEvent = { lngLat: { lat: number; lng: number }; point: { x: number; y: number } }
  const handlers = new Map<string, (event: MockMapEvent) => void>()
  const source = { setData: vi.fn() }
  const map = {
    getSource: vi.fn(() => source),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    project: vi.fn(() => ({ x: 100, y: 100 })),
    on: vi.fn((event: string, handler: (value: MockMapEvent) => void) => { handlers.set(event, handler) }),
    off: vi.fn(),
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
  } as unknown as maplibregl.Map
  return { map, handlers, source }
}

describe('useOsmImportTool', () => {
  beforeEach(() => {
    currentTool = 'import-osm'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests shared confirmation instead of submitting on polygon close', () => {
    const { map, handlers } = createMap()
    const requestConfirm = vi.fn()
    const drawing = createDrawing({ requestConfirm })
    const { unmount } = renderHook(() => useOsmImportTool(map, drawing))

    act(() => {
      handlers.get('click')?.({ lngLat: { lat: 1, lng: 2 }, point: { x: 10, y: 10 } })
      handlers.get('click')?.({ lngLat: { lat: 1, lng: 3 }, point: { x: 20, y: 20 } })
      handlers.get('click')?.({ lngLat: { lat: 2, lng: 3 }, point: { x: 30, y: 30 } })
      handlers.get('click')?.({ lngLat: { lat: 1, lng: 2 }, point: { x: 100, y: 100 } })
    })

    expect(requestConfirm).toHaveBeenCalledWith('import-osm', [
      { lat: 1, lng: 2 },
      { lat: 1, lng: 3 },
      { lat: 2, lng: 3 },
    ])
    expect(fetch).not.toHaveBeenCalled()
    unmount()
  })
})
