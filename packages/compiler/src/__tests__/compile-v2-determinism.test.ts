import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument } from '@navi/core'

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'det-test', name: 'det-test', description: 'Determinism test', lastModified: '', editorVersion: '1.0' },
    buildings: [
      {
        id: 'b1',
        name: 'Det Building',
        code: 'DET',
        category: 'academic',
        description: '',
        footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.001 }, { lat: 14.0, lng: 121.001 }] },
        baseElevation: 10,
        height: 10,
        floors: [
          {
            id: 'b1-f1',
            level: 1,
            label: 'Floor 1',
            elevation: 0,
            rooms: [
              {
                id: 'r1',
                name: 'Room 1',
                number: '101',
                category: 'classroom',
                polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
                roomDoors: [{ id: 'r1-d1', roomId: 'r1', connectedToId: 'hw1', connectedToType: 'hallway', doorType: 'standard', position: { x: 5, y: 10 }, width: 1.5, metadata: {} }],
                metadata: {},
              },
            ],
            hallways: [{ id: 'hw1', name: 'Hallway', polyline: { points: [{ x: 0, y: 5 }, { x: 15, y: 5 }] }, width: 3 }],
            staircases: [],
            elevators: [],
            entrances: [{ id: 'e1', label: 'Entrance', position: { lat: 14.0, lng: 121.0 } as any, level: 1, type: 'main', hasQR: false, hasPanorama: false }],
            connectorStops: [],
            metadata: {},
          },
        ],
        verticalConnectors: [],
        aliases: [],
        color: '#fff',
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('compileV2 determinism', () => {
  const config = { nodeInterval: 10, mergeThreshold: 0.5 } as any

  it('produces identical structural output across 5 runs', () => {
    const doc = makeDocument()
    const compiler = new CampusCompiler(config)
    const results = Array.from({ length: 5 }, () => compiler.compileV2(doc))

    const base = results[0]!
    for (let i = 1; i < 5; i++) {
      expect(results[i]!.graph!.nodes.length).toBe(base.graph!.nodes.length)
      expect(results[i]!.graph!.edges.length).toBe(base.graph!.edges.length)
      expect(results[i]!.graph!.metadata).toEqual(base.graph!.metadata)
      expect(results[i]!.artifacts!.searchIndex.entries.length).toBe(base.artifacts!.searchIndex.entries.length)
      expect(results[i]!.artifacts!.buildingIndex.buildings.length).toBe(base.artifacts!.buildingIndex.buildings.length)
      expect(results[i]!.artifacts!.poiIndex.points.length).toBe(base.artifacts!.poiIndex.points.length)
    }
  })

  it('produces identical node type distribution across runs', () => {
    const doc = makeDocument()
    const compiler = new CampusCompiler(config)
    const results = Array.from({ length: 3 }, () => compiler.compileV2(doc))

    const typeCounts = results.map(r =>
      r.graph!.nodes.reduce((acc, n) => {
        acc[n.type] = (acc[n.type] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    )

    for (let i = 1; i < typeCounts.length; i++) {
      expect(typeCounts[i]).toEqual(typeCounts[0])
    }
  })

  it('produces identical edge type distribution across runs', () => {
    const doc = makeDocument()
    const compiler = new CampusCompiler(config)
    const results = Array.from({ length: 3 }, () => compiler.compileV2(doc))

    const typeCounts = results.map(r =>
      r.graph!.edges.reduce((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    )

    for (let i = 1; i < typeCounts.length; i++) {
      expect(typeCounts[i]).toEqual(typeCounts[0])
    }
  })

  it('produces identical report statistics across runs', () => {
    const doc = makeDocument()
    const compiler = new CampusCompiler(config)
    const results = Array.from({ length: 3 }, () => compiler.compileV2(doc))

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.report!.statistics.rooms).toBe(results[0]!.report!.statistics.rooms)
      expect(results[i]!.report!.statistics.waypoints).toBe(results[0]!.report!.statistics.waypoints)
      expect(results[i]!.report!.statistics.edges).toBe(results[0]!.report!.statistics.edges)
      expect(results[i]!.report!.statistics.primitives).toBe(results[0]!.report!.statistics.primitives)
    }
  })

  it('produces identical spatial index cell structure across runs', () => {
    const doc = makeDocument()
    const compiler = new CampusCompiler(config)
    const results = Array.from({ length: 3 }, () => compiler.compileV2(doc))

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.artifacts!.spatialIndex.cellSize).toBe(results[0]!.artifacts!.spatialIndex.cellSize)
      expect(Object.keys(results[i]!.artifacts!.spatialIndex.cells).sort()).toEqual(
        Object.keys(results[0]!.artifacts!.spatialIndex.cells).sort(),
      )
    }
  })

  it('produces identical building index across runs', () => {
    const doc = makeDocument()
    const compiler = new CampusCompiler(config)
    const results = Array.from({ length: 3 }, () => compiler.compileV2(doc))

    for (let i = 1; i < results.length; i++) {
      const idsA = results[0]!.artifacts!.buildingIndex.buildings.map(b => b.id)
      const idsB = results[i]!.artifacts!.buildingIndex.buildings.map(b => b.id)
      expect(idsB).toEqual(idsA)

      const floorCountsA = results[0]!.artifacts!.buildingIndex.buildings.map(b => b.floors.length)
      const floorCountsB = results[i]!.artifacts!.buildingIndex.buildings.map(b => b.floors.length)
      expect(floorCountsB).toEqual(floorCountsA)
    }
  })
})
