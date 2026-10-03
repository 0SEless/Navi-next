import { describe, expect, it } from 'vitest'
import {
  CAMPUSES_PATH,
  DEFAULT_MAP_APPEARANCE,
  PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_PATHS,
  canOpenPanorama,
  isCampusSelectable,
  resolveBuildingPresentationColor,
  resolveDisplayedFloor,
  selectCurrentCampus,
  setDefaultCampus,
  shouldShowFloorControl,
} from '../public-app-contracts'

describe('public primary navigation contract', () => {
  it('keeps Campuses secondary while exposing exactly four primary destinations', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.id)).toEqual([
      'home',
      'explore',
      'navigate',
      'profile',
    ])
    expect(PRIMARY_NAV_ITEMS.map((item) => item.path)).toEqual([
      '/map/home',
      '/map/explore',
      '/map/navigate',
      '/map/profile',
    ])
    expect(CAMPUSES_PATH).toBe('/map/maps')
    expect(PRIMARY_NAV_PATHS.profile).toBe('/map/profile')
  })
})

describe('presentation-only building appearance contract', () => {
  it('defaults to department colors and does not mutate the input', () => {
    const options = Object.freeze({
      authoredColor: '#AABBCC',
      userPreference: undefined,
    })

    expect(DEFAULT_MAP_APPEARANCE).toBe('department')
    expect(resolveBuildingPresentationColor(options)).toBe('#AABBCC')
    expect(options.authoredColor).toBe('#AABBCC')
  })

  it('supports only the department, navi, and uniform presentation modes', () => {
    expect(resolveBuildingPresentationColor({ userPreference: 'department', authoredColor: '#112233' })).toBe('#112233')
    expect(resolveBuildingPresentationColor({ userPreference: 'navi', authoredColor: '#112233' })).toBe('#0F6B3A')
    expect(resolveBuildingPresentationColor({ userPreference: 'uniform', authoredColor: '#112233' })).toBe('#CBD5E1')
  })

  it('applies navigation and accessibility overrides before user preference', () => {
    expect(resolveBuildingPresentationColor({
      userPreference: 'uniform',
      accessibilityColor: '#123456',
      navigationEmphasis: true,
    })).toBe('#0F6B3A')
    expect(resolveBuildingPresentationColor({
      userPreference: 'uniform',
      accessibilityColor: '#123456',
    })).toBe('#123456')
  })

  it('uses a published default before the authored fallback when no preference exists', () => {
    expect(resolveBuildingPresentationColor({
      userPreference: null,
      publishedDefaultMode: 'uniform',
      publishedDefaultColor: '#445566',
      authoredColor: '#AABBCC',
    })).toBe('#445566')
  })
})

describe('campus identity contract', () => {
  it('changes current campus without changing the default campus', () => {
    const initial = { currentCampusId: 'campus-a', defaultCampusId: 'campus-a' }
    expect(selectCurrentCampus(initial, 'campus-b')).toEqual({
      currentCampusId: 'campus-b',
      defaultCampusId: 'campus-a',
    })
  })

  it('changes the default campus without changing the current campus', () => {
    const initial = { currentCampusId: 'campus-a', defaultCampusId: 'campus-a' }
    expect(setDefaultCampus(initial, 'campus-b')).toEqual({
      currentCampusId: 'campus-a',
      defaultCampusId: 'campus-b',
    })
  })
})

describe('floor, panorama, and campus availability contracts', () => {
  it('does not show a permanent floor selector outdoors', () => {
    expect(shouldShowFloorControl({ context: 'outdoors', routeFloors: [] })).toBe(false)
  })

  it('shows floor controls for an indoor building or active multi-floor route', () => {
    expect(shouldShowFloorControl({ context: 'building', indoorActive: true })).toBe(true)
    expect(shouldShowFloorControl({ context: 'active-navigation', routeFloors: [3, 1] })).toBe(true)
  })

  it('keeps an active navigation floor route-authoritative over manual inspection', () => {
    expect(resolveDisplayedFloor({
      activeNavigation: true,
      routeFloor: 3,
      viewedFloor: 1,
    })).toBe(3)
    expect(resolveDisplayedFloor({
      activeNavigation: false,
      routeFloor: 3,
      viewedFloor: 1,
    })).toBe(1)
  })

  it('allows panoramas in Explore/details but not during active navigation', () => {
    expect(canOpenPanorama('explore')).toBe(true)
    expect(canOpenPanorama('building-details')).toBe(true)
    expect(canOpenPanorama('active-navigation')).toBe(false)
  })

  it('selects only campuses whose catalog and runtime identities agree', () => {
    expect(isCampusSelectable({
      campusId: 'campus-a',
      listed: true,
      runtimeCampusId: 'campus-a',
      runtimeSource: 'published_maps',
    })).toBe(true)
    expect(isCampusSelectable({
      campusId: 'campus-a',
      listed: true,
      runtimeCampusId: 'campus-b',
      runtimeSource: 'graph_snapshots',
    })).toBe(false)
    expect(isCampusSelectable({
      campusId: 'campus-a',
      listed: true,
      runtimeCampusId: null,
      runtimeSource: null,
    })).toBe(false)
  })
})
