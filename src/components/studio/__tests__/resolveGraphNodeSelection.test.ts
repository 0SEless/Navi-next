import { describe, it, expect } from 'vitest'
import { Graph } from '@/engine/graph'
import type { NavNode } from '@/types/nav-types'
import type { CampusDocument } from '@navi/core'
import { resolveGraphNodeSelection } from '../resolveGraphNodeSelection'

function makeNode(over: Partial<NavNode>): NavNode {
  return {
    id: 'N0001',
    label: 'node',
    position: { lat: 0, lng: 0 },
    floor: 0,
    buildingId: 'bld-1',
    campusId: 'campus',
    type: 'room',
    ...over,
  } as NavNode
}

function makeDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [
      {
        id: 'bld-1',
        name: 'Main',
        code: 'M',
        category: 'academic',
        description: '',
        footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] },
        baseElevation: 0,
        height: 10,
        color: '#3366ff',
        floors: [
          {
            id: 'flr-1',
            level: 0,
            name: 'Ground',
            planImageId: undefined,
            rooms: [{ id: 'room-1', name: 'Room 1', number: '101', hallwayIds: [], polygon: { points: [] } }],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
          },
        ],
        aliases: [],
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  } as unknown as CampusDocument
}

describe('resolveGraphNodeSelection', () => {
  it('resolves a graph node to its source room entity via componentId', () => {
    const graph = new Graph()
    graph.addNode(makeNode({ id: 'N0002', componentId: 'room-1' }))
    const sel = resolveGraphNodeSelection(graph, makeDoc(), 'N0002')
    expect(sel).toEqual({ type: 'room', id: 'room-1' })
  })

  it('resolves a graph node to its source building entity via componentId', () => {
    const graph = new Graph()
    graph.addNode(makeNode({ id: 'N0003', componentId: 'bld-1' }))
    const sel = resolveGraphNodeSelection(graph, makeDoc(), 'N0003')
    expect(sel).toEqual({ type: 'building', id: 'bld-1' })
  })

  it('returns null for a node with no componentId (derived node)', () => {
    const graph = new Graph()
    graph.addNode(makeNode({ id: 'N0004', componentId: undefined }))
    expect(resolveGraphNodeSelection(graph, makeDoc(), 'N0004')).toBeNull()
  })

  it('returns null for a node whose componentId is not in the document', () => {
    const graph = new Graph()
    graph.addNode(makeNode({ id: 'N0005', componentId: 'ghost-9' }))
    expect(resolveGraphNodeSelection(graph, makeDoc(), 'N0005')).toBeNull()
  })

  it('returns null for a node id that does not exist', () => {
    const graph = new Graph()
    expect(resolveGraphNodeSelection(graph, makeDoc(), 'N-does-not-exist')).toBeNull()
  })

  it('returns null for a null node id', () => {
    const graph = new Graph()
    expect(resolveGraphNodeSelection(graph, makeDoc(), null)).toBeNull()
  })
})
