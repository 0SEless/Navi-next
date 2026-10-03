import { describe, it, expect, beforeEach } from 'vitest'
import { RelationshipService } from '../RelationshipService'
import type { CampusDocument } from '@navi/core'

function makeDoc(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '', editorVersion: '' },
    buildings: [
      {
        id: 'bld-1',
        name: 'Building 1',
        footprint: { points: [] },
        floors: [
          {
            level: 0,
            rooms: [],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'ent-1', label: 'Main Entrance', position: { lat: 0, lng: 0 } as any, level: 0, type: 'main', hasQR: false, hasPanorama: false },
              { id: 'ent-2', label: 'Side Entrance', position: { lat: 0, lng: 0 } as any, level: 0, type: 'side', hasQR: false, hasPanorama: false },
            ],
          },
        ],
      },
    ],
    roads: [
      { id: 'road-1', name: 'Main Walkway', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] }, width: 3, surface: 'paved', type: 'pedestrian', metadata: {} },
      { id: 'road-2', name: 'Service Road', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }] }, width: 4, surface: 'paved', type: 'service', metadata: {} },
    ],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}

describe('RelationshipService', () => {
  let doc: CampusDocument
  let svc: RelationshipService

  beforeEach(() => {
    doc = makeDoc()
    svc = new RelationshipService(doc)
  })

  // ── connect() ──────────────────────────────────────────────────────────

  describe('connect()', () => {
    it('creates a relationship atomically', () => {
      const result = svc.connect('ent-1', 'road-1', 'entrance-road')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.relationship.ownerId).toBe('ent-1')
        expect(result.relationship.targetId).toBe('road-1')
      }

      // Verify bidirectional synchronization
      const ent = doc.buildings[0].floors[0].entrances[0]
      const road = doc.roads[0]
      expect(ent.connectorRoadId).toBe('road-1')
      expect(road.connectorEntranceId).toBe('ent-1')
    })

    it('returns already-connected when entrance has a connection', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      const result = svc.connect('ent-1', 'road-2', 'entrance-road')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('already-connected')
      }
    })

    it('returns invalid-target when road does not exist', () => {
      const result = svc.connect('ent-1', 'road-nonexistent', 'entrance-road')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-target')
      }
    })

    it('returns owner-not-found when entrance does not exist', () => {
      const result = svc.connect('ent-nonexistent', 'road-1', 'entrance-road')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('owner-not-found')
      }
    })

    it('prevents connecting to a road already claimed by another entrance', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      const result = svc.connect('ent-2', 'road-1', 'entrance-road')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-target')
        expect(result.error.reason).toContain('already connected')
      }
    })
  })

  // ── disconnect() ───────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('clears both sides atomically', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      const result = svc.disconnect('ent-1', 'entrance-road')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.previousTargetId).toBe('road-1')
      }

      // Verify both sides cleared
      const ent = doc.buildings[0].floors[0].entrances[0]
      const road = doc.roads[0]
      expect(ent.connectorRoadId).toBeUndefined()
      expect(road.connectorEntranceId).toBeUndefined()
    })

    it('returns previous target ID', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      const result = svc.disconnect('ent-1', 'entrance-road')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.previousTargetId).toBe('road-1')
      }
    })

    it('returns null previous target when not connected', () => {
      const result = svc.disconnect('ent-1', 'entrance-road')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.previousTargetId).toBeNull()
      }
    })

    it('returns owner-not-found for nonexistent entrance', () => {
      const result = svc.disconnect('ent-nonexistent', 'entrance-road')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe('owner-not-found')
      }
    })
  })

  // ── getRelationship() ──────────────────────────────────────────────────

  describe('getRelationship()', () => {
    it('returns the relationship when connected', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      const rel = svc.getRelationship('ent-1', 'entrance-road')

      expect(rel).not.toBeNull()
      expect(rel!.ownerId).toBe('ent-1')
      expect(rel!.targetId).toBe('road-1')
    })

    it('returns null when not connected', () => {
      const rel = svc.getRelationship('ent-1', 'entrance-road')
      expect(rel).toBeNull()
    })

    it('returns null for nonexistent entrance', () => {
      const rel = svc.getRelationship('ent-nonexistent', 'entrance-road')
      expect(rel).toBeNull()
    })
  })

  // ── getState() ─────────────────────────────────────────────────────────

  describe('getState()', () => {
    it('returns unresolved when no connection', () => {
      expect(svc.getState('ent-1', 'entrance-road')).toBe('unresolved')
    })

    it('returns connected when both sides synchronized', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      expect(svc.getState('ent-1', 'entrance-road')).toBe('connected')
    })

    it('returns invalid when target does not exist', () => {
      // Manually set a broken reference
      const ent = doc.buildings[0].floors[0].entrances[0]
      ent.connectorRoadId = 'road-nonexistent'

      expect(svc.getState('ent-1', 'entrance-road')).toBe('invalid')
    })

    it('returns broken when back-reference is missing', () => {
      // Manually set entrance connector but not road back-reference
      const ent = doc.buildings[0].floors[0].entrances[0]
      ent.connectorRoadId = 'road-1'
      // road-1.connectorEntranceId is not set

      expect(svc.getState('ent-1', 'entrance-road')).toBe('broken')
    })

    it('returns broken when back-reference points to wrong entrance', () => {
      // Connect ent-1 to road-1, then manually set road's back-ref to ent-2
      svc.connect('ent-1', 'road-1', 'entrance-road')
      doc.roads[0].connectorEntranceId = 'ent-2'

      expect(svc.getState('ent-1', 'entrance-road')).toBe('broken')
    })

    it('returns unresolved for nonexistent entrance', () => {
      expect(svc.getState('ent-nonexistent', 'entrance-road')).toBe('unresolved')
    })
  })

  // ── Invariants ─────────────────────────────────────────────────────────

  describe('invariants', () => {
    it('bidirectional sync: connect sets both sides', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')

      expect(doc.buildings[0].floors[0].entrances[0].connectorRoadId).toBe('road-1')
      expect(doc.roads[0].connectorEntranceId).toBe('ent-1')
    })

    it('bidirectional sync: disconnect clears both sides', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      svc.disconnect('ent-1', 'entrance-road')

      expect(doc.buildings[0].floors[0].entrances[0].connectorRoadId).toBeUndefined()
      expect(doc.roads[0].connectorEntranceId).toBeUndefined()
    })

    it('reconnect: disconnect then connect to different road', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      svc.disconnect('ent-1', 'entrance-road')
      const result = svc.connect('ent-1', 'road-2', 'entrance-road')

      expect(result.ok).toBe(true)
      expect(doc.buildings[0].floors[0].entrances[0].connectorRoadId).toBe('road-2')
      expect(doc.roads[1].connectorEntranceId).toBe('ent-1')
      // Old road should be cleared
      expect(doc.roads[0].connectorEntranceId).toBeUndefined()
    })

    it('one-to-one: only one entrance can connect to a road', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      const result = svc.connect('ent-2', 'road-1', 'entrance-road')

      expect(result.ok).toBe(false)
    })

    it('state reflects document changes', () => {
      svc.connect('ent-1', 'road-1', 'entrance-road')
      expect(svc.getState('ent-1', 'entrance-road')).toBe('connected')

      // Simulate external modification (e.g., deleting the road)
      doc.roads.splice(0, 1)
      expect(svc.getState('ent-1', 'entrance-road')).toBe('invalid')
    })
  })
})
