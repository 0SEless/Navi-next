import { describe, expect, it } from 'vitest'
import type { Building, NavNode, SearchEntry } from '@/types/nav-types'
import {
  buildHomeContent,
  buildRecentDestination,
  normalizeAnnouncementPriority,
  reconcileRecentDestinationIds,
  type HomeAnnouncementInput,
  type HomeHeroInput,
} from '../home-content'

const building = (overrides: Partial<Building> = {}): Building => ({
  id: 'bld-main',
  name: 'Main Building',
  campusId: 'asu-ibajay',
  floors: [0, 1],
  footprint: [],
  baseElevation: 0,
  height: 0,
  category: 'Academic',
  code: 'MAIN',
  ...overrides,
})

const node = (overrides: Partial<NavNode> = {}): NavNode => ({
  id: 'node-101',
  label: 'Room 101',
  position: { lat: 11, lng: 122 },
  floor: 1,
  buildingId: 'bld-main',
  campusId: 'asu-ibajay',
  type: 'room',
  ...overrides,
})

describe('Home content adapter', () => {
  it('keeps only active, in-window hero content and orders it deterministically', () => {
    const heroes: HomeHeroInput[] = [
      { id: 'later', title: 'Later', subtitle: '', order: 2, active: true },
      { id: 'inactive', title: 'Inactive', subtitle: '', order: 0, active: false },
      { id: 'expired', title: 'Expired', subtitle: '', order: 0, active: true, endsAt: '2026-09-04T23:59:59Z' },
      { id: 'first-b', title: 'First B', subtitle: '', order: 0, active: true },
      { id: 'first-a', title: 'First A', subtitle: '', order: 0, active: true },
      { id: 'future', title: 'Future', subtitle: '', order: 1, active: true, startsAt: '2026-09-06T00:00:00Z' },
    ]

    const content = buildHomeContent({
      campusName: 'ASU–Ibajay',
      buildings: [],
      heroes,
      announcements: [],
      now: new Date('2026-09-05T12:00:00Z'),
    })

    expect(content.heroSlides.map((slide) => slide.id)).toEqual(['first-a', 'first-b', 'later'])
    expect(content.usesFallbackHero).toBe(false)
  })

  it('uses isolated neutral fallback content when optional editorial sources are absent', () => {
    const content = buildHomeContent({ campusName: null, buildings: [] })

    expect(content.heroSlides).toHaveLength(1)
    expect(content.heroSlides[0]).toMatchObject({
      id: 'campus-overview',
      title: 'Your campus map',
      active: true,
    })
    expect(content.heroSlides[0].image).toBeUndefined()
    expect(content.announcements).toMatchObject([
      expect.objectContaining({ id: 'campus-map-available', priority: 'info' }),
    ])
    expect(content.usesFallbackHero).toBe(true)
    expect(content.usesFallbackAnnouncements).toBe(true)
  })

  it('uses the explicit campus name and falls back when the name is missing or equals the campus id', () => {
    expect(buildHomeContent({ campusName: 'North Campus' }).campusName).toBe('North Campus')
    expect(buildHomeContent({ campusName: 'test-campus', campusId: 'test-campus' }).campusName).toBe('Your campus')
  })

  it('derives featured places from real loaded buildings and preserves stable IDs', () => {
    const buildings = [
      building({ id: 'bld-library', name: 'Library', category: 'Services', description: 'Study and research spaces.' }),
      building({ id: 'bld-science', name: 'Science Hall', floors: [0], code: undefined }),
    ]

    const content = buildHomeContent({ campusName: 'ASU–Ibajay', buildings })

    expect(content.featuredPlaces).toEqual([
      expect.objectContaining({ id: 'bld-library', title: 'Library', floorCount: 2 }),
      expect.objectContaining({ id: 'bld-science', title: 'Science Hall', floorCount: 1 }),
    ])
    expect(content.featuredPlaces.every((place) => place.id.startsWith('bld-'))).toBe(true)
  })

  it('normalizes announcement priority without treating ordinary content as emergency', () => {
    expect(normalizeAnnouncementPriority('warning')).toBe('warning')
    expect(normalizeAnnouncementPriority('emergency')).toBe('emergency')
    expect(normalizeAnnouncementPriority('red')).toBe('info')
    expect(normalizeAnnouncementPriority(undefined)).toBe('info')
  })

  it('filters inactive announcements and retains safe building location IDs only', () => {
    const announcements: HomeAnnouncementInput[] = [
      {
        id: 'notice',
        title: 'Library hours',
        description: 'Check the public campus map for the library.',
        priority: 'info',
        location: { buildingId: 'bld-library' },
        active: true,
      },
      {
        id: 'invented-location',
        title: 'Unknown place',
        description: 'Should not claim a location.',
        priority: 'warning',
        location: { buildingId: 'not-in-campus' },
        active: true,
      },
      {
        id: 'hidden',
        title: 'Hidden',
        description: 'Not visible.',
        active: false,
      },
    ]

    const content = buildHomeContent({
      buildings: [building({ id: 'bld-library', name: 'Library' })],
      announcements,
    })

    expect(content.announcements).toHaveLength(2)
    expect(content.announcements[0].location).toEqual({ buildingId: 'bld-library' })
    expect(content.announcements[1].location).toBeUndefined()
  })

  it('formats recent destinations with existing building and floor context', () => {
    const buildings = [building({ id: 'bld-main', name: 'Main Building' })]
    const nodes = [node()]
    const searchEntries: SearchEntry[] = [
      { id: 'entry-101', label: 'Registrar Office', type: 'room', nodeId: 'node-101', buildingId: 'bld-main', floor: 1 },
    ]

    expect(buildRecentDestination('node-101', { buildings, nodes, searchEntries })).toEqual({
      nodeId: 'node-101',
      label: 'Registrar Office',
      buildingId: 'bld-main',
      buildingName: 'Main Building',
      floor: 1,
      floorLabel: 'Floor 1',
    })
  })

  it('filters stale recent IDs while preserving valid node ids and search-entry ids', () => {
    expect(reconcileRecentDestinationIds(
      ['stale-node', 'node-101', 'node-101'],
      { buildings: [], nodes: [node()], searchEntries: [] },
    )).toEqual(['node-101'])

    expect(buildRecentDestination('node-101', { buildings: [], nodes: [node()], searchEntries: [] })).toMatchObject({
      nodeId: 'node-101',
      label: 'Room 101',
    })
  })
})
