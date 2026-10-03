/**
 * Public-app contracts that are intentionally independent from the visual
 * remodel. These values describe what a surface may do; components decide how
 * to present them.
 */

export const PRIMARY_NAV_ITEMS = [
  { id: 'home', label: 'Home', path: '/map/home' },
  { id: 'explore', label: 'Explore', path: '/map/explore' },
  { id: 'navigate', label: 'Navigate', path: '/map/navigate' },
  { id: 'profile', label: 'Profile', path: '/map/profile' },
] as const

export type PrimaryNavId = (typeof PRIMARY_NAV_ITEMS)[number]['id']

export const PRIMARY_NAV_PATHS: Record<PrimaryNavId, string> = {
  home: '/map/home',
  explore: '/map/explore',
  navigate: '/map/navigate',
  profile: '/map/profile',
}

/** Campuses is a secondary settings/selection surface, not a primary tab. */
export const CAMPUSES_PATH = '/map/maps'

/** Public routes that own their URL without becoming primary navigation tabs. */
export const SECONDARY_PUBLIC_PATHS = [
  CAMPUSES_PATH,
  '/map/search',
  '/map/panoramas',
] as const

export function isSecondaryPublicPath(pathname: string): boolean {
  return SECONDARY_PUBLIC_PATHS.some((path) => (
    pathname === path || pathname.startsWith(`${path}/`)
  ))
}

export type MapAppearanceMode = 'department' | 'navi' | 'uniform'
export const DEFAULT_MAP_APPEARANCE: MapAppearanceMode = 'department'

export interface BuildingPresentationOptions {
  /** Null means the user has no preference and published defaults may apply. */
  userPreference?: MapAppearanceMode | null
  publishedDefaultMode?: MapAppearanceMode | null
  authoredColor?: string | null
  publishedDefaultColor?: string | null
  accessibilityColor?: string | null
  navigationEmphasis?: boolean
  navigationColor?: string | null
}

/**
 * Resolve a presentation color without changing the authored/published input.
 * The precedence is navigation > accessibility > user preference > published
 * default > authored/default. The returned color is a view-model value only.
 */
export function resolveBuildingPresentationColor(
  options: BuildingPresentationOptions,
): string {
  if (options.navigationEmphasis) {
    return options.navigationColor ?? '#0F6B3A'
  }
  if (options.accessibilityColor) return options.accessibilityColor

  const hasUserPreference = options.userPreference !== undefined && options.userPreference !== null
  const mode = hasUserPreference
    ? options.userPreference!
    : options.publishedDefaultMode ?? DEFAULT_MAP_APPEARANCE

  // A published color is the published default when no user preference exists.
  if (!hasUserPreference && options.publishedDefaultColor) {
    return options.publishedDefaultColor
  }

  if (mode === 'navi') return '#0F6B3A'
  if (mode === 'uniform') return '#CBD5E1'
  return options.authoredColor ?? options.publishedDefaultColor ?? '#94A3B8'
}

export interface CampusSelectionState {
  currentCampusId: string | null
  defaultCampusId: string | null
}

export function selectCurrentCampus(
  state: CampusSelectionState,
  campusId: string | null,
): CampusSelectionState {
  return { ...state, currentCampusId: campusId }
}

export function setDefaultCampus(
  state: CampusSelectionState,
  campusId: string | null,
): CampusSelectionState {
  return { ...state, defaultCampusId: campusId }
}

export type PublicMapContext = 'outdoors' | 'building' | 'active-navigation'

export function shouldShowFloorControl(input: {
  context: PublicMapContext
  indoorActive?: boolean
  routeFloors?: number[]
}): boolean {
  if (input.context === 'outdoors') return false
  if (input.context === 'building') return input.indoorActive === true
  return (input.routeFloors?.length ?? 0) > 0
}

export function resolveDisplayedFloor(input: {
  activeNavigation: boolean
  routeFloor?: number | null
  viewedFloor?: number | null
  fallbackFloor?: number | null
}): number | null {
  if (input.activeNavigation && input.routeFloor !== undefined && input.routeFloor !== null) {
    return input.routeFloor
  }
  return input.viewedFloor ?? input.fallbackFloor ?? null
}

export type PanoramaSurface = 'explore' | 'building-details' | 'route-preview' | 'active-navigation'

export function canOpenPanorama(surface: PanoramaSurface): boolean {
  return surface !== 'active-navigation'
}

export type PublicCampusRuntimeSource = 'published_maps' | 'graph_snapshots'

export interface CampusAvailability {
  campusId: string
  listed: boolean
  runtimeCampusId: string | null
  runtimeSource: PublicCampusRuntimeSource | null
}

/**
 * The selector and runtime endpoint must agree on the campus identity before a
 * campus is advertised as selectable. This is a client-side contract only;
 * endpoint source unification remains a later backend task.
 */
export function isCampusSelectable(input: CampusAvailability): boolean {
  return Boolean(
    input.listed
      && input.runtimeCampusId === input.campusId
      && input.runtimeSource !== null,
  )
}
