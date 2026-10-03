import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoordinateTransformer, worldDistanceMeters, type CampusDocument } from '@navi/core'
import { POI_PREVIEW_SOURCE } from '../rendering/constants'

const state = vi.hoisted(() => ({
  currentTool: 'poi-circle',
  dispatcher: { execute: vi.fn() },
  selection: { select: vi.fn() },
}))

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => state.currentTool,
}))

vi.mock('@navi/editor', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>
  return {
    ...original,
    genId: (prefix: string) => `${prefix}_3c_test`,
    SelectionOrigin: { Canvas: 'canvas' },
    useEditor: () => ({
      document: makeDocument(),
      transformer: makeTransformer(),
      services: {
        get(name: string) {
          if (name === 'dispatcher') return state.dispatcher
          if (name === 'selection') return state.selection
          return undefined
        },
      },
    }),
  }
})

const studioState = {
  activeBuildingId: 'bld-1',
  activeFloor: 0,
}

vi.mock('@/store/studio-store', () => ({
  useStudioStore: Object.assign(
    vi.fn((selector?: (value: typeof studioState) => unknown) => selector ? selector(studioState) : studioState),
    { getState: vi.fn(() => studioState) },
  ),
}))

import { POIGeometryAuthoring } from '../POIGeometryAuthoring'
import { ImportToast } from '../ImportToast'

afterEach(cleanup)

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'MAIN', category: 'academic', description: '',
      footprint: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121 }, { lat: 14, lng: 121 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      verticalConnectors: [],
      floors: [{
        id: 'floor-1', level: 0, label: 'Ground', elevation: 0, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [],
        connectorStops: [], parametricComponents: [], pois: [],
      }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  } as CampusDocument
}

function makeTransformer(): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  transformer.registerBuilding({ buildingId: 'bld-1', origin: { lat: 14, lng: 121 }, rotation: 0 })
  transformer.registerFloor('bld-1', 0, { offset: { x: 0, y: 0 }, rotation: 0 })
  return transformer
}

function makeMap() {
  const listeners: Record<string, (...args: any[]) => void> = {}
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn>; data?: unknown }>()
  const map = {
    on: vi.fn((event: string, ...args: any[]) => { listeners[event] = args.at(-1) }),
    off: vi.fn(),
    addSource: vi.fn((id: string) => {
      const entry: { setData: ReturnType<typeof vi.fn>; data?: unknown } = { setData: vi.fn() }
      entry.setData.mockImplementation((data: unknown) => { entry.data = data })
      sources.set(id, entry)
    }),
    removeSource: vi.fn((id: string) => { sources.delete(id) }),
    getSource: vi.fn((id: string) => sources.get(id)),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    getLayer: vi.fn(() => undefined),
    setLayoutProperty: vi.fn(),
    getStyle: vi.fn(() => ({ layers: [] })),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    listeners,
    sources,
  }
  return map as any
}

function renderGeometryTool(map: ReturnType<typeof makeMap>) {
  return render(
    <>
      <POIGeometryAuthoring map={map} />
      <ImportToast />
    </>,
  )
}

function previewFeatures(map: ReturnType<typeof makeMap>): unknown[] {
  const source = map.sources.get(POI_PREVIEW_SOURCE)
  const data = source?.data as { features?: unknown[] } | undefined
  return data?.features ?? []
}

describe('Phase 3C transient POI geometry authoring', () => {
  beforeEach(() => {
    state.currentTool = 'poi-circle'
    state.dispatcher.execute.mockReset()
    state.selection.select.mockReset()
    studioState.activeBuildingId = 'bld-1'
    studioState.activeFloor = 0
  })

  it('commits one local-meter circle and selects its stable POI identity', () => {
    const map = makeMap()
    render(<POIGeometryAuthoring map={map} />)
    const center = { lat: 14.0001, lng: 121.0001 }
    const edge = { lat: 14.00013, lng: 121.00014 }

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: center }))
    act(() => map.listeners.mousemove({ lngLat: edge }))
    act(() => map.listeners.mouseup({ lngLat: edge }))

    const expectedCenter = makeTransformer().worldToFloorLocal(center, 'bld-1', 0)
    const expectedEdge = makeTransformer().worldToFloorLocal(edge, 'bld-1', 0)
    expect(state.dispatcher.execute).toHaveBeenCalledTimes(1)
    expect(state.dispatcher.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'poi.create',
      payload: expect.objectContaining({
        id: 'poi_3c_test',
        buildingId: 'bld-1',
        floorId: 'floor-1',
        geometry: {
          type: 'circle',
          center: expectedCenter,
          radius: expect.closeTo(Math.hypot(expectedEdge!.x - expectedCenter!.x, expectedEdge!.y - expectedCenter!.y)),
        },
      }),
    }))
    expect(state.selection.select).toHaveBeenCalledWith({
      type: 'poi', id: 'poi_3c_test', buildingId: 'bld-1', floorId: 'floor-1',
    }, 'canvas')
    expect(map.dragPan.disable).toHaveBeenCalled()
    expect(map.dragPan.enable).toHaveBeenCalled()
    expect(state.dispatcher.execute.mock.calls.flat().some((value: unknown) => (
      typeof value === 'object' && value !== null && 'id' in value && String((value as { id: unknown }).id).startsWith('route.')
    ))).toBe(false)
  })

  it('cancels a rectangle draft and never creates a partial POI', () => {
    state.currentTool = 'poi-rectangle'
    const map = makeMap()
    render(<POIGeometryAuthoring map={map} />)

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

    expect(state.dispatcher.execute).not.toHaveBeenCalled()
    expect(map.dragPan.enable).toHaveBeenCalled()
  })

  it('finishes an ordered open polygon with Enter exactly once', () => {
    state.currentTool = 'poi-polygon'
    const map = makeMap()
    render(<POIGeometryAuthoring map={map} />)

    act(() => map.listeners.click({ lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => map.listeners.click({ lngLat: { lat: 14.0001, lng: 121.0002 } }))
    act(() => map.listeners.click({ lngLat: { lat: 14.0002, lng: 121.0002 } }))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))

    expect(state.dispatcher.execute).toHaveBeenCalledTimes(1)
    const command = state.dispatcher.execute.mock.calls[0][0]
    expect(command.id).toBe('poi.create')
    expect(command.payload.geometry.type).toBe('polygon')
    expect(command.payload.geometry.points).toHaveLength(3)
    expect(command.payload.geometry.points[0]).not.toEqual(command.payload.geometry.points.at(-1))
  })

  it('renders a live circle preview during the initial drag gesture', () => {
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => map.listeners.mousemove({ lngLat: { lat: 14.00013, lng: 121.00014 } }))

    expect(previewFeatures(map).length).toBeGreaterThan(0)
    expect(screen.getByText(/POI Circle · release to commit/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('renders a live rectangle preview during the initial drag gesture', () => {
    state.currentTool = 'poi-rectangle'
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => map.listeners.mousemove({ lngLat: { lat: 14.0002, lng: 121.0002 } }))

    expect(previewFeatures(map).length).toBeGreaterThan(0)
    expect(screen.getByText(/POI Rectangle · release to commit/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('renders the first polygon vertex and preview on the first click', () => {
    state.currentTool = 'poi-polygon'
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.click({ lngLat: { lat: 14.0001, lng: 121.0001 } }))

    expect(previewFeatures(map).length).toBeGreaterThan(0)
    expect(screen.getByText(/POI Polygon · 1 vertices/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('creates an outdoor circle with world geometry when no building is active', () => {
    studioState.activeBuildingId = null
    const map = makeMap()
    renderGeometryTool(map)

    const center = { lat: 14.0001, lng: 121.0001 }
    const edge = { lat: 14.00013, lng: 121.00014 }
    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: center }))
    act(() => map.listeners.mousemove({ lngLat: edge }))
    act(() => map.listeners.mouseup({ lngLat: edge }))

    expect(state.dispatcher.execute).toHaveBeenCalledTimes(1)
    expect(state.dispatcher.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'poi.create',
      payload: expect.objectContaining({
        id: 'poi_3c_test',
        scope: 'outdoor',
        geometry: {
          type: 'circle',
          center,
          radius: expect.closeTo(worldDistanceMeters(center, edge)),
        },
      }),
    }))
    expect((state.dispatcher.execute.mock.calls[0][0] as { payload: Record<string, unknown> }).payload)
      .not.toHaveProperty('buildingId')
    expect((state.dispatcher.execute.mock.calls[0][0] as { payload: Record<string, unknown> }).payload)
      .not.toHaveProperty('floorId')
    expect(state.selection.select).toHaveBeenCalledWith(
      { type: 'poi', id: 'poi_3c_test' },
      'canvas',
    )
  })

  it('shows an outdoor preview immediately when no building is active', () => {
    studioState.activeBuildingId = null
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => map.listeners.mousemove({ lngLat: { lat: 14.00013, lng: 121.00014 } }))

    expect(previewFeatures(map).length).toBeGreaterThan(0)
    expect(screen.getByText(/Outdoor POI Circle · release to commit/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('creates an outdoor rectangle with world corners when no building is active', () => {
    studioState.activeBuildingId = null
    state.currentTool = 'poi-rectangle'
    const map = makeMap()
    renderGeometryTool(map)

    const first = { lat: 14.0001, lng: 121.0001 }
    const current = { lat: 14.0002, lng: 121.00025 }
    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: first }))
    act(() => map.listeners.mousemove({ lngLat: current }))
    act(() => map.listeners.mouseup({ lngLat: current }))

    const payload = (state.dispatcher.execute.mock.calls[0][0] as { payload: Record<string, unknown> }).payload
    expect(payload.scope).toBe('outdoor')
    expect((payload.geometry as { type: string }).type).toBe('rectangle')
    expect((payload.geometry as { points: unknown[] }).points).toHaveLength(4)
    expect((payload.geometry as { points: Array<{ lat: number; lng: number }> }).points).toEqual([
      { lat: 14.0001, lng: 121.0001 },
      { lat: 14.0001, lng: 121.00025 },
      { lat: 14.0002, lng: 121.00025 },
      { lat: 14.0002, lng: 121.0001 },
    ])
  })

  it('creates an outdoor polygon with world vertices when no building is active', () => {
    studioState.activeBuildingId = null
    state.currentTool = 'poi-polygon'
    const map = makeMap()
    renderGeometryTool(map)

    const points = [
      { lat: 14.0001, lng: 121.0001 },
      { lat: 14.0002, lng: 121.0001 },
      { lat: 14.0002, lng: 121.0002 },
    ]
    act(() => map.listeners.click({ lngLat: points[0] }))
    expect(screen.getByText(/Outdoor POI Polygon · 1 vertices/i)).toBeTruthy()
    act(() => map.listeners.click({ lngLat: points[1] }))
    act(() => map.listeners.click({ lngLat: points[2] }))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))

    const payload = (state.dispatcher.execute.mock.calls[0][0] as { payload: Record<string, unknown> }).payload
    expect(payload.scope).toBe('outdoor')
    expect(payload.geometry).toMatchObject({ type: 'polygon', points })
    expect(state.selection.select).toHaveBeenCalledWith({ type: 'poi', id: 'poi_3c_test' }, 'canvas')
  })

  it('explains a missing active floor instead of silently ignoring the gesture', () => {
    studioState.activeFloor = 3
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => map.listeners.mouseup({ lngLat: { lat: 14.00013, lng: 121.00014 } }))

    expect(screen.getByText(/has no floor 3/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('explains a zero-radius circle instead of silently discarding the gesture', () => {
    const map = makeMap()
    renderGeometryTool(map)

    const point = { lat: 14.0001, lng: 121.0001 }
    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: point }))
    act(() => map.listeners.mouseup({ lngLat: point }))

    expect(screen.getByText(/non-zero radius/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('explains a zero-area rectangle instead of silently discarding the gesture', () => {
    state.currentTool = 'poi-rectangle'
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.mousedown({ originalEvent: { button: 0 }, lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => map.listeners.mouseup({ lngLat: { lat: 14.0001, lng: 121.0002 } }))

    expect(screen.getByText(/non-zero area/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
  })

  it('explains an incomplete polygon when Enter is pressed before three vertices', () => {
    state.currentTool = 'poi-polygon'
    const map = makeMap()
    renderGeometryTool(map)

    act(() => map.listeners.click({ lngLat: { lat: 14.0001, lng: 121.0001 } }))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))

    expect(screen.getByText(/three vertices/i)).toBeTruthy()
    expect(state.dispatcher.execute).not.toHaveBeenCalled()
    expect(screen.getByText(/POI Polygon · 1 vertices/i)).toBeTruthy()
  })
})
