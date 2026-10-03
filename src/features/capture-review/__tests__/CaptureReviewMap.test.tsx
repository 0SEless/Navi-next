import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Road } from '@navi/core'
import type { CaptureSession } from '@/features/capture/types'
import { CaptureReviewMap } from '../components/CaptureReviewMap'
import type { ReviewLayerKey } from '../types'

const { fakeMap } = vi.hoisted(() => ({
  fakeMap: {
    getSource: vi.fn(() => undefined),
    addSource: vi.fn(),
    getLayer: vi.fn(() => undefined),
    addLayer: vi.fn(),
    setLayoutProperty: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    fitBounds: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
    dragPan: {
      disable: vi.fn(),
      enable: vi.fn(),
    },
  },
}))

vi.mock('@/components/map/NavigationMap', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="navigation-map">{children}</div>,
  useNavigationMap: () => ({ map: fakeMap, isReady: true }),
}))

const session: CaptureSession = {
  schemaVersion: 1,
  id: 'capture-map-1',
  title: 'Review path',
  status: 'finished',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:01:00.000Z',
  startedAt: '2026-08-31T10:00:00.000Z',
  finishedAt: '2026-08-31T10:01:00.000Z',
  rawSamples: [
    { sequence: 0, timestamp: '2026-08-31T10:00:00.000Z', latitude: 11.8, longitude: 122.1, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    { sequence: 1, timestamp: '2026-08-31T10:01:00.000Z', latitude: 11.801, longitude: 122.101, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  ],
  candidateRoute: {
    points: [{ latitude: 11.8, longitude: 122.1 }, { latitude: 11.801, longitude: 122.101 }],
    sourceSampleIndices: [0, 1],
    edgeCount: 1,
    derivedFromSampleCount: 2,
    derivedAt: '2026-08-31T10:01:00.000Z',
    algorithmVersion: 'capture-dp-v1',
  },
  markers: [{ id: 'marker-1', type: 'poi', position: { latitude: 11.8, longitude: 122.1 }, createdAt: '2026-08-31T10:00:30.000Z' }],
}

const allLayers: Record<ReviewLayerKey, boolean> = {
  rawGps: true,
  candidateRoute: true,
  candidateNodes: true,
  markers: true,
  gpsWarnings: true,
}

describe('CaptureReviewMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeMap.getSource.mockImplementation(() => undefined)
    fakeMap.getLayer.mockImplementation(() => undefined)
  })

  it('creates independent namespaced sources/layers and applies layer visibility', async () => {
    render(<CaptureReviewMap session={session} campusMap={null} layers={{ ...allLayers, rawGps: false }} selection={{ routeSegments: {}, markers: {} }} />)

    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('capture-review-raw-route', expect.anything()))

    const sourceIds = fakeMap.addSource.mock.calls.map(([id]) => id)
    expect(sourceIds).toEqual(expect.arrayContaining([
      'capture-review-campus',
      'capture-review-raw-route',
      'capture-review-candidate-route',
      'capture-review-candidate-nodes',
      'capture-review-markers',
      'capture-review-gps-warnings',
    ]))
    const layerIds = fakeMap.addLayer.mock.calls.map(([layer]) => layer.id)
    expect(layerIds).toEqual(expect.arrayContaining([
      'capture-review-raw-route-line',
      'capture-review-candidate-route-line',
      'capture-review-candidate-node-points',
      'capture-review-marker-points',
      'capture-review-gps-warning-lines',
    ]))
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith('capture-review-raw-route-line', 'visibility', 'none')
  })

  it('cleans up safely after the map context is torn down', async () => {
    const { unmount } = render(<CaptureReviewMap session={session} campusMap={null} layers={allLayers} selection={{ routeSegments: {}, markers: {} }} />)
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalled())

    fakeMap.getLayer.mockImplementation(() => { throw new Error('map already removed') })
    await act(async () => { unmount() })

    expect(true).toBe(true)
  })

  it('adds namespaced existing-road preview layers when Studio supplies canonical Roads', async () => {
    const existingRoads: Road[] = [{
      id: 'road-existing-1',
      name: 'Existing walkway',
      polyline: { points: [{ lat: 11.799, lng: 122.099 }, { lat: 11.8, lng: 122.1 }] },
      width: 3,
      surface: 'paved',
      type: 'pedestrian',
      displayMode: 'visible',
      metadata: {},
    }]

    render(<CaptureReviewMap session={session} campusMap={null} existingRoads={existingRoads} layers={allLayers} selection={{ routeSegments: {}, markers: {} }} />)

    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('capture-import-existing-roads', expect.anything()))
    const layerIds = fakeMap.addLayer.mock.calls.map(([layer]) => layer.id)
    expect(layerIds).toContain('capture-import-existing-roads-line')
  })

  it('renders explicit endpoint snap targets in a separate namespaced layer', async () => {
    render(<CaptureReviewMap
      session={session}
      campusMap={null}
      layers={allLayers}
      selection={{ routeSegments: {}, markers: {} }}
      snapTargets={[{
        endpoint: 'start',
        roadId: 'road-existing-1',
        roadName: 'Existing walkway',
        segmentIndex: 0,
        coordinate: { latitude: 11.80005, longitude: 122.1 },
        distanceMeters: 5.5,
      }]}
    />)

    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('capture-review-snap-targets', expect.anything()))
    const layerIds = fakeMap.addLayer.mock.calls.map(([layer]) => layer.id)
    expect(layerIds).toContain('capture-review-snap-target-points')
  })

  it('wires explicit move, add, and remove gestures without requiring map events in read-only mode', async () => {
    const onMovePoint = vi.fn()
    const onAddPoint = vi.fn()
    const onRemovePoint = vi.fn()
    render(<CaptureReviewMap
      session={session}
      campusMap={null}
      layers={allLayers}
      selection={{ routeSegments: {}, markers: {} }}
      editMode="move"
      onMovePoint={onMovePoint}
      onAddPoint={onAddPoint}
      onRemovePoint={onRemovePoint}
    />)

    await waitFor(() => expect(fakeMap.on).toHaveBeenCalledWith('mousedown', 'capture-review-candidate-node-points', expect.any(Function)))
    const mouseDown = fakeMap.on.mock.calls.find(([event, layer]) => event === 'mousedown' && layer === 'capture-review-candidate-node-points')?.[2] as ((event: unknown) => void) | undefined
    const mouseMove = fakeMap.on.mock.calls.find(([event]) => event === 'mousemove')?.[1] as ((event: unknown) => void) | undefined
    const mouseUp = fakeMap.on.mock.calls.find(([event]) => event === 'mouseup')?.[1] as ((event: unknown) => void) | undefined
    expect(mouseDown).toBeTypeOf('function')
    expect(mouseMove).toBeTypeOf('function')
    expect(mouseUp).toBeTypeOf('function')

    act(() => mouseDown?.({ features: [{ properties: { nodeIndex: 1 } }] }))
    act(() => mouseMove?.({ lngLat: { lat: 11.8004, lng: 122.1004 } }))
    act(() => mouseUp?.({}))
    expect(onMovePoint).toHaveBeenCalledWith(1, { latitude: 11.8004, longitude: 122.1004 })
    expect(fakeMap.dragPan.disable).toHaveBeenCalled()
    expect(fakeMap.dragPan.enable).toHaveBeenCalled()

    vi.clearAllMocks()
    render(<CaptureReviewMap
      session={session}
      campusMap={null}
      layers={allLayers}
      selection={{ routeSegments: {}, markers: {} }}
      editMode="add"
      onAddPoint={onAddPoint}
      onRemovePoint={onRemovePoint}
    />)
    await waitFor(() => expect(fakeMap.on).toHaveBeenCalledWith('click', expect.any(Function)))
    const addClick = fakeMap.on.mock.calls.find(([event]) => event === 'click')?.[1] as ((event: unknown) => void) | undefined
    act(() => addClick?.({ lngLat: { lat: 11.8006, lng: 122.1006 } }))
    expect(onAddPoint).toHaveBeenCalledWith({ latitude: 11.8006, longitude: 122.1006 })

    vi.clearAllMocks()
    render(<CaptureReviewMap
      session={session}
      campusMap={null}
      layers={allLayers}
      selection={{ routeSegments: {}, markers: {} }}
      editMode="remove"
      onRemovePoint={onRemovePoint}
    />)
    await waitFor(() => expect(fakeMap.on).toHaveBeenCalledWith('click', 'capture-review-candidate-node-points', expect.any(Function)))
    const removeClick = fakeMap.on.mock.calls.find(([event, layer]) => event === 'click' && layer === 'capture-review-candidate-node-points')?.[2] as ((event: unknown) => void) | undefined
    act(() => removeClick?.({ features: [{ properties: { nodeIndex: 1 } }] }))
    expect(onRemovePoint).toHaveBeenCalledWith(1)
  })
})
