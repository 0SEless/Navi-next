import { describe, expect, it } from 'vitest'
import { resolveApproachAnchorWorld } from '../poi-anchor-overlay'

/**
 * The Studio overlay draws a marker for the selected POI's preferred approach
 * anchor. This helper resolves the stored geometry-relative anchor into a world
 * position for both scopes.
 */
describe('resolveApproachAnchorWorld', () => {
  it('projects an outdoor circle-angle anchor to world coordinates', () => {
    const result = resolveApproachAnchorWorld({
      scope: 'outdoor',
      geometry: { type: 'circle', center: { lat: 10, lng: 20 }, radius: 100 },
      navigation: { approachMode: 'preferred', anchor: { kind: 'circle-angle', angle: 0 } },
    })

    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(10, 5)
    // angle 0 = due east; longitude grows by radius / meters-per-degree
    expect(result!.lng).toBeGreaterThan(20)
  })

  it('projects an outdoor rectangle-edge anchor to the edge midpoint', () => {
    const points = [
      { lat: 1, lng: 1 },
      { lat: 1, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 1 },
    ]
    const result = resolveApproachAnchorWorld({
      scope: 'outdoor',
      geometry: { type: 'rectangle', points },
      navigation: { approachMode: 'preferred', anchor: { kind: 'rectangle-edge', edge: 0, t: 0.5 } },
    })

    expect(result).toEqual({ lat: 1, lng: 1.5 })
  })

  it('projects an indoor anchor through the supplied local-to-world transform', () => {
    const result = resolveApproachAnchorWorld({
      scope: 'indoor',
      geometry: { type: 'circle', center: { x: 5, y: 5 }, radius: 2 },
      navigation: { approachMode: 'preferred', anchor: { kind: 'circle-angle', angle: 0 } },
      localToWorld: (local) => ({ lat: local.x, lng: local.y }),
    })

    expect(result).toEqual({ lat: 7, lng: 5 })
  })

  it('returns null without a preferred anchor', () => {
    const base = {
      scope: 'outdoor' as const,
      geometry: { type: 'circle' as const, center: { lat: 10, lng: 20 }, radius: 100 },
    }
    expect(resolveApproachAnchorWorld({ ...base })).toBeNull()
    expect(resolveApproachAnchorWorld({ ...base, navigation: { approachMode: 'automatic', anchor: { kind: 'circle-angle', angle: 1 } } })).toBeNull()
  })

  it('returns null for point geometry and indoor anchors without a transform', () => {
    expect(resolveApproachAnchorWorld({
      scope: 'outdoor',
      geometry: { type: 'point', position: { lat: 1, lng: 1 } },
      navigation: { approachMode: 'preferred', anchor: { kind: 'circle-angle', angle: 0 } },
    })).toBeNull()

    expect(resolveApproachAnchorWorld({
      scope: 'indoor',
      geometry: { type: 'rectangle', min: { x: 0, y: 0 }, max: { x: 4, y: 4 } },
      navigation: { approachMode: 'preferred', anchor: { kind: 'rectangle-edge', edge: 0, t: 0.5 } },
    })).toBeNull()
  })
})
