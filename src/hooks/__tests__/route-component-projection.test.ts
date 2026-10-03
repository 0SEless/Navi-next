import { describe, expect, it } from 'vitest'
import type { CampusDocument, CoordinateTransformer } from '@navi/core'
import { extractFloorComponents } from '../floor-graph-selectors'

const transformer = {
  buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y, lng: point.x }),
} as unknown as CoordinateTransformer

function createDoc(floor: any): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Test', code: 'T', category: 'academic', description: '',
      footprint: { points: [] }, baseElevation: 0, height: 20, color: '#000', aliases: {}, metadata: {},
      floors: [floor], verticalConnectors: [],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  } as CampusDocument
}

describe('route component projection', () => {
  it('projects route nodes and edges without creating physical hallway components', () => {
    const floor = {
      id: 'flr-1', level: 0, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [],
      routeNetwork: {
        nodes: [
          { id: 'route-node-1', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
          { id: 'route-node-2', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
        ],
        edges: [{ id: 'route-edge-1', from: 'route-node-1', to: 'route-node-2', type: 'walk', distance: 10 }],
      },
    }

    const components = extractFloorComponents(createDoc(floor), 'bld-1', floor, transformer)
    const node = components.find((component) => component.id === 'route-node-1')
    const edge = components.find((component) => component.id === 'route-edge-1')

    expect(node).toMatchObject({ id: 'route-node-1', type: 'route-node', floor: 0, position: { lat: 0, lng: 0 } })
    expect(node?.metadata).toMatchObject({ routeEntity: 'node', nodeType: 'waypoint', nodeId: 'route-node-1' })
    expect(edge).toMatchObject({ id: 'route-edge-1', type: 'route-edge', floor: 0, position: { lat: 0, lng: 5 } })
    expect(edge?.metadata).toMatchObject({ routeEntity: 'edge', edgeId: 'route-edge-1', from: 'route-node-1', to: 'route-node-2', edgeType: 'walk', distance: 10 })
    expect(components.some((component) => component.type === 'hallway')).toBe(false)
  })
})
