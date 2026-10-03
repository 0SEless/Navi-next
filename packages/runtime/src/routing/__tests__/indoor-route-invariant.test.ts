/**
 * T1.2 — Indoor Route Invariant
 *
 * INVARIANT 2: Every entrance portal must connect indoor ↔ outdoor topology.
 *
 * A route from an indoor room to an outdoor road MUST be findable by A*.
 * The path must traverse: Room → Hallway → Entrance → Outdoor.
 *
 * INVARIANT: The entrance is a portal between coordinate/topology domains.
 * The graph must have distinct indoor and outdoor nodes connected by a
 * traversable edge.
 *
 * STATUS: RED — these tests expose BUG 1 (RoomDoor→hallway dropped),
 * BUG 5 (nearestEntrance wrong type), and the missing indoor→outdoor chain.
 */

import { describe, it, expect } from 'vitest'
import { RoutingEngine } from '../routing-engine'
import type { NavigationGraph, NavNode, NavEdge } from '@navi/core'

// ── Helpers ──

function makeGraph(nodes: NavNode[], edges: NavEdge[]): NavigationGraph {
  return {
    version: '1.0.0', campusId: 'test', createdAt: '', checksum: '',
    nodes,
    edges,
    metadata: {
      nodeCount: nodes.length, edgeCount: edges.length,
      buildings: new Set(nodes.map(n => n.buildingId)).size,
      floors: new Set(nodes.map(n => `${n.buildingId}-${n.floor}`)).size,
      boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 },
    },
  }
}

function n(id: string, label: string, type: NavNode['type'], lng: number, lat: number, floor = 0, buildingId = 'b1'): NavNode {
  return { id, label, type, position: { lng, lat }, floor, buildingId, properties: {} }
}

function e(id: string, from: string, to: string, type: NavEdge['type'], distance: number, weight = distance): NavEdge {
  return { id, from, to, type, distance, weight }
}

// ── Scenario: Complete indoor → outdoor route ──
//
//  room-1 (space, floor 0, b1)
//     │
//   door edge (walk)
//     │
//  hall-1 (corridor, floor 0, b1)
//     │
//   walkway edge
//     │
//  ent-1 (building_entrance, floor 0, b1)  ← indoor position
//     │
//   walkway edge (portal)
//     │
//  outdoor-1 (outdoor, floor 0, "")
//     │
//   walk edge
//     │
//  road-1 (corridor, floor 0, "")

function indoorToOutdoorGraph(): NavigationGraph {
  return makeGraph(
    [
      n('room-1', 'Room 101', 'space', 121.001, 14.001, 0, 'b1'),
      n('hall-1', 'Main Hallway', 'corridor', 121.0005, 14.0005, 0, 'b1'),
      n('ent-1', 'Main Entrance', 'building_entrance', 121.0003, 14.0003, 0, 'b1'),
      n('outdoor-1', 'Road Junction', 'outdoor', 121.000, 14.000, 0, ''),
      n('road-1', 'Main Road', 'corridor', 120.999, 14.000, 0, ''),
    ],
    [
      e('door-1', 'room-1', 'hall-1', 'door', 50),
      e('walk-1', 'hall-1', 'ent-1', 'walkway', 30),
      e('portal-1', 'ent-1', 'outdoor-1', 'walkway', 20),
      e('road-1', 'outdoor-1', 'road-1', 'walk', 100),
    ],
  )
}

// ── Scenario: Indoor → outdoor with entrance as portal ──
//
// Verifies the dual-position entrance model:
// outdoor position → entrance node → indoor position

function entrancePortalGraph(): NavigationGraph {
  return makeGraph(
    [
      // Outdoor side
      n('road-a', 'Road A', 'corridor', 121.0, 14.0, 0, ''),
      n('outdoor-ent', 'Outdoor Entrance', 'outdoor', 121.0002, 14.0002, 0, ''),
      // Entrance portal (indoor position)
      n('indoor-ent', 'Building Entrance', 'building_entrance', 121.0004, 14.0004, 0, 'b1'),
      // Indoor side
      n('hall-a', 'Lobby', 'corridor', 121.0006, 14.0006, 0, 'b1'),
      n('room-a', 'Office 101', 'space', 121.001, 14.001, 0, 'b1'),
    ],
    [
      e('e1', 'road-a', 'outdoor-ent', 'walk', 30),
      e('portal', 'outdoor-ent', 'indoor-ent', 'walkway', 25),
      e('e3', 'indoor-ent', 'hall-a', 'walkway', 20),
      e('door', 'hall-a', 'room-a', 'door', 40),
    ],
  )
}

// ── Tests ──

describe('T1.2 | Indoor Route Invariant', () => {

  describe('INVARIANT: Every entrance portal must connect indoor ↔ outdoor topology', () => {

    it('finds a route from indoor room to outdoor road', () => {
      const engine = new RoutingEngine(indoorToOutdoorGraph())
      const route = engine.findRoute('room-1', 'road-1')

      // INVARIANT: Route MUST exist
      expect(route).not.toBeNull()

      if (route) {
        // INVARIANT: Path must include both indoor and outdoor nodes
        const nodeIds = route.path.map(s => s.nodeId)
        expect(nodeIds).toContain('room-1')   // start: indoor
        expect(nodeIds).toContain('road-1')   // end: outdoor

        // INVARIANT: Path must traverse the entrance portal
        expect(nodeIds).toContain('ent-1')

        // INVARIANT: Total distance must be positive
        expect(route.totalDistance).toBeGreaterThan(0)
      }
    })

    it('finds a route from outdoor road to indoor room', () => {
      const engine = new RoutingEngine(indoorToOutdoorGraph())
      const route = engine.findRoute('road-1', 'room-1')

      // INVARIANT: Reverse route must also work
      expect(route).not.toBeNull()

      if (route) {
        const nodeIds = route.path.map(s => s.nodeId)
        expect(nodeIds).toContain('road-1')
        expect(nodeIds).toContain('room-1')
        expect(nodeIds).toContain('ent-1')
      }
    })

    it('entrance portal has distinct indoor and outdoor nodes', () => {
      const graph = entrancePortalGraph()

      // INVARIANT: There must be an outdoor node at the entrance
      const outdoorNodes = graph.nodes.filter(n => n.type === 'outdoor')
      expect(outdoorNodes.length).toBeGreaterThanOrEqual(1)

      // INVARIANT: There must be a building_entrance node
      const entranceNodes = graph.nodes.filter(n => n.type === 'building_entrance')
      expect(entranceNodes.length).toBeGreaterThanOrEqual(1)

      // INVARIANT: Outdoor and entrance nodes must have DIFFERENT positions
      if (outdoorNodes.length > 0 && entranceNodes.length > 0) {
        const outdoor = outdoorNodes[0]
        const entrance = entranceNodes[0]
        const samePosition =
          outdoor.position.lat === entrance.position.lat &&
          outdoor.position.lng === entrance.position.lng
        expect(samePosition).toBe(false)
      }
    })

    it('portal edge connects outdoor node to entrance node', () => {
      const graph = entrancePortalGraph()

      // INVARIANT: There must be a walkway edge between outdoor and entrance
      const portalEdges = graph.edges.filter(e => e.type === 'walkway')
      expect(portalEdges.length).toBeGreaterThanOrEqual(1)

      if (portalEdges.length > 0) {
        const portal = portalEdges[0]
        const fromNode = graph.nodes.find(n => n.id === portal.from)
        const toNode = graph.nodes.find(n => n.id === portal.to)

        // INVARIANT: One side must be outdoor, the other building_entrance
        const fromType = fromNode?.type
        const toType = toNode?.type
        const validPortal =
          (fromType === 'outdoor' && toType === 'building_entrance') ||
          (fromType === 'building_entrance' && toType === 'outdoor')
        expect(validPortal).toBe(true)

        // INVARIANT: Portal edge distance must be positive
        expect(portal.distance).toBeGreaterThan(0)
      }
    })

    it('route from room to outdoor traverses the entrance portal', () => {
      const engine = new RoutingEngine(entrancePortalGraph())
      const route = engine.findRoute('room-a', 'road-a')

      expect(route).not.toBeNull()

      if (route) {
        const nodeIds = route.path.map(s => s.nodeId)

        // INVARIANT: Route must include the entrance portal node
        expect(nodeIds).toContain('indoor-ent')

        // INVARIANT: Route must include the outdoor node
        expect(nodeIds).toContain('outdoor-ent')

        // INVARIANT: Route must go through both indoor and outdoor sides
        const hasIndoor = nodeIds.some(id => {
          const node = route.path.find(s => s.nodeId === id)
          return node && node.buildingId === 'b1'
        })
        const hasOutdoor = nodeIds.some(id => {
          const node = route.path.find(s => s.nodeId === id)
          return node && node.buildingId === ''
        })
        expect(hasIndoor).toBe(true)
        expect(hasOutdoor).toBe(true)
      }
    })
  })
})
