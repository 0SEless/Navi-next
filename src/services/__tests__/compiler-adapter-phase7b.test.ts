import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompilerAdapter } from '../compiler-adapter'
import type { CampusDocument } from '@navi/core'

const document = {
  schemaVersion: 1,
  version: 7,
  metadata: { campusId: 'adapter-campus' },
} as CampusDocument

describe('Phase 7B compiler adapter contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves provenance, components, doors, and additive artifact fields', async () => {
    const artifacts = {
      navigationGraph: { version: '1.0.0' },
      searchIndex: { version: '1.0.0', entries: [] },
      poiData: { version: '1.0.0', points: [] },
      buildingIndex: { version: '1.0.0', buildings: [] },
      spatialIndex: { version: '1.0.0', cells: {}, cellSize: 1 },
      panoramaIndex: { version: '1.0.0', panoramas: [] },
      floorGeometry: { schemaVersion: 1, formatVersion: 0, campusId: 'adapter-campus', buildings: [] },
      qrIndex: { schemaVersion: 1, formatVersion: 1, campusId: 'adapter-campus', checkpoints: [] },
      components: [{ id: 'room-adapter', type: 'room' }],
      doors: [{ id: 'door-adapter', roomId: 'room-adapter' }],
      metadata: {
        campusId: 'adapter-campus',
        connectivitySemanticsVersion: '6.0.0',
        compilerVersion: '1.0.0',
        revision: '7',
        sourceDocumentVersion: '7',
        compiledAt: '2026-09-06T00:00:00.000Z',
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', artifacts }), { status: 200 }),
    ))

    const result = await createCompilerAdapter().compile(document)

    expect(result.status).toBe('success')
    expect(result.artifacts).toMatchObject({
      spatialIndex: artifacts.spatialIndex,
      panoramaIndex: artifacts.panoramaIndex,
      floorGeometry: artifacts.floorGeometry,
      qrIndex: artifacts.qrIndex,
      components: artifacts.components,
      doors: artifacts.doors,
      metadata: artifacts.metadata,
    })
  })
})
