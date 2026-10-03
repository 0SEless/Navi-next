import { describe, expect, it } from 'vitest'
import { buildPoiGeoJSON } from '../POILayer'
import type { PoiRenderData } from '@/components/map/NavigationRenderModel'
import type { CampusPOI } from '@/types/nav-types'

const BASE: PoiRenderData = {
  id: 'poi-visible',
  name: 'Visible',
  buildingId: 'b1',
  floor: 0,
  position: { lat: 10, lng: 20 },
}

describe('POI visibility in the public layer', () => {
  it('renders visible + searchable POIs by default', () => {
    const fc = buildPoiGeoJSON([{ ...BASE, id: 'poi-default' }])
    expect(fc.features.map(f => f.id)).toEqual(['poi-default'])
    expect(fc.features[0].properties?.revealed).toBe(false)
  })

  it('hides showOnMap=false POIs unless temporarily revealed', () => {
    const hidden: PoiRenderData = { ...BASE, id: 'poi-hidden', showOnMap: false }
    expect(buildPoiGeoJSON([hidden]).features).toHaveLength(0)

    const revealed = buildPoiGeoJSON([hidden], ['poi-hidden'])
    expect(revealed.features.map(f => f.id)).toEqual(['poi-hidden'])
    expect(revealed.features[0].properties?.revealed).toBe(true)
  })

  it('restores the hidden state when the reveal set is cleared', () => {
    const hidden: PoiRenderData = { ...BASE, id: 'poi-hidden', showOnMap: false }
    expect(buildPoiGeoJSON([hidden], ['poi-hidden']).features).toHaveLength(1)
    expect(buildPoiGeoJSON([hidden], []).features).toHaveLength(0)
  })

  it('keeps visible POIs visible while another POI is revealed', () => {
    const hidden: PoiRenderData = { ...BASE, id: 'poi-hidden', showOnMap: false }
    const visible: PoiRenderData = { ...BASE, id: 'poi-visible-2' }
    const fc = buildPoiGeoJSON([hidden, visible], ['poi-hidden'])
    expect(fc.features.map(f => f.id)).toEqual(['poi-hidden', 'poi-visible-2'])
    expect(fc.features.find(f => f.id === 'poi-visible-2')?.properties?.revealed).toBe(false)
  })

  it('projects outdoor rectangle geometry as a closed polygon and retains authored identity', () => {
    const outdoor: CampusPOI = {
      id: 'poi-outdoor-court',
      label: 'Basketball Court',
      category: 'recreation',
      scope: 'outdoor',
      position: { lat: 10.0005, lng: 20.0005 },
      properties: { surface: 'rubber' },
      visibility: { showOnMap: true, searchable: true },
      geometry: { type: 'rectangle', points: [
        { lat: 10, lng: 20 }, { lat: 10, lng: 20.001 },
        { lat: 10.001, lng: 20.001 }, { lat: 10.001, lng: 20 },
      ] },
    }

    const fc = buildPoiGeoJSON([], [], [outdoor])

    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].id).toBe('poi-outdoor-court')
    expect(fc.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[
        [20, 10], [20.001, 10], [20.001, 10.001], [20, 10.001], [20, 10],
      ]],
    })
    expect(fc.features[0].properties).toMatchObject({
      id: 'poi-outdoor-court',
      name: 'Basketball Court',
      category: 'recreation',
      scope: 'outdoor',
      metadata: { surface: 'rubber' },
    })
  })

  it('projects outdoor circles to valid closed polygons and respects hidden visibility reveals', () => {
    const circle: CampusPOI = {
      id: 'poi-outdoor-circle',
      label: 'Water feature',
      category: 'landmark',
      scope: 'outdoor',
      position: { lat: 10, lng: 20 },
      properties: {},
      visibility: { showOnMap: false, searchable: true },
      geometry: { type: 'circle', center: { lat: 10, lng: 20 }, radius: 25 },
    }

    expect(buildPoiGeoJSON([], [], [circle]).features).toHaveLength(0)
    const feature = buildPoiGeoJSON([], [circle.id], [circle]).features[0]

    expect(feature.id).toBe('poi-outdoor-circle')
    expect(feature.properties?.revealed).toBe(true)
    expect(feature.geometry.type).toBe('Polygon')
    if (feature.geometry.type !== 'Polygon') throw new Error('Expected circle polygon geometry')
    expect(feature.geometry.coordinates[0]).toHaveLength(49)
    expect(feature.geometry.coordinates[0][0]).toEqual(feature.geometry.coordinates[0][48])
  })

  it('keeps outdoor point POIs as points and skips malformed authored geometry', () => {
    const point: CampusPOI = {
      id: 'poi-outdoor-point',
      label: 'Entrance marker',
      category: 'entrance',
      scope: 'outdoor',
      position: { lat: 10, lng: 20 },
      properties: {},
      geometry: { type: 'point', position: { lat: 10, lng: 20 } },
    }
    const malformed = {
      ...point,
      id: 'poi-invalid',
      geometry: { type: 'polygon', points: [{ lat: 10, lng: 20 }] },
    } as unknown as CampusPOI

    const fc = buildPoiGeoJSON([], [], [point, malformed])

    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [20, 10] })
  })

  it('projects Studio-authored marker, 2D, and 2.5D appearance into outdoor features', () => {
    const marker: CampusPOI = {
      id: 'poi-marker',
      label: 'Marker',
      category: 'other',
      scope: 'outdoor',
      position: { lat: 10, lng: 20 },
      properties: {},
      geometry: { type: 'point', position: { lat: 10, lng: 20 } },
      appearance: { mode: 'marker', color: '#2563EB' },
    }
    const area2d: CampusPOI = {
      id: 'poi-area-2d',
      label: '2D Area',
      category: 'other',
      scope: 'outdoor',
      position: { lat: 10, lng: 20 },
      properties: {},
      geometry: { type: 'rectangle', points: [
        { lat: 10, lng: 20 }, { lat: 10, lng: 20.001 },
        { lat: 10.001, lng: 20.001 }, { lat: 10.001, lng: 20 },
      ] },
      appearance: { mode: '2d', color: '#16A34A' },
    }
    const area25d: CampusPOI = {
      ...area2d,
      id: 'poi-area-25d',
      label: '2.5D Area',
      appearance: { mode: '2.5d', color: '#DC2626', height: 4.25 },
    }

    const features = buildPoiGeoJSON([], [], [marker, area2d, area25d]).features

    expect(features.map((feature) => feature.properties)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'poi-marker', appearanceMode: 'marker', appearanceColor: '#2563EB' }),
      expect.objectContaining({ id: 'poi-area-2d', appearanceMode: '2d', appearanceColor: '#16A34A' }),
      expect.objectContaining({
        id: 'poi-area-25d', appearanceMode: '2.5d', appearanceColor: '#DC2626', appearanceHeight: 4.25,
      }),
    ]))
  })
})
