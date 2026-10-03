import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDrawingSession } from '../useDrawingSession'
import type { ConnectivityCandidate } from '@navi/editor'

const candidate: ConnectivityCandidate = {
  kind: 'road-endpoint',
  targetRoadId: 'road-target',
  position: { lat: 0, lng: 0 },
  distanceMeters: 0.3,
  label: 'Road endpoint: Target',
}

describe('useDrawingSession — connection decisions (Fix 1)', () => {
  it('Connect appends the projected point and records a connect decision for commit', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => {
      result.current.addTracePoint({ lat: 0, lng: -0.001 })
      result.current.setPendingRoadConnection({ point: { lat: 0.000003, lng: 0 }, candidate })
    })
    act(() => {
      result.current.resolveRoadConnection('connect')
    })

    expect(result.current.tracePoints).toHaveLength(2)
    expect(result.current.tracePoints[1]).toEqual(candidate.position)
    expect(result.current.pendingRoadConnection).toBeNull()

    act(() => {
      result.current.requestConfirm('route')
    })
    const connections = result.current.pendingConfirm?.connections
    expect(connections).toHaveLength(1)
    expect(connections![0]).toMatchObject({
      pointIndex: 1,
      action: 'connect',
      kind: 'road-endpoint',
      targetRoadId: 'road-target',
      position: candidate.position,
    })
  })

  it('Keep Separate preserves the raw coordinate and records a separate decision', () => {
    const raw = { lat: 0.000003, lng: 0 }
    const { result } = renderHook(() => useDrawingSession())
    act(() => {
      result.current.addTracePoint({ lat: 0, lng: -0.001 })
      result.current.setPendingRoadConnection({ point: raw, candidate })
    })
    act(() => {
      result.current.resolveRoadConnection('separate')
    })

    expect(result.current.tracePoints[1]).toEqual(raw)
    act(() => {
      result.current.requestConfirm('route')
    })
    expect(result.current.pendingConfirm?.connections?.[0]).toMatchObject({
      pointIndex: 1,
      action: 'separate',
      // Decision metadata records the contact point; raw geometry is preserved.
      position: candidate.position,
    })
  })

  it('Alt shortcut (addSeparatePoint) keeps the raw coordinate and records separate', () => {
    const raw = { lat: 0.000003, lng: 0 }
    const { result } = renderHook(() => useDrawingSession())
    act(() => {
      result.current.addTracePoint({ lat: 0, lng: -0.001 })
      result.current.addSeparatePoint(raw, candidate)
    })

    expect(result.current.tracePoints[1]).toEqual(raw)
    act(() => {
      result.current.requestConfirm('route')
    })
    expect(result.current.pendingConfirm?.connections?.[0]).toMatchObject({ action: 'separate', pointIndex: 1 })
  })

  it('refuses to confirm while a decision is pending', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => {
      result.current.addTracePoint({ lat: 0, lng: -0.001 })
      result.current.addTracePoint({ lat: 0, lng: 0 })
      result.current.setPendingRoadConnection({ point: { lat: 0.000003, lng: 0 }, candidate })
    })
    act(() => {
      result.current.requestConfirm('route')
    })
    expect(result.current.pendingConfirm).toBeNull()
  })

  it('undo drops decisions captured for removed points', () => {
    const { result } = renderHook(() => useDrawingSession())
    act(() => {
      result.current.addTracePoint({ lat: 0, lng: -0.001 })
      result.current.setPendingRoadConnection({ point: { lat: 0.000003, lng: 0 }, candidate })
    })
    act(() => {
      result.current.resolveRoadConnection('connect')
    })
    act(() => {
      result.current.undoLastPoint()
    })
    act(() => {
      result.current.requestConfirm('route')
    })
    // Only one point remains → confirmation is not requested at all.
    expect(result.current.pendingConfirm).toBeNull()
  })
})
