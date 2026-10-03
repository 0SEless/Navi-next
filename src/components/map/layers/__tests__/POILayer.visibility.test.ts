import { describe, expect, it } from 'vitest'
import { buildPoiGeoJSON } from '../POILayer'
import type { PoiRenderData } from '@/components/map/NavigationRenderModel'

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
})
