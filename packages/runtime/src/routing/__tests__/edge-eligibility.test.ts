import type { NavEdge, RoadRouting } from '@navi/core'
import { describe, expect, it } from 'vitest'
import {
  STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
  isTraversalEligible,
} from '../index'

function edge(authored?: RoadRouting): NavEdge {
  return {
    id: 'edge-1',
    from: 'a',
    to: 'b',
    type: 'walk',
    distance: 10,
    weight: 10,
    ...(authored
      ? {
          routing: {
            sourceRoadId: 'road-1',
            authoredOrientation: 'forward' as const,
            authored,
          },
        }
      : {}),
  }
}

function eligible(candidate: NavEdge, from: string): boolean {
  return isTraversalEligible(candidate, from, STANDARD_PEDESTRIAN_ELIGIBILITY_V1)
}

describe('STANDARD_PEDESTRIAN_ELIGIBILITY_V1', () => {
  it('exports an explicit version', () => {
    expect(STANDARD_PEDESTRIAN_ELIGIBILITY_V1.version).toBe(
      'STANDARD_PEDESTRIAN_ELIGIBILITY_V1',
    )
  })

  it('keeps legacy and missing-direction edges bidirectionally eligible', () => {
    expect(eligible(edge(), 'a')).toBe(true)
    expect(eligible(edge(), 'b')).toBe(true)
    expect(eligible(edge({}), 'a')).toBe(true)
    expect(eligible(edge({}), 'b')).toBe(true)
  })

  it('allows both directions when direction is both', () => {
    expect(eligible(edge({ direction: 'both' }), 'a')).toBe(true)
    expect(eligible(edge({ direction: 'both' }), 'b')).toBe(true)
  })

  it('allows only edge.from to edge.to for forward Roads', () => {
    expect(eligible(edge({ direction: 'forward' }), 'a')).toBe(true)
    expect(eligible(edge({ direction: 'forward' }), 'b')).toBe(false)
  })

  it('allows only edge.to to edge.from for reverse Roads', () => {
    expect(eligible(edge({ direction: 'reverse' }), 'a')).toBe(false)
    expect(eligible(edge({ direction: 'reverse' }), 'b')).toBe(true)
  })

  it('rejects walkable false in both directions', () => {
    expect(eligible(edge({ walkable: false }), 'a')).toBe(false)
    expect(eligible(edge({ walkable: false }), 'b')).toBe(false)
    expect(eligible(edge({ walkable: false, direction: 'forward' }), 'a')).toBe(false)
  })

  it('treats absent and true walkability equivalently', () => {
    expect(eligible(edge({ walkable: true }), 'a')).toBe(true)
    expect(eligible(edge({}), 'a')).toBe(true)
  })

  it('keeps wheelchair metadata passive in standard pedestrian routing', () => {
    expect(eligible(edge({ wheelchairAccessible: false }), 'a')).toBe(true)
    expect(eligible(edge({ wheelchairAccessible: true }), 'a')).toBe(true)
    expect(eligible(edge({ wheelchairAccessible: false, direction: 'forward' }), 'b')).toBe(false)
  })

  it('treats malformed routing wrappers as legacy eligibility', () => {
    const invalid = edge({ walkable: false })
    invalid.routing = {
      ...invalid.routing!,
      unexpected: true,
    } as unknown as NavEdge['routing']

    expect(eligible(invalid, 'a')).toBe(true)
    expect(eligible(invalid, 'b')).toBe(true)
  })

  it('rejects traversal from outside the edge', () => {
    expect(() => eligible(edge(), 'not-an-endpoint')).toThrow(/edge endpoint/i)
  })
})
