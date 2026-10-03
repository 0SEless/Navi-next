import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationPositionMarker } from '../NavigationPositionMarker'

const markerFixture = vi.hoisted(() => {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn>; options: unknown }>()
  const layers = new Set<string>()
  const images = new Set<string>()
  const map = {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, options: unknown) => {
      sources.set(id, { setData: vi.fn(), options })
    }),
    getLayer: vi.fn((id: string) => layers.has(id) ? {} : undefined),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id)
    }),
    hasImage: vi.fn((id: string) => images.has(id)),
    addImage: vi.fn((id: string) => {
      images.add(id)
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id)
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id)
    }),
    removeImage: vi.fn((id: string) => {
      images.delete(id)
    }),
  }

  return {
    sources,
    layers,
    images,
    map,
    context: {
      location: { lat: 11.81830075, lng: 122.17159818 } as { lat: number; lng: number } | null,
      heading: 359 as number | null,
      headingFollow: false,
    },
  }
})

vi.mock('@/components/map/NavigationMap', () => ({
  useNavigationMap: () => ({ map: markerFixture.map, isReady: true }),
}))

vi.mock('@/components/map/NavigationContext', () => ({
  useOptionalNavigationContext: () => markerFixture.context,
}))

vi.mock('maplibre-gl', () => ({ default: {} }))

function latestFeature(sourceId: string): GeoJSON.Feature | undefined {
  return markerFixture.sources.get(sourceId)?.setData.mock.calls.at(-1)?.[0]?.features?.[0]
}

beforeEach(() => {
  markerFixture.context.location = { lat: 11.81830075, lng: 122.17159818 }
  markerFixture.context.heading = 359
  markerFixture.context.headingFollow = false
  markerFixture.sources.clear()
  markerFixture.layers.clear()
  markerFixture.images.clear()
  markerFixture.map.addSource.mockClear()
  markerFixture.map.addLayer.mockClear()
  markerFixture.map.addImage.mockClear()
  markerFixture.map.removeLayer.mockClear()
  markerFixture.map.removeSource.mockClear()
  markerFixture.map.removeImage.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NavigationPositionMarker', () => {
  it('renders the shared Capture-compatible dot and arrow without a DOM marker or beam', () => {
    render(<NavigationPositionMarker />)

    expect(markerFixture.map.addSource).toHaveBeenCalledWith('navigate-current-position', expect.objectContaining({ type: 'geojson' }))
    expect(markerFixture.map.addSource).toHaveBeenCalledWith('navigate-current-direction', expect.objectContaining({ type: 'geojson' }))
    const layers = markerFixture.map.addLayer.mock.calls.map(([layer]) => layer as { id: string; type: string; source?: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> })
    const arrow = layers.find(layer => layer.id === 'navigate-current-direction-arrow')
    const dot = layers.find(layer => layer.id === 'navigate-current-position-point')

    expect(layers).toHaveLength(2)
    expect(arrow).toMatchObject({
      type: 'symbol',
      source: 'navigate-current-direction',
      layout: {
        'icon-anchor': 'bottom',
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
      },
    })
    expect(dot).toEqual({
      id: 'navigate-current-position-point',
      type: 'circle',
      source: 'navigate-current-position',
      paint: {
        'circle-color': '#059669',
        'circle-radius': 8,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 3,
      },
    })
    expect(layers.some(layer => layer.type === 'fill' || /beam|core|outer|inner/.test(layer.id))).toBe(false)
    expect(latestFeature('navigate-current-position')?.geometry).toEqual({
      type: 'Point',
      coordinates: [122.17159818, 11.81830075],
    })
    expect(latestFeature('navigate-current-direction')?.properties).toEqual({
      kind: 'navigation-forward-heading-arrow',
      heading: 359,
    })
  })

  it('updates the marker coordinate for sequential live positions without changing the route seam', () => {
    const { rerender } = render(<NavigationPositionMarker />)
    const positions = [
      { lat: 11.81830075, lng: 122.17159818 },
      { lat: 11.81840075, lng: 122.17169818 },
      { lat: 11.81850075, lng: 122.17179818 },
    ]

    for (const position of positions) {
      markerFixture.context.location = position
      rerender(<NavigationPositionMarker />)
    }

    const coordinates = markerFixture.sources.get('navigate-current-position')?.setData.mock.calls
      .map(([data]) => (data as GeoJSON.FeatureCollection).features[0]?.geometry)
      .filter(Boolean)
      .map((geometry) => (geometry as GeoJSON.Point).coordinates)
    expect(coordinates).toContainEqual([122.17159818, 11.81830075])
    expect(coordinates).toContainEqual([122.17169818, 11.81840075])
    expect(coordinates).toContainEqual([122.17179818, 11.81850075])
  })

  it('updates the shared arrow heading through cardinal and wraparound changes', () => {
    const { rerender } = render(<NavigationPositionMarker />)
    const headings = [0, 90, 180, 270, 359, 0, 1]

    for (const heading of headings) {
      markerFixture.context.heading = heading
      rerender(<NavigationPositionMarker />)
    }

    const renderedHeadings = markerFixture.sources.get('navigate-current-direction')?.setData.mock.calls
      .map(([data]) => (data as GeoJSON.FeatureCollection).features[0]?.properties?.heading)
      .filter((heading): heading is number => typeof heading === 'number')
    for (const heading of headings) expect(renderedHeadings).toContain(heading)
  })

  it('keeps heading presentation independent from Heading Follow state', () => {
    const { rerender } = render(<NavigationPositionMarker />)

    markerFixture.context.headingFollow = false
    markerFixture.context.heading = 90
    rerender(<NavigationPositionMarker />)
    markerFixture.context.headingFollow = true
    markerFixture.context.heading = 180
    rerender(<NavigationPositionMarker />)

    expect(latestFeature('navigate-current-direction')?.properties?.heading).toBe(180)
  })

  it('keeps the dot while heading is unavailable and cleans every passive resource', () => {
    const { rerender } = render(<NavigationPositionMarker />)

    markerFixture.context.heading = null
    rerender(<NavigationPositionMarker />)

    expect(latestFeature('navigate-current-position')?.geometry.type).toBe('Point')
    expect(latestFeature('navigate-current-direction')).toBeUndefined()

    cleanup()
    expect(markerFixture.map.removeLayer).toHaveBeenCalledWith('navigate-current-direction-arrow')
    expect(markerFixture.map.removeLayer).toHaveBeenCalledWith('navigate-current-position-point')
    expect(markerFixture.map.removeSource).toHaveBeenCalledWith('navigate-current-direction')
    expect(markerFixture.map.removeSource).toHaveBeenCalledWith('navigate-current-position')
    expect(markerFixture.map.removeImage).toHaveBeenCalledWith('navigate-direction-arrow-icon')
  })

  it('retains the layer/source contract across a positionless remount', () => {
    markerFixture.context.location = null
    const { rerender } = render(<NavigationPositionMarker />)

    expect(markerFixture.map.addLayer).toHaveBeenCalledTimes(2)
    expect(latestFeature('navigate-current-position')).toBeUndefined()

    markerFixture.context.location = { lat: 11.819, lng: 122.172 }
    rerender(<NavigationPositionMarker />)
    expect(latestFeature('navigate-current-position')?.geometry).toEqual({
      type: 'Point',
      coordinates: [122.172, 11.819],
    })
  })
})
