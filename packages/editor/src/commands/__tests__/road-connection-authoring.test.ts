import { describe, expect, it } from 'vitest'
import type { CampusDocument, Road, RoadJunction } from '@navi/core'
import { roadCreateHandler } from '../road-handlers'
import {
  findConnectivityCandidates,
  toRoadConnectionRequest,
  type RoadConnectionRequest,
} from '../road-connectivity'

function docWithRoads(roads: Road[], junctions?: RoadJunction[]): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads,
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: junctions,
  }
}

/** Target road: east-west, ~222 m long. */
const TARGET: Road = {
  id: 'road-target',
  name: 'Target',
  polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
  width: 8,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

const TARGET_WEST_END = { lat: 0, lng: -0.001 }
const TARGET_MID = { lat: 0, lng: 0 }

function connectRequest(overrides: Partial<RoadConnectionRequest> & Pick<RoadConnectionRequest, 'kind' | 'position'>): RoadConnectionRequest {
  return {
    pointIndex: 0,
    action: 'connect',
    targetRoadId: 'road-target',
    ...overrides,
  }
}

describe('road.create connection authoring (Fix 1)', () => {
  it('endpoint→endpoint + Connect creates one authored RoadJunction and projects the point exactly', () => {
    const doc = docWithRoads([TARGET])
    const result = roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0, lng: -0.001 }, { lat: 0.001, lng: -0.001 }],
      connections: [connectRequest({ kind: 'road-endpoint', position: TARGET_WEST_END })],
    })

    expect(result.success).toBe(true)
    expect(doc.roadJunctions).toHaveLength(1)
    const junction = doc.roadJunctions![0]
    expect(junction.source).toBe('authored')
    expect(junction.roadIds).toEqual(expect.arrayContaining(['road-new', 'road-target']))
    expect(junction.position.lat).toBeCloseTo(0, 9)
    expect(junction.position.lng).toBeCloseTo(-0.001, 9)
    const created = doc.roads.find((r) => r.id === 'road-new')!
    expect(created.polyline.points[0].lat).toBeCloseTo(junction.position.lat, 9)
    expect(created.polyline.points[0].lng).toBeCloseTo(junction.position.lng, 9)
  })

  it('endpoint→segment + Connect creates a junction at the projected segment point', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0.0003, lng: 0 }, { lat: 0.001, lng: 0 }],
      connections: [connectRequest({ kind: 'road-segment', position: TARGET_MID })],
    })

    expect(doc.roadJunctions).toHaveLength(1)
    const junction = doc.roadJunctions![0]
    expect(junction.roadIds).toEqual(expect.arrayContaining(['road-new', 'road-target']))
    expect(junction.position.lat).toBeCloseTo(0, 9)
    expect(junction.position.lng).toBeCloseTo(0, 9)
    const created = doc.roads.find((r) => r.id === 'road-new')!
    expect(created.polyline.points[0].lat).toBeCloseTo(0, 9)
    expect(created.polyline.points[0].lng).toBeCloseTo(0, 9)
  })

  it('endpoint→existing junction merges into that junction without duplicating it', () => {
    const existing: RoadJunction = {
      id: 'j-existing',
      position: TARGET_MID,
      roadIds: ['road-target', 'road-other'],
      source: 'authored',
    }
    const doc = docWithRoads([TARGET], [existing])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }],
      connections: [connectRequest({ kind: 'existing-junction', junctionId: 'j-existing', position: TARGET_MID })],
    })

    expect(doc.roadJunctions).toHaveLength(1)
    expect(doc.roadJunctions![0].id).toBe('j-existing')
    expect(doc.roadJunctions![0].roadIds).toEqual(expect.arrayContaining(['road-new', 'road-target', 'road-other']))
  })

  it('creates no junction when there is no candidate (beyond 0.5 m)', () => {
    const point = { lat: 0.000006, lng: 0 } // ~0.67 m north — beyond discovery radius
    const candidates = findConnectivityCandidates(point, { roads: [TARGET] })
    expect(candidates.best).toBeNull()

    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [point, { lat: 0.001, lng: 0 }],
    })
    expect(doc.roadJunctions).toBeUndefined()
    const created = doc.roads.find((r) => r.id === 'road-new')!
    expect(created.polyline.points[0]).toEqual(point)
  })

  it('Keep Separate preserves the raw coordinate and creates no RoadJunction', () => {
    const raw = { lat: 0, lng: 0 }
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [raw, { lat: 0.001, lng: 0 }],
      connections: [{ pointIndex: 0, action: 'separate', kind: 'road-endpoint', targetRoadId: 'road-target', position: raw }],
    })

    expect(doc.roadJunctions).toBeUndefined()
    const created = doc.roads.find((r) => r.id === 'road-new')!
    expect(created.polyline.points[0]).toEqual(raw)
  })

  it('Keep Separate at a genuine interior crossing persists a SeparatedCrossing', () => {
    const doc = docWithRoads([TARGET])
    // New polyline passes through the target interior point at index 1.
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [
        { lat: 0.001, lng: -0.001 },
        { lat: 0, lng: 0 },
        { lat: -0.001, lng: 0.001 },
      ],
      connections: [{ pointIndex: 1, action: 'separate', kind: 'road-segment', targetRoadId: 'road-target', position: { lat: 0, lng: 0 } }],
    })

    expect(doc.roadJunctions).toBeUndefined()
    expect(doc.separatedCrossings).toHaveLength(1)
    expect(doc.separatedCrossings![0].roadIds).toEqual(expect.arrayContaining(['road-new', 'road-target']))
  })

  it('interior crossings without an explicit decision never auto-connect', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [
        { lat: 0.001, lng: -0.001 },
        { lat: 0, lng: 0 },
        { lat: -0.001, lng: 0.001 },
      ],
    })

    expect(doc.roadJunctions).toBeUndefined()
    expect(doc.separatedCrossings).toBeUndefined()
  })

  it('toRoadConnectionRequest maps a candidate and preserves the target identity', () => {
    const candidates = findConnectivityCandidates({ lat: 0, lng: 0 }, {
      roads: [TARGET],
      junctions: [{ id: 'j-1', position: { lat: 0, lng: 0 }, roadIds: ['road-target', 'x'], source: 'authored' }],
    })
    expect(candidates.best).not.toBeNull()
    const request = toRoadConnectionRequest(2, candidates.best!, 'connect')
    expect(request.pointIndex).toBe(2)
    expect(request.action).toBe('connect')
    expect(request.kind).toBe('existing-junction')
    expect(request.junctionId).toBe('j-1')
    expect(request.position).toEqual({ lat: 0, lng: 0 })
  })

  it('does not move interior points of the new road', () => {
    const doc = docWithRoads([TARGET])
    roadCreateHandler.execute(doc, {
      id: 'road-new',
      name: 'New',
      points: [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0.0005 },
        { lat: 0.002, lng: 0 },
      ],
      connections: [connectRequest({ kind: 'road-segment', position: TARGET_MID })],
    })
    const created = doc.roads.find((r) => r.id === 'road-new')!
    expect(created.polyline.points[1]).toEqual({ lat: 0.001, lng: 0.0005 })
  })
})
