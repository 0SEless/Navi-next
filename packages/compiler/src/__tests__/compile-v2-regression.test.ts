import { describe, it, expect } from 'vitest'
import { compile, CampusCompiler } from '../pipeline/compile'
import type { CampusDocument } from '@navi/core'
import type { CompilerConfig } from '../types'

function preM5Document(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'legacy-campus', name: 'legacy-campus', description: 'Pre-M5 campus', lastModified: '', editorVersion: '1.0' },
    buildings: [
      {
        id: 'legacy-bld',
        name: 'Legacy Building',
        code: 'LGB',
        category: 'academic',
        description: 'A building with no M5 entities',
        footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.001 }, { lat: 14.0, lng: 121.001 }] },
        baseElevation: 10,
        height: 20,
        floors: [
          {
            id: 'legacy-f1',
            level: 1,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'room-1',
                name: 'Legacy Room',
                number: '001',
                category: 'classroom',
                polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [
              { id: 'hw-1', name: 'Main Hallway', polyline: { points: [{ x: 0, y: 5 }, { x: 15, y: 5 }] }, width: 3 },
            ],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'ent-1', label: 'Main Entrance', position: { lat: 14.0, lng: 121.0 } as any, level: 1, type: 'main', hasQR: false, hasPanorama: false },
            ],
            connectorStops: [],
            metadata: {},
          },
        ],
        verticalConnectors: [],
        aliases: [],
        color: '#ccc',
        metadata: {},
      },
    ],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

const legacyConfig: CompilerConfig = {
  nodeInterval: 10,
  mergeThreshold: 0.5,
  optimizationLevel: 'none',
  includeAccessibility: false,
} as CompilerConfig

describe('compile regression (pre-M5 compatibility)', () => {
  it('old compile() output structure matches baseline', () => {
    const doc = preM5Document()
    const result = compile(doc, legacyConfig)

    expect(result.graph.nodes.length).toMatchSnapshot('legacy-node-count')
    expect(result.graph.edges.length).toMatchSnapshot('legacy-edge-count')
    expect(result.graph.metadata).toMatchSnapshot('legacy-metadata')
    expect(result.report).toMatchSnapshot('legacy-report')
    expect(result.graph.version).toBe('1.0.0')
  })

  it('old compile() returns consistent node types for pre-M5 document', () => {
    const doc = preM5Document()
    const result = compile(doc, legacyConfig)
    const types = new Set(result.graph.nodes.map(n => n.type))

    expect(types.has('space')).toBe(true)
    expect(types.has('transition')).toBe(true)
  })

  it('compileV2 also succeeds on pre-M5 document', () => {
    const doc = preM5Document()
    const compiler = new CampusCompiler({
      nodeInterval: 10,
      mergeThreshold: 0.5,
      optimizationLevel: 'none',
      includeAccessibility: false,
    } as any)
    const result = compiler.compileV2(doc)

    expect(result.success).toBe(true)
    expect(result.graph).not.toBeNull()
    expect(result.graph!.nodes.length).toBeGreaterThan(0)
    expect(result.graph!.edges.length).toBeGreaterThan(0)
  })

  it('compileV2 produces structurally consistent output for pre-M5 document', () => {
    const doc = preM5Document()
    const compiler = new CampusCompiler({
      nodeInterval: 10,
      mergeThreshold: 0.5,
      optimizationLevel: 'none',
      includeAccessibility: false,
    } as any)
    const a = compiler.compileV2(doc)
    const b = compiler.compileV2(doc)

    expect(a.graph!.nodes.length).toBe(b.graph!.nodes.length)
    expect(a.graph!.edges.length).toBe(b.graph!.edges.length)
    expect(a.graph!.metadata).toEqual(b.graph!.metadata)
  })
})
