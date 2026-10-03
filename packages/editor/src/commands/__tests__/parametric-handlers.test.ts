import { describe, it, expect } from 'vitest'
import { parametricCreateHandler, parametricDeleteHandler, parametricUpdateHandler } from '../parametric-handlers'
import type { CampusDocument } from '@navi/core'

function makeDoc(): CampusDocument {
  return {
    schemaVersion: 1, version: 1,
    metadata: { campusId: 'Test', name: 'Test', description: '', lastModified: '', editorVersion: '1' },
    buildings: [{
      id: 'bld-1', name: 'B1', code: '', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }, { lat: 0, lng: 1 }] },
      baseElevation: 0, height: 10, color: '#000',
      floors: [{
        id: 'flr-1', level: 0, label: 'GF', elevation: 0, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [],
        connectorStops: [], parametricComponents: [],
        metadata: {},
      }],
      verticalConnectors: [], aliases: [], metadata: {},
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

describe('parametricCreateHandler', () => {
  it('creates a parametric component', () => {
    const doc = makeDoc()
    const result = parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      definitionId: 'stair',
      position: { x: 10, y: 20 },
      rotation: 0,
      properties: { stepCount: 4, stepWidth: 1.2 },
    })
    expect(result.success).toBe(true)
    expect(result.entityId).toBeTruthy()
    const floor = doc.buildings[0].floors[0]
    expect(floor.parametricComponents).toHaveLength(1)
    expect(floor.parametricComponents[0].definitionId).toBe('stair')
    expect(floor.parametricComponents[0].position).toEqual({ x: 10, y: 20 })
  })

  it('rejects missing buildingId', () => {
    const doc = makeDoc()
    const result = parametricCreateHandler.execute(doc, {
      buildingId: 'nope', floorId: 'flr-1',
      definitionId: 'stair', position: { x: 0, y: 0 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing definitionId', () => {
    const doc = makeDoc()
    const result = parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      position: { x: 0, y: 0 },
    })
    expect(result.success).toBe(false)
  })
})

describe('parametricDeleteHandler', () => {
  it('deletes a parametric component', () => {
    const doc = makeDoc()
    parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      definitionId: 'elevator', position: { x: 5, y: 5 },
    })
    const id = doc.buildings[0].floors[0].parametricComponents[0].id
    const result = parametricDeleteHandler.execute(doc, { parametricId: id })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].parametricComponents).toHaveLength(0)
  })

  it('returns false for unknown id', () => {
    const doc = makeDoc()
    const result = parametricDeleteHandler.execute(doc, { parametricId: 'nope' })
    expect(result.success).toBe(false)
  })
})

describe('parametricUpdateHandler', () => {
  it('updates position', () => {
    const doc = makeDoc()
    parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      definitionId: 'stair', position: { x: 0, y: 0 },
    })
    const id = doc.buildings[0].floors[0].parametricComponents[0].id
    const result = parametricUpdateHandler.execute(doc, { parametricId: id, changes: { position: { x: 99, y: 88 } } })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].parametricComponents[0].position).toEqual({ x: 99, y: 88 })
  })

  it('updates properties', () => {
    const doc = makeDoc()
    parametricCreateHandler.execute(doc, {
      buildingId: 'bld-1', floorId: 'flr-1',
      definitionId: 'elevator', position: { x: 0, y: 0 },
    })
    const id = doc.buildings[0].floors[0].parametricComponents[0].id
    parametricUpdateHandler.execute(doc, { parametricId: id, changes: { properties: { width: 2.0, depth: 2.0 } } })
    expect(doc.buildings[0].floors[0].parametricComponents[0].properties.width).toBe(2.0)
  })
})
