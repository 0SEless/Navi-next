import { describe, expect, it } from 'vitest'
import type { Building, LatLng, NavEdge, NavNode } from '@/types/nav-types'
import {
  buildCampusNavigationEdges,
  buildCampusNavigationNodes,
  buildOutdoorRouteCandidates,
  buildingPickerBounds,
  resolveOutdoorRoutePick,
} from '../outdoor-route-picker-model'

const building = {
  id: 'building-1',
  name: 'Library',
  campusId: 'campus-1',
  floors: [0],
  footprint: [
    { lat: 14.5990, lng: 120.9840 },
    { lat: 14.5990, lng: 120.9850 },
    { lat: 14.6000, lng: 120.9850 },
    { lat: 14.6000, lng: 120.9840 },
  ],
  baseElevation: 0,
  height: 10,
} as Building

const entrance = { position: { lat: 14.5995, lng: 120.9845 } }

function node(partial: Partial<NavNode> & Pick<NavNode, 'id' | 'type' | 'position'>): NavNode {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    name: partial.name,
    position: partial.position,
    floor: partial.floor ?? 0,
    buildingId: partial.buildingId ?? '__outdoor__',
    campusId: 'campus-1',
    type: partial.type,
    metadata: partial.metadata,
  }
}

function edge(partial: Partial<NavEdge> & Pick<NavEdge, 'id' | 'from' | 'to'>): NavEdge {
  return {
    id: partial.id,
    from: partial.from,
    to: partial.to,
    distance: partial.distance ?? 10,
    weight: partial.weight,
    type: partial.type ?? 'outdoor',
    campusId: 'campus-1',
  }
}

describe('outdoor route picker model', () => {
  it('filters eligible outdoor nodes and sorts them by distance with readable labels', () => {
    const candidates = buildOutdoorRouteCandidates([
      node({ id: 'far', type: 'outdoor', position: { lat: 14.6020, lng: 120.9845 }, label: 'Far path' }),
      node({ id: 'near-entrance', type: 'building_entrance', position: { lat: 14.59955, lng: 120.9845 }, label: 'Gate A' }),
      node({ id: 'near-junction', type: 'intersection', position: { lat: 14.59955, lng: 120.9845 }, label: 'Junction A', metadata: { traceId: 'road-1' } }),
      node({ id: 'near-path', type: 'outdoor', position: { lat: 14.5997, lng: 120.9845 }, name: 'Walkway A', label: 'internal-id-should-not-render' }),
      node({ id: 'indoor', type: 'room', position: { lat: 14.59951, lng: 120.9845 }, label: 'Room 101' }),
    ], building, entrance, { includeAll: true })

    expect(candidates.map((candidate) => candidate.id)).toEqual(['near-junction', 'near-path', 'far'])
    expect(candidates.map((candidate) => candidate.label)).toEqual(['Junction A', 'Walkway A', 'Far path'])
    expect(candidates[0].distanceMeters).toBeLessThan(candidates[1].distanceMeters)
    expect(candidates.every((candidate) => candidate.id !== candidate.label)).toBe(true)
  })

  it('uses the local radius by default and exposes a full-campus fallback', () => {
    const nodes = [
      node({ id: 'near', type: 'outdoor', position: { lat: 14.5996, lng: 120.9845 }, label: 'Nearby path' }),
      node({ id: 'far', type: 'outdoor', position: { lat: 14.6100, lng: 120.9845 }, label: 'Distant path' }),
    ]

    expect(buildOutdoorRouteCandidates(nodes, building, entrance, { localRadiusMeters: 30 }).map((candidate) => candidate.id)).toEqual(['near'])
    expect(buildOutdoorRouteCandidates(nodes, building, entrance, { localRadiusMeters: 30, includeAll: true }).map((candidate) => candidate.id)).toEqual(['near', 'far'])
  })

  it('resolves a route-line click to an exact segment position for a new junction', () => {
    const nodes = [
      node({ id: 'outside-a', type: 'outdoor', position: { lat: 14.5994, lng: 120.9845 }, label: 'North path', metadata: { traceId: 'road-1' } }),
      node({ id: 'outside-b', type: 'outdoor', position: { lat: 14.5999, lng: 120.9845 }, label: 'South path', metadata: { traceId: 'road-1' } }),
      node({ id: 'room-node', type: 'room', position: { lat: 14.5996, lng: 120.9845 }, label: 'Room 101' }),
    ]
    const clickPosition = { lat: 14.59982, lng: 120.9845 }
    const result = resolveOutdoorRoutePick(
      { kind: 'edge', edgeId: 'outdoor-edge-1', lngLat: clickPosition },
      nodes,
      [edge({ id: 'outdoor-edge-1', from: 'outside-a', to: 'outside-b' })],
    )

    expect(result?.source).toBe('edge')
    expect(result?.candidate.targetKind).toBe('segment')
    expect(result?.candidate.id).toBe('segment:outdoor-edge-1')
    expect(result?.candidate.routeId).toBe('road-1')
    expect(result?.candidate.edgeId).toBe('outdoor-edge-1')
    expect(result?.candidate.position).toEqual(clickPosition)
    expect(result?.candidate.label).toContain('road-1')
  })

  it('rejects an edge that has no eligible outdoor endpoint', () => {
    const result = resolveOutdoorRoutePick(
      { kind: 'edge', edgeId: 'indoor-edge', lngLat: { lat: 14.5995, lng: 120.9845 } },
      [
        node({ id: 'room-a', type: 'room', position: { lat: 14.5994, lng: 120.9845 } }),
        node({ id: 'room-b', type: 'room', position: { lat: 14.5996, lng: 120.9845 } }),
      ],
      [edge({ id: 'indoor-edge', from: 'room-a', to: 'room-b', type: 'walk' })],
    )

    expect(result).toBeNull()
  })

  it('builds geographic bounds around the current building in lng/lat order', () => {
    const bounds = buildingPickerBounds(building, 10)

    expect(bounds[0][0]).toBeLessThan(120.9840)
    expect(bounds[0][1]).toBeLessThan(14.5990)
    expect(bounds[1][0]).toBeGreaterThan(120.9850)
    expect(bounds[1][1]).toBeGreaterThan(14.6000)
  })

  it('keeps the original node position and stable ID in the candidate', () => {
    const position: LatLng = { lat: 14.59955, lng: 120.9845 }
    const candidates = buildOutdoorRouteCandidates([node({ id: 'stable-id', type: 'outdoor', position })], building, entrance, { includeAll: true })

    expect(candidates[0]).toMatchObject({ id: 'stable-id', position, type: 'outdoor' })
  })

  it('keeps campus navigation nodes while excluding indoor-only nodes', () => {
    const campusNodes = buildCampusNavigationNodes([
      node({ id: 'outdoor', type: 'outdoor', position: { lat: 14.5991, lng: 120.9841 } }),
      node({ id: 'junction', type: 'intersection', position: { lat: 14.5992, lng: 120.9842 }, metadata: { traceId: 'road-1' } }),
      node({ id: 'entrance', type: 'building_entrance', buildingId: 'building-1', position: { lat: 14.5993, lng: 120.9843 } }),
      node({ id: 'indoor-route', type: 'intersection', buildingId: 'building-1', position: { lat: 14.59935, lng: 120.98435 } }),
      node({ id: 'room', type: 'room', buildingId: 'building-1', position: { lat: 14.5994, lng: 120.9844 } }),
    ])

    expect(campusNodes.map((candidate) => candidate.id)).toEqual(['outdoor', 'junction', 'entrance'])
  })

  it('keeps graph edges whose endpoints are intermediate campus nodes', () => {
    const campusNodes = buildCampusNavigationNodes([
      node({ id: 'outdoor', type: 'outdoor', position: { lat: 14.5991, lng: 120.9841 } }),
      node({ id: 'junction-a', type: 'intersection', position: { lat: 14.5992, lng: 120.9842 }, metadata: { traceId: 'road-1' } }),
      node({ id: 'junction-b', type: 'intersection', position: { lat: 14.5993, lng: 120.9843 }, metadata: { traceId: 'road-1' } }),
      node({ id: 'room', type: 'room', buildingId: 'building-1', position: { lat: 14.5994, lng: 120.9844 } }),
    ])

    const campusEdges = buildCampusNavigationEdges(campusNodes, [
      edge({ id: 'outer-1', from: 'outdoor', to: 'junction-a' }),
      edge({ id: 'outer-2', from: 'junction-a', to: 'junction-b' }),
      edge({ id: 'indoor', from: 'junction-b', to: 'room' }),
    ])

    expect(campusEdges.map((candidate) => candidate.id)).toEqual(['outer-1', 'outer-2'])
  })
})
