import type { PanoramaEntry } from '@navi/core'
import type { NavigationContextValue } from '@/components/map/NavigationContext'
import type { Building, CampusBundle, SearchEntry } from '@/types/nav-types'
import {
  resolveBuildingPresentationColor,
  type MapAppearanceMode,
  type PublicMapContext,
} from './public-app-contracts'

export type ExploreCategory = 'all' | SearchEntry['type']

export interface ExploreContextInput {
  parentContext?: NavigationContextValue | null
  selectedBuildingId?: string | null
  indoorContext?: {
    active: boolean
    buildingId?: string
    floorId?: number
  }
  activeFloor?: number | null
}

export interface ExploreContext {
  surface: PublicMapContext
  buildingId?: string
  floor?: number
  indoorActive: boolean
  routeFloors: number[]
  navigationSegment?: NavigationContextValue['navigationSegment']
  currentNodeId?: string | null
}

function finiteFloor(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function floorFromData(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return finiteFloor(record.floor ?? record.level)
}

/** Return only floors published for the requested building, ordered top-down. */
export function getExploreFloors(bundle: CampusBundle, buildingId: string | null | undefined): number[] {
  if (!buildingId) return []
  const building = bundle.buildings.find(candidate => candidate.id === buildingId)
  if (!building) return []

  const floors = new Set<number>()
  for (const floor of building.floors) {
    const normalized = finiteFloor(floor)
    if (normalized !== null) floors.add(normalized)
  }
  for (const floorData of building.floorData ?? []) {
    const normalized = floorFromData(floorData)
    if (normalized !== null) floors.add(normalized)
  }
  return [...floors].sort((a, b) => b - a)
}

/** Return category values actually represented by the published search index. */
export function getExploreCategories(bundle: CampusBundle): SearchEntry['type'][] {
  const supportedOrder: SearchEntry['type'][] = ['building', 'room', 'facility', 'entrance', 'poi']
  const available = new Set(bundle.searchEntries.map(entry => entry.type))
  return supportedOrder.filter(category => available.has(category))
}

function tokenizeExploreQuery(value: string): string[] {
  return value.split(/[\s,_\-:;,.!?]+/).filter(Boolean)
}

export function filterExploreEntries(
  bundle: CampusBundle,
  input: {
    query?: string
    category?: ExploreCategory
    buildingId?: string | null
  } = {},
): SearchEntry[] {
  const query = input.query?.trim().toLowerCase() ?? ''
  const queryTokens = tokenizeExploreQuery(query)
  return bundle.searchEntries.filter((entry) => {
    if (input.category && input.category !== 'all' && entry.type !== input.category) return false
    if (input.buildingId && entry.buildingId !== input.buildingId) return false

    if (!query) return true
    const haystack = [entry.label, ...(entry.tags ?? []), entry.category ?? ''].join(' ').toLowerCase()
    return queryTokens.every(token => haystack.includes(token))
  })
}

/**
 * Parent navigation state is authoritative whenever the map is rendered inside
 * the existing navigation lifecycle. Explore-local selection is used only for
 * the standalone public map.
 */
export function resolveExploreContext(input: ExploreContextInput): ExploreContext {
  const parent = input.parentContext
  if (parent?.route) {
    const routeFloors = [...new Set(
      parent.route.nodeFloors.length > 0
        ? parent.route.nodeFloors
        : parent.route.steps.map(step => step.floor),
    )].sort((a, b) => b - a)
    return {
      surface: 'active-navigation',
      buildingId: parent.buildingId,
      floor: parent.floor,
      indoorActive: Boolean(parent.buildingId),
      routeFloors,
      navigationSegment: parent.navigationSegment,
      currentNodeId: parent.currentNodeId,
    }
  }

  const indoorBuildingId = input.indoorContext?.buildingId ?? input.selectedBuildingId ?? undefined
  const indoorActive = Boolean(input.indoorContext?.active && indoorBuildingId)
  if (indoorActive) {
    return {
      surface: 'building',
      buildingId: indoorBuildingId,
      floor: input.indoorContext?.floorId ?? input.activeFloor ?? undefined,
      indoorActive: true,
      routeFloors: [],
    }
  }

  return {
    surface: 'outdoors',
    indoorActive: false,
    routeFloors: [],
  }
}

export function resolveExploreBuildingColor(
  building: Pick<Building, 'color'>,
  mode: MapAppearanceMode,
): string {
  return resolveBuildingPresentationColor({
    userPreference: mode,
    authoredColor: building.color,
  })
}

/**
 * Resolve a destination only from the published public search index. In
 * particular, this deliberately does not fall back to an entrance or the
 * first graph node when a building destination entry is absent.
 */
export function resolveStableExploreDestination(
  bundle: CampusBundle,
  input: { entryId?: string; buildingId?: string },
): Pick<SearchEntry, 'id' | 'nodeId' | 'type'> | null {
  const entry = input.entryId
    ? bundle.searchEntries.find(candidate => candidate.id === input.entryId)
    : bundle.searchEntries.find((candidate) => {
        if (candidate.type !== 'building' || !input.buildingId) return false
        return candidate.buildingId === input.buildingId || candidate.id === input.buildingId
      })

  if (!entry || !entry.nodeId || !entry.nodeId.trim()) return null
  return { id: entry.id, nodeId: entry.nodeId, type: entry.type }
}

export function getAvailablePanoramas(
  bundle: CampusBundle,
  buildingId?: string | null,
): readonly PanoramaEntry[] {
  return (bundle.panoramaIndex?.panoramas ?? []).filter((panorama) => {
    if (!panorama.imageAssetId.trim()) return false
    if (buildingId && panorama.buildingId !== buildingId) return false
    return true
  })
}
