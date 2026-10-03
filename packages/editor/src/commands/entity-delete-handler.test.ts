import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { entityDeleteHandler } from './entity-delete-handler'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      floors: [{
        id: 'flr-1', level: 0, label: 'Ground', elevation: 0,
        rooms: [{
          id: 'rm-1', name: 'R1', number: '101', category: 'classroom',
          polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
          metadata: {},
        }],
        hallways: [], staircases: [], elevators: [], entrances: [], metadata: {},
      }],
    }],
    roads: [{ id: 'rd-1', name: 'Road', polyline: { points: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] }, width: 6, surface: 'paved', type: 'service', metadata: {} }],
    panoramas: [], qrCheckpoints: [],
  }
}

describe('entityDeleteHandler', () => {
  it('deletes a building by entityId', () => {
    const doc = createDoc()
    const res = entityDeleteHandler.execute(doc, { entityId: 'bld-1' })
    expect(res.success).toBe(true)
    expect(doc.buildings.find((b) => b.id === 'bld-1')).toBeUndefined()
  })

  it('deletes a nested room by entityId', () => {
    const doc = createDoc()
    const res = entityDeleteHandler.execute(doc, { entityId: 'rm-1' })
    expect(res.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms.find((r) => r.id === 'rm-1')).toBeUndefined()
  })

  it('deletes a road by entityId', () => {
    const doc = createDoc()
    const res = entityDeleteHandler.execute(doc, { entityId: 'rd-1' })
    expect(res.success).toBe(true)
    expect(doc.roads.find((r) => r.id === 'rd-1')).toBeUndefined()
  })

  it('fails for an unknown entityId', () => {
    const doc = createDoc()
    const res = entityDeleteHandler.execute(doc, { entityId: 'nope' })
    expect(res.success).toBe(false)
  })

  it('fails when entityId is missing', () => {
    const doc = createDoc()
    const res = entityDeleteHandler.execute(doc, {})
    expect(res.success).toBe(false)
  })
})
