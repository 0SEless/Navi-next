import { describe, it, expect } from 'vitest'
import { canvasDrawReducer, INITIAL_CANVAS_DRAW_STATE, type CanvasDrawState } from '../canvas-draw-reducer'

const pt = (x: number, y: number) => ({ x, y })

describe('canvasDrawReducer', () => {
  const INITIAL: CanvasDrawState = { ...INITIAL_CANVAS_DRAW_STATE }

  it('initial state is idle with empty polygon', () => {
    expect(INITIAL.drawMode).toBe('idle')
    expect(INITIAL.pendingPolygon).toEqual([])
  })

  it('RESET returns to initial state', () => {
    const s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(1, 2) })
    const reset = canvasDrawReducer(s, { type: 'RESET' })
    expect(reset).toEqual(INITIAL)
  })

  it('ADD_POLYGON_POINT adds vertex and enters placing-polygon', () => {
    const s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(3, 4) })
    expect(s.drawMode).toBe('placing-polygon')
    expect(s.pendingPolygon).toEqual([pt(3, 4)])
  })

  it('multiple ADD_POLYGON_POINT accumulate', () => {
    let s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(0, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(10, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(10, 10) })
    expect(s.pendingPolygon).toHaveLength(3)
    expect(s.drawMode).toBe('placing-polygon')
  })

  it('CLEAR_POLYGON empties polygon and returns to idle', () => {
    let s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(0, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(1, 1) })
    const cleared = canvasDrawReducer(s, { type: 'CLEAR_POLYGON' })
    expect(cleared.pendingPolygon).toEqual([])
    expect(cleared.drawMode).toBe('idle')
  })

  it('REMOVE_LAST_POLYGON_POINT removes last vertex', () => {
    let s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(0, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(10, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(10, 10) })
    const afterRemove = canvasDrawReducer(s, { type: 'REMOVE_LAST_POLYGON_POINT' })
    expect(afterRemove.pendingPolygon).toHaveLength(2)
    expect(afterRemove.pendingPolygon[0]).toEqual(pt(0, 0))
    expect(afterRemove.pendingPolygon[1]).toEqual(pt(10, 0))
    expect(afterRemove.drawMode).toBe('placing-polygon')
  })

  it('REMOVE_LAST_POLYGON_POINT returns to idle when last vertex removed', () => {
    let s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(5, 5) })
    const afterRemove = canvasDrawReducer(s, { type: 'REMOVE_LAST_POLYGON_POINT' })
    expect(afterRemove.pendingPolygon).toEqual([])
    expect(afterRemove.drawMode).toBe('idle')
  })

  it('RESET clears polygon accumulated from multiple adds', () => {
    let s = canvasDrawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: pt(0, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(10, 0) })
    s = canvasDrawReducer(s, { type: 'ADD_POLYGON_POINT', point: pt(10, 10) })
    const reset = canvasDrawReducer(s, { type: 'RESET' })
    expect(reset.pendingPolygon).toEqual([])
    expect(reset.drawMode).toBe('idle')
  })
})
