import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFloorDrawing } from '../useFloorDrawing'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(() => ({ success: true })),
  onSelect: vi.fn(),
  document: {
    buildings: [{
      id: 'building-1',
      floors: [{ id: 'floor-1', level: 0, rooms: [], walls: [] }],
    }],
    panoramas: [],
    roads: [],
    qrCheckpoints: [],
  },
}))

vi.mock('@navi/editor', () => ({
  useEditor: () => ({
    document: mocks.document,
    transformer: {
      worldToBuildingLocal: ({ lat, lng }: { lat: number; lng: number }) => ({ x: lng, y: lat }),
      buildingLocalToWorld: ({ x, y }: { x: number; y: number }) => ({ lat: y, lng: x }),
    },
    services: { get: () => ({ execute: mocks.execute }) },
  }),
  findBuilding: (document: typeof mocks.document, buildingId: string) => document.buildings.find((building) => building.id === buildingId),
  genId: () => 'door-feedback-1',
  snapPoint: (position: { x: number; y: number }) => ({ position }),
}))

function createMapProbe() {
  const handlers = new Map<string, (event: unknown) => void>()
  const previewSource = { setData: vi.fn() }
  const dragPan = { disable: vi.fn(), enable: vi.fn() }
  const map = {
    isStyleLoaded: () => true,
    getSource: () => previewSource,
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getLayer: (id: string) => ({ id }),
    queryRenderedFeatures: () => [],
    on: (event: string, handler: (event: unknown) => void) => handlers.set(event, handler),
    off: vi.fn(),
    once: vi.fn(),
    dragPan,
  } as unknown as import('maplibre-gl').Map

  const emit = (type: 'mousedown' | 'mousemove' | 'mouseup', x: number, y: number) => {
    handlers.get(type)?.({
      lngLat: { lng: x, lat: y },
      point: { x, y },
      originalEvent: { button: 0 },
    })
  }

  return { map, emit, dragPan }
}

function messageOf(value: unknown): string | null | undefined {
  return (value as { rectangleMessage?: string | null }).rectangleMessage
}

describe('Door rectangle gesture feedback', () => {
  beforeEach(() => {
    mocks.execute.mockClear()
    mocks.onSelect.mockClear()
  })

  afterEach(cleanup)

  it('explains the drag gesture and reports a click that is too small to create a Door', () => {
    const probe = createMapProbe()
    const { result } = renderHook(() => useFloorDrawing({
      map: probe.map,
      mapReady: true,
      buildingId: 'building-1',
      campusId: 'campus-1',
      floor: 0,
      tool: 'door',
      onSelect: mocks.onSelect,
    }))

    expect(messageOf(result.current)).toBe('Door: click and drag to draw a rectangle.')

    act(() => {
      probe.emit('mousedown', 2, 2)
      probe.emit('mouseup', 2, 2)
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(messageOf(result.current)).toBe('No Door created — drag at least 0.2 m wide and deep.')
    expect(probe.dragPan.enable).toHaveBeenCalled()
  })

  it('keeps a same-frame drag in the ref and creates the Door on release', () => {
    const probe = createMapProbe()
    renderHook(() => useFloorDrawing({
      map: probe.map,
      mapReady: true,
      buildingId: 'building-1',
      campusId: 'campus-1',
      floor: 0,
      tool: 'door',
      onSelect: mocks.onSelect,
    }))

    act(() => {
      probe.emit('mousedown', 1, 1)
      probe.emit('mousemove', 3, 2)
      probe.emit('mouseup', 3, 2)
    })

    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'door.create',
      payload: expect.objectContaining({
        door: expect.objectContaining({
          id: 'door-feedback-1',
          position: { x: 2, y: 1.5 },
          width: 2,
          depth: 1,
        }),
      }),
    }))
    expect(mocks.onSelect).toHaveBeenCalledWith('door-feedback-1')
  })
})
