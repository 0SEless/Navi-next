import { describe, expect, it } from 'vitest'
import type { LocalCoord } from '@navi/core'
import {
  buildPOIGeometry,
  localDistance,
  normalizeRectangle,
} from '../poi-geometry-authoring'

describe('Phase 3C local POI geometry authoring helpers', () => {
  it('measures circle radius in local meters', () => {
    const center: LocalCoord = { x: 10, y: 20 }
    const current: LocalCoord = { x: 13, y: 24 }

    expect(localDistance(center, current)).toBe(5)
    expect(buildPOIGeometry('poi-circle', { center, current })).toEqual({
      type: 'circle',
      center,
      radius: 5,
    })
  })

  it('normalizes rectangle bounds regardless of drag direction', () => {
    const first: LocalCoord = { x: 8, y: 9 }
    const current: LocalCoord = { x: 2, y: 4 }

    expect(normalizeRectangle(first, current)).toEqual({
      min: { x: 2, y: 4 },
      max: { x: 8, y: 9 },
    })
    expect(buildPOIGeometry('poi-rectangle', { first, current })).toEqual({
      type: 'rectangle',
      min: { x: 2, y: 4 },
      max: { x: 8, y: 9 },
    })
  })

  it('preserves polygon order as an open ring', () => {
    const points: LocalCoord[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ]

    expect(buildPOIGeometry('poi-polygon', { points })).toEqual({
      type: 'polygon',
      points,
    })
    expect(buildPOIGeometry('poi-polygon', { points })?.type).toBe('polygon')
    expect((buildPOIGeometry('poi-polygon', { points }) as { type: 'polygon'; points: LocalCoord[] }).points).toHaveLength(3)
  })

  it('rejects zero-radius, degenerate, and incomplete drafts', () => {
    expect(buildPOIGeometry('poi-circle', {
      center: { x: 1, y: 1 },
      current: { x: 1, y: 1 },
    })).toBeNull()
    expect(buildPOIGeometry('poi-rectangle', {
      first: { x: 1, y: 1 },
      current: { x: 1, y: 2 },
    })).toBeNull()
    expect(buildPOIGeometry('poi-polygon', {
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    })).toBeNull()
  })
})
