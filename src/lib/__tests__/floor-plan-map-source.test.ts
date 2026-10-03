import { describe, expect, it, vi } from 'vitest'
import * as sourceModule from '../floor-plan-map-source'

const syncFloorPlanImageLayer = sourceModule.syncFloorPlanImageLayer

describe('floor-plan MapLibre source lifecycle', () => {
  it('hides an existing layer when the image or footprint becomes invalid', () => {
    expect(syncFloorPlanImageLayer).toBeTypeOf('function')
    if (!syncFloorPlanImageLayer) return

    const setLayoutProperty = vi.fn()
    const map = {
      getLayer: vi.fn(() => ({ id: 'floor-floorplan-layer' })),
      setLayoutProperty,
    }

    const rendered = syncFloorPlanImageLayer(map, {
      sourceId: 'floor-floorplan',
      layerId: 'floor-floorplan-layer',
      imageUrl: undefined,
      footprint: [],
    })

    expect(rendered).toBe(false)
    expect(setLayoutProperty).toHaveBeenCalledWith('floor-floorplan-layer', 'visibility', 'none')
  })

  it('updates coordinates without reloading pixels when the URL is unchanged', () => {
    expect(syncFloorPlanImageLayer).toBeTypeOf('function')
    if (!syncFloorPlanImageLayer) return

    const setCoordinates = vi.fn()
    const updateImage = vi.fn()
    const map = {
      getSource: vi.fn(() => ({ url: 'plan.png', setCoordinates, updateImage })),
      getLayer: vi.fn(() => ({ id: 'floor-floorplan-layer' })),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
    }

    const rendered = syncFloorPlanImageLayer(map, {
      sourceId: 'floor-floorplan',
      layerId: 'floor-floorplan-layer',
      imageUrl: 'plan.png',
      footprint: [
        { lat: 14, lng: 121 },
        { lat: 14, lng: 121.001 },
        { lat: 14.001, lng: 121.001 },
      ],
      alignment: { scaleX: 1.2, scaleY: 0.8 },
    })

    expect(rendered).toBe(true)
    expect(setCoordinates).toHaveBeenCalledTimes(1)
    expect(updateImage).not.toHaveBeenCalled()
  })

  it('reloads pixels exactly once when the URL changes', () => {
    const updateImage = vi.fn()
    const map = {
      getSource: vi.fn(() => ({ url: 'old.png', setCoordinates: vi.fn(), updateImage })),
      getLayer: vi.fn(() => ({ id: 'floor-floorplan-layer' })),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
    }

    expect(syncFloorPlanImageLayer(map, {
      sourceId: 'floor-floorplan',
      layerId: 'floor-floorplan-layer',
      imageUrl: 'new.png',
      footprint: [
        { lat: 14, lng: 121 },
        { lat: 14, lng: 121.001 },
        { lat: 14.001, lng: 121.001 },
      ],
    })).toBe(true)
    expect(updateImage).toHaveBeenCalledTimes(1)
    expect(updateImage.mock.calls[0][0].url).toBe('new.png')
  })
})
