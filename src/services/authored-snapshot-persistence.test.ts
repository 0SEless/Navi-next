import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import {
  parseAuthoredGraphPayload,
  readAuthoredDocument,
  serializeAuthoredGraphPayload,
} from './authored-snapshot-persistence'

function documentFixture(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 2,
    metadata: {
      campusId: 'draft-campus',
      name: 'Draft Campus',
      description: 'Draft',
      lastModified: '2026-09-21T00:00:00.000Z',
      editorVersion: 'test',
    },
    buildings: [{
      id: 'building-1',
      name: 'Main',
      footprint: { points: [] },
      floors: [],
      verticalConnectors: [{ id: 'connector-1', type: 'staircase', name: 'Stair', stopIds: ['stop-1'] }],
    } as unknown as CampusDocument['buildings'][number]],
    roads: [],
    panoramas: [{ id: 'pano-1', label: 'Pano', position: { x: 1, y: 2 }, heading: 45, imageAssetId: 'asset-1', hotspots: [] }],
    qrCheckpoints: [{ id: 'qr-1', label: 'QR', position: { x: 3, y: 4 }, code: 'navi://draft', metadata: { authored: true } }],
  } as CampusDocument
}

describe('authored graph persistence payload', () => {
  it('keeps the legacy Graph shape top-level while carrying the authored document', () => {
    const graph = { campusId: 'draft-campus', buildings: [], nodes: [], edges: [], components: [] }
    const payload = serializeAuthoredGraphPayload(graph, documentFixture())
    const parsed = parseAuthoredGraphPayload(JSON.parse(JSON.stringify(payload)))

    expect(payload.nodes).toEqual([])
    expect(payload.authoredDocumentFormatVersion).toBe(1)
    expect(parsed.legacyGraphOnly).toBe(false)
    expect(parsed.authoredDocument?.metadata.name).toBe('Draft Campus')
    expect(parsed.authoredDocument?.buildings[0].verticalConnectors?.[0].id).toBe('connector-1')
    expect(parsed.authoredDocument?.panoramas[0].id).toBe('pano-1')
    expect(parsed.authoredDocument?.qrCheckpoints[0].id).toBe('qr-1')
  })

  it('reads an old raw Graph payload as legacy without creating authored state', () => {
    const legacy = { campusId: 'legacy-campus', buildings: [], nodes: [], edges: [], components: [] }
    const parsed = parseAuthoredGraphPayload(legacy)

    expect(parsed.legacyGraphOnly).toBe(true)
    expect(parsed.authoredDocument).toBeNull()
    expect(readAuthoredDocument(legacy)).toBeNull()
  })

  it('rejects a malformed new-format authored snapshot instead of silently dropping it', () => {
    expect(() => parseAuthoredGraphPayload({ nodes: [], authoredDocument: { bad: true } })).toThrow(/authored document/i)
  })

  it('rejects a newer companion format instead of guessing a migration', () => {
    expect(() => parseAuthoredGraphPayload({ nodes: [], authoredDocumentFormatVersion: 2, authoredDocument: {} })).toThrow(/format version/i)
  })
})
