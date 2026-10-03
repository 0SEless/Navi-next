import { describe, expect, it } from 'vitest'
import { tracesToGeoJSON } from './PublicMap'

describe('tracesToGeoJSON', () => {
  it('keeps visible routes and excludes navigation-only routes from public map geometry', () => {
    const result = tracesToGeoJSON([
      { id: 'visible', name: 'Main road', type: 'arterial', points: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }] },
      { id: 'hidden', name: 'Invisible connector', type: 'connector', displayMode: 'navigation-only', points: [{ lat: 2, lng: 2 }, { lat: 2, lng: 3 }] },
    ] as any)

    expect(result.features).toHaveLength(1)
    expect(result.features[0].properties?.name).toBe('Main road')
  })
})
