import { describe, it, expect } from 'vitest'
import { drawReducer, type DrawState } from '../draw-reducer'

const INITIAL: DrawState = { drawMode: 'idle', pendingPoints: [], pendingPolygon: [] }
const a = { lat: 10, lng: 120 }
const b = { lat: 11, lng: 121 }

describe('drawReducer', () => {
  it('returns initial state on RESET', () => {
    expect(drawReducer(INITIAL, { type: 'RESET' })).toEqual(INITIAL)
  })

  it('RESET clears non-idle state', () => {
    const mid = drawReducer(INITIAL, { type: 'ADD_POINT', point: a })
    expect(mid.drawMode).toBe('placing-points')
    expect(drawReducer(mid, { type: 'RESET' })).toEqual(INITIAL)
  })

  it('ADD_POINT appends point and sets placing-points mode', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POINT', point: a })
    expect(s.drawMode).toBe('placing-points')
    expect(s.pendingPoints).toEqual([a])
    expect(s.pendingPolygon).toEqual([])
  })

  it('ADD_POINT accumulates multiple points', () => {
    const s1 = drawReducer(INITIAL, { type: 'ADD_POINT', point: a })
    const s2 = drawReducer(s1, { type: 'ADD_POINT', point: b })
    expect(s2.pendingPoints).toEqual([a, b])
    expect(s2.drawMode).toBe('placing-points')
  })

  it('ADD_POLYGON_POINT appends point and sets placing-polygon mode', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: a })
    expect(s.drawMode).toBe('placing-polygon')
    expect(s.pendingPolygon).toEqual([a])
    expect(s.pendingPoints).toEqual([])
  })

  it('ADD_POLYGON_POINT accumulates multiple points', () => {
    const s1 = drawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: a })
    const s2 = drawReducer(s1, { type: 'ADD_POLYGON_POINT', point: b })
    expect(s2.pendingPolygon).toEqual([a, b])
    expect(s2.drawMode).toBe('placing-polygon')
  })

  it('CLEAR_POINTS resets points to idle', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POINT', point: a })
    const cleared = drawReducer(s, { type: 'CLEAR_POINTS' })
    expect(cleared.drawMode).toBe('idle')
    expect(cleared.pendingPoints).toEqual([])
  })

  it('CLEAR_POLYGON resets polygon to idle', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: a })
    const cleared = drawReducer(s, { type: 'CLEAR_POLYGON' })
    expect(cleared.drawMode).toBe('idle')
    expect(cleared.pendingPolygon).toEqual([])
  })

  it('sets idle on CLEAR_POINTS even when polygon has points', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POINT', point: a })
    const s2 = drawReducer(s, { type: 'ADD_POLYGON_POINT', point: b })
    const cleared = drawReducer(s2, { type: 'CLEAR_POINTS' })
    expect(cleared.pendingPoints).toEqual([])
    expect(cleared.pendingPolygon).toEqual([b])
    expect(cleared.drawMode).toBe('idle')
  })

  it('sets idle on CLEAR_POLYGON even when points exist', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: a })
    const s2 = drawReducer(s, { type: 'ADD_POINT', point: b })
    const cleared = drawReducer(s2, { type: 'CLEAR_POLYGON' })
    expect(cleared.pendingPolygon).toEqual([])
    expect(cleared.pendingPoints).toEqual([b])
    expect(cleared.drawMode).toBe('idle')
  })

  it('ADD_POINT preserves existing polygon', () => {
    const s = drawReducer(INITIAL, { type: 'ADD_POLYGON_POINT', point: a })
    const s2 = drawReducer(s, { type: 'ADD_POINT', point: b })
    expect(s2.pendingPolygon).toEqual([a])
    expect(s2.pendingPoints).toEqual([b])
  })
})
