import { describe, expect, it } from 'vitest'
import {
  buildPassiveLocationArrowGeoJson,
  buildPassiveLocationPositionGeoJson,
  buildNavigationHeadingArrowGeoJson,
  createPassiveLocationMarkerLayers,
  createNavigationHeadingArrowLayer,
} from '../navigation-heading-arrow'

describe('shared passive location marker contracts', () => {
  it('builds the shared passive location dot and arrow at one geographic anchor', () => {
    const position = { latitude: 11.81830075, longitude: 122.17159818 }
    const dot = buildPassiveLocationPositionGeoJson(position)
    const arrow = buildPassiveLocationArrowGeoJson(position, 90, 'capture-direction-arrow')

    expect(dot.features).toHaveLength(1)
    expect(dot.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [122.17159818, 11.81830075],
    })
    expect(arrow.features).toHaveLength(1)
    expect(arrow.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [122.17159818, 11.81830075],
    })
    expect(arrow.features[0].properties).toEqual({ kind: 'capture-direction-arrow', heading: 90 })
  })

  it('keeps the shared passive marker contract empty when position or heading is unavailable', () => {
    expect(buildPassiveLocationPositionGeoJson(null).features).toHaveLength(0)
    expect(buildPassiveLocationArrowGeoJson({ latitude: 11.8, longitude: 122.1 }, null).features).toHaveLength(0)
    expect(buildPassiveLocationArrowGeoJson({ latitude: 11.8, longitude: 122.1 }, 361).features[0].properties?.heading).toBe(1)
  })

  it('defines the Capture-compatible dot and map-aligned arrow as one shared layer set', () => {
    const layers = createPassiveLocationMarkerLayers({
      positionSourceId: 'capture-current-position',
      positionLayerId: 'capture-current-position-point',
      directionSourceId: 'capture-current-direction',
      directionLayerId: 'capture-current-direction-arrow',
      imageId: 'capture-direction-arrow-icon',
    })

    expect(layers.position).toEqual({
      id: 'capture-current-position-point',
      type: 'circle',
      source: 'capture-current-position',
      paint: {
        'circle-color': '#059669',
        'circle-radius': 8,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 3,
      },
    })
    expect(layers.direction).toEqual({
      id: 'capture-current-direction-arrow',
      source: 'capture-current-direction',
      ...createNavigationHeadingArrowLayer('capture-direction-arrow-icon'),
    })
  })

  it('retains the navigation compatibility wrapper with normalized heading', () => {
    const geoJson = buildNavigationHeadingArrowGeoJson(
      { latitude: 11.81830075, longitude: 122.17159818 },
      -1,
    )

    expect(geoJson.features).toHaveLength(1)
    expect(geoJson.features[0].geometry.type).toBe('Point')
    expect(geoJson.features[0].geometry.coordinates).toEqual([122.17159818, 11.81830075])
    expect(geoJson.features[0].properties).toEqual({
      kind: 'navigation-forward-heading-arrow',
      heading: 359,
    })
  })

  it('keeps the MapLibre arrow aligned to the map and rotates from geographic heading', () => {
    const layer = createNavigationHeadingArrowLayer('navigate-direction-arrow-icon')

    expect(layer).toEqual({
      type: 'symbol',
      layout: {
        'icon-image': 'navigate-direction-arrow-icon',
        'icon-anchor': 'bottom',
        'icon-size': 0.75,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  })
})
