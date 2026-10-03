import { describe, it, expect } from 'vitest'
import { ExtractionCoordinator } from '../extractors/coordinator'

function demoDocument(): any {
  return {
    id: 'test-campus',
    name: 'Test Campus',
    buildings: [{
      id: 'b1',
      name: 'Building A',
      floors: [{
        id: 'f1',
        level: 1,
        label: 'Ground Floor',
        spaces: [{ id: 's1', label: 'Room 101', type: 'room', polygon: [{ lng: 121.0, lat: 14.0 }, { lng: 121.001, lat: 14.0 }, { lng: 121.001, lat: 14.001 }, { lng: 121.0, lat: 14.001 }] }],
      }],
      entrances: [{ id: 'e1', label: 'Main Entrance', position: { lng: 121.0, lat: 14.0 } as any }],
    }],
  }
}

describe('compile smoke test', () => {
  it('extracts a navigation graph from a campus document', () => {
    const coordinator = new ExtractionCoordinator()
    const result = coordinator.extractAll(demoDocument(), { campusId: 'c1', campusDocument: demoDocument(), projectId: 'p1' })
    expect(result.spaces).toBeDefined()
    expect(result.transitions).toBeDefined()
    expect(result.corridors).toBeDefined()
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })
})
