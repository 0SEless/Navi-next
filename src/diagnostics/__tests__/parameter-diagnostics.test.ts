import { describe, it, expect } from 'vitest'
import { parameterDiagnostics } from '../parameter/index'
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

describe('parameterDiagnostics', () => {
  it('returns empty for document with no parametric components', () => {
    const result = parameterDiagnostics(makeDoc())
    expect(result).toEqual([])
  })

  it('returns diagnostics for invalid parametric components', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].parametricComponents.push({
      id: 'pc-1', definitionId: 'stair',
      position: { x: 0, y: 0 }, rotation: 0,
      properties: { stepCount: 0, stepWidth: 1.2 },
    })
    const result = parameterDiagnostics(doc)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].code).toBe('PARAMETER_OUT_OF_RANGE')
  })

  it('returns empty for valid components', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].parametricComponents.push({
      id: 'pc-2', definitionId: 'stair',
      position: { x: 0, y: 0 }, rotation: 0,
      properties: { stepCount: 10, stepWidth: 1.2, stepDepth: 0.3, direction: 'east' },
    })
    const result = parameterDiagnostics(doc)
    expect(result).toEqual([])
  })

  it('skips unknown definitionId gracefully', () => {
    const doc = makeDoc()
    doc.buildings[0].floors[0].parametricComponents.push({
      id: 'pc-3', definitionId: 'nonexistent',
      position: { x: 0, y: 0 }, rotation: 0, properties: {},
    })
    const result = parameterDiagnostics(doc)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})
