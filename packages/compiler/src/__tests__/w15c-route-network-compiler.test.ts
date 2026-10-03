import { describe, it, expect } from 'vitest'
import { assessRouteNetworkAuthority } from '../primitives/route-network-authority'
import { extractRouteNetwork } from '../primitives/route-network-extractor'
import { generatePrimitives } from '../primitives/coordinator'
import type { NormalizedDocument, NormalizedFloor, RouteNetwork, GenerationContext } from '../types'

const ctx: GenerationContext = { nodeInterval: 10, mergeThreshold: 0.5 }

function makeBuilding(overrides?: Record<string, unknown>) {
  return {
    id: 'b1',
    name: 'Building A',
    code: 'BA',
    category: 'academic',
    position: { lat: 14.0, lng: 121.0 },
    baseElevation: 0,
    height: 10,
    floors: [],
    ...overrides,
  } as any
}

function makeFloor(overrides?: Partial<NormalizedFloor>): NormalizedFloor {
  return {
    id: 'b1-0',
    level: 0,
    label: 'Ground',
    elevation: 0,
    buildingId: 'b1',
    rooms: [],
    hallways: [],
    connectorStops: [],
    entrances: [],
    anchors: [],
    ...overrides,
  } as any
}

function makeDoc(buildings?: any[]): NormalizedDocument {
  return {
    buildings: buildings || [makeBuilding({ floors: [makeFloor()] })],
    roads: [],
  }
}

function makeRouteNetwork(overrides?: Partial<RouteNetwork>): RouteNetwork {
  return {
    nodes: [
      { id: 'rn-1', type: 'waypoint', position: { x: 2, y: 3 }, floor: 0 },
      { id: 'rn-2', type: 'waypoint', position: { x: 8, y: 3 }, floor: 0 },
      { id: 'rn-3', type: 'waypoint', position: { x: 5, y: 6 }, floor: 0 },
    ],
    edges: [
      { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 6 },
      { id: 're-2', from: 'rn-2', to: 'rn-3', type: 'walk', distance: 5 },
    ],
    ...overrides,
  }
}

// ── Authority Predicate Tests ──

describe('assessRouteNetworkAuthority', () => {
  it('ABSENT when routeNetwork is undefined', () => {
    const floor = makeFloor()
    expect(assessRouteNetworkAuthority(floor)).toBe('ABSENT')
  })

  it('EMPTY when routeNetwork has no nodes', () => {
    const floor = makeFloor({ routeNetwork: { nodes: [], edges: [] } })
    expect(assessRouteNetworkAuthority(floor)).toBe('EMPTY')
  })

  it('USABLE for valid network', () => {
    const floor = makeFloor({ routeNetwork: makeRouteNetwork() })
    expect(assessRouteNetworkAuthority(floor)).toBe('USABLE')
  })

  it('INVALID when node IDs are duplicate', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'rn-1', type: 'waypoint', position: { x: 1, y: 1 }, floor: 0 },
        ],
        edges: [],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when node has non-finite coordinates', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: NaN, y: 0 }, floor: 0 },
        ],
        edges: [],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when node has Infinity coordinates', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: Infinity, y: 0 }, floor: 0 },
        ],
        edges: [],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when edge IDs are duplicate', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'rn-2', type: 'waypoint', position: { x: 1, y: 0 }, floor: 0 },
        ],
        edges: [
          { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 1 },
          { id: 're-1', from: 'rn-2', to: 'rn-1', type: 'walk', distance: 1 },
        ],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when edge references non-existent node', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        ],
        edges: [
          { id: 're-1', from: 'rn-1', to: 'rn-999', type: 'walk', distance: 1 },
        ],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when edge is self-edge', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        ],
        edges: [
          { id: 're-1', from: 'rn-1', to: 'rn-1', type: 'walk', distance: 0 },
        ],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when edge distance is negative', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'rn-2', type: 'waypoint', position: { x: 1, y: 0 }, floor: 0 },
        ],
        edges: [
          { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: -5 },
        ],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })

  it('INVALID when edge distance is NaN', () => {
    const floor = makeFloor({
      routeNetwork: {
        nodes: [
          { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'rn-2', type: 'waypoint', position: { x: 1, y: 0 }, floor: 0 },
        ],
        edges: [
          { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: NaN },
        ],
      },
    })
    expect(assessRouteNetworkAuthority(floor)).toBe('INVALID')
  })
})

// ── Route-Network Extractor Tests ──

describe('extractRouteNetwork', () => {
  it('emits PrimitiveNode for each RouteNode with R- prefix', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])
    const result = extractRouteNetwork(doc)
    expect(result.nodes).toBeDefined()
    expect(result.nodes!.length).toBe(3)
    expect(result.nodes![0]!.id).toBe('R-rn-1')
    expect(result.nodes![1]!.id).toBe('R-rn-2')
    expect(result.nodes![2]!.id).toBe('R-rn-3')
  })

  it('converts building-local position to world LatLng', () => {
    const doc = makeDoc([makeBuilding({
      position: { lat: 14.0, lng: 121.0 },
      floors: [makeFloor({
        routeNetwork: {
          nodes: [{ id: 'rn-1', type: 'waypoint', position: { x: 100, y: 200 }, floor: 0 }],
          edges: [],
        },
      })],
    })])
    const result = extractRouteNetwork(doc)
    const node = result.nodes![0]!

    // x=100m east, y=200m north from origin (14.0, 121.0)
    expect(node.position.lat).toBeGreaterThan(14.0)
    expect(node.position.lng).toBeGreaterThan(121.0)
    expect(node.source.entityId).toBe('rn-1')
    expect(node.source.entityType).toBe('route_node')
  })

  it('emits PrimitiveEdge for each RouteEdge with R- prefix', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])
    const result = extractRouteNetwork(doc)
    expect(result.edges).toBeDefined()
    expect(result.edges!.length).toBe(2)
    expect(result.edges![0]!.id).toBe('R-re-1')
    expect(result.edges![1]!.id).toBe('R-re-2')
  })

  it('preserves authored edge distances', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])
    const result = extractRouteNetwork(doc)
    expect(result.edges![0]!.distance).toBe(6)
    expect(result.edges![1]!.distance).toBe(5)
  })

  it('sets correct floor and buildingId on nodes', () => {
    const doc = makeDoc([makeBuilding({
      id: 'b1',
      floors: [makeFloor({ id: 'b1-0', level: 0, buildingId: 'b1', routeNetwork: makeRouteNetwork() })],
    })])
    const result = extractRouteNetwork(doc)
    for (const node of result.nodes!) {
      expect(node.floor).toBe(0)
      expect(node.buildingId).toBe('b1')
    }
  })

  it('emits ROUTE_NETWORK_COMPILED diagnostic', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({ routeNetwork: makeRouteNetwork() })],
    })])
    const result = extractRouteNetwork(doc)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics!.some(d => d.code === 'ROUTE_NETWORK_COMPILED')).toBe(true)
  })

  it('skips floors without routeNetwork', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor()],
    })])
    const result = extractRouteNetwork(doc)
    expect(result.nodes!.length).toBe(0)
    expect(result.edges!.length).toBe(0)
  })

  it('emits a traversable chain through a shared junction and door connector', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'n-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'j-1', type: 'waypoint', position: { x: 4, y: 0 }, floor: 0 },
        { id: 'n-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
        { id: 'door-anchor', type: 'portal', position: { x: 4, y: 1 }, floor: 0 },
      ],
      edges: [
        { id: 'e-a-j', from: 'n-a', to: 'j-1', type: 'walk', distance: 4 },
        { id: 'e-j-b', from: 'j-1', to: 'n-b', type: 'walk', distance: 6 },
        { id: 'e-door', from: 'door-anchor', to: 'j-1', type: 'walk', distance: 1 },
      ],
    }
    const doc = makeDoc([makeBuilding({ floors: [makeFloor({ routeNetwork })] })])

    const contribution = extractRouteNetwork(doc)
    expect(contribution.nodes!.map(node => node.id)).toEqual(expect.arrayContaining(['R-n-a', 'R-j-1', 'R-n-b', 'R-door-anchor']))
    expect(contribution.edges!.map(edge => edge.id)).toEqual(expect.arrayContaining(['R-e-a-j', 'R-e-j-b', 'R-e-door']))

    // Traversal proof: BFS from R-n-a must reach R-n-b and the door anchor via R-j-1.
    const adjacency = new Map<string, string[]>()
    for (const edge of contribution.edges!) {
      if (!('from' in edge) || !('to' in edge)) continue
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to])
      adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from])
    }
    const visited = new Set<string>(['R-n-a'])
    const queue = ['R-n-a']
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
    expect(visited.has('R-n-b')).toBe(true)
    expect(visited.has('R-door-anchor')).toBe(true)
  })
})

// ── Coordinator Authority Selector Tests ──

describe('generatePrimitives authority selector', () => {
  it('uses route-network-extractor when USABLE', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({
        hallways: [{
          id: 'hw1', name: 'Hall', polyline: [
            { lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 },
          ], width: 3, floorId: 'b1-0', floorLevel: 0, buildingId: 'b1',
        }],
        routeNetwork: makeRouteNetwork(),
      })],
    })])
    const result = generatePrimitives(doc, ctx)

    // Should have R- prefixed nodes from route network
    const routeNodes = result.nodes.filter(n => n.id.startsWith('R-'))
    expect(routeNodes.length).toBe(3)

    // Should NOT have skeleton waypoints from the hallway on this floor
    const skeletonNodes = result.nodes.filter(
      n => n.source.generatorId === 'builtin:polyline-skeleton' && n.source.entityType === 'hallway',
    )
    expect(skeletonNodes.length).toBe(0)
  })

  it('uses skeleton-generator when ABSENT', () => {
    const doc = makeDoc([makeBuilding({
      floors: [makeFloor({
        hallways: [{
          id: 'hw1', name: 'Hall', polyline: [
            { lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 },
          ], width: 3, floorId: 'b1-0', floorLevel: 0, buildingId: 'b1',
        }],
      })],
    })])
    const result = generatePrimitives(doc, ctx)

    const skeletonNodes = result.nodes.filter(
      n => n.source.generatorId === 'builtin:polyline-skeleton' && n.source.entityType === 'hallway',
    )
    expect(skeletonNodes.length).toBeGreaterThan(0)
  })

  it('mixed floors: canonical for USABLE, skeleton for legacy', () => {
    const doc = makeDoc([makeBuilding({
      floors: [
        makeFloor({
          id: 'b1-0', level: 0, buildingId: 'b1',
          hallways: [{
            id: 'hw1', name: 'Hall', polyline: [
              { lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 },
            ], width: 3, floorId: 'b1-0', floorLevel: 0, buildingId: 'b1',
          }],
          routeNetwork: makeRouteNetwork(),
        }),
        makeFloor({
          id: 'b1-1', level: 1, buildingId: 'b1',
          hallways: [{
            id: 'hw2', name: 'Hall2', polyline: [
              { lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 },
            ], width: 3, floorId: 'b1-1', floorLevel: 1, buildingId: 'b1',
          }],
        }),
      ],
    })])
    const result = generatePrimitives(doc, ctx)

    // Floor 0: canonical nodes
    const routeNodes = result.nodes.filter(n => n.id.startsWith('R-'))
    expect(routeNodes.length).toBe(3)

    // Floor 1: skeleton nodes
    const skeletonNodes = result.nodes.filter(
      n => n.source.generatorId === 'builtin:polyline-skeleton' && n.source.entityType === 'hallway',
    )
    expect(skeletonNodes.length).toBeGreaterThan(0)
  })
})

// ── A* Pathfinding Proof ──

describe('A* pathfinding through compiled RouteNetwork', () => {
  it('finds shortest path from rn-1 to rn-3', () => {
    const routeNetwork: RouteNetwork = {
      nodes: [
        { id: 'rn-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
        { id: 'rn-2', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
        { id: 'rn-3', type: 'waypoint', position: { x: 5, y: 5 }, floor: 0 },
      ],
      edges: [
        { id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 10 },
        { id: 're-2', from: 'rn-2', to: 'rn-3', type: 'walk', distance: 7 },
        { id: 're-3', from: 'rn-1', to: 'rn-3', type: 'walk', distance: 8 },
      ],
    }

    const doc = makeDoc([makeBuilding({
      position: { lat: 14.0, lng: 121.0 },
      floors: [makeFloor({ routeNetwork })],
    })])

    const graph = generatePrimitives(doc, ctx)

    // Build adjacency list from compiled edges
    const adj = new Map<string, Array<{ to: string; distance: number }>>()
    for (const node of graph.nodes) {
      adj.set(node.id, [])
    }
    for (const edge of graph.edges) {
      if (edge.kind === 'skeleton' && 'from' in edge) {
        adj.get(edge.from)?.push({ to: edge.to, distance: edge.distance })
        adj.get(edge.to)?.push({ to: edge.from, distance: edge.distance })
      }
    }

    // A* implementation
    function aStar(start: string, goal: string): string[] | null {
      const gScore = new Map<string, number>()
      const fScore = new Map<string, number>()
      const cameFrom = new Map<string, string>()
      const openSet = new Set<string>([start])

      gScore.set(start, 0)
      fScore.set(start, 0)

      while (openSet.size > 0) {
        let current = ''
        let bestF = Infinity
        for (const node of openSet) {
          const f = fScore.get(node) ?? Infinity
          if (f < bestF) {
            bestF = f
            current = node
          }
        }

        if (current === goal) {
          const path = [current]
          while (cameFrom.has(current)) {
            current = cameFrom.get(current)!
            path.unshift(current)
          }
          return path
        }

        openSet.delete(current)
        for (const neighbor of adj.get(current) ?? []) {
          const tentativeG = (gScore.get(current) ?? Infinity) + neighbor.distance
          if (tentativeG < (gScore.get(neighbor.to) ?? Infinity)) {
            cameFrom.set(neighbor.to, current)
            gScore.set(neighbor.to, tentativeG)
            fScore.set(neighbor.to, tentativeG)
            openSet.add(neighbor.to)
          }
        }
      }
      return null
    }

    const path = aStar('R-rn-1', 'R-rn-3')
    expect(path).not.toBeNull()
    expect(path).toEqual(['R-rn-1', 'R-rn-3'])
  })
})
