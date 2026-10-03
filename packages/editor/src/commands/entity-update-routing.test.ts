import type { CampusDocument } from '@navi/core'
import { describe, expect, it } from 'vitest'
import { entityUpdateHandler } from './entity-update-handler'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: {
      campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0',
    },
    buildings: [],
    roads: [{
      id: 'rd-1',
      name: 'Road',
      polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] },
      width: 6,
      surface: 'paved',
      type: 'service',
      metadata: {},
      routing: { feature: 'normal', slope: 'gentle', direction: 'both', walkable: true },
    }],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('entityUpdateHandler Road.routing history', () => {
  it('updates and restores road routing without changing identity or geometry', () => {
    const doc = createDoc()
    const roadId = doc.roads[0].id
    const polyline = structuredClone(doc.roads[0].polyline)
    const originalRouting = structuredClone(doc.roads[0].routing)
    const nextRouting = {
      ...originalRouting,
      feature: 'stairs' as const,
      slope: 'steep' as const,
      startElevationMeters: 4,
      endElevationMeters: 12,
      wheelchairAccessible: false,
    }
    const payload = { entityId: roadId, changes: { routing: nextRouting } }

    const result = entityUpdateHandler.execute(doc, payload)

    expect(result.success).toBe(true)
    expect(doc.roads[0]).toMatchObject({ id: roadId, routing: nextRouting })
    expect(doc.roads[0].polyline).toEqual(polyline)

    const inverse = entityUpdateHandler.inverse!(payload, result)
    expect(inverse).not.toBeNull()
    expect(inverse.payload).toEqual({
      entityId: roadId,
      changes: { routing: originalRouting },
    })

    const undoResult = entityUpdateHandler.execute(doc, inverse.payload)
    expect(undoResult.success).toBe(true)
    expect(doc.roads[0]).toMatchObject({ id: roadId, routing: originalRouting })
    expect(doc.roads[0].polyline).toEqual(polyline)

    const redoResult = entityUpdateHandler.execute(doc, payload)
    expect(redoResult.success).toBe(true)
    expect(doc.roads[0]).toMatchObject({ id: roadId, routing: nextRouting })
    expect(doc.roads[0].polyline).toEqual(polyline)
  })
})
