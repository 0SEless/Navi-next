import { describe, it, expect } from 'vitest'
import type { CampusDocument, Road, RoadJunction } from '@navi/core'
import {
  detectLegacyConnections,
  buildRecoveryConnectionRequest,
  type LegacyConnectionCandidate,
} from '../connectivity/legacy-recovery'
import { roadRecoveryApplyHandler } from '../commands/road-recovery-handlers'

function road(id: string, points: Array<{ lat: number; lng: number }>): Road {
  return { id, name: id, polyline: { points }, width: 8, surface: 'paved', type: 'arterial', metadata: {} }
}

interface FixtureOptions {
  junctions?: RoadJunction[]
  separated?: boolean
}

function makeDocument(options: FixtureOptions = {}): CampusDocument {
  const target = road('target', [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }])
  const segmentContact = road('seg-contact', [{ lat: 0, lng: -0.0005 }, { lat: 0.001, lng: -0.0005 }])
  const endpointContact = road('end-contact', [{ lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }])
  const nearContact = road('near-contact', [{ lat: 0.0000036, lng: 0.0005 }, { lat: 0.001, lng: 0.0009 }])
  const authorized = road('authorized-contact', [{ lat: 0, lng: 0.0005 }, { lat: 0.001, lng: 0.0001 }])
  const separated = road('separated-contact', [{ lat: 0, lng: -0.0008 }, { lat: 0.001, lng: -0.0008 }])

  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'legacy', name: 'legacy', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads: [target, segmentContact, endpointContact, nearContact, authorized, separated],
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: options.junctions,
    ...(options.separated
      ? { separatedCrossings: [{ id: 'sc-1', roadIds: ['target', 'separated-contact'], position: { lat: 0, lng: -0.0008 } }] }
      : {}),
  }
}

describe('legacy connection recovery detection', () => {
  it('detects coincident endpoints as high confidence', () => {
    const doc = makeDocument()
    const candidates = detectLegacyConnections(doc)
    const endpointPair = candidates.find(
      (c) => c.kind === 'endpoint-endpoint' && c.roadIds.includes('end-contact'),
    )
    expect(endpointPair).toBeDefined()
    expect(endpointPair!.confidence).toBe('high')
    expect(endpointPair!.distanceMeters).toBeLessThanOrEqual(0.05)
    expect(endpointPair!.position.lat).toBeCloseTo(0, 9)
    expect(endpointPair!.position.lng).toBeCloseTo(0.001, 9)
  })

  it('detects an endpoint on a segment as high confidence', () => {
    const doc = makeDocument()
    const candidates = detectLegacyConnections(doc)
    const segmentPair = candidates.find(
      (c) => c.kind === 'endpoint-segment' && c.roadIds.includes('seg-contact') && c.roadIds.includes('target'),
    )
    expect(segmentPair).toBeDefined()
    expect(segmentPair!.confidence).toBe('high')
    expect(segmentPair!.roadIds[1]).toBe('target')
    expect(segmentPair!.pointIndex).toBe(0)
    expect(segmentPair!.position.lng).toBeCloseTo(-0.0005, 9)
  })

  it('classifies a 0.4 m contact as reviewable, never high confidence', () => {
    const doc = makeDocument()
    const candidates = detectLegacyConnections(doc)
    const near = candidates.find((c) => c.roadIds.includes('near-contact'))
    expect(near).toBeDefined()
    expect(near!.confidence).toBe('review')
    expect(near!.distanceMeters).toBeGreaterThan(0.05)
    expect(near!.distanceMeters).toBeLessThanOrEqual(0.5)
  })

  it('does not propose an already-authorized road pair', () => {
    const junctions: RoadJunction[] = [{
      id: 'j-existing',
      position: { lat: 0, lng: 0.0005 },
      roadIds: ['target', 'authorized-contact'],
      source: 'authored',
    }]
    const doc = makeDocument({ junctions })
    const candidates = detectLegacyConnections(doc)
    // The authorized pair (target ↔ authorized-contact) must never be proposed.
    expect(candidates.some((c) => c.roadIds.includes('authorized-contact') && c.roadIds.includes('target'))).toBe(false)
  })

  it('does not propose a pair explicitly marked Keep Separate', () => {
    const doc = makeDocument({ separated: true })
    const candidates = detectLegacyConnections(doc)
    expect(candidates.some((c) => c.roadIds.includes('separated-contact'))).toBe(false)
  })

  it('returns no candidates for a document without roads', () => {
    const doc = makeDocument()
    doc.roads = []
    expect(detectLegacyConnections(doc)).toEqual([])
  })

  it('builds the canonical connection request from a candidate', () => {
    const candidate: LegacyConnectionCandidate = {
      id: 'x',
      kind: 'endpoint-segment',
      roadIds: ['a', 'b'],
      pointIndex: 0,
      position: { lat: 1, lng: 2 },
      distanceMeters: 0.01,
      confidence: 'high',
    }
    expect(buildRecoveryConnectionRequest(candidate)).toEqual({
      pointIndex: 0,
      action: 'connect',
      kind: 'road-segment',
      targetRoadId: 'b',
      position: { lat: 1, lng: 2 },
    })
  })
})

describe('road.recovery.apply command', () => {
  it('creates one authored junction for an approved coincident-endpoint candidate', () => {
    const doc = makeDocument()
    const candidate = detectLegacyConnections(doc).find(
      (c) => c.kind === 'endpoint-endpoint' && c.roadIds.includes('end-contact'),
    )!

    const result = roadRecoveryApplyHandler.execute(doc, { candidates: [candidate] })

    expect(result.success).toBe(true)
    expect(result.data?.applied).toBe(1)
    expect(doc.roadJunctions).toHaveLength(1)
    const junction = doc.roadJunctions![0]
    expect(junction.source).toBe('authored')
    expect(junction.roadIds).toEqual(expect.arrayContaining(['target', 'end-contact']))
  })

  it('projects the endpoint onto the target for an approved endpoint-segment candidate', () => {
    const doc = makeDocument()
    const candidate = detectLegacyConnections(doc).find(
      (c) => c.kind === 'endpoint-segment' && c.roadIds.includes('seg-contact'),
    )!

    roadRecoveryApplyHandler.execute(doc, { candidates: [candidate] })

    const junction = doc.roadJunctions![0]
    expect(junction.position.lng).toBeCloseTo(-0.0005, 9)
    const contact = doc.roads.find((r) => r.id === 'seg-contact')!
    expect(contact.polyline.points[0].lat).toBeCloseTo(junction.position.lat, 9)
    expect(contact.polyline.points[0].lng).toBeCloseTo(junction.position.lng, 9)
  })

  it('re-applying the same candidate merges instead of duplicating', () => {
    const doc = makeDocument()
    const candidate = detectLegacyConnections(doc).find(
      (c) => c.kind === 'endpoint-endpoint' && c.roadIds.includes('end-contact'),
    )!

    roadRecoveryApplyHandler.execute(doc, { candidates: [candidate] })
    roadRecoveryApplyHandler.execute(doc, { candidates: [candidate] })

    expect(doc.roadJunctions).toHaveLength(1)
  })

  it('rejects an empty candidate list', () => {
    const doc = makeDocument()
    const result = roadRecoveryApplyHandler.execute(doc, { candidates: [] })
    expect(result.success).toBe(false)
    expect(doc.roadJunctions).toBeUndefined()
  })
})
