import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCaptureDirectionGeoJson } from '../direction'
import { CaptureMapLayers, removeCaptureLayers } from '../components/RecordingMap'
import type { CaptureSession } from '../types'
import { createPassiveLocationMarkerLayers } from '@/lib/navigation-heading-arrow'

const captureMap = vi.hoisted(() => {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn>; options: unknown }>()
  const layers = new Set<string>()
  const images = new Set<string>()
  return {
    sources,
    layers,
    images,
    reset() {
      sources.clear()
      layers.clear()
      images.clear()
      this.addSource.mockClear()
      this.addLayer.mockClear()
      this.addImage.mockClear()
      this.removeImage.mockClear()
    },
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
    removeImage: vi.fn((id: string) => {
      images.delete(id)
    }),
  }
})

vi.mock('@/components/map/NavigationMap', () => ({
  default: () => null,
  useNavigationMap: () => ({ map: captureMap, isReady: true }),
}))

beforeEach(() => captureMap.reset())
afterEach(() => vi.restoreAllMocks())

describe('Capture MapLibre layer cleanup', () => {
  it('does not throw when NavigationMap has already torn down the map instance', () => {
    expect(() => removeCaptureLayers(null)).not.toThrow()
  })

  it('cleans up the namespaced direction source and layers with Capture layers', () => {
    const map = {
      getLayer: vi.fn((id: string) => id.startsWith('capture-') ? {} : undefined),
      getSource: vi.fn((id: string) => id.startsWith('capture-') ? {} : undefined),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      hasImage: vi.fn((id: string) => id === 'capture-direction-arrow-icon'),
      removeImage: vi.fn(),
    }

    removeCaptureLayers(map as never)

    expect(map.removeLayer).toHaveBeenCalledWith('capture-current-direction-arrow')
    expect(map.removeLayer).not.toHaveBeenCalledWith('capture-current-direction-cone')
    expect(map.removeLayer).not.toHaveBeenCalledWith('capture-current-direction-glow')
    expect(map.removeSource).toHaveBeenCalledWith('capture-current-direction')
    expect(map.removeImage).toHaveBeenCalledWith('capture-direction-arrow-icon')
  })

  it('creates one compact geographic arrow symbol without any glow, outline, or center-line layer', () => {
    const session = {
      rawSamples: [],
      candidateRoute: null,
      markers: [],
      lastPosition: { latitude: 11.8, longitude: 122.1 },
    } as unknown as CaptureSession

    const context = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      getImageData: vi.fn(() => ({ width: 32, height: 40, data: new Uint8ClampedArray(32 * 40 * 4) })),
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)

    render(<CaptureMapLayers session={session} directionGeoJson={buildCaptureDirectionGeoJson(session.lastPosition!, 90)} />)

    const layers = captureMap.addLayer.mock.calls.map(([layer]) => layer as { id: string; type: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> })
    const arrow = layers.find((layer) => layer.id === 'capture-current-direction-arrow')
    expect(arrow).toBeDefined()
    if (!arrow) return

    expect(arrow.type).toBe('symbol')
    expect(arrow.layout?.['icon-image']).toBe('capture-direction-arrow-icon')
    expect(arrow.layout?.['icon-anchor']).toBe('bottom')
    expect(arrow.layout?.['icon-size']).toBeLessThanOrEqual(0.9)
    expect(arrow.layout?.['icon-size']).toBeGreaterThan(0)
    expect(arrow.layout?.['icon-rotate']).toEqual(['get', 'heading'])
    expect(arrow.layout?.['icon-rotation-alignment']).toBe('map')
    expect(arrow.layout?.['icon-pitch-alignment']).toBe('map')
    expect(arrow.layout?.['icon-allow-overlap']).toBe(true)
    expect(arrow.layout?.['icon-ignore-placement']).toBe(true)
    expect(arrow.paint).toBeUndefined()
    expect(layers.some((layer) => layer.id === 'capture-current-direction-cone')).toBe(false)
    expect(layers.some((layer) => layer.id === 'capture-current-direction-glow')).toBe(false)

    const arrowIndex = layers.findIndex((layer) => layer.id === 'capture-current-direction-arrow')
    const locationIndex = layers.findIndex((layer) => layer.id === 'capture-current-position-point')
    expect(locationIndex).toBeGreaterThan(arrowIndex)
    expect(captureMap.addImage).toHaveBeenCalledWith('capture-direction-arrow-icon', expect.anything())
    expect(captureMap.sources.get('capture-current-direction')?.options).toMatchObject({ type: 'geojson' })
    expect(captureMap.sources.get('capture-current-direction')?.options).not.toHaveProperty('lineMetrics')

    const directionData = captureMap.sources.get('capture-current-direction')?.setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection
    expect(directionData.features).toHaveLength(1)
    expect(directionData.features[0].geometry.type).toBe('Point')
    expect(directionData.features[0].geometry.coordinates).toEqual([122.1, 11.8])
    expect(directionData.features[0].properties).toEqual({ kind: 'capture-direction-arrow', heading: 90 })

    const sharedLayers = createPassiveLocationMarkerLayers({
      positionSourceId: 'capture-current-position',
      positionLayerId: 'capture-current-position-point',
      directionSourceId: 'capture-current-direction',
      directionLayerId: 'capture-current-direction-arrow',
      imageId: 'capture-direction-arrow-icon',
    })
    expect(arrow).toEqual(sharedLayers.direction)
    expect(layers.find((layer) => layer.id === 'capture-current-position-point')).toEqual(sharedLayers.position)
  })
})
