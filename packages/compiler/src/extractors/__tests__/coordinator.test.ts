import { describe, it, expect, beforeEach } from 'vitest'
import { ExtractionCoordinator } from '../coordinator'
import type { Extractor, ExtractionContext } from '../types'
import type { NavigationSpace } from '../../types'

class FakeRoomExtractor implements Extractor<any, NavigationSpace> {
  extract(input: any, context: ExtractionContext): NavigationSpace[] {
    return (input.rooms || []).map((r: any) => ({
      id: r.id + '_extracted',
      label: r.name,
      type: 'room' as const,
      buildingId: r.buildingId,
      floor: r.floor,
      position: { lng: 0, lat: 0 },
      properties: {},
    }))
  }
}

const mockCampusDocument = {
  buildings: [
    { id: 'b1', name: 'Building A', code: 'A', category: 'academic', floors: [] },
  ],
  rooms: [
    { id: 'r1', name: 'Room 101', number: '101', buildingId: 'b1', floor: 1, vertices: [{ lng: 0, lat: 0 }, { lng: 10, lat: 0 }, { lng: 10, lat: 10 }] },
  ],
  hallways: [],
  roads: [],
  entrances: [],
  staircases: [],
  elevators: [],
  panoramas: [],
  qrCheckpoints: [],
} as any

describe('ExtractionCoordinator', () => {
  let coordinator: ExtractionCoordinator
  let context: ExtractionContext

  beforeEach(() => {
    coordinator = new ExtractionCoordinator()
    context = { campusId: 'campus-1', campusDocument: mockCampusDocument, projectId: 'proj-1' }
  })

  it('returns empty result when no extractors registered', () => {
    const result = coordinator.extractAll(mockCampusDocument, context)
    expect(result.spaces).toHaveLength(0)
    expect(result.transitions).toHaveLength(0)
    expect(result.corridors).toHaveLength(0)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('extracts primitives from a registered extractor', () => {
    coordinator.register(new FakeRoomExtractor())
    const result = coordinator.extractAll(mockCampusDocument, context)
    expect(result.spaces).toHaveLength(1)
    expect(result.spaces[0].id).toBe('r1_extracted')
  })

  it('deduplicates by entity ID', () => {
    coordinator.register(new FakeRoomExtractor())
    const doc = {
      ...mockCampusDocument,
      rooms: [
        { id: 'r1', name: 'Room 101', number: '101', buildingId: 'b1', floor: 1, vertices: [{ lng: 0, lat: 0 }, { lng: 10, lat: 0 }, { lng: 10, lat: 10 }] },
        { id: 'r1', name: 'Room 101', number: '101', buildingId: 'b1', floor: 1, vertices: [{ lng: 0, lat: 0 }, { lng: 10, lat: 0 }, { lng: 10, lat: 10 }] },
      ],
    } as any
    const result = coordinator.extractAll(doc, context)
    expect(result.spaces).toHaveLength(1)
  })

  it('returns empty result for empty document', () => {
    const empty = { buildings: [], rooms: [], hallways: [], roads: [], entrances: [], staircases: [], elevators: [], panoramas: [], qrCheckpoints: [] } as any
    const result = coordinator.extractAll(empty, context)
    expect(result.spaces).toEqual([])
    expect(result.transitions).toEqual([])
    expect(result.corridors).toEqual([])
  })
})
