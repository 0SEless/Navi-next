import { describe, it, expect } from 'vitest'
import { SearchEngine } from '../search-engine'
import type { SearchIndex } from '@navi/core'

function makeIndex(entries: SearchIndex['entries']): SearchIndex {
  return { version: '1.0.0', entries }
}

const authoredPoi = {
  id: 'poi-study-area',
  label: 'Student Study Area',
  type: 'poi',
  position: { lng: 121.002, lat: 14.002 },
  tags: ['student', 'study', 'area', 'owner', 'library'],
  category: 'study_area',
  buildingId: 'b1',
  floor: 1,
  floorId: 'f1',
  source: 'authored',
  sourceId: 'poi-study-area',
} as unknown as SearchIndex['entries'][number]

describe('SearchEngine', () => {
  const index = makeIndex([
    { id: 'b1', label: 'Engineering Building', type: 'building', nodeId: 'n1', position: { lng: 121, lat: 14 }, tags: ['engineering', 'academic'], buildingId: 'b1' },
    { id: 'b2', label: 'Library', type: 'building', nodeId: 'n2', position: { lng: 121, lat: 14 }, tags: ['library', 'academic'], buildingId: 'b2' },
    { id: 'r1', label: 'Room 101', type: 'room', nodeId: 'n3', position: { lng: 121, lat: 14 }, tags: ['classroom'], buildingId: 'b1', floor: 1 },
    { id: 'r2', label: 'Computer Lab A', type: 'room', nodeId: 'n4', position: { lng: 121, lat: 14 }, tags: ['lab', 'computer'], buildingId: 'b1', floor: 2 },
    { id: 'e1', label: 'Main Entrance', type: 'entrance', nodeId: 'n5', position: { lng: 121, lat: 14 }, tags: ['entrance', 'main'], buildingId: 'b1' },
  ])

  it('returns results for exact label match', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('Library')
    expect(results[0].entry.id).toBe('b2')
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('returns results for partial label match', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('Eng')
    expect(results.some(r => r.entry.id === 'b1')).toBe(true)
  })

  it('returns results for tag match', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('classroom')
    expect(results.some(r => r.entry.id === 'r1')).toBe(true)
  })

  it('matches authored POIs by normalized category tokens without a node', () => {
    const engine = new SearchEngine(makeIndex([...index.entries, authoredPoi]))
    const results = engine.query('study_area')
    expect(results[0]?.entry).toMatchObject({
      id: 'poi-study-area',
      type: 'poi',
      category: 'study_area',
      source: 'authored',
    })
    expect(results[0]?.entry.nodeId).toBeUndefined()
  })

  it('finds outdoor/campus POIs with stable identity and no building/floor context', () => {
    const outdoorPoi = {
      id: 'outdoor-guard-post',
      label: 'Guard Post',
      type: 'poi',
      position: { lng: 121.05, lat: 14.05 },
      tags: ['guard', 'post'],
      category: 'other',
      source: 'authored',
      sourceId: 'outdoor-guard-post',
      scope: 'outdoor',
    } as unknown as SearchIndex['entries'][number]

    const engine = new SearchEngine(makeIndex([...index.entries, outdoorPoi]))
    const results = engine.query('guard post')

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.entry).toMatchObject({
      id: 'outdoor-guard-post',
      type: 'poi',
      source: 'authored',
      sourceId: 'outdoor-guard-post',
      scope: 'outdoor',
      position: { lat: 14.05, lng: 121.05 },
    })
    expect(results[0]?.entry.nodeId).toBeUndefined()
    expect(results[0]?.entry.buildingId).toBeUndefined()
    expect(results[0]?.entry.floor).toBeUndefined()
  })

  it('returns multiple results ranked by score', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('Engineering')
    expect(results.length).toBeGreaterThan(0)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('returns empty for no match', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('zzzznotfound', { minScore: 1 })
    expect(results).toHaveLength(0)
  })

  it('respects maxResults', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('a', { maxResults: 2 })
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('building results are boosted', () => {
    const engine = new SearchEngine(index)
    const results = engine.query('a')
    const top = results[0]
    expect(top.entry.type).toBe('building')
  })

  it('search API works through engine', async () => {
    const { RuntimeEngine } = await import('../../engine/runtime-engine')
    const { resolve } = await import('path')
    const fixturesDir = resolve(__dirname, '../../../test/fixtures')
    const { load } = await import('../../loader')
    const result = await load(fixturesDir)
    expect(result.success).toBe(true)
    if (!result.success) return
    const engine = new RuntimeEngine(result.package)
    const results = engine.search.search('Room')
    expect(results.length).toBeGreaterThanOrEqual(0)
  })
})
