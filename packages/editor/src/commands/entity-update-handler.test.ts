import { describe, it, expect } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { entityUpdateHandler } from './entity-update-handler'
import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'

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

describe('entityUpdateHandler', () => {
  it('updates a building property', () => {
    const doc = createDoc()
    const result = entityUpdateHandler.execute(doc, { entityId: 'bld-1', changes: { name: 'Renamed' } })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].name).toBe('Renamed')
  })

  it('updates a room property', () => {
    const doc = createDoc()
    const result = entityUpdateHandler.execute(doc, { entityId: 'rm-1', changes: { name: 'Lab 101' } })
    expect(result.success).toBe(true)
    expect(doc.buildings[0].floors[0].rooms[0].name).toBe('Lab 101')
  })

  it('updates a road property', () => {
    const doc = createDoc()
    const result = entityUpdateHandler.execute(doc, { entityId: 'rd-1', changes: { width: 10 } })
    expect(result.success).toBe(true)
    expect(doc.roads[0].width).toBe(10)
  })
  it('moves a shared authored junction in one undoable road edit and projects the connected route graph', () => {
    const doc = createDoc()
    const junctionPosition = { lat: 0, lng: 0 }
    const nextPosition = { lat: 0.0001, lng: 0.0001 }
    const roadAStart = { lat: 0, lng: -0.001 }
    const roadBStart = { lat: -0.001, lng: 0 }
    const roadBEnd = { lat: 0.001, lng: 0 }
    doc.buildings = []
    doc.roads = [
      { id: 'road-a', name: 'A', polyline: { points: [roadAStart, junctionPosition] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} },
      { id: 'road-b', name: 'B', polyline: { points: [roadBStart, roadBEnd] }, width: 5, surface: 'paved', type: 'arterial', metadata: {} },
    ]
    doc.roadJunctions = [{ id: 'junction-ab', position: junctionPosition, roadIds: ['road-a', 'road-b'], source: 'authored' }]
    const payload = {
      entityId: 'road-a',
      changes: { polyline: { points: [roadAStart, nextPosition] } },
      junctionMove: { junctionId: 'junction-ab', position: nextPosition },
    }

    const result = entityUpdateHandler.execute(doc, payload)

    expect(result.success).toBe(true)
    expect(doc.roads[0].polyline.points).toEqual([roadAStart, nextPosition])
    expect(doc.roads[1].polyline.points).toEqual([roadBStart, nextPosition, roadBEnd])
    expect(doc.roadJunctions?.[0]?.position).toEqual(nextPosition)

    const graph = new Graph()
    graph.campusId = doc.metadata.campusId
    new GraphAdapter(graph).sync(doc)
    const aStart = graph.nodes.find((node) => node.metadata?.traceId === 'road-a' && node.position.lat === roadAStart.lat && node.position.lng === roadAStart.lng)
    const bStart = graph.nodes.find((node) => node.metadata?.traceId === 'road-b' && node.position.lat === roadBStart.lat && node.position.lng === roadBStart.lng)
    expect(aStart).toBeDefined()
    expect(bStart).toBeDefined()
    expect(graph.findPath(aStart!.id, bStart!.id)).not.toBeNull()

    const inverse = entityUpdateHandler.inverse!(payload, result)
    const undoResult = entityUpdateHandler.execute(doc, inverse.payload)
    expect(undoResult.success).toBe(true)
    expect(doc.roads[0].polyline.points).toEqual([roadAStart, junctionPosition])
    expect(doc.roads[1].polyline.points).toEqual([roadBStart, roadBEnd])
    expect(doc.roadJunctions?.[0]?.position).toEqual(junctionPosition)
  })

  it('fails for unknown entity', () => {
    const doc = createDoc()
    const result = entityUpdateHandler.execute(doc, { entityId: 'nope', changes: { name: 'X' } })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('fails without entityId', () => {
    const doc = createDoc()
    const result = entityUpdateHandler.execute(doc, { changes: { name: 'X' } })
    expect(result.success).toBe(false)
  })

  it('generates inverse command', () => {
    const doc = createDoc()
    const result = entityUpdateHandler.execute(doc, { entityId: 'bld-1', changes: { name: 'New' } })
    const inverse = entityUpdateHandler.inverse!({ entityId: 'bld-1', changes: { name: 'New' } }, result)
    expect(inverse).not.toBeNull()
    expect(inverse.payload.entityId).toBe('bld-1')
    expect(inverse.payload.changes).toMatchObject({ name: 'Main' })
  })
})
