import { describe, expect, it } from 'vitest'
import type { LatLng, NavEdge, NavNode, NavigationGraph, POI, POIIndex } from '@navi/core'
import { resolvePoiDestination } from '../poi-destination-resolver'

function node(
  id: string,
  position: LatLng,
  overrides: Partial<Pick<NavNode, 'buildingId' | 'floor' | 'type'>> = {},
): NavNode {
  return {
    id,
    label: id,
    type: overrides.type ?? 'corridor',
    position,
    floor: overrides.floor ?? 2,
    buildingId: overrides.buildingId ?? 'b1',
    properties: {},
  }
}

function edge(
  id: string,
  from: string,
  to: string,
  overrides: Partial<Pick<NavEdge, 'distance' | 'weight' | 'type' | 'routing'>> = {},
): NavEdge {
  return {
    id,
    from,
    to,
    type: overrides.type ?? 'walk',
    distance: overrides.distance ?? 11.1,
    weight: overrides.weight ?? overrides.distance ?? 11.1,
    ...(overrides.routing ? { routing: overrides.routing } : {}),
  }
}

function graph(): NavigationGraph {
  const nodes = [
    node('hall-a', { lat: 0, lng: 0 }),
    node('hall-b', { lat: 0, lng: 0.0002 }),
    node('floor-1-a', { lat: 0, lng: 0.00004 }, { floor: 1 }),
    node('floor-1-b', { lat: 0, lng: 0.00024 }, { floor: 1 }),
    node('out-a', { lat: 0.00004, lng: 0 }, { buildingId: '', floor: 0, type: 'outdoor' }),
    node('out-b', { lat: 0.00004, lng: 0.0002 }, { buildingId: '', floor: 0, type: 'outdoor' }),
    node('vehicle-a', { lat: 0.00001, lng: 0 }, { buildingId: '', floor: 0, type: 'outdoor' }),
    node('vehicle-b', { lat: 0.00001, lng: 0.0002 }, { buildingId: '', floor: 0, type: 'outdoor' }),
  ]
  const edges = [
    edge('hall-edge', 'hall-a', 'hall-b', { distance: 22.2, weight: 22.2 }),
    edge('floor-1-edge', 'floor-1-a', 'floor-1-b', { distance: 22.2, weight: 22.2 }),
    edge('outdoor-edge', 'out-a', 'out-b', { distance: 22.2, weight: 22.2 }),
    edge('vehicle-edge', 'vehicle-a', 'vehicle-b', {
      distance: 22.2,
      weight: 1,
      routing: {
        sourceRoadId: 'vehicle-road',
        authoredOrientation: 'forward',
        authored: { walkable: false },
      },
    }),
  ]
  return {
    version: '4c-test',
    campusId: 'campus-4c',
    createdAt: '',
    checksum: '4c-test',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings: 1,
      floors: 2,
      boundingBox: { minLng: 0, maxLng: 0.00024, minLat: 0, maxLat: 0.00004 },
    },
  }
}

function authoredPoi(
  geometry: NonNullable<POI['geometry']>,
  overrides: Partial<POI> = {},
): POI {
  return {
    id: overrides.id ?? `poi-${geometry.type}`,
    label: overrides.label ?? `Test ${geometry.type}`,
    category: 'study_area',
    position: overrides.position ?? ('position' in geometry ? geometry.position : 'center' in geometry ? geometry.center : geometry.points[0]),
    buildingId: overrides.buildingId ?? 'b1',
    floor: overrides.floor ?? 2,
    floorId: overrides.floorId ?? 'floor-2',
    source: 'authored',
    sourceId: overrides.sourceId ?? overrides.id ?? `poi-${geometry.type}`,
    properties: {},
    geometry,
    ...overrides,
  }
}

function poiIndex(poi: POI): POIIndex {
  return { version: '4c-test', points: [poi] }
}

function resolve(
  baseGraph: NavigationGraph,
  poi: POI,
): unknown {
  return resolvePoiDestination(
    baseGraph,
    poiIndex(poi),
    { destinationType: 'poi', poiId: poi.id },
  )
}

describe('Phase 4C runtime POI destination resolution', () => {
  it.each([
    ['point', authoredPoi({ type: 'point', position: { lat: 0, lng: 0.0001 } })],
    ['circle', authoredPoi({ type: 'circle', center: { lat: 0, lng: 0.0001 }, radius: 2 })],
    ['rectangle', authoredPoi({
      type: 'rectangle',
      points: [
        { lat: -0.00001, lng: 0.00008 },
        { lat: -0.00001, lng: 0.00012 },
        { lat: 0.00001, lng: 0.00012 },
        { lat: 0.00001, lng: 0.00008 },
      ],
    })],
    ['polygon', authoredPoi({
      type: 'polygon',
      points: [
        { lat: -0.00001, lng: 0.00008 },
        { lat: -0.00001, lng: 0.00012 },
        { lat: 0.00001, lng: 0.00012 },
        { lat: 0.00001, lng: 0.00008 },
        { lat: -0.00001, lng: 0.00008 },
      ],
    })],
  ])('resolves a %s POI without a permanent node identity', (_kind, poi) => {
    const base = graph()
    const before = structuredClone(base)
    const result = resolve(base, poi)

    expect(result).toMatchObject({ ok: true })
    expect(JSON.stringify(base)).toBe(JSON.stringify(before))
  })

  it('prefers an eligible same-floor hallway over a geographically close outdoor edge', () => {
    const result = resolve(graph(), authoredPoi({
      type: 'point',
      position: { lat: 0.00002, lng: 0.0001 },
      id: 'poi-floor-2',
    })) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('hall-edge')
  })

  it('does not escape an indoor floor scope when another floor overlaps in world coordinates', () => {
    const result = resolve(graph(), authoredPoi({
      type: 'point',
      position: { lat: 0, lng: 0.0001 },
      id: 'poi-floor-isolation',
      floor: 2,
      floorId: 'floor-2',
    })) as { ok: boolean; resolution?: { candidate?: { floor?: number } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.floor).toBe(2)
  })

  it('uses outdoor scope for a POI without building context and rejects vehicle-only metadata', () => {
    const outdoorPoi = authoredPoi({
      type: 'point',
      position: { lat: 0.000025, lng: 0.0001 },
    }, {
      id: 'poi-outdoor',
      buildingId: undefined,
      floor: undefined,
      floorId: undefined,
    })
    expect(outdoorPoi.buildingId).toBeUndefined()
    const result = resolve(graph(), outdoorPoi) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('outdoor-edge')
    expect(result.resolution?.candidate?.networkId).not.toBe('vehicle-edge')
  })

  it('returns typed failures for missing, malformed, and out-of-range destinations', () => {
    const base = graph()
    const missing = resolvePoiDestination(
      base,
      { version: '4c-test', points: [] },
      { destinationType: 'poi', poiId: 'missing-poi' },
    ) as { ok: boolean; code?: string }
    expect(missing.code).toBe('POI_NOT_FOUND')

    const malformed = authoredPoi({ type: 'point', position: { lat: 0, lng: 0 } }, { id: 'poi-invalid' })
    malformed.geometry = { type: 'polygon', points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }] }
    const invalid = resolve(base, malformed) as { ok: boolean; code?: string }
    expect(invalid.code).toBe('POI_INVALID_DESTINATION_GEOMETRY')

    const far = resolve(base, authoredPoi({ type: 'point', position: { lat: 0.02, lng: 0.02 } }, { id: 'poi-far' })) as { ok: boolean; code?: string }
    expect(far.code).toBe('POI_APPROACH_TOO_FAR')
  })

  it('has a deterministic candidate tie-break independent of insertion order', () => {
    const first = resolve(graph(), authoredPoi({ type: 'point', position: { lat: 0, lng: 0.0001 } }, { id: 'poi-tie' })) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }
    const reversed = graph()
    reversed.nodes.reverse()
    reversed.edges.reverse()
    const second = resolve(reversed, authoredPoi({ type: 'point', position: { lat: 0, lng: 0.0001 } }, { id: 'poi-tie' })) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.resolution?.candidate?.networkId).toBe(first.resolution?.candidate?.networkId)
  })
})

describe('Outdoor/campus POI destination resolution', () => {
  // The outdoor edge runs at lat 0.00004 from lng 0 to lng 0.0002.
  const outdoor = { buildingId: undefined, floor: undefined, floorId: undefined } as const

  const outdoorShapes: Array<[string, NonNullable<POI['geometry']>]> = [
    ['circle', { type: 'circle', center: { lat: 0.00004, lng: 0.0001 }, radius: 3 }],
    ['rectangle', {
      type: 'rectangle',
      points: [
        { lat: 0.00003, lng: 0.00009 },
        { lat: 0.00003, lng: 0.00011 },
        { lat: 0.00005, lng: 0.00011 },
        { lat: 0.00005, lng: 0.00009 },
      ],
    }],
    ['polygon', {
      type: 'polygon',
      points: [
        { lat: 0.00003, lng: 0.00009 },
        { lat: 0.00005, lng: 0.00011 },
        { lat: 0.00003, lng: 0.00011 },
      ],
    }],
  ]

  it.each(outdoorShapes)('resolves an outdoor %s POI with scope/geometry onto the outdoor edge', (_kind, geometry) => {
    const base = graph()
    const before = structuredClone(base)
    const poi = authoredPoi(geometry, { id: `poi-outdoor-${geometry.type}`, scope: 'outdoor', ...outdoor })
    const result = resolve(base, poi) as {
      ok: boolean
      resolution?: { candidate?: { networkId?: string; kind?: string }; temporaryRoutingTargetId?: string }
    }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('outdoor-edge')
    expect(result.resolution?.temporaryRoutingTargetId).toContain('poi-outdoor')
    // Request-local overlay only: the base graph is untouched.
    expect(JSON.stringify(base)).toBe(JSON.stringify(before))
  })

  it('keeps an outdoor POI out of indoor edges even when coordinates overlap', () => {
    const poi = authoredPoi({ type: 'point', position: { lat: 0, lng: 0.0001 } }, { id: 'poi-outdoor-overlap', scope: 'outdoor', ...outdoor })
    const result = resolve(graph(), poi) as { ok: boolean; resolution?: { candidate?: { networkId?: string; buildingId?: string } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('outdoor-edge')
    expect(result.resolution?.candidate?.buildingId).toBe('')
  })
})

describe('Preferred POI approach anchor', () => {
  const outdoor = { buildingId: undefined, floor: undefined, floorId: undefined } as const

  function anchorGraph(): NavigationGraph {
    const nodes = [
      { id: 'south-a', label: 'south-a', type: 'outdoor' as const, position: { lat: 0, lng: 0 }, floor: 0, buildingId: '', properties: {} },
      { id: 'south-b', label: 'south-b', type: 'outdoor' as const, position: { lat: 0, lng: 0.0002 }, floor: 0, buildingId: '', properties: {} },
      { id: 'north-a', label: 'north-a', type: 'outdoor' as const, position: { lat: 0.00008, lng: 0 }, floor: 0, buildingId: '', properties: {} },
      { id: 'north-b', label: 'north-b', type: 'outdoor' as const, position: { lat: 0.00008, lng: 0.0002 }, floor: 0, buildingId: '', properties: {} },
    ]
    return {
      version: 'anchor-test',
      campusId: 'campus-anchor',
      createdAt: '',
      checksum: 'anchor-test',
      nodes,
      edges: [
        edge('edge-a-north', 'north-a', 'north-b', { distance: 22.2, weight: 22.2 }),
        edge('edge-b-south', 'south-a', 'south-b', { distance: 22.2, weight: 22.2 }),
      ],
      metadata: { nodeCount: 4, edgeCount: 2, buildings: 0, floors: 1, boundingBox: { minLng: 0, maxLng: 0.0002, minLat: 0, maxLat: 0.00008 } },
    }
  }

  const anchoredCircle = (angle: number): POI => authoredPoi(
    { type: 'circle', center: { lat: 0.00004, lng: 0.0001 }, radius: 5 },
    {
      id: 'poi-anchored',
      scope: 'outdoor',
      ...outdoor,
      approach: { mode: 'preferred', position: projectAnchor(angle) },
    } as Partial<POI>,
  )

  function projectAnchor(angle: number): LatLng {
    const center = { lat: 0.00004, lng: 0.0001 }
    const metersLng = Math.max(Math.cos((center.lat * Math.PI) / 180) * 111_320, 1)
    return {
      lat: center.lat + (Math.sin(angle) * 5) / 111_320,
      lng: center.lng + (Math.cos(angle) * 5) / metersLng,
    }
  }

  it('keeps automatic as the default selection when no anchor is present', () => {
    const base = anchorGraph()
    const before = JSON.stringify(base)
    const poi = authoredPoi(
      { type: 'circle', center: { lat: 0.00004, lng: 0.0001 }, radius: 5 },
      { id: 'poi-auto', scope: 'outdoor', ...outdoor },
    )
    const result = resolve(base, poi) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('edge-a-north')
    expect(JSON.stringify(base)).toBe(before)
  })

  it('uses the resolved preferred anchor to choose the nearest eligible edge', () => {
    const base = anchorGraph()
    const before = JSON.stringify(base)
    const poi = anchoredCircle(-Math.PI / 2) // south-facing anchor
    const result = resolve(base, poi) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('edge-b-south')
    expect(JSON.stringify(base)).toBe(before)
    expect(base.nodes.some((node) => node.id.includes('poi-anchored'))).toBe(false)
  })

  it('falls back to automatic when the preferred anchor is invalid', () => {
    const base = anchorGraph()
    const poi = authoredPoi(
      { type: 'circle', center: { lat: 0.00004, lng: 0.0001 }, radius: 5 },
      {
        id: 'poi-bad-anchor',
        scope: 'outdoor',
        ...outdoor,
        approach: { mode: 'preferred', position: { lat: Number.NaN, lng: 0 } },
      } as Partial<POI>,
    )
    const result = resolve(base, poi) as { ok: boolean; resolution?: { candidate?: { networkId?: string } } }

    expect(result.ok).toBe(true)
    expect(result.resolution?.candidate?.networkId).toBe('edge-a-north')
  })
})
