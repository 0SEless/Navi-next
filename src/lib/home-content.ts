import type { Building, NavNode, SearchEntry } from '@/types/nav-types'

export type HomeAction =
  | { type: 'search'; label: string }
  | { type: 'explore'; label: string; buildingId?: string }
  | { type: 'navigate'; label: string; nodeId: string }

export interface HomeHeroInput {
  id: string
  title: string
  subtitle?: string
  image?: string
  imageAlt?: string
  order?: number
  active?: boolean
  action?: HomeAction
  startsAt?: string
  endsAt?: string
}

export interface HomeHeroSlide extends HomeHeroInput {
  subtitle: string
  active: true
}

export type HomeAnnouncementPriority = 'info' | 'warning' | 'emergency'

export interface HomeAnnouncementLocation {
  buildingId: string
  label?: string
}

export interface HomeAnnouncementInput {
  id: string
  title: string
  description: string
  image?: string
  date?: string
  priority?: string
  location?: HomeAnnouncementLocation
  active?: boolean
  startsAt?: string
  endsAt?: string
}

export interface HomeAnnouncement extends HomeAnnouncementInput {
  priority: HomeAnnouncementPriority
  active: true
  location?: HomeAnnouncementLocation
}

export interface HomeFeaturedPlace {
  id: string
  title: string
  subtitle: string
  description?: string
  floorCount: number
  image?: string
}

export interface HomeRecentDestination {
  nodeId: string
  label: string
  buildingId?: string
  buildingName?: string
  floor?: number
  floorLabel?: string
}

export interface HomeCampusSource {
  buildings: readonly Building[]
  nodes: readonly NavNode[]
  searchEntries: readonly SearchEntry[]
}

export interface HomeContentInput {
  campusName?: string | null
  campusId?: string | null
  buildings?: readonly Building[] | null
  nodes?: readonly NavNode[] | null
  searchEntries?: readonly SearchEntry[] | null
  heroes?: readonly HomeHeroInput[] | null
  announcements?: readonly HomeAnnouncementInput[] | null
  now?: Date
}

export interface HomeContent {
  campusName: string
  heroSlides: HomeHeroSlide[]
  featuredPlaces: HomeFeaturedPlace[]
  announcements: HomeAnnouncement[]
  usesFallbackHero: boolean
  usesFallbackAnnouncements: boolean
}

const FALLBACK_CAMPUS_NAME = 'Your campus'

const FALLBACK_HERO: HomeHeroInput = {
  id: 'campus-overview',
  title: 'Your campus map',
  subtitle: 'Find buildings, rooms, and campus services in one place.',
  order: 0,
  active: true,
  action: { type: 'explore', label: 'Explore campus' },
}

const FALLBACK_ANNOUNCEMENT: HomeAnnouncementInput = {
  id: 'campus-map-available',
  title: 'Campus information',
  description: 'Browse the public campus map to see available buildings and destinations.',
  priority: 'info',
  active: true,
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Resolve only an explicit display label. A campus id is identity, not a
 * human-readable name, so an exact id match falls back to neutral copy.
 */
export function resolveCampusDisplayName(value: unknown, campusId?: string | null): string {
  const candidate = asNonEmptyString(value)
  const identity = asNonEmptyString(campusId)
  if (!candidate || (identity && candidate === identity)) return FALLBACK_CAMPUS_NAME
  return candidate
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function isActiveInWindow(
  item: { active?: boolean; startsAt?: string; endsAt?: string },
  now: Date,
): boolean {
  if (item.active === false) return false
  const nowTime = now.getTime()
  const startsAt = parseDate(item.startsAt)
  const endsAt = parseDate(item.endsAt)
  if (startsAt !== null && nowTime < startsAt) return false
  if (endsAt !== null && nowTime > endsAt) return false
  return true
}

function sortByOrder<T extends { id: string; order?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const orderDifference = (a.order ?? 0) - (b.order ?? 0)
    return orderDifference || a.id.localeCompare(b.id)
  })
}

function normalizeHero(input: HomeHeroInput): HomeHeroSlide | null {
  const id = asNonEmptyString(input.id)
  const title = asNonEmptyString(input.title)
  if (!id || !title) return null

  const subtitle = asNonEmptyString(input.subtitle) ?? ''
  const image = asNonEmptyString(input.image)
  const imageAlt = asNonEmptyString(input.imageAlt) ?? (image ? `${title} campus highlight` : undefined)

  return {
    ...input,
    id,
    title,
    subtitle,
    ...(image ? { image } : { image: undefined }),
    ...(imageAlt ? { imageAlt } : { imageAlt: undefined }),
    active: true,
  }
}

function normalizeAnnouncement(
  input: HomeAnnouncementInput,
  buildings: ReadonlyMap<string, Building>,
): HomeAnnouncement | null {
  const id = asNonEmptyString(input.id)
  const title = asNonEmptyString(input.title)
  const description = asNonEmptyString(input.description)
  if (!id || !title || !description) return null

  const buildingId = asNonEmptyString(input.location?.buildingId)
  const location = buildingId && buildings.has(buildingId)
    ? {
        buildingId,
        ...(asNonEmptyString(input.location?.label)
          ? { label: asNonEmptyString(input.location?.label) }
          : {}),
      }
    : undefined

  const image = asNonEmptyString(input.image)
  const date = asNonEmptyString(input.date)

  return {
    ...input,
    id,
    title,
    description,
    ...(image ? { image } : { image: undefined }),
    ...(date ? { date } : { date: undefined }),
    priority: normalizeAnnouncementPriority(input.priority),
    ...(location ? { location } : { location: undefined }),
    active: true,
  }
}

export function normalizeAnnouncementPriority(value: string | undefined): HomeAnnouncementPriority {
  if (value === 'warning' || value === 'emergency') return value
  return 'info'
}

function fallbackHero(): HomeHeroSlide[] {
  return [normalizeHero(FALLBACK_HERO) as HomeHeroSlide]
}

function fallbackAnnouncements(): HomeAnnouncement[] {
  return [
    normalizeAnnouncement(FALLBACK_ANNOUNCEMENT, new Map<string, Building>()) as HomeAnnouncement,
  ]
}

function featuredPlaces(buildings: readonly Building[]): HomeFeaturedPlace[] {
  return buildings
    .filter((building) => asNonEmptyString(building.id) && asNonEmptyString(building.name))
    .map((building) => {
      const subtitle = [asNonEmptyString(building.code), asNonEmptyString(building.category)]
        .filter(Boolean)
        .join(' · ')

      return {
        id: building.id,
        title: building.name,
        subtitle: subtitle || 'Campus building',
        ...(asNonEmptyString(building.description) ? { description: building.description } : {}),
        floorCount: Array.isArray(building.floors) ? building.floors.length : 0,
      }
    })
}

export function buildHomeContent(input: HomeContentInput = {}): HomeContent {
  const now = input.now ?? new Date()
  const buildings = input.buildings ?? []
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const campusName = resolveCampusDisplayName(input.campusName, input.campusId)

  const heroSlides = sortByOrder(
    (input.heroes ?? [])
      .filter((hero) => isActiveInWindow(hero, now))
      .map(normalizeHero)
      .filter((hero): hero is HomeHeroSlide => hero !== null),
  )
  const announcements = (input.announcements ?? [])
    .filter((announcement) => isActiveInWindow(announcement, now))
    .map((announcement) => normalizeAnnouncement(announcement, buildingById))
    .filter((announcement): announcement is HomeAnnouncement => announcement !== null)

  return {
    campusName,
    heroSlides: heroSlides.length > 0 ? heroSlides : fallbackHero(),
    featuredPlaces: featuredPlaces(buildings),
    announcements: announcements.length > 0 ? announcements : fallbackAnnouncements(),
    usesFallbackHero: heroSlides.length === 0,
    usesFallbackAnnouncements: announcements.length === 0,
  }
}

/** Keep persisted destination ids that still belong to the active bundle. */
export function reconcileRecentDestinationIds(
  ids: readonly string[],
  source: HomeCampusSource,
): string[] {
  const knownNodeIds = new Set(source.nodes.map((node) => node.id))
  for (const entry of source.searchEntries) {
    if (entry.nodeId) knownNodeIds.add(entry.nodeId)
  }

  const seen = new Set<string>()
  return ids.filter((id) => {
    if (!knownNodeIds.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function prettifyNodeId(nodeId: string): string {
  return nodeId
    .split('-')
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
}

export function buildRecentDestination(nodeId: string, source: HomeCampusSource): HomeRecentDestination {
  const node = source.nodes.find((candidate) => candidate.id === nodeId)
  const entry = source.searchEntries.find((candidate) => candidate.nodeId === nodeId)
  const buildingId = node?.buildingId || entry?.buildingId
  const building = buildingId ? source.buildings.find((candidate) => candidate.id === buildingId) : undefined
  const floor = node?.floor ?? entry?.floor

  return {
    nodeId,
    label: entry?.label || node?.label || prettifyNodeId(nodeId),
    ...(building ? { buildingId: building.id, buildingName: building.name } : {}),
    ...(typeof floor === 'number' ? { floor, floorLabel: `Floor ${floor}` } : {}),
  }
}
