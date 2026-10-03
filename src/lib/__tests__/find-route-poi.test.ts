import { describe, expect, it } from 'vitest'
import type { POI } from '@navi/core'
import type { NavEdge, NavNode } from '@/types/nav-types'
import * as routeModule from '@/lib/findRoute'

const nodes: NavNode[] = [
  {
    id: 'origin',
    label: 'Origin',
    position: { lat: 0, lng: 0 },
    floor: 0,
    buildingId: '',
    campusId: 'campus-4c',
    type: 'outdoor',
  },
  {
    id: 'walkway',
    label: 'Walkway',
    position: { lat: 0, lng: 0.0002 },
    floor: 0,
    buildingId: '',
    campusId: 'campus-4c',
    type: 'outdoor',
  },
]

const edges: NavEdge[] = [{
  id: 'walk-edge',
  from: 'origin',
  to: 'walkway',
  distance: 22,
  weight: 22,
  type: 'walk',
}]

const poi: POI = {
  id: 'poi-study-area',
  label: 'Study Area',
  category: 'study_area',
  position: { lat: 0, lng: 0.0001 },
  source: 'authored',
  sourceId: 'poi-study-area',
  properties: {},
  geometry: { type: 'point', position: { lat: 0, lng: 0.0001 } },
}

describe('Phase 4C public POI route adapter', () => {
  it('exposes a POI route adapter without requiring a fabricated graph node', () => {
    const findPoiNavRoute = (routeModule as unknown as {
      findPoiNavRoute?: (nodes: NavNode[], edges: NavEdge[], pois: unknown[], fromId: string, poiId: string) => unknown
    }).findPoiNavRoute

    expect(typeof findPoiNavRoute).toBe('function')
    const route = findPoiNavRoute?.(nodes, edges, [poi], 'origin', poi.id)
    expect(route).not.toBeNull()
    expect(route?.path.at(-1)).toBe(poi.id)
    expect(route?.path.some((id) => id.includes('__navi_poi_target__'))).toBe(false)
    expect(route?.destination).toMatchObject({ entityType: 'poi', entityId: poi.id })
    expect(route?.instructions.at(-1)?.text).toBe('Arrive at Study Area')
  })
})
