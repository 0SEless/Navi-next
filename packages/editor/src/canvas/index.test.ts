import { describe, it, expect } from 'vitest'
import { ENABLE_CANVAS_EDITOR } from './feature-flag'
import { createCamera, worldToScreen, screenToWorld, applyCamera, resetCamera, drawFloorPlanImage } from './viewport'
import { renderFloor, renderRooms, renderHallways, renderStairsElevators, renderInteractionOverlays } from './floor-renderer'
import { hitTestFloor, pointInPolygon, pointNearPolyline } from './hit-test'
import { handleCanvasClick } from './selection'
import { handleKeyboard } from './keyboard-nav'

describe('Canvas module exports', () => {
  it('feature flag is exported and is a boolean', () => {
    expect(typeof ENABLE_CANVAS_EDITOR).toBe('boolean')
  })

  it('viewport module exports all public functions', () => {
    expect(typeof createCamera).toBe('function')
    expect(typeof worldToScreen).toBe('function')
    expect(typeof screenToWorld).toBe('function')
    expect(typeof applyCamera).toBe('function')
    expect(typeof resetCamera).toBe('function')
    expect(typeof drawFloorPlanImage).toBe('function')
  })

  it('floor-renderer module exports all public functions', () => {
    expect(typeof renderFloor).toBe('function')
    expect(typeof renderRooms).toBe('function')
    expect(typeof renderHallways).toBe('function')
    expect(typeof renderStairsElevators).toBe('function')
    expect(typeof renderInteractionOverlays).toBe('function')
  })

  it('hit-test module exports all public functions', () => {
    expect(typeof hitTestFloor).toBe('function')
    expect(typeof pointInPolygon).toBe('function')
    expect(typeof pointNearPolyline).toBe('function')
  })

  it('selection module exports handleCanvasClick', () => {
    expect(typeof handleCanvasClick).toBe('function')
  })

  it('keyboard-nav module exports handleKeyboard', () => {
    expect(typeof handleKeyboard).toBe('function')
  })
})
