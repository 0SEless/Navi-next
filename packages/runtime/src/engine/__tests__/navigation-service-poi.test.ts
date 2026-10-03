import { describe, expect, it } from 'vitest'
import type { POIIndex } from '@navi/core'
import { NavigationService } from '../navigation-service'

describe('Phase 4C NavigationService destination boundary', () => {
  it('exposes an additive POI destination request seam while preserving node routing', () => {
    const service = Object.create(NavigationService.prototype) as NavigationService & {
      findDestinationRoute?: (
        fromId: string,
        request: { destinationType: 'poi'; poiId: string },
        poiIndex?: POIIndex,
      ) => unknown
    }

    expect(typeof service.findDestinationRoute).toBe('function')
  })
})
