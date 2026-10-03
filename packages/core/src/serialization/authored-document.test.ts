import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '../types/document'
import {
  AUTHORED_DOCUMENT_FORMAT_VERSION,
  authoredFingerprint,
  deserializeAuthoredDocument,
  serializeAuthoredDocument,
  toAuthoredDocumentSnapshot,
} from './authored-document'

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 7,
    metadata: {
      campusId: 'authored-campus',
      name: 'Authored Campus',
      description: 'Lossless fixture',
      lastModified: '2026-09-21T00:00:00.000Z',
      editorVersion: 'test-editor',
    },
    buildings: [{
      id: 'building-1',
      name: 'Main Hall',
      code: 'MH',
      category: 'academic',
      description: 'Building description',
      footprint: { points: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }, { lat: 2, lng: 3 }, { lat: 2, lng: 2 }] },
      floors: [{
        id: 'floor-1',
        level: 0,
        label: 'Ground',
        elevation: 0,
        height: 4,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [{
          id: 'stop-1',
          connectorId: 'connector-1',
          label: 'Landing',
          position: { x: 1, y: 2 },
          anchors: [{ id: 'anchor-1', label: 'Panorama', position: { x: 1, y: 2 }, heading: 90, imageAssetId: 'asset-1' }],
        }],
      }],
      verticalConnectors: [{
        id: 'connector-1',
        type: 'staircase',
        name: 'North Stair',
        stopIds: ['stop-1'],
      }],
    } as unknown as CampusDocument['buildings'][number]],
    roads: [],
    panoramas: [{ id: 'panorama-1', label: 'Main', position: { x: 4, y: 5 }, heading: 135, imageAssetId: 'asset-1', hotspots: [] }],
    qrCheckpoints: [{ id: 'qr-1', label: 'QR', position: { x: 3, y: 4 }, code: 'navi://qr', metadata: { authored: true } }],
    pois: [{ id: 'poi-1', scope: 'outdoor', name: 'Gate', category: 'other', geometry: { type: 'point', position: { lat: 1, lng: 2 } } }],
    areas: [{ id: 'area-1', name: 'Plaza', points: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }], color: '#fff' }],
    roadJunctions: [],
    separatedCrossings: [],
    boundary: { points: [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }] },
    connectivitySemanticsVersion: 'phase3',
    _changeJournal: [{ entityId: 'x', entityType: 'building', operation: 'updated' }],
  } as CampusDocument
}

describe('authored CampusDocument serialization', () => {
  it('emits a versioned, detached authored snapshot without the runtime journal', () => {
    const document = makeDocument()
    const snapshot = toAuthoredDocumentSnapshot(document)

    expect(AUTHORED_DOCUMENT_FORMAT_VERSION).toBe(1)
    expect(snapshot).not.toBe(document)
    expect(snapshot._changeJournal).toBeUndefined()
    expect(snapshot.buildings[0]).not.toBe(document.buildings[0])
    expect(snapshot.buildings[0].verticalConnectors?.[0].id).toBe('connector-1')
  })

  it('canonicalizes object key order and ignores runtime identity metadata', () => {
    const document = makeDocument()
    const reordered = JSON.parse(JSON.stringify(document)) as CampusDocument
    reordered.version = 99
    reordered.metadata.lastModified = '2099-01-01T00:00:00.000Z'
    reordered.metadata.editorVersion = 'future-editor'
    reordered._changeJournal = [{ entityId: 'different', entityType: 'road', operation: 'created' }]
    reordered.metadata = {
      editorVersion: reordered.metadata.editorVersion,
      description: reordered.metadata.description,
      campusId: reordered.metadata.campusId,
      lastModified: reordered.metadata.lastModified,
      name: reordered.metadata.name,
    }

    expect(serializeAuthoredDocument(document)).toBe(serializeAuthoredDocument(reordered))
    expect(authoredFingerprint(document)).toBe(authoredFingerprint(reordered))
  })

  it('changes fingerprint for authored connector and identity edits', () => {
    const document = makeDocument()
    const edited = toAuthoredDocumentSnapshot(document)
    edited.buildings[0].verticalConnectors![0].name = 'South Stair'
    edited.panoramas[0].id = 'panorama-edited'
    edited.qrCheckpoints[0].code = 'navi://changed'

    expect(authoredFingerprint(edited)).not.toBe(authoredFingerprint(document))
  })

  it('round-trips the authored persistence representation through validation', () => {
    const document = makeDocument()
    const restored = deserializeAuthoredDocument(serializeAuthoredDocument(document))

    expect(authoredFingerprint(restored)).toBe(authoredFingerprint(document))
    expect(restored.metadata.name).toBe('Authored Campus')
    expect(restored.buildings[0].verticalConnectors?.[0].id).toBe('connector-1')
    expect(restored.panoramas[0].id).toBe('panorama-1')
    expect(restored.qrCheckpoints[0].id).toBe('qr-1')
  })
})
