import { describe, expect, it } from 'vitest'
import * as core from '@navi/core'

type AppearanceApi = {
  DEFAULT_POI_2_5D_HEIGHT?: number
  validatePointOfInterestAppearance?: (appearance: unknown, geometry: unknown) => { valid: boolean; error?: string }
  resolvePointOfInterestAppearance?: (poi: unknown) => { mode: string; height?: number } | null
  resolveOutdoorPointOfInterestAppearance?: (poi: unknown) => { mode: string; height?: number } | null
}

const api = core as unknown as AppearanceApi

const pointGeometry = { type: 'point', position: { x: 1, y: 2 } }
const rectangleGeometry = { type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 4, y: 3 } }
const worldPointGeometry = { type: 'point', position: { lat: 25.6, lng: 122.9 } }
const worldRectangleGeometry = {
  type: 'rectangle',
  points: [{ lat: 25.6, lng: 122.9 }, { lat: 25.6, lng: 122.91 }, { lat: 25.61, lng: 122.91 }, { lat: 25.61, lng: 122.9 }],
}

describe('POI appearance contract', () => {
  it('resolves the additive defaults without changing legacy point identity', () => {
    expect(typeof api.resolvePointOfInterestAppearance).toBe('function')
    if (!api.resolvePointOfInterestAppearance) return

    expect(api.resolvePointOfInterestAppearance({
      id: 'poi-point', name: 'Point', category: 'other', position: { x: 1, y: 2 },
    })).toEqual({ mode: 'marker' })
    expect(api.resolvePointOfInterestAppearance({
      id: 'poi-rectangle', name: 'Rectangle', category: 'other', geometry: rectangleGeometry,
    })).toEqual({ mode: '2d' })
  })

  it('accepts bounded 2.5D appearance for a shape and resolves its default height', () => {
    expect(typeof api.validatePointOfInterestAppearance).toBe('function')
    expect(typeof api.DEFAULT_POI_2_5D_HEIGHT).toBe('number')
    if (!api.validatePointOfInterestAppearance || typeof api.DEFAULT_POI_2_5D_HEIGHT !== 'number') return

    expect(api.validatePointOfInterestAppearance({ mode: '2.5d', height: 4.25 }, rectangleGeometry).valid).toBe(true)

    expect(typeof api.resolvePointOfInterestAppearance).toBe('function')
    if (!api.resolvePointOfInterestAppearance) return
    expect(api.resolvePointOfInterestAppearance({
      id: 'poi-rectangle', name: 'Rectangle', category: 'other',
      geometry: rectangleGeometry, appearance: { mode: '2.5d' },
    })).toEqual({ mode: '2.5d', height: api.DEFAULT_POI_2_5D_HEIGHT })
  })

  it('rejects incompatible modes and non-finite or non-positive heights', () => {
    expect(typeof api.validatePointOfInterestAppearance).toBe('function')
    if (!api.validatePointOfInterestAppearance) return

    for (const [appearance, geometry] of [
      [{ mode: '2d' }, pointGeometry],
      [{ mode: '2.5d', height: 3 }, pointGeometry],
      [{ mode: 'marker' }, rectangleGeometry],
      [{ mode: '2.5d', height: 0 }, rectangleGeometry],
      [{ mode: '2.5d', height: -1 }, rectangleGeometry],
      [{ mode: '2.5d', height: Number.NaN }, rectangleGeometry],
      [{ mode: '2.5d', height: Number.POSITIVE_INFINITY }, rectangleGeometry],
    ] as const) {
      expect(api.validatePointOfInterestAppearance(appearance, geometry).valid).toBe(false)
    }
  })

  it('applies the same appearance contract to outdoor world geometry', () => {
    expect(typeof api.validatePointOfInterestAppearance).toBe('function')
    if (!api.validatePointOfInterestAppearance) return

    expect(api.validatePointOfInterestAppearance(undefined, worldPointGeometry).valid).toBe(true)
    expect(api.validatePointOfInterestAppearance({ mode: 'marker' }, worldPointGeometry).valid).toBe(true)
    expect(api.validatePointOfInterestAppearance({ mode: '2d' }, worldPointGeometry).valid).toBe(false)
    expect(api.validatePointOfInterestAppearance({ mode: '2.5d', height: 4 }, worldRectangleGeometry).valid).toBe(true)
    expect(api.validatePointOfInterestAppearance({ mode: 'marker' }, worldRectangleGeometry).valid).toBe(false)
    expect(api.validatePointOfInterestAppearance({ mode: '2.5d', height: 0 }, worldRectangleGeometry).valid).toBe(false)
  })

  it('resolves outdoor defaults and explicit 2.5D heights', () => {
    expect(typeof api.resolveOutdoorPointOfInterestAppearance).toBe('function')
    if (!api.resolveOutdoorPointOfInterestAppearance) return

    expect(api.resolveOutdoorPointOfInterestAppearance({
      id: 'poi-guard-post', name: 'Guard Post', category: 'other', scope: 'outdoor', geometry: worldPointGeometry,
    })).toEqual({ mode: 'marker' })
    expect(api.resolveOutdoorPointOfInterestAppearance({
      id: 'poi-court', name: 'Court', category: 'other', scope: 'outdoor', geometry: worldRectangleGeometry,
    })).toEqual({ mode: '2d' })
    expect(api.resolveOutdoorPointOfInterestAppearance({
      id: 'poi-court', name: 'Court', category: 'other', scope: 'outdoor',
      geometry: worldRectangleGeometry, appearance: { mode: '2.5d' },
    })).toEqual({ mode: '2.5d', height: api.DEFAULT_POI_2_5D_HEIGHT })
  })
})
