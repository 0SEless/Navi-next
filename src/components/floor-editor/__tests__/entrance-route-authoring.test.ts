import { describe, expect, it } from 'vitest'
import type { LatLng } from '@/types/nav-types'
import { ENTRANCE_ROUTE_START_TOLERANCE_METERS, resolveEntranceFinishAccess, routeStartError, snapRouteStartToEntrance } from '../entrance-route-authoring'

const entrancePosition: LatLng = { lat: 11.8195, lng: 122.0922 }

describe('entrance-first Route authoring', () => {
  it('snaps a click within the entrance tolerance to the exact Entrance position', () => {
    const result = snapRouteStartToEntrance(
      { lat: entrancePosition.lat + 0.000001, lng: entrancePosition.lng },
      { entranceId: 'entrance-1', outdoorNodeId: 'outdoor-1', position: entrancePosition },
    )

    expect(result.accepted).toBe(true)
    if (result.accepted) {
      expect(result.position).toEqual(entrancePosition)
      expect(result.distanceMeters).toBeLessThan(ENTRANCE_ROUTE_START_TOLERANCE_METERS)
    }
  })

  it('rejects a first click that is not close enough to the selected Entrance', () => {
    const result = snapRouteStartToEntrance(
      { lat: entrancePosition.lat + 0.001, lng: entrancePosition.lng },
      { entranceId: 'entrance-1', outdoorNodeId: 'outdoor-1', position: entrancePosition },
    )

    expect(result.accepted).toBe(false)
    if (!result.accepted) expect(result.reason).toMatch(/Start the Route at the selected Entrance/)
  })

  it('requires a confirmed Entrance anchor before starting the first Route network', () => {
    expect(routeStartError({ hasExistingRoute: false, hasEntranceAnchor: false })).toMatch(/select an Entrance/i)
    expect(routeStartError({ hasExistingRoute: false, hasEntranceAnchor: true })).toBeNull()
  })

  it('allows additional Route branches after a network already exists', () => {
    expect(routeStartError({ hasExistingRoute: true, hasEntranceAnchor: false })).toBeNull()
  })
})

describe('resolveEntranceFinishAccess', () => {
  it('reuses an existing outdoor assignment', () => {
    const floor = {
      entranceAccess: [{
        entranceId: 'entrance-1',
        outdoorNodeId: 'outdoor-1',
        outdoorRouteId: 'road-7',
        outdoorPosition: { lat: 11.82, lng: 122.09 },
      }],
    }
    expect(resolveEntranceFinishAccess(floor, 'entrance-1')).toEqual({
      kind: 'existing',
      outdoorNodeId: 'outdoor-1',
      outdoorRouteId: 'road-7',
      outdoorPosition: { lat: 11.82, lng: 122.09 },
    })
  })

  it('reports required when the entrance has no access record', () => {
    expect(resolveEntranceFinishAccess({ entranceAccess: [] }, 'entrance-1')).toEqual({ kind: 'required' })
    expect(resolveEntranceFinishAccess({}, 'entrance-1')).toEqual({ kind: 'required' })
  })
})
