import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { Graph } from '@/engine/graph'
import { NavigationCompiler } from '../services/navigation-compiler'
import { createEditorContext } from '../context/create-editor-context'
import type { PersistenceAdapter } from '../services/persistence-service'

function authoredFixture(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 4,
    metadata: {
      campusId: 'authored-context-campus',
      name: 'Authored Name',
      description: 'Authored Description',
      lastModified: '2026-09-21T00:00:00.000Z',
      editorVersion: 'test',
    },
    buildings: [{
      id: 'building-1',
      name: 'Main',
      footprint: { points: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }, { lat: 2, lng: 3 }, { lat: 2, lng: 2 }] },
      floors: [{ id: 'floor-1', level: 0, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [] }],
      verticalConnectors: [{ id: 'connector-1', type: 'staircase', name: 'Stair', stopIds: [] }],
    } as unknown as CampusDocument['buildings'][number]],
    roads: [],
    panoramas: [{ id: 'panorama-1', label: 'Main', position: { x: 1, y: 2 }, heading: 135, imageAssetId: 'asset-1', hotspots: [] }],
    qrCheckpoints: [{ id: 'qr-1', label: 'QR', position: { x: 2, y: 3 }, code: 'navi://authored', metadata: { authored: true } }],
  } as CampusDocument
}

function adapter(): PersistenceAdapter {
  return {
    save: async () => {},
    syncToSupabase: async () => {},
    publish: async () => ({ success: true, version: '1.0.0' }),
  }
}

describe('Phase 3A.1 authored hydration', () => {
  it('hydrates the editor from CampusDocument instead of reconstructing it from Graph', () => {
    const authored = authoredFixture()
    const graph = new Graph()
    graph.campusId = authored.metadata.campusId
    const compiler = new NavigationCompiler({
      getGraph: () => ({ nodes: [], edges: [] }),
      updateNode: () => {},
      updateEdge: () => {},
    } as unknown as ConstructorParameters<typeof NavigationCompiler>[0])

    const context = createEditorContext(graph, adapter(), compiler, authored)

    expect(context.document).not.toBe(authored)
    expect(context.document.metadata.name).toBe('Authored Name')
    expect(context.document.metadata.description).toBe('Authored Description')
    expect(context.document.buildings[0].verticalConnectors?.[0].id).toBe('connector-1')
    expect(context.document.panoramas[0].id).toBe('panorama-1')
    expect(context.document.qrCheckpoints[0].id).toBe('qr-1')
  })
})
