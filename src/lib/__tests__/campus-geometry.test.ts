import { describe, it, expect } from 'vitest'
import {
  deriveBuildingFootprint,
  buildingStats,
  resolveBuildingEntranceNode,
} from '../campus-geometry'
import type { Building, CampusBundle, LatLng, NavNode } from '@/types/nav-types'

const latlng = (lat: number, lng: number): LatLng => ({ lat, lng })

const building = (overrides: Partial<Building> = {}): Building => ({
  id: 'bld-a',
  name: 'Building A',
  campusId: 'asu-ibajay',
  floors: [0, 1],
  footprint: [],
  baseElevation: 0,
  height: 0,
  ...overrides,
})

const node = (
  id: string,
  buildingId: string,
  position: LatLng,
  overrides: Partial<NavNode> = {},
): NavNode => ({
  id,
  label: id,
  position,
  floor: 0,
  buildingId,
  campusId: 'asu-ibajay',
  type: 'room',
  ...overrides,
})

const bundle = (overrides: Partial<CampusBundle> = {}): CampusBundle => ({
  nodes: [],
  edges: [],
  searchEntries: [],
  buildings: [building()],
  poi: [],
  boundingBox: { minLat: 0, maxLat: 10, minLng: 0, maxLng: 10 },
  ...overrides,
})

/** Ray-cast point-in-polygon on an unclosed lat/lng ring (test-only helper).
 * Boundary points (vertices or on a segment) count as inside. */
function inside(p: LatLng, ring: LatLng[]): boolean {
  let inPoly = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.lng === p.lng && a.lat === p.lat) return true
    const cross = (b.lng - a.lng) * (p.lat - a.lat) - (b.lat - a.lat) * (p.lng - a.lng)
    if (
      cross === 0 &&
      p.lng >= Math.min(a.lng, b.lng) && p.lng <= Math.max(a.lng, b.lng) &&
      p.lat >= Math.min(a.lat, b.lat) && p.lat <= Math.max(a.lat, b.lat)
    ) {
      return true
    }
    if (
      (a.lat > p.lat) !== (b.lat > p.lat) &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng
    ) {
      inPoly = !inPoly
    }
  }
  return inPoly
}

describe('deriveBuildingFootprint', () => {
  it('passes a footprint through when present (ignores nodes), closed at the first point', () => {
    const fp = [latlng(1, 1), latlng(1, 2), latlng(2, 2), latlng(2, 1)]
    const b = building({ footprint: fp })
    const nodes = [node('n-other', 'bld-b', latlng(50, 50))]
    expect(deriveBuildingFootprint(b, nodes)).toEqual([...fp, fp[0]])
  })

  it('normalizes [lat, lng] pair footprints to {lat, lng} objects, closed', () => {
    const b = building({ footprint: [[1, 1], [1, 2], [2, 2], [2, 1]] as unknown as LatLng[] })
    expect(deriveBuildingFootprint(b, [])).toEqual([
      latlng(1, 1), latlng(1, 2), latlng(2, 2), latlng(2, 1), latlng(1, 1),
    ])
  })

  it('drops invalid footprint entries and falls back to derivation when < 3 remain', () => {
    const b = building({ footprint: [latlng(1, 1), { bad: true } as unknown as LatLng] })
    const nodes = [
      node('a', 'bld-a', latlng(0, 0)),
      node('b', 'bld-a', latlng(0, 10)),
      node('c', 'bld-a', latlng(10, 10)),
      node('d', 'bld-a', latlng(10, 0)),
    ]
    const result = deriveBuildingFootprint(b, nodes)
    expect(result).toHaveLength(5)
  })

  it('derives the exact convex hull corners for a square with an interior point', () => {
    const nodes = [
      node('a', 'bld-a', latlng(0, 0)),
      node('b', 'bld-a', latlng(0, 10)),
      node('c', 'bld-a', latlng(10, 10)),
      node('d', 'bld-a', latlng(10, 0)),
      node('e', 'bld-a', latlng(5, 5)),
    ]
    expect(deriveBuildingFootprint(building(), nodes)).toEqual([
      latlng(0, 0), latlng(0, 10), latlng(10, 10), latlng(10, 0), latlng(0, 0),
    ])
  })

  it('returns a hull containing every node position (irregular cluster)', () => {
    const positions: LatLng[] = [
      latlng(2, 3), latlng(4, 1), latlng(7, 2), latlng(8, 5),
      latlng(6, 8), latlng(3, 7), latlng(5, 4.5),
    ]
    const nodes = positions.map((p, i) => node(`n${i}`, 'bld-a', p))
    const hull = deriveBuildingFootprint(building(), nodes)!
    expect(hull.length).toBeGreaterThanOrEqual(3)
    for (const p of positions) {
      expect(inside(p, hull)).toBe(true)
    }
  })

  it('uses a padded bounding box for two nodes and contains both', () => {
    const nodes = [
      node('a', 'bld-a', latlng(2, 3)),
      node('b', 'bld-a', latlng(5, 7)),
    ]
    const ring = deriveBuildingFootprint(building(), nodes)!
    expect(ring).toHaveLength(5)
    expect(inside(nodes[0].position, ring)).toBe(true)
    expect(inside(nodes[1].position, ring)).toBe(true)
  })

  it('uses a small padded square for a single node', () => {
    const nodes = [node('a', 'bld-a', latlng(4, 4))]
    const ring = deriveBuildingFootprint(building(), nodes)!
    expect(ring).toHaveLength(5)
    expect(inside(nodes[0].position, ring)).toBe(true)
  })

  it('returns null when the building has no nodes', () => {
    expect(deriveBuildingFootprint(building({ id: 'bld-empty' }), [])).toBeNull()
  })

  describe('every returned ring is closed (first point repeated at the end)', () => {
    const closed = (ring: LatLng[] | null) => {
      if (ring === null) return
      expect(ring[0].lat).toBe(ring[ring.length - 1].lat)
      expect(ring[0].lng).toBe(ring[ring.length - 1].lng)
    }

    it('closes the footprint pass-through path', () => {
      const fp = [latlng(1, 1), latlng(1, 2), latlng(2, 2), latlng(2, 1)]
      closed(deriveBuildingFootprint(building({ footprint: fp }), []))
    })

    it('closes the convex hull path', () => {
      const nodes = [
        node('a', 'bld-a', latlng(0, 0)),
        node('b', 'bld-a', latlng(0, 10)),
        node('c', 'bld-a', latlng(10, 10)),
        node('d', 'bld-a', latlng(10, 0)),
      ]
      closed(deriveBuildingFootprint(building(), nodes))
    })

    it('closes the padded bounding box path', () => {
      const nodes = [node('a', 'bld-a', latlng(2, 3)), node('b', 'bld-a', latlng(5, 7))]
      closed(deriveBuildingFootprint(building(), nodes))
    })
  })
})

describe('buildingStats', () => {
  const statsBundle = bundle({
    buildings: [
      building({
        id: 'bld-main',
        floors: [0, 1],
        entrances: [
          { id: 'ent-1', position: latlng(1, 1), floor: 0 },
          { id: 'ent-2', position: latlng(2, 2), floor: 0 },
        ],
      }),
    ],
    searchEntries: [
      { id: 's1', label: 'Main Building', type: 'building', nodeId: 'n0', buildingId: 'bld-main' },
      { id: 's2', label: 'Room 101', type: 'room', nodeId: 'n1', buildingId: 'bld-main' },
      { id: 's3', label: 'Room 102', type: 'room', nodeId: 'n2', buildingId: 'bld-main' },
      { id: 's4', label: 'Room 201', type: 'room', nodeId: 'n3', buildingId: 'bld-main' },
      { id: 's5', label: 'Other Room', type: 'room', nodeId: 'n4', buildingId: 'bld-other' },
    ],
  })

  it('counts floors from the building floor list, rooms from entries, entrances from list', () => {
    expect(buildingStats(statsBundle, 'bld-main')).toEqual({ floors: 2, rooms: 3, entrances: 2 })
  })

  it('falls back to unique node floors when the floor list is empty', () => {
    const b = bundle({
      buildings: [building({ id: 'bld-f', floors: [] })],
      nodes: [
        node('a', 'bld-f', latlng(1, 1), { floor: 0 }),
        node('b', 'bld-f', latlng(2, 2), { floor: 1 }),
        node('c', 'bld-f', latlng(3, 3), { floor: 3 }),
      ],
    })
    expect(buildingStats(b, 'bld-f').floors).toBe(3)
  })

  it('returns zeros for an unknown building', () => {
    expect(buildingStats(statsBundle, 'bld-ghost')).toEqual({ floors: 0, rooms: 0, entrances: 0 })
  })
})

describe('resolveBuildingEntranceNode', () => {
  it('prefers the building search entry node', () => {
    const b = bundle({
      searchEntries: [
        { id: 's1', label: 'Main Building', type: 'building', nodeId: 'node-entry', buildingId: 'bld-a' },
      ],
      nodes: [node('node-entrance', 'bld-a', latlng(1, 1), { type: 'building_entrance' })],
    })
    expect(resolveBuildingEntranceNode(b, 'bld-a')).toBe('node-entry')
  })

  it('falls back to the building_entrance node when no search entry exists', () => {
    const b = bundle({
      nodes: [
        node('node-room', 'bld-a', latlng(1, 1)),
        node('node-entrance', 'bld-a', latlng(2, 2), { type: 'building_entrance' }),
      ],
    })
    expect(resolveBuildingEntranceNode(b, 'bld-a')).toBe('node-entrance')
  })

  it('falls back to the first building node when no entrance exists', () => {
    const b = bundle({
      nodes: [
        node('node-first', 'bld-a', latlng(1, 1)),
        node('node-second', 'bld-a', latlng(2, 2)),
      ],
    })
    expect(resolveBuildingEntranceNode(b, 'bld-a')).toBe('node-first')
  })

  it('skips a search entry without nodeId and falls through to an entrance node', () => {
    const b = bundle({
      searchEntries: [
        { id: 's1', label: 'Main Building', type: 'building', nodeId: '', buildingId: 'bld-a' },
      ],
      nodes: [node('node-entrance', 'bld-a', latlng(1, 1), { type: 'building_entrance' })],
    })
    expect(resolveBuildingEntranceNode(b, 'bld-a')).toBe('node-entrance')
  })

  it('returns null for a building with no nodes', () => {
    expect(resolveBuildingEntranceNode(bundle(), 'bld-ghost')).toBeNull()
  })
})
