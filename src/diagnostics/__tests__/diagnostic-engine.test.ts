import { describe, it, expect } from 'vitest'
import { DiagnosticEngine } from '../engine'
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
        connectorStops: [], parametricComponents: [{
          id: 'pc-bad', definitionId: 'stair',
          position: { x: 100, y: 100 }, rotation: 0,
          properties: { stepCount: 0, stepWidth: 1.2 },
        }],
        metadata: {},
      }],
      verticalConnectors: [], aliases: [], metadata: {},
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

describe('DiagnosticEngine', () => {
  it('returns diagnostics with all providers enabled', () => {
    const result = DiagnosticEngine.run(makeDoc())
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2)
    expect(result.skippedProviders).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('runs only parameter provider when specified', () => {
    const result = DiagnosticEngine.run(makeDoc(), { parameter: true, topology: false })
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1)
    expect(result.diagnostics.every(d => d.category === 'parameter')).toBe(true)
  })

  it('returns deterministic results (same count, codes, messages)', () => {
    const doc = makeDoc()
    const r1 = DiagnosticEngine.run(doc)
    const r2 = DiagnosticEngine.run(doc)
    const r3 = DiagnosticEngine.run(doc)
    const stripId = (ds: any[]) => ds.map(({ id, ...rest }) => rest)
    expect(stripId(r1.diagnostics)).toEqual(stripId(r2.diagnostics))
    expect(stripId(r2.diagnostics)).toEqual(stripId(r3.diagnostics))
    expect(r1.diagnostics.length).toBe(r2.diagnostics.length)
    expect(r1.diagnostics.length).toBe(r3.diagnostics.length)
  })

  it('skips nothing when run() with no options', () => {
    const doc = makeDoc()
    const result = DiagnosticEngine.run(doc)
    expect(result.errors).toEqual([])
  })
})
