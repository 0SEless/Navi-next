import { describe, it, expect } from 'vitest'
import { loadStoredCampus } from './campus-loader'
import { createDocument } from './create-editor-context'
import { documentToGeoJSON } from '../rendering/geojson'
import { serializeDocument, type CampusDocument } from '@navi/core'

// Minimal CampusDocument with an explicit building height (the value the
// regression report says disappears after reload).
const doc: CampusDocument = {
  schemaVersion: 1,
  version: 1,
  metadata: { campusId: 'T', name: 'T', description: '', lastModified: new Date().toISOString(), editorVersion: '1.0.0' },
  buildings: [{
    id: 'b1', name: 'Main', code: 'M', category: 'academic', description: '',
    baseElevation: 0, height: 42, color: '#1C6BEB', aliases: [], metadata: {},
    footprint: { points: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 1 }] },
    floors: [],
  }],
  roads: [], panoramas: [], qrCheckpoints: [],
}

describe('building height persistence (regression check)', () => {
  it('height survives save -> load -> graph -> ctx.document -> render source', () => {
    // (2) Is height present in the saved JSON?
    const raw = serializeDocument(doc)
    expect(JSON.parse(raw).buildings[0].height).toBe(42)

    // (3) Is height restored in the loaded CampusDocument AND the regenerated graph?
    const loaded = loadStoredCampus(raw)
    expect(loaded.wasLegacy).toBe(false)
    expect(loaded.document.buildings[0].height).toBe(42)
    expect(loaded.graph.buildings[0].height).toBe(42)

    // Studio derives ctx.document from the loaded graph (EditorBridge line 85).
    const derived = createDocument(loaded.graph)
    expect(derived.buildings[0].height).toBe(42)

    // Renderer source (EntityRenderer.syncAll -> documentToGeoJSON).
    const render = documentToGeoJSON(derived)
    expect((render.buildings.features[0].properties as any)?.height).toBe(42)
  })

  it('height survives the legacy-graph reload path', () => {
    // Simulate a campus previously saved as a legacy Graph snapshot.
    const graph = loadedGraphWithHeight()
    const legacyRaw = JSON.stringify(graph.toJSON())
    const loaded = loadStoredCampus(legacyRaw)
    expect(loaded.wasLegacy).toBe(true)
    expect(loaded.document.buildings[0].height).toBe(42)
    expect(loaded.graph.buildings[0].height).toBe(42)
  })
})

// Build a Graph (via the real Graph class) whose building carries height,
// mirroring what GraphAdapter.sync would produce from a document.
function loadedGraphWithHeight() {
  // Reuse the same load path but start from a document so heights are real.
  const loaded = loadStoredCampus(serializeDocument(doc))
  return loaded.graph
}
