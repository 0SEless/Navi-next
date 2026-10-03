import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBuildingTracer } from '../BuildingTracer'
import type { DrawingSessionValue } from '../useDrawingSession'

const toolState = vi.hoisted(() => ({ activeTool: 'building' }))

vi.mock('../useCurrentTool', () => ({
  useCurrentTool: () => toolState.activeTool,
}))

function createMap(source: { setData: ReturnType<typeof vi.fn> }) {
  return {
    getSource: vi.fn(() => source),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
  } as any
}

function createDrawing(drawPoints: Array<{ lat: number; lng: number }>) {
  return {
    drawPoints,
    clearDrawPoints: vi.fn(),
  } as unknown as DrawingSessionValue
}

const threePoints = [
  { lat: 10, lng: 20 },
  { lat: 10, lng: 21 },
  { lat: 11, lng: 21 },
]

describe('Building draft tracer', () => {
  beforeEach(() => {
    toolState.activeTool = 'building'
  })

  it('redraws the Building tracer when draft points are undone', () => {
    const source = { setData: vi.fn() }
    const map = createMap(source)
    const { rerender } = renderHook(
      ({ drawing }) => useBuildingTracer(map, undefined, drawing),
      { initialProps: { drawing: createDrawing(threePoints) } },
    )

    rerender({ drawing: createDrawing(threePoints.slice(0, 2)) })

    const latest = source.setData.mock.calls.at(-1)?.[0]
    expect(latest.features).toHaveLength(3)
    expect(latest.features.some((feature: GeoJSON.Feature) => feature.geometry.type === 'Polygon')).toBe(false)
  })
})
