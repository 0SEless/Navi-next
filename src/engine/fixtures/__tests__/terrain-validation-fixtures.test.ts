import { afterEach, describe, expect, it, vi } from 'vitest'
import { findCanonicalRoutePath } from '@/engine/canonical-routing-adapter'
import {
  getTerrainValidationCase,
  getTerrainValidationFixture,
  matchesTerrainExpectation,
  summarizeTerrainRoute,
  terrainValidationFixtures,
} from '../terrain-validation-fixtures'

describe('Phase 6 terrain validation fixtures', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('provides the six deterministic validation fixtures', () => {
    expect(terrainValidationFixtures.map((fixture) => fixture.id)).toEqual([
      'level-vs-steep',
      'stairs-vs-normal',
      'forward-only',
      'reverse-only',
      'walkable-false',
      'outdoor-entrance-indoor',
    ])
  })

  it('routes every case through the canonical adapter with documented evidence', () => {
    for (const fixture of terrainValidationFixtures) {
      for (const fixtureCase of fixture.cases) {
        const result = findCanonicalRoutePath(
          fixture.nodes,
          fixture.edges,
          fixtureCase.origin,
          fixtureCase.destination,
        )
        const actual = summarizeTerrainRoute(result)

        expect(
          matchesTerrainExpectation(fixtureCase.expected, actual),
          `${fixture.id}/${fixtureCase.id}: ${JSON.stringify({ expected: fixtureCase.expected, actual })}`,
        ).toBe(true)
      }
    }
  })

  it('proves the forward-only and reverse-only direction subcases', () => {
    const forward = getTerrainValidationFixture('forward-only')!
    const forwardAllowed = getTerrainValidationCase(forward, 'forward-allowed')!
    const forwardBlocked = getTerrainValidationCase(forward, 'reverse-blocked')!
    expect(summarizeTerrainRoute(findCanonicalRoutePath(forward.nodes, forward.edges, forwardAllowed.origin, forwardAllowed.destination)).routeFound).toBe(true)
    expect(summarizeTerrainRoute(findCanonicalRoutePath(forward.nodes, forward.edges, forwardBlocked.origin, forwardBlocked.destination)).routeFound).toBe(false)

    const reverse = getTerrainValidationFixture('reverse-only')!
    const reverseBlocked = getTerrainValidationCase(reverse, 'forward-blocked')!
    const reverseAllowed = getTerrainValidationCase(reverse, 'reverse-allowed')!
    expect(summarizeTerrainRoute(findCanonicalRoutePath(reverse.nodes, reverse.edges, reverseBlocked.origin, reverseBlocked.destination)).routeFound).toBe(false)
    expect(summarizeTerrainRoute(findCanonicalRoutePath(reverse.nodes, reverse.edges, reverseAllowed.origin, reverseAllowed.destination)).routeFound).toBe(true)
  })

  it('loads fixtures from checked-in memory without a network request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const fixture = getTerrainValidationFixture('outdoor-entrance-indoor')

    expect(fixture?.nodes.length).toBeGreaterThan(0)
    expect(fixture?.edges.length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
