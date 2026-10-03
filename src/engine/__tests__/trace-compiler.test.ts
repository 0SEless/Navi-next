import { describe, it, expect } from 'vitest'
import type { TracePath, NavNode, NavEdge } from '@/types/nav-types'
import { compileTrace } from '../trace-compiler'

describe('compileTrace', () => {
  const hallway: TracePath = {
    id: 'T001',
    name: 'Main Hallway',
    buildingId: 'BLD01',
    floor: 1,
    points: [
      { lat: 11.8195, lng: 122.0922 },
      { lat: 11.8196, lng: 122.0923 },
      { lat: 11.8197, lng: 122.0924 },
    ],
    type: 'connector',
  }

  it('generates endpoint nodes for a simple trace', () => {
    const result = compileTrace(hallway, [], [])
    expect(result.nodes.length).toBeGreaterThanOrEqual(2)
    const firstNode = result.nodes[0]
    expect(firstNode.type).toBe('intersection')
    expect(firstNode.floor).toBe(1)
    expect(firstNode.buildingId).toBe('BLD01')
  })

  it('marks both endpoints as connectable road endpoints', () => {
    const result = compileTrace(hallway, [], [])
    const endpointNodes = result.nodes.filter((node) => node.metadata?.roadEndpoint === true)

    expect(endpointNodes).toHaveLength(2)
    expect(endpointNodes.map((node) => node.position)).toEqual([
      hallway.points[0],
      hallway.points[hallway.points.length - 1],
    ])
  })

  it('generates edges between consecutive nodes', () => {
    const result = compileTrace(hallway, [], [])
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
    for (const edge of result.edges) {
      expect(edge.type).toBe('walk')
    }
  })

  it('does not create extra nodes for wall traces', () => {
    const wall: TracePath = { id: 'W01', floor: 1, points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], type: 'connector', metadata: { role: 'wall' } }
    const result = compileTrace(wall, [], [])
    expect(result.nodes.length).toBe(0)
    expect(result.edges.length).toBe(0)
  })

  it('does NOT connect traces to room door nodes (no road→door shortcuts)', () => {
    // Regression: traces must never link directly to room doors — that would
    // bypass the building entrance (road → entrance → hallway → room_door is
    // the only valid path into a building).
    const roomNode: NavNode = {
      id: 'N010', label: 'Room 101', name: 'Room 101', type: 'room_door',
      buildingId: 'BLD01', campusId: 'asu-ibajay', floor: 1,
      position: { lat: 11.81955, lng: 122.09225 },
    }
    const result = compileTrace(hallway, [roomNode], [])
    const hasRoomConnection = result.edges.some(
      (e) => e.to === 'N010' || e.from === 'N010'
    )
    expect(hasRoomConnection).toBe(false)
  })

  it('does not duplicate existing edges', () => {
    const firstResult = compileTrace(hallway, [], [])
    const firstEdge = firstResult.edges[0]
    const existingEdges: NavEdge[] = [firstEdge]
    const secondResult = compileTrace(hallway, [], existingEdges)
    const duplicateCount = secondResult.edges.filter(
      (e) => e.from === firstEdge.from && e.to === firstEdge.to
    ).length
    expect(duplicateCount).toBe(0)
  })

  it('reuses stable node and edge IDs from stableReference across recompilation', () => {
    const initial = compileTrace(hallway, [], [])
    expect(initial.nodes.length).toBe(3)
    expect(initial.edges.length).toBe(2)

    const recompiled = compileTrace(hallway, [], [], {
      nodes: initial.nodes,
      edges: initial.edges,
    })

    expect(recompiled.nodes.map(n => n.id)).toEqual(initial.nodes.map(n => n.id))
    expect(recompiled.edges.map(e => e.id)).toEqual(initial.edges.map(e => e.id))
  })
})

