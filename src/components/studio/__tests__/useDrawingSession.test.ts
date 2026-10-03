import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDrawingSession } from '../useDrawingSession'
import type { LatLng } from '@/types/nav-types'

describe('useDrawingSession', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useDrawingSession())
    expect(result.current.tracePoints).toEqual([])
    expect(result.current.drawPoints).toEqual([])
    expect(result.current.routeWidth).toBe(8)
    expect(result.current.pendingConfirm).toBeNull()
    expect(result.current.roomDrag).toBeNull()
  })

  it('adds a trace point', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 10, lng: 20 }))
    expect(result.current.tracePoints).toHaveLength(1)
    expect(result.current.tracePoints[0]).toEqual({ lat: 10, lng: 20 })
  })

  it('adds multiple trace points', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    expect(result.current.tracePoints).toHaveLength(2)
  })

  it('undoes last trace point', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.undoLastPoint())
    expect(result.current.tracePoints).toHaveLength(1)
    expect(result.current.tracePoints[0]).toEqual({ lat: 1, lng: 2 })
  })

  it('clears all trace points', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.clearTracePoints())
    expect(result.current.tracePoints).toEqual([])
  })

  it('sets pending confirm from trace points (route)', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm('route'))
    expect(result.current.pendingConfirm).not.toBeNull()
    expect(result.current.pendingConfirm!.type).toBe('route')
    expect(result.current.pendingConfirm!.points).toHaveLength(2)
  })

  it('clears pending confirm on cancel', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm('route'))
    act(() => result.current.cancel())
    expect(result.current.pendingConfirm).toBeNull()
    expect(result.current.tracePoints).toEqual([])
  })

  it('manages routeWidth with min/max clamping', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => result.current.setRouteWidth(2))
    expect(result.current.routeWidth).toBe(2)
    act(() => result.current.setRouteWidth(1))
    expect(result.current.routeWidth).toBe(2)
    act(() => result.current.setRouteWidth(25))
    expect(result.current.routeWidth).toBe(24)
  })

  it('provides confirm() that returns pending points and clears state', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.addTracePoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm('route'))
    let points: LatLng[]
    act(() => {
      points = result.current.confirm()
    })
    expect(points!).toHaveLength(2)
    expect(result.current.pendingConfirm).toBeNull()
    expect(result.current.tracePoints).toEqual([])
  })

  it('manages draw points (for building/boundary tools)', () => {
    const { result } = renderHook(() => useDrawingSession('building'))
    act(() => result.current.addDrawPoint({ lat: 1, lng: 2 }))
    act(() => result.current.addDrawPoint({ lat: 3, lng: 4 }))
    act(() => result.current.addDrawPoint({ lat: 5, lng: 6 }))
    expect(result.current.drawPoints).toHaveLength(3)
    act(() => result.current.undoLastDrawPoint())
    expect(result.current.drawPoints).toHaveLength(2)
    act(() => result.current.clearDrawPoints())
    expect(result.current.drawPoints).toEqual([])
  })

  it('setTracePoints replaces all trace points', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    act(() => result.current.setTracePoints([{ lat: 10, lng: 20 }, { lat: 30, lng: 40 }]))
    expect(result.current.tracePoints).toHaveLength(2)
    expect(result.current.tracePoints[0]).toEqual({ lat: 10, lng: 20 })
    act(() => result.current.setTracePoints([{ lat: 50, lng: 60 }]))
    expect(result.current.tracePoints).toHaveLength(1)
  })

  it('setDrawPoints replaces all draw points', () => {
    const { result } = renderHook(() => useDrawingSession('building'))
    act(() => result.current.setDrawPoints([{ lat: 10, lng: 20 }, { lat: 30, lng: 40 }, { lat: 50, lng: 60 }]))
    expect(result.current.drawPoints).toHaveLength(3)
    act(() => result.current.setDrawPoints([{ lat: 99, lng: 88 }]))
    expect(result.current.drawPoints).toHaveLength(1)
  })

  it('manages room drag state', () => {
    const { result } = renderHook(() => useDrawingSession())
    const drag = { start: { lat: 0, lng: 0 }, current: { lat: 10, lng: 10 } }
    act(() => result.current.setRoomDrag(drag))
    expect(result.current.roomDrag).toEqual(drag)
    act(() => result.current.setRoomDrag(null))
    expect(result.current.roomDrag).toBeNull()
  })

  it('requestConfirm does nothing when route has < 2 points', () => {
    const { result } = renderHook(() => useDrawingSession('route'))
    act(() => result.current.addTracePoint({ lat: 1, lng: 2 }))
    act(() => result.current.requestConfirm('route'))
    expect(result.current.pendingConfirm).toBeNull()
  })

  it('requestConfirm does nothing when building has < 3 points', () => {
    const { result } = renderHook(() => useDrawingSession('building'))
    act(() => result.current.addDrawPoint({ lat: 1, lng: 2 }))
    act(() => result.current.addDrawPoint({ lat: 3, lng: 4 }))
    act(() => result.current.requestConfirm('building'))
    expect(result.current.pendingConfirm).toBeNull()
  })

  it('sets a pending confirmation for an OSM import boundary', () => {
    const { result } = renderHook(() => useDrawingSession('import-osm'))
    const points = [
      { lat: 1, lng: 2 },
      { lat: 1, lng: 3 },
      { lat: 2, lng: 3 },
    ]
    act(() => result.current.setDrawPoints(points))
    act(() => result.current.requestConfirm('import-osm'))
    expect(result.current.pendingConfirm).toMatchObject({ type: 'import-osm', points })
  })

  it('sets a pending confirmation for a campus boundary', () => {
    const { result } = renderHook(() => useDrawingSession('set-boundary'))
    const points = [
      { lat: 4, lng: 5 },
      { lat: 4, lng: 6 },
      { lat: 5, lng: 6 },
    ]
    act(() => result.current.setDrawPoints(points))
    act(() => result.current.requestConfirm('set-boundary'))
    expect(result.current.pendingConfirm).toMatchObject({ type: 'set-boundary', points })
  })
})
