import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditablePolygonEditor } from '../useEditablePolygonEditor'
import { PolygonEngine } from '../PolygonEngine'

describe('useEditablePolygonEditor', () => {
  it('initializes with polygon and idle mode', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    expect(result.current.state.mode).toBe('idle')
    expect(result.current.state.selectedRing).toBe(poly.rings[0].id)
  })

  it('moveVertex via operations updates polygon', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    const vid = poly.rings[0].vertices[0].id
    act(() => {
      result.current.operations.moveVertex(vid, { x: 5, y: 5 })
    })
    const moved = result.current.state.polygon.rings[0].vertices.find(v => v.id === vid)
    expect(moved).toBeDefined()
    expect(moved!.x).toBe(5)
  })

  it('insertVertex via operations inserts between vertices', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    const sv = poly.rings[0].vertices[0]
    const ev = poly.rings[0].vertices[1]
    act(() => {
      result.current.operations.insertVertex(sv.id, ev.id, { x: 5, y: 0 })
    })
    expect(result.current.state.polygon.rings[0].vertices).toHaveLength(4)
  })

  it('deleteVertex via operations removes vertex', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    const vid = poly.rings[0].vertices[0].id
    act(() => {
      result.current.operations.deleteVertex(vid)
    })
    expect(result.current.state.polygon.rings[0].vertices).toHaveLength(3)
  })

  it('records history for undo', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    const vid = poly.rings[0].vertices[0].id
    act(() => {
      result.current.operations.moveVertex(vid, { x: 5, y: 5 })
    })
    expect(result.current.state.history.past.length).toBeGreaterThanOrEqual(1)
  })

  it('undo restores previous polygon state', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    const vid = poly.rings[0].vertices[0].id
    act(() => {
      result.current.operations.moveVertex(vid, { x: 5, y: 5 })
    })
    act(() => {
      result.current.operations.undo()
    })
    const restored = result.current.state.polygon.rings[0].vertices.find(v => v.id === vid)
    expect(restored!.x).toBe(0)
  })

  it('redo restores undone polygon state', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    const vid = poly.rings[0].vertices[0].id
    act(() => {
      result.current.operations.moveVertex(vid, { x: 5, y: 5 })
    })
    act(() => {
      result.current.operations.undo()
    })
    act(() => {
      result.current.operations.redo()
    })
    const moved = result.current.state.polygon.rings[0].vertices.find(v => v.id === vid)
    expect(moved!.x).toBe(5)
  })

  it('closePolygon via operations closes the polygon', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))
    act(() => {
      result.current.operations.closePolygon()
    })
    expect(result.current.state.polygon.rings[0].closed).toBe(true)
  })

  it('handlers update mode/session state', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))

    act(() => {
      result.current.handlers.onVertexPointerDown('v1')
    })
    expect(result.current.state.mode).toBe('dragging')
    expect(result.current.state.draggedVertex).toBe('v1')

    act(() => {
      result.current.handlers.onPointerUp()
    })
    expect(result.current.state.mode).toBe('idle')
    expect(result.current.state.draggedVertex).toBeNull()
  })

  it('hover state setters work', () => {
    const poly = PolygonEngine.create([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    const { result } = renderHook(() => useEditablePolygonEditor({ polygon: poly }))

    act(() => {
      result.current.setHoveredVertex('v1')
    })
    expect(result.current.state.hoveredVertex).toBe('v1')

    act(() => {
      result.current.setHoveredEdge('e1')
    })
    expect(result.current.state.hoveredEdge).toBe('e1')
  })
})
