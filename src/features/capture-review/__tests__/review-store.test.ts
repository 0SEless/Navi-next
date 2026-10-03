import { describe, expect, it } from 'vitest'
import { createCaptureReviewStore, createMemoryReviewStorage, getDefaultCaptureReviewSelection } from '../review-store'

describe('Capture Reviewer state', () => {
  it('persists layer visibility and inclusion decisions under an isolated review key', async () => {
    const storage = createMemoryReviewStorage()
    const store = createCaptureReviewStore(storage)

    await store.getState().hydrate()
    store.getState().setSelectedItem('capture-1')
    store.getState().setLayerVisible('rawGps', false)
    store.getState().setRouteSegmentDecision('capture-1', 'segment-0', 'excluded')
    store.getState().setMarkerDecision('capture-1', 'marker-1', 'excluded')

    const restored = createCaptureReviewStore(storage)
    await restored.getState().hydrate()

    expect(storage.getItem('navi-capture-review-v1')).toContain('segment-0')
    expect(restored.getState().selectedItemId).toBe('capture-1')
    expect(restored.getState().layers.rawGps).toBe(false)
    expect(restored.getState().getSelection('capture-1')).toEqual({
      routeSegments: { 'segment-0': 'excluded' },
      markers: { 'marker-1': 'excluded' },
    })
  })

  it('defaults review objects to included and returns independent selection snapshots', () => {
    const store = createCaptureReviewStore(createMemoryReviewStorage())
    const first = store.getState().getSelection('capture-1')
    first.routeSegments['segment-0'] = 'excluded'

    expect(store.getState().getSelection('capture-1')).toEqual(getDefaultCaptureReviewSelection())
    expect(store.getState().layers).toEqual({
      rawGps: true,
      candidateRoute: true,
      candidateNodes: true,
      markers: true,
      gpsWarnings: true,
    })
  })
})

