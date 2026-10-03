import { describe, expect, it } from 'vitest'
import type { QrIndex } from '@navi/core'
import type { CampusBundle, NavNode } from '@/types/nav-types'
import {
  parseQrScanPayload,
  resolveQrScanPayload,
  type QrLocation,
} from '../qr-location'

const checkpoint = {
  id: 'CS-3F-EAST-01',
  label: 'East QR Checkpoint',
  buildingId: 'cs-building',
  floor: 3,
  position: { x: 4, y: 8 },
  code: 'navi.app/q/CS-3F-EAST-01',
}

const qrIndex: QrIndex = {
  schemaVersion: 1,
  formatVersion: 1,
  campusId: 'campus-a',
  checkpoints: [checkpoint],
}

const qrNode: NavNode = {
  id: 'qr-node-1',
  label: 'QR: East QR Checkpoint',
  position: { lat: 14.0001, lng: 121.0001 },
  floor: 3,
  buildingId: 'cs-building',
  campusId: 'campus-a',
  type: 'intersection',
  metadata: { entityType: 'qr', entityId: checkpoint.id },
}

function bundle(overrides: Partial<CampusBundle> = {}): CampusBundle {
  return {
    nodes: [qrNode],
    edges: [],
    searchEntries: [],
    buildings: [{
      id: 'cs-building',
      name: 'Computer Studies Building',
      campusId: 'campus-a',
      floors: [3],
      footprint: [],
      baseElevation: 0,
      height: 10,
    }],
    poi: [],
    boundingBox: null,
    qrIndex,
    ...overrides,
  }
}

describe('parseQrScanPayload', () => {
  it('uses one shared parser for opaque codes and public Navigate links', () => {
    expect(parseQrScanPayload('navi.app/q/CS-3F-EAST-01')).toEqual({
      kind: 'checkpoint',
      checkpointId: 'CS-3F-EAST-01',
    })
    expect(parseQrScanPayload('https://navi.app/q/CS-3F-EAST-01')).toEqual({
      kind: 'checkpoint',
      checkpointId: 'CS-3F-EAST-01',
    })
    expect(parseQrScanPayload('/map/navigate?qr=CS-3F-EAST-01')).toEqual({
      kind: 'checkpoint',
      checkpointId: 'CS-3F-EAST-01',
    })
  })

  it('keeps explicit legacy node forms in the same resolver boundary', () => {
    expect(parseQrScanPayload('navi://campus-a/navigate?node=qr-node-1')).toEqual({
      kind: 'legacy-node',
      payload: { campusId: 'campus-a', nodeId: 'qr-node-1' },
    })
    expect(parseQrScanPayload('https://navi.app/?node=qr-node-1')).toEqual({
      kind: 'legacy-node',
      payload: { campusId: 'asu-ibajay', nodeId: 'qr-node-1' },
    })
  })

  it('rejects malformed, external, and oversized inputs', () => {
    expect(parseQrScanPayload('')).toBeNull()
    expect(parseQrScanPayload('https://evil.example/map/navigate?qr=CS-3F-EAST-01')).toBeNull()
    expect(parseQrScanPayload(`navi.app/q/${'x'.repeat(129)}`)).toBeNull()
    expect(parseQrScanPayload('javascript:alert(1)')).toBeNull()
  })
})

describe('resolveQrScanPayload', () => {
  it('resolves an exact published checkpoint to its graph QR anchor', () => {
    const result = resolveQrScanPayload(
      'navi.app/q/CS-3F-EAST-01',
      bundle(),
      'campus-a',
    )

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.location).toMatchObject({
      source: 'qr',
      checkpointId: checkpoint.id,
      campusId: 'campus-a',
      label: 'East QR Checkpoint',
      buildingId: 'cs-building',
      floor: 3,
      nodeId: 'qr-node-1',
      anchor: 'graph-node',
    } satisfies Partial<QrLocation>)
  })

  it('uses bounded coordinate snapping only with a published floor/building anchor', () => {
    const result = resolveQrScanPayload(
      'navi.app/q/CS-3F-EAST-01',
      bundle({
        nodes: [{
          ...qrNode,
          id: 'nearby-node',
          metadata: { entityType: 'room', entityId: 'room-1' },
        }],
        floorGeometry: {
          schemaVersion: 1,
          formatVersion: 1,
          campusId: 'campus-a',
          buildings: [{
            id: 'cs-building',
            name: 'Computer Studies Building',
            anchor: { origin: { lat: 14, lng: 121 }, rotation: 0 },
            floors: [],
          }],
        },
      }),
      'campus-a',
    )

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.location.anchor).toBe('coordinate-snap')
    expect(result.location.nodeId).toBe('nearby-node')
  })

  it('returns a truthful resolved location without a routing anchor', () => {
    const result = resolveQrScanPayload(
      'navi.app/q/CS-3F-EAST-01',
      bundle({ nodes: [] }),
      'campus-a',
    )

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.location).toMatchObject({
      label: 'East QR Checkpoint',
      buildingId: 'cs-building',
      floor: 3,
      nodeId: null,
      anchor: 'none',
    })
  })

  it('does not invent missing floor or building metadata', () => {
    const incomplete = {
      ...checkpoint,
      label: 'Uncontextualized QR',
      buildingId: '',
      floor: undefined,
      position: undefined,
    } as unknown as QrIndex['checkpoints'][number]
    const result = resolveQrScanPayload(
      'navi.app/q/CS-3F-EAST-01',
      bundle({ qrIndex: { ...qrIndex, checkpoints: [incomplete] }, nodes: [] }),
      'campus-a',
    )

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.location.buildingId).toBeUndefined()
    expect(result.location.floor).toBeUndefined()
    expect(result.location.label).toBe('Uncontextualized QR')
  })

  it('reports exact unknown, unavailable, foreign, and legacy-node states', () => {
    expect(resolveQrScanPayload('navi.app/q/missing', bundle(), 'campus-a')).toEqual({
      status: 'unknown',
      reference: 'missing',
    })
    expect(resolveQrScanPayload('navi.app/q/CS-3F-EAST-01', undefined, 'campus-a')).toEqual({
      status: 'unavailable',
      reference: 'CS-3F-EAST-01',
    })
    expect(resolveQrScanPayload('navi://campus-b/navigate?node=qr-node-1', bundle(), 'campus-a')).toEqual({
      status: 'foreign',
      reference: 'qr-node-1',
      campusId: 'campus-b',
    })
    expect(resolveQrScanPayload('navi://campus-a/navigate?node=qr-node-1', bundle(), 'campus-a')).toMatchObject({
      status: 'resolved',
    })
    expect(resolveQrScanPayload('unknown payload', bundle(), 'campus-a')).toEqual({
      status: 'malformed',
    })
  })
})
