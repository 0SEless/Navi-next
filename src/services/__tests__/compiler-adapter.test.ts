import { describe, it, expect } from 'vitest'
import { CampusCompilerAdapter } from '../compiler-server'
import { createGoldenCampus } from '../../../packages/editor/src/demo/golden-campus'
import type { CampusDocument } from '@navi/core'

function makeInvalidNoEntranceDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'No-Entrance Campus',
      name: 'No-Entrance Campus',
      description: 'Building with rooms but no entrances — fails MissingEntranceRule',
      lastModified: '2025-01-01T00:00:00.000Z',
      editorVersion: '1.0.0',
    },
    buildings: [
      {
        id: 'bldg-x',
        name: 'Building X',
        code: 'BX',
        category: 'academic',
        description: 'No entrances, staircases, or elevators',
        footprint: { points: [{ lat: 12.34, lng: 121.23 }, { lat: 12.35, lng: 121.23 }, { lat: 12.35, lng: 121.24 }, { lat: 12.34, lng: 121.24 }] },
        baseElevation: 0,
        height: 10,
        color: '#FF0000',
        aliases: [],
        metadata: {},
        verticalConnectors: [],
        floors: [
          {
            id: 'fl-x-1',
            level: 1,
            label: 'Floor 1',
            elevation: 0,
            rooms: [
              {
                id: 'room-x-1',
                name: 'Room X1',
                number: 'X101',
                category: 'classroom',
                polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] },
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [
              {
                id: 'hw-x-1',
                name: 'Hallway X',
                polyline: { points: [{ x: 0, y: 6 }, { x: 10, y: 6 }] },
                width: 2,
              },
            ],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [],
            metadata: {},
          },
        ],
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('CampusCompilerAdapter', () => {
  it('compiles a valid campus document', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = createGoldenCampus()
    const result = await adapter.compile(doc)
    expect(result.status).toBe('success')
  })

  it('returns artifacts with navigationGraph', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = createGoldenCampus()
    const result = await adapter.compile(doc)
    expect(result.artifacts?.navigationGraph).toBeDefined()
    expect(result.artifacts?.searchIndex).toBeDefined()
    expect(result.artifacts?.poiData).toBeDefined()
    expect(result.artifacts?.buildingIndex).toBeDefined()
  })

  it('returns node count > 0', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = createGoldenCampus()
    const result = await adapter.compile(doc)
    const graph = result.artifacts?.navigationGraph as any
    expect(graph.nodes.length).toBeGreaterThan(0)
  })

  it('fails with graph validation error for campus with no entrances', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = makeInvalidNoEntranceDoc()
    const result = await adapter.compile(doc)
    expect(result.status).toBe('error')
    expect(result.message).toContain('Compilation failed')
    expect(result.message).toContain('HALLWAY_DISCONNECTED')
  })

  it('fails gracefully with null doc', async () => {
    const adapter = new CampusCompilerAdapter()
    const result = await adapter.compile(null as any)
    expect(result.status).toBe('error')
    expect(result.message).toBeDefined()
  })
})
