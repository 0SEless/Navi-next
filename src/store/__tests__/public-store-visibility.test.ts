import { beforeEach, describe, expect, it } from 'vitest'
import { usePublicStore } from '../public-store'
import type { SearchEntry } from '@navi/core'

const HIDDEN_SEARCHABLE: SearchEntry = {
  id: 'poi-hidden',
  label: 'Guard Post',
  type: 'poi',
  position: { lat: 10, lng: 20 },
  tags: ['guard', 'post'],
  category: 'other',
  source: 'authored',
  sourceId: 'poi-hidden',
}

const VISIBLE_SEARCHABLE: SearchEntry = {
  id: 'poi-visible',
  label: 'Study Area',
  type: 'poi',
  position: { lat: 10.001, lng: 20.001 },
  tags: ['study'],
  category: 'study_area',
  source: 'authored',
  sourceId: 'poi-visible',
}

function setEntries(entries: SearchEntry[]) {
  ;(usePublicStore.setState as unknown as (state: Record<string, unknown>) => void)({
    campus: { searchEntries: entries },
  })
}

describe('public-store POI search reveal (transient)', () => {
  beforeEach(() => {
    setEntries([HIDDEN_SEARCHABLE, VISIBLE_SEARCHABLE])
    usePublicStore.getState().clearRevealedPoiIds()
  })

  it('reveals matching POI ids while a search query is active', () => {
    const results = usePublicStore.getState().search('guard')
    expect(results.map((entry) => entry.id)).toEqual(['poi-hidden'])
    expect(usePublicStore.getState().revealedPoiIds).toEqual(['poi-hidden'])
  })

  it('keeps the reveal limited to the matching hidden POI', () => {
    usePublicStore.getState().search('study')
    expect(usePublicStore.getState().revealedPoiIds).toEqual(['poi-visible'])
  })

  it('clears the reveal when the query is cleared', () => {
    usePublicStore.getState().search('guard')
    expect(usePublicStore.getState().revealedPoiIds).toHaveLength(1)

    usePublicStore.getState().search('')
    expect(usePublicStore.getState().revealedPoiIds).toEqual([])
  })

  it('clears the reveal through the explicit clear action', () => {
    usePublicStore.getState().search('guard')
    usePublicStore.getState().clearRevealedPoiIds()
    expect(usePublicStore.getState().revealedPoiIds).toEqual([])
  })

  it('never persists the temporary reveal', () => {
    const campusBefore = usePublicStore.getState().campus
    usePublicStore.getState().search('guard')
    expect(usePublicStore.getState().campus).toBe(campusBefore)
    const persisted = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key) ?? '')
      .join('\n')
    expect(persisted).not.toContain('revealedPoiIds')
  })
})
