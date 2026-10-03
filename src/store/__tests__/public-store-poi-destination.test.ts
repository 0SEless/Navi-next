import { afterEach, describe, expect, it } from 'vitest'
import { usePublicStore } from '../public-store'

describe('Phase 4C public POI destination state', () => {
  afterEach(() => {
    usePublicStore.setState({
      fromNode: null,
      toNode: null,
      poiDestination: null,
    })
  })

  it('stores a stable POI request separately from the legacy toNode field', () => {
    const state = usePublicStore.getState() as typeof usePublicStore extends never ? never : {
      setPoiDestination?: (poiId: string | null) => void
      poiDestination?: { destinationType: 'poi'; poiId: string } | null
      toNode: string | null
    }
    expect(typeof state.setPoiDestination).toBe('function')
    state.setPoiDestination?.('poi-study-area')

    const next = usePublicStore.getState() as typeof state
    expect(next.toNode).toBeNull()
    expect(next.poiDestination).toEqual({ destinationType: 'poi', poiId: 'poi-study-area' })
  })

  it('exposes a destination-route query boundary for the selected POI', () => {
    const state = usePublicStore.getState() as typeof usePublicStore extends never ? never : {
      findDestinationRoute?: (fromId: string) => unknown
    }
    expect(typeof state.findDestinationRoute).toBe('function')
  })
})
