import { describe, it, expect } from 'vitest'
import { Graph } from '../graph'
import type { TracePath, NavNode } from '@/types/nav-types'

function makeGraph(): Graph {
  const g = new Graph()
  g.campusId = 'test-campus'
  return g
}

function makeTrace(overrides: Partial<TracePath> = {}): TracePath {
  return {
    id: 'trace-1',
    name: 'Test Path',
    floor: 0,
    points: [
      { lat: 10, lng: 20 },
      { lat: 10.001, lng: 20.001 },
    ],
    type: 'arterial',
    ...overrides,
  }
}

describe('Graph.removeTrace', () => {
  it('should not delete nodes shared with other traces', () => {
    const g = makeGraph()
    const sharedNode: NavNode = {
      id: 'shared-node',
      label: 'Junction',
      name: 'Junction',
      type: 'intersection',
      buildingId: '',
      campusId: '',
      floor: 0,
      position: { lat: 10.0005, lng: 20.0005 },
      metadata: { traceIds: ['trace-1', 'trace-2'], connectionNode: true },
    }
    const ownedNode: NavNode = {
      id: 'owned-node',
      label: 'Path Node',
      name: 'Path Node',
      type: 'intersection',
      buildingId: '',
      campusId: '',
      floor: 0,
      position: { lat: 10, lng: 20 },
      metadata: { traceId: 'trace-1' },
    }
    g.addNode(sharedNode)
    g.addNode(ownedNode)
    g.addTrace(makeTrace())
    g.addTrace(makeTrace({ id: 'trace-2' }))

    g.removeTrace('trace-1')

    // shared node should still exist (referenced by trace-2)
    expect(g.getNode('shared-node')).toBeDefined()
    // owned node should be deleted
    expect(g.getNode('owned-node')).toBeUndefined()
    // shared node's traceIds should no longer contain trace-1
    const remaining = g.getNode('shared-node')!
    const traceIds = remaining.metadata?.traceIds as string[]
    expect(traceIds).toEqual(['trace-2'])
  })

  it('should delete shared node when last reference is removed', () => {
    const g = makeGraph()
    const node: NavNode = {
      id: 'node',
      label: 'Junction',
      name: 'Junction',
      type: 'intersection',
      buildingId: '',
      campusId: '',
      floor: 0,
      position: { lat: 10, lng: 20 },
      metadata: { traceIds: ['trace-1'], connectionNode: true },
    }
    g.addNode(node)
    g.addTrace(makeTrace())

    g.removeTrace('trace-1')

    expect(g.getNode('node')).toBeUndefined()
  })

  it('should remove edges whose endpoint nodes were deleted', () => {
    const g = makeGraph()
    const nodeA: NavNode = {
      id: 'node-a', label: 'A', name: 'A', type: 'intersection',
      buildingId: '', campusId: '', floor: 0,
      position: { lat: 10, lng: 20 },
      metadata: { traceId: 'trace-1' },
    }
    const nodeB: NavNode = {
      id: 'node-b', label: 'B', name: 'B', type: 'intersection',
      buildingId: '', campusId: '', floor: 0,
      position: { lat: 10.001, lng: 20.001 },
      metadata: { traceId: 'trace-1' },
    }
    g.addNode(nodeA)
    g.addNode(nodeB)
    g.addEdge({ id: 'edge-1', from: 'node-a', to: 'node-b', type: 'walk', distance: 100, weight: 100 })
    g.addTrace(makeTrace())

    g.removeTrace('trace-1')

    expect(g.getNode('node-a')).toBeUndefined()
    expect(g.getNode('node-b')).toBeUndefined()
    expect(g.getEdge('edge-1')).toBeUndefined()
  })
})
