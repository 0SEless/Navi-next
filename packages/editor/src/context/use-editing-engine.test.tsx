import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditingEngine } from './use-editing-engine'

describe('useEditingEngine', () => {
  it('starts with idle state', () => {
    const { result } = renderHook(() => useEditingEngine())
    expect(result.current.snapshot.state).toBe('idle')
    expect(result.current.snapshot.operation).toBeNull()
    expect(result.current.snapshot.preview).toBeNull()
  })

  it('begins a create operation reactively', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      result.current.begin({ kind: 'create', entityType: 'space', geometry: [] })
    })
    expect(result.current.snapshot.state).toBe('drawing')
    expect(result.current.snapshot.operation!.kind).toBe('create')
  })

  it('preview updates reactively', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      result.current.begin({ kind: 'create', entityType: 'space', geometry: [] })
    })
    act(() => {
      result.current.preview({ x: 10, y: 20 })
    })
    expect(result.current.snapshot.preview).toEqual({ x: 10, y: 20 })
  })

  it('commit clears operation and marks dirty', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      result.current.begin({ kind: 'delete', entityIds: ['room-1'] })
    })
    expect(result.current.snapshot.state).toBe('idle')

    act(() => {
      const r = result.current.doCommit()
      expect(r.committed).toBe(true)
    })
    expect(result.current.snapshot.operation).toBeNull()
    expect(result.current.snapshot.geometryDirty).toBe(true)
  })

  it('cancel reverts to idle', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      result.current.begin({ kind: 'create', entityType: 'space', geometry: [] })
    })
    act(() => {
      result.current.cancel()
    })
    expect(result.current.snapshot.state).toBe('idle')
    expect(result.current.snapshot.operation).toBeNull()
  })

  it('execute completes begin+commit', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      const r = result.current.execute({ kind: 'rename', entityId: 'room-1', name: 'New' })
      expect(r.committed).toBe(true)
    })
    expect(result.current.snapshot.metadataDirty).toBe(true)
    expect(result.current.snapshot.compilerDirty).toBe(true)
  })

  it('escape cancels operation or clears selection', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      result.current.begin({ kind: 'create', entityType: 'space', geometry: [] })
    })
    act(() => {
      result.current.escape()
    })
    expect(result.current.snapshot.state).toBe('idle')
  })

  it('reset clears all state', () => {
    const { result } = renderHook(() => useEditingEngine())
    act(() => {
      result.current.execute({ kind: 'create', entityType: 'space', geometry: [] })
      result.current.session.selection.select('x')
    })
    expect(result.current.snapshot.geometryDirty).toBe(true)
    expect(result.current.session.selection.isEmpty).toBe(false)
    act(() => {
      result.current.reset()
    })
    expect(result.current.snapshot.isDirty).toBe(false)
    expect(result.current.session.selection.isEmpty).toBe(true)
  })

  it('session is stable across renders', () => {
    const { result, rerender } = renderHook(() => useEditingEngine())
    const session1 = result.current.session
    rerender()
    expect(result.current.session).toBe(session1)
  })
})
