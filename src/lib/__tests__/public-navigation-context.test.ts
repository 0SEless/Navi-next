import { describe, expect, it } from 'vitest'
import {
  isIndoorContextVisible,
  selectAuthoritativeNavigationContext,
} from '../public-navigation-context'

const fallback = {
  route: null,
  currentNodeId: null,
  location: null,
  buildingId: undefined,
  floor: undefined,
  activeFloor: 0,
  navigationSegment: 'outdoor' as const,
  indoorContext: { active: false },
}

const live = {
  ...fallback,
  route: { path: ['outdoor', 'entry'] },
  currentNodeId: 'entry',
  location: { lat: 11.82, lng: 122.168 },
  buildingId: 'b1',
  floor: 3,
  activeFloor: 3,
  navigationSegment: 'entrance' as const,
  indoorContext: { active: true, buildingId: 'b1', floorId: 3 },
}

describe('public navigation context contract', () => {
  it('selects the live parent context over a standalone fallback provider', () => {
    expect(selectAuthoritativeNavigationContext(live, fallback)).toBe(live)
    expect(selectAuthoritativeNavigationContext(null, fallback)).toBe(fallback)
  })

  it('makes indoor layer visibility explicit', () => {
    expect(isIndoorContextVisible({ active: true, buildingId: 'b1', floorId: 3 })).toBe(true)
    expect(isIndoorContextVisible({ active: false, buildingId: 'b1', floorId: 3 })).toBe(false)
  })
})
