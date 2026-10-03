import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RelationshipSuggestionService } from '../RelationshipSuggestionService'
import type { SpatialQueryService, NearestResult } from '@navi/core'
import type { RelationshipService } from '../RelationshipService'
import type { Entrance, Road } from '@navi/core'

function createMockSpatial(): SpatialQueryService {
  return {
    nearestRoad: vi.fn(),
  } as unknown as SpatialQueryService
}

function createMockRelationships(): RelationshipService {
  return {
    findEntrance: vi.fn(),
    findRoad: vi.fn(),
  } as unknown as RelationshipService
}

function makeEntrance(overrides?: Partial<Entrance>): Entrance {
  return {
    id: 'ent-1',
    position: { lat: 37.7749, lng: -122.4194 },
    floor: 0,
    ...overrides,
  } as Entrance
}

function makeRoad(overrides?: Partial<Road>): Road {
  return {
    id: 'road-1',
    name: 'Main Street',
    polyline: [{ lat: 37.775, lng: -122.419 }],
    ...overrides,
  } as Road
}

function makeNearestResult(roadId: string, distance: number): NearestResult {
  return {
    entity: { id: roadId, type: 'road' },
    distance,
    point: { lat: 37.775, lng: -122.419 },
  }
}

describe('RelationshipSuggestionService', () => {
  let spatial: ReturnType<typeof createMockSpatial>
  let relationships: ReturnType<typeof createMockRelationships>
  let service: RelationshipSuggestionService

  beforeEach(() => {
    vi.clearAllMocks()
    spatial = createMockSpatial()
    relationships = createMockRelationships()
    service = new RelationshipSuggestionService(spatial, relationships)
  })

  describe('suggestEntranceRoad', () => {
    it('returns empty array when entrance not found', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(null)

      const suggestions = service.suggestEntranceRoad('nonexistent')

      expect(suggestions).toEqual([])
    })

    it('returns empty array when entrance has no position', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(
        makeEntrance({ position: undefined }),
      )

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toEqual([])
    })

    it('returns empty array when no roads within range', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(null)

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toEqual([])
    })

    it('returns suggestion for nearest road', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 12))
      vi.mocked(relationships.findRoad).mockReturnValue(makeRoad())

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].targetId).toBe('road-1')
      expect(suggestions[0].targetName).toBe('Main Street')
      expect(suggestions[0].distanceMeters).toBe(12)
    })

    it('excludes roads with connectorEntranceId set by another entrance', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 12))
      vi.mocked(relationships.findRoad).mockReturnValue(
        makeRoad({ connectorEntranceId: 'other-entrance' }),
      )

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toEqual([])
    })

    it('allows road with connectorEntranceId set to same entrance', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance({ id: 'ent-1' }))
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 12))
      vi.mocked(relationships.findRoad).mockReturnValue(
        makeRoad({ connectorEntranceId: 'ent-1' }),
      )

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toHaveLength(1)
    })

    it('returns empty array when road not found', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 12))
      vi.mocked(relationships.findRoad).mockReturnValue(null)

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toEqual([])
    })
  })

  describe('confidence', () => {
    it('returns 1.0 for distance 0', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 0))
      vi.mocked(relationships.findRoad).mockReturnValue(makeRoad())

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions[0].confidence).toBe(1)
    })

    it('returns 0.76 for distance 12m', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 12))
      vi.mocked(relationships.findRoad).mockReturnValue(makeRoad())

      const suggestions = service.suggestEntranceRoad('ent-1')

      // confidence = max(0, 1 - 12/50) = 0.76
      expect(suggestions[0].confidence).toBeCloseTo(0.76)
    })

    it('returns 0 for distance 50m', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(makeNearestResult('road-1', 50))
      vi.mocked(relationships.findRoad).mockReturnValue(makeRoad())

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions[0].confidence).toBe(0)
    })

    it('does not return suggestions beyond 50m', () => {
      vi.mocked(relationships.findEntrance).mockReturnValue(makeEntrance())
      vi.mocked(spatial.nearestRoad).mockReturnValue(null)

      const suggestions = service.suggestEntranceRoad('ent-1')

      expect(suggestions).toEqual([])
    })
  })

  describe('spatial integration', () => {
    it('calls nearestRoad with entrance position', () => {
      const entrance = makeEntrance({ position: { lat: 40.0, lng: -74.0 } as any })
      vi.mocked(relationships.findEntrance).mockReturnValue(entrance)
      vi.mocked(spatial.nearestRoad).mockReturnValue(null)

      service.suggestEntranceRoad('ent-1')

      expect(spatial.nearestRoad).toHaveBeenCalledWith(
        { lat: 40.0, lng: -74.0 },
        { maxDistance: 50 },
      )
    })
  })
})
