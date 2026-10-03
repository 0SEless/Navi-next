import { describe, it, expect } from 'vitest'
import { topologyDiagnostics } from '../topology/index'
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

describe('topologyDiagnostics', () => {
  it('returns empty for document with no parametric components', () => {
    const result = topologyDiagnostics(makeDoc())
    expect(result).toEqual([])
  })

  it('warns when stair is far from any hallway', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].parametricComponents.push({
      id: 'pc-stair-1', definitionId: 'stair',
      position: { x: 100, y: 100 }, rotation: 0,
      properties: { stepCount: 10, stepWidth: 1.2 },
    })
    const result = topologyDiagnostics(doc)
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('TOPOLOGY_STAIR_DISCONNECTED')
  })

  it('warns when elevator has no nearby path', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].parametricComponents.push({
      id: 'pc-elev-1', definitionId: 'elevator',
      position: { x: 200, y: 200 }, rotation: 0,
      properties: { width: 1.5, depth: 1.5 },
    })
    const result = topologyDiagnostics(doc)
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('TOPOLOGY_ELEVATOR_DISCONNECTED')
  })

  it('warns when entrance has no connecting hallway', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].entrances.push({
      id: 'ent-1', label: 'Main', position: { lat: 0, lng: 0 },
      level: 0, type: 'side',
    } as any)
    const result = topologyDiagnostics(doc)
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('TOPOLOGY_ENTRANCE_UNATTACHED')
  })

  it('no warning when stair is near a hallway', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].parametricComponents.push({
      id: 'pc-stair-2', definitionId: 'stair',
      position: { x: 1, y: 1 }, rotation: 0,
      properties: { stepCount: 10, stepWidth: 1.2 },
    })
    doc.buildings[0].floors[0].hallways.push({
      id: 'hw-1', name: 'Corridor',
      polyline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      width: 2,
    } as any)
    const result = topologyDiagnostics(doc)
    expect(result).toEqual([])
  })
})
