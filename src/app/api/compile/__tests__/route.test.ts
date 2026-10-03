// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@navi/compiler', () => ({
  CampusCompiler: class {
    compileV2() {
      return {
        success: true,
        graph: { version: '1.0.0', campusId: 'compile-campus', nodes: [], edges: [] },
        artifacts: {
          searchIndex: { version: '1.0.0', entries: [] },
          poiIndex: { version: '1.0.0', points: [] },
          buildingIndex: { version: '1.0.0', buildings: [] },
          spatialIndex: { version: '1.0.0', cells: {}, cellSize: 1 },
          panoramaIndex: { version: '1.0.0', panoramas: [] },
          floorGeometry: { schemaVersion: 1, formatVersion: 0, campusId: 'compile-campus', buildings: [] },
          qrIndex: { schemaVersion: 1, formatVersion: 1, campusId: 'compile-campus', checkpoints: [] },
          components: [{ id: 'room-compile', type: 'room' }],
          doors: [{ id: 'door-compile', roomId: 'room-compile' }],
          metadata: {
            campusId: 'compile-campus',
            connectivitySemanticsVersion: '6.0.0',
            compilerVersion: '1.0.0',
            revision: '7',
            sourceDocumentVersion: '7',
            compiledAt: '2026-09-06T00:00:00.000Z',
          },
          extensions: {},
        },
        stats: {},
        report: {},
        warnings: [],
        errors: [],
      }
    }
  },
}))

import { POST } from '../route'

describe('POST /api/compile — Phase 7B artifact envelope', () => {
  it('preserves provenance, components, doors, and additive artifacts', async () => {
    const request = new NextRequest('http://localhost/api/compile', {
      method: 'POST',
      headers: { cookie: 'sb-test-auth-token=test' },
      body: JSON.stringify({
        document: {
          metadata: { campusId: 'compile-campus' },
          buildings: [],
        },
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.artifacts).toMatchObject({
      components: [{ id: 'room-compile' }],
      doors: [{ id: 'door-compile', roomId: 'room-compile' }],
      metadata: {
        campusId: 'compile-campus',
        sourceDocumentVersion: '7',
        connectivitySemanticsVersion: '6.0.0',
      },
      floorGeometry: expect.any(Object),
      qrIndex: expect.any(Object),
    })
  })
})
