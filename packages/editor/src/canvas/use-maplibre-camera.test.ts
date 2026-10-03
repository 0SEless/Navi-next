import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMapLibreCamera, type MapLike } from './use-maplibre-camera'

// ── Mock MapLibre Map ──

interface MockMap extends MapLike {
  _emit(event: string): void
}

function createMockMap(overrides?: Partial<MapLike>): MockMap {
  const listeners = new Map<string, Set<() => void>>()
  return {
    getCenter: vi.fn(() => ({ lat: 33.4255, lng: -111.9400 })),
    getZoom: vi.fn(() => 15),
    getBearing: vi.fn(() => 0),
    on: vi.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(cb)
    }),
    off: vi.fn((event: string, cb: () => void) => {
      listeners.get(event)?.delete(cb)
    }),
    ...overrides,
    _emit(event: string) {
      listeners.get(event)?.forEach(cb => cb())
    },
  }
}

// ── Tests ──

describe('useMapLibreCamera', () => {
  it('returns initial camera state from map', () => {
    const map = createMockMap()
    const { result } = renderHook(() => useMapLibreCamera(map))

    expect(result.current.center).toEqual({ lat: 33.4255, lng: -111.9400 })
    expect(result.current.zoom).toBe(15)
    expect(result.current.bearing).toBe(0)
  })

  it('returns default state when map is null', () => {
    const { result } = renderHook(() => useMapLibreCamera(null))

    expect(result.current.center).toEqual({ lat: 0, lng: 0 })
    expect(result.current.zoom).toBe(1)
    expect(result.current.bearing).toBe(0)
  })

  it('updates on map move', () => {
    const map = createMockMap()
    const { result } = renderHook(() => useMapLibreCamera(map))

    act(() => {
      map.getCenter = vi.fn(() => ({ lat: 33.4300, lng: -111.9500 }))
      map._emit('move')
    })

    expect(result.current.center).toEqual({ lat: 33.4300, lng: -111.9500 })
  })

  it('updates on map zoom', () => {
    const map = createMockMap()
    const { result } = renderHook(() => useMapLibreCamera(map))

    act(() => {
      map.getZoom = vi.fn(() => 18)
      map._emit('zoom')
    })

    expect(result.current.zoom).toBe(18)
  })

  it('updates on map rotate', () => {
    const map = createMockMap()
    const { result } = renderHook(() => useMapLibreCamera(map))

    act(() => {
      map.getBearing = vi.fn(() => 45)
      map._emit('rotate')
    })

    expect(result.current.bearing).toBe(45)
  })

  it('subscribes to move, zoom, and rotate events', () => {
    const map = createMockMap()
    renderHook(() => useMapLibreCamera(map))

    expect(map.on).toHaveBeenCalledWith('move', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('zoom', expect.any(Function))
    expect(map.on).toHaveBeenCalledWith('rotate', expect.any(Function))
  })

  it('unsubscribes on unmount', () => {
    const map = createMockMap()
    const { unmount } = renderHook(() => useMapLibreCamera(map))

    unmount()

    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('zoom', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('rotate', expect.any(Function))
  })

  it('does not update after unmount', () => {
    const map = createMockMap()
    const { result, unmount } = renderHook(() => useMapLibreCamera(map))

    unmount()

    act(() => {
      map.getCenter = vi.fn(() => ({ lat: 0, lng: 0 }))
      map._emit('move')
    })

    expect(result.current.center).toEqual({ lat: 33.4255, lng: -111.9400 })
  })
})
