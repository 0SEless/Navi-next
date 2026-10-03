import { describe, it, expect, beforeEach } from 'vitest'
import { connectEntranceHandler, disconnectEntranceHandler } from '../relationship-handlers'
import type { CampusDocument } from '@navi/core'

function makeDoc(): CampusDocument {
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
              { id: 'ent-1', label: 'Main', position: { lat: 0, lng: 0 }, level: 0, type: 'main', hasQR: false, hasPanorama: false },
              { id: 'ent-2', label: 'Side', position: { lat: 0, lng: 0 }, level: 0, type: 'side', hasQR: false, hasPanorama: false },
            ],
          },
        ],
      },
    ],
    roads: [
      { id: 'road-1', name: 'Walkway', polyline: { points: [{ lat: 0, lng: 0 }] }, width: 3, surface: 'paved', type: 'pedestrian', metadata: {} },
      { id: 'road-2', name: 'Service', polyline: { points: [{ lat: 0, lng: 0 }] }, width: 4, surface: 'paved', type: 'service', metadata: {} },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('relationship-handlers', () => {
  let doc: CampusDocument

  beforeEach(() => {
    doc = makeDoc()
  })

  // ── connectEntranceHandler ──────────────────────────────────────────────

  describe('connectEntranceHandler', () => {
    it('has correct id', () => {
      expect(connectEntranceHandler.id).toBe('entrance.connectRoad')
    })

    it('connects entrance to road atomically', () => {
      const result = connectEntranceHandler.execute(doc, {
        entranceId: 'ent-1',
        roadId: 'road-1',
      })

      expect(result.success).toBe(true)
      expect(result.entityId).toBe('ent-1')

      // Verify bidirectional sync
      const ent = doc.buildings[0].floors[0].entrances[0]
      const road = doc.roads[0]
      expect(ent.connectorRoadId).toBe('road-1')
      expect(road.connectorEntranceId).toBe('ent-1')
    })

    it('returns error for missing entranceId', () => {
      const result = connectEntranceHandler.execute(doc, { roadId: 'road-1' })
      expect(result.success).toBe(false)
    })

    it('returns error for missing roadId', () => {
      const result = connectEntranceHandler.execute(doc, { entranceId: 'ent-1' })
      expect(result.success).toBe(false)
    })

    it('returns error for nonexistent entrance', () => {
      const result = connectEntranceHandler.execute(doc, {
        entranceId: 'ent-nonexistent',
        roadId: 'road-1',
      })
      expect(result.success).toBe(false)
    })

    it('returns error for already connected entrance', () => {
      connectEntranceHandler.execute(doc, { entranceId: 'ent-1', roadId: 'road-1' })
      const result = connectEntranceHandler.execute(doc, { entranceId: 'ent-1', roadId: 'road-2' })
      expect(result.success).toBe(false)
    })

    it('provides inverse command for undo', () => {
      const result = connectEntranceHandler.execute(doc, {
        entranceId: 'ent-1',
        roadId: 'road-1',
      })

      const inverse = connectEntranceHandler.inverse!({ entranceId: 'ent-1', roadId: 'road-1' }, result)
      expect(inverse).not.toBeNull()
      expect(inverse!.id).toBe('entrance.disconnectRoad')
      expect(inverse!.payload.entranceId).toBe('ent-1')
    })
  })

  // ── disconnectEntranceHandler ───────────────────────────────────────────

  describe('disconnectEntranceHandler', () => {
    it('has correct id', () => {
      expect(disconnectEntranceHandler.id).toBe('entrance.disconnectRoad')
    })

    it('disconnects entrance from road atomically', () => {
      // First connect
      connectEntranceHandler.execute(doc, { entranceId: 'ent-1', roadId: 'road-1' })

      // Then disconnect
      const result = disconnectEntranceHandler.execute(doc, { entranceId: 'ent-1' })

      expect(result.success).toBe(true)
      expect(result.entityId).toBe('ent-1')
      expect(result.data?.previousRoadId).toBe('road-1')

      // Verify both sides cleared
      const ent = doc.buildings[0].floors[0].entrances[0]
      const road = doc.roads[0]
      expect(ent.connectorRoadId).toBeUndefined()
      expect(road.connectorEntranceId).toBeUndefined()
    })

    it('returns error for missing entranceId', () => {
      const result = disconnectEntranceHandler.execute(doc, {})
      expect(result.success).toBe(false)
    })

    it('returns success with null previousTargetId when not connected', () => {
      const result = disconnectEntranceHandler.execute(doc, { entranceId: 'ent-1' })
      expect(result.success).toBe(true)
      expect(result.data?.previousRoadId).toBeNull()
    })

    it('provides inverse command for reconnect', () => {
      connectEntranceHandler.execute(doc, { entranceId: 'ent-1', roadId: 'road-1' })

      const result = disconnectEntranceHandler.execute(doc, { entranceId: 'ent-1' })
      const inverse = disconnectEntranceHandler.inverse!({ entranceId: 'ent-1' }, result)

      expect(inverse).not.toBeNull()
      expect(inverse!.id).toBe('entrance.connectRoad')
      expect(inverse!.payload.entranceId).toBe('ent-1')
      expect(inverse!.payload.roadId).toBe('road-1')
    })

    it('returns null inverse when not connected', () => {
      const result = disconnectEntranceHandler.execute(doc, { entranceId: 'ent-1' })
      const inverse = disconnectEntranceHandler.inverse!({ entranceId: 'ent-1' }, result)
      expect(inverse).toBeNull()
    })
  })

  // ── Undo/Redo flow ─────────────────────────────────────────────────────

  describe('undo/redo flow', () => {
    it('connect → disconnect → reconnect works', () => {
      // Connect
      const connectResult = connectEntranceHandler.execute(doc, { entranceId: 'ent-1', roadId: 'road-1' })
      expect(connectResult.success).toBe(true)
      expect(doc.buildings[0].floors[0].entrances[0].connectorRoadId).toBe('road-1')

      // Disconnect (undo connect)
      const disconnectResult = disconnectEntranceHandler.execute(doc, { entranceId: 'ent-1' })
      expect(disconnectResult.success).toBe(true)
      expect(doc.buildings[0].floors[0].entrances[0].connectorRoadId).toBeUndefined()

      // Reconnect (redo connect via inverse)
      const reconnectResult = connectEntranceHandler.execute(doc, { entranceId: 'ent-1', roadId: 'road-1' })
      expect(reconnectResult.success).toBe(true)
      expect(doc.buildings[0].floors[0].entrances[0].connectorRoadId).toBe('road-1')
    })
  })
})
