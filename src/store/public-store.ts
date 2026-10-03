'use client'

import { create } from 'zustand'
import { getCanonicalCampusId } from '@/lib/canonical-campus'
import type {
  Building,
  BuildingEntrance,
  NavNode,
  NavEdge,
  Component,
  DoorData,
  LatLng,
  SearchEntry,
  CampusBundle,
  CampusPOI,
  TracePath,
} from '@/types/nav-types'
import type { NavRoute } from '@/types/route-types'
import type { PrimaryNavId } from '@/lib/public-app-contracts'
import {
  loadPublicPreferences,
  mergePublicPreferences,
  savePublicPreferences,
  type AccessibilityPreferences,
  type NavigationPreferences,
  type PublicPreferences,
  type ThemePreference,
} from '@/lib/public-preferences'
import { findNavRoute, findPoiNavRoute } from '@/lib/findRoute'
import { reconcileRecentDestinationIds } from '@/lib/home-content'
import {
  getWorldPointOfInterestRepresentative,
  isValidRoadEdgeRouting,
  SpatialQueryService,
  validateWorldPointOfInterestGeometry,
} from '@navi/core'
import type { FloorGeometryArtifact, PanoramaIndex, QrIndex, RoadType, WorldPOIGeometry } from '@navi/core'
import type { QrLocation } from '@/lib/qr-location'
import {
  normalizePublicCampusResult,
  isUsablePublicCampusBundle,
  type PublicCampusResult,
} from '@/features/public-campus/types'
import {
  indexedDbCampusCacheRepository,
  validateCachedCampus,
  type CachedCampus,
  type CampusCacheRepository,
} from '@/features/public-campus/cache'

export type { CampusBundle, SearchEntry } from '@/types/nav-types'

export type TabId = PrimaryNavId

export type SheetState = 'collapsed' | 'half' | 'full' | 'hidden'
export type MapMode = 'explore' | 'navigate'
export type CampusSource = 'supabase' | 'demo' | 'published_maps' | 'graph_snapshots' | 'empty'

/** Payload from GET /api/public-campus — a partial GraphSnapshot. */
export interface CampusData {
  campusId: string
  campusName?: string
  source: CampusSource
  buildings: Building[]
  components: Component[]
  doors?: DoorData[]
  nodes: NavNode[]
  edges: NavEdge[]
  boundary?: { points: LatLng[] } | null
}

export type CampusStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PoiDestinationRequest {
  destinationType: 'poi'
  poiId: string
}

/** Explicit indoor context — replaces zoom-driven indoor visibility (W16C). */
export interface IndoorContext {
  /** Whether user is inside a building/floor context. */
  active: boolean
  /** The building the user has entered. */
  buildingId?: string
  /** The floor the user is viewing. */
  floorId?: number
}

export interface PublicState {
  activeTab: TabId
  sheetState: SheetState
  mapMode: MapMode
  fromNode: string | null
  toNode: string | null
  poiDestination: PoiDestinationRequest | null
  selectedBuilding: Building | null
  selectedNode: NavNode | null

  /** Campus currently hydrated for browsing/navigation. */
  currentCampusId: string | null
  /** Campus chosen as the user's default; temporary switches must not change it. */
  defaultCampusId: string | null

  /** Guest-safe presentation preferences; never part of CampusBundle data. */
  preferences: PublicPreferences

  campusData: CampusData | null
  campusStatus: CampusStatus
  campusError: string | null
  activeFloor: number

  /** W16C: Explicit indoor context — gates indoor layer visibility. */
  indoorContext: IndoorContext

  /** Parsed, validated public data bundle (from /api/public-campus or demo artifacts). */
  campus: CampusBundle | null
  /** Explicit origin resolved from a QR checkpoint; separate from stored campus preference. */
  qrLocation: QrLocation | null
  campusLoading: boolean
  /** Origin of the currently hydrated bundle, independent from server sync state. */
  campusOrigin: 'cache' | 'network' | null
  campusRevision: string | null
  /** True only while the authoritative network refresh is pending. */
  isRefreshing: boolean
  refreshError: string | null

  recentDestinations: string[]    // node IDs, max 8
  recentSearches: string[]        // query strings, max 8
  /** Transient ids temporarily revealed by the current public search. */
  revealedPoiIds: string[]
  onboardingComplete: boolean

  setTab: (tab: TabId) => void
  setSheet: (state: SheetState) => void
  setMapMode: (mode: MapMode) => void
  setFrom: (nodeId: string | null) => void
  setQrLocation: (location: QrLocation | null) => void
  setTo: (nodeId: string | null) => void
  setPoiDestination: (poiId: string | null) => void
  setDefaultCampus: (campusId: string | null) => void
  setTheme: (theme: ThemePreference) => void
  setMapAppearance: (mode: PublicPreferences['mapAppearance']) => void
  setNotifications: (enabled: boolean) => void
  setNavigationPreferences: (preferences: Partial<NavigationPreferences>) => void
  setAccessibilityPreferences: (preferences: Partial<AccessibilityPreferences>) => void
  selectBuilding: (b: Building | null) => void
  selectNode: (n: NavNode | null) => void
  setActiveFloor: (floor: number) => void
  /** W16C: Enter indoor mode for a specific building and floor. */
  enterIndoorContext: (buildingId: string, floorId: number) => void
  /** W16C: Exit indoor mode, return to campus mode. */
  exitIndoorContext: () => void
  fetchCampusData: (campusId?: string) => Promise<void>
  search: (query: string) => SearchEntry[]
  setRevealedPoiIds: (ids: string[]) => void
  clearRevealedPoiIds: () => void
  findRoute: (fromId: string, toId: string) => NavRoute | null
  findDestinationRoute: (fromId: string) => NavRoute | null
  nearestNode: (latlng: LatLng, maxDistanceMeters?: number) => NavNode | null
  addRecentDestination: (nodeId: string) => void
  clearRecentDestinations: () => void
  addRecentSearch: (query: string) => void
  completeOnboarding: () => void
  resetOnboarding: () => void
}

export interface PublicStoreDependencies {
  cache?: CampusCacheRepository
}

const RECENT_DEST_KEY = 'navi-recent-destinations'
const RECENT_DEST_BY_CAMPUS_KEY = 'navi-recent-destinations-by-campus'
const RECENT_SEARCH_KEY = 'navi-recent-searches'
const ONBOARDING_KEY = 'navi-onboarded'
const DEFAULT_CAMPUS_KEY = 'navi-default-campus'
const LEGACY_CAMPUS_KEY = 'navi-selected-campus'
const DEFAULT_CAMPUS_CONFIG_KEY = 'navi-default-campus-config'
const MAX_RECENT = 8

function loadDefaultCampusId(): string {
  const canonicalCampusId = getCanonicalCampusId()
  if (typeof window === 'undefined') return canonicalCampusId
  try {
    const savedCampusId = localStorage.getItem(DEFAULT_CAMPUS_KEY)
      || localStorage.getItem(LEGACY_CAMPUS_KEY)
    const savedCanonicalCampusId = localStorage.getItem(DEFAULT_CAMPUS_CONFIG_KEY)
    return savedCampusId && savedCanonicalCampusId === canonicalCampusId
      ? savedCampusId
      : canonicalCampusId
  } catch { return canonicalCampusId }
}

function saveDefaultCampusId(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id === null) {
      localStorage.removeItem(DEFAULT_CAMPUS_KEY)
      localStorage.removeItem(LEGACY_CAMPUS_KEY)
      localStorage.removeItem(DEFAULT_CAMPUS_CONFIG_KEY)
    } else {
      localStorage.setItem(DEFAULT_CAMPUS_KEY, id)
      // Keep older public sessions compatible with the renamed setting.
      localStorage.setItem(LEGACY_CAMPUS_KEY, id)
      localStorage.setItem(DEFAULT_CAMPUS_CONFIG_KEY, getCanonicalCampusId())
    }
  } catch {}
}

function loadArray(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch { return [] }
}

function saveArray(key: string, arr: string[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(arr))
}

type RecentDestinationByCampus = Record<string, string[]>

function loadRecentDestinationsByCampus(): RecentDestinationByCampus {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(RECENT_DEST_BY_CAMPUS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Array.isArray(value))
        .map(([campusId, value]) => [
          campusId,
          (value as unknown[]).filter((item): item is string => typeof item === 'string'),
        ]),
    )
  } catch {
    return {}
  }
}

function saveRecentDestinationsByCampus(value: RecentDestinationByCampus) {
  if (typeof window === 'undefined') return
  localStorage.setItem(RECENT_DEST_BY_CAMPUS_KEY, JSON.stringify(value))
}

function campusDestinationSource(bundle: CampusBundle) {
  return {
    buildings: bundle.buildings,
    nodes: bundle.nodes,
    searchEntries: bundle.searchEntries,
  }
}

function loadRecentDestinationsForCampus(campusId: string, bundle: CampusBundle): string[] {
  const byCampus = loadRecentDestinationsByCampus()
  const hasCampusHistory = Object.prototype.hasOwnProperty.call(byCampus, campusId)
  const candidates = hasCampusHistory ? byCampus[campusId] : loadArray(RECENT_DEST_KEY)
  const reconciled = reconcileRecentDestinationIds(candidates ?? [], campusDestinationSource(bundle)).slice(0, MAX_RECENT)

  // One-time migration from the old global list. It is intentionally filtered
  // against the first active bundle rather than assigned to another campus.
  if (!hasCampusHistory || JSON.stringify(byCampus[campusId]) !== JSON.stringify(reconciled)) {
    byCampus[campusId] = reconciled
    saveRecentDestinationsByCampus(byCampus)
  }
  saveArray(RECENT_DEST_KEY, reconciled)
  return reconciled
}

function saveRecentDestinationsForCampus(campusId: string, ids: string[]) {
  const byCampus = loadRecentDestinationsByCampus()
  byCampus[campusId] = ids
  saveRecentDestinationsByCampus(byCampus)
  // Preserve compatibility for older clients while the active state remains
  // explicitly scoped by the namespaced record above.
  saveArray(RECENT_DEST_KEY, ids)
}

// ---- Pure helpers (exported for tests and for the store actions) ----

export function search(entries: SearchEntry[], query: string, limit = 20): SearchEntry[] {
  const q = query.trim().toLowerCase()
  const tokens = q.split(/[\s,_\-:;,.!?]+/).filter(Boolean)
  if (!q || tokens.length === 0 || entries.length === 0) return []
  const scored: Array<{ entry: SearchEntry; rank: number }> = []
  for (const entry of entries) {
    const label = (entry.label ?? '').toLowerCase()
    const tags = [
      ...(entry.tags ?? []),
      ...(entry.category ? [entry.category] : []),
    ].map((tag) => tag.toLowerCase())
    const matchesAllTokens = tokens.every((token) =>
      label.includes(token) || tags.some((tag) => tag.includes(token)),
    )
    if (!matchesAllTokens) continue
    if (label.startsWith(q)) scored.push({ entry, rank: 0 })
    else if (label.includes(q)) scored.push({ entry, rank: 1 })
    else scored.push({ entry, rank: 2 })
  }
  scored.sort((a, b) => a.rank - b.rank)
  return scored.slice(0, limit).map((s) => s.entry)
}

export function findRoute(
  nodes: NavNode[],
  edges: NavEdge[],
  fromId: string,
  toId: string,
): NavRoute | null {
  return findNavRoute(nodes, edges, fromId, toId)
}

export function nearestNode(
  nodes: NavNode[],
  latlng: LatLng,
  maxDistanceMeters = 50,
): NavNode | null {
  const svc = new SpatialQueryService()
  svc.loadFromNodes(nodes as unknown as Array<{ id: string; position: LatLng; type?: string; floor?: number; buildingId?: string; [key: string]: unknown }>)
  const result = svc.nearestEntity(latlng, { maxDistance: maxDistanceMeters })
  if (!result) return null
  return nodes.find(n => n.id === result.entity.id) ?? null
}

// ---- Defensive artifact parsing (see errors/ERRORS.md: Array.isArray guards) ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalizeCampusDisplayName(value: unknown, campusId: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  if (!name || name === campusId) return undefined
  return name
}

const VALID_NODE_TYPES = new Set<NavNode['type']>([
  'room', 'room_door', 'walkway', 'stair', 'elevator', 'entrance', 'qr_marker', 'corner',
  'staircase', 'intersection', 'building_entrance', 'outdoor', 'hallway', 'connector_stop',
])

const NODE_TYPE_MAP: Record<string, NavNode['type']> = {
  space: 'room',
  corridor: 'walkway',
  transition: 'building_entrance',
}

function mapNodeType(raw: unknown): NavNode['type'] {
  if (typeof raw === 'string') {
    if (VALID_NODE_TYPES.has(raw as NavNode['type'])) return raw as NavNode['type']
    const mapped = NODE_TYPE_MAP[raw]
    if (mapped) return mapped
  }
  return 'room'
}

function normalizeNode(raw: unknown, campusId: string): NavNode | null {
  if (!isRecord(raw)) return null
  const { id, label, position, floor, buildingId } = raw
  if (typeof id !== 'string' || id === '') return null
  if (!isRecord(position) || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
    return null
  }
  const node: NavNode = {
    id,
    label: typeof label === 'string' && label !== '' ? label : id,
    position: { lat: position.lat, lng: position.lng },
    floor: typeof floor === 'number' ? floor : 0,
    buildingId: typeof buildingId === 'string' ? buildingId : '',
    campusId,
    type: mapNodeType(raw.type),
  }
  if (typeof raw.name === 'string') node.name = raw.name
  const properties = isRecord(raw.properties) ? raw.properties : undefined
  const metadata = isRecord(raw.metadata) ? raw.metadata : undefined
  if (properties || metadata) node.metadata = { ...(properties ?? {}), ...(metadata ?? {}) }
  return node
}

const VALID_EDGE_TYPES = new Set<NavEdge['type']>([
  'walkway', 'stair', 'elevator', 'hallway', 'outdoor', 'corridor', 'stairs',
  'transition', 'walk', 'wall', 'door',
])

function mapEdgeType(raw: unknown): NavEdge['type'] {
  if (typeof raw === 'string' && VALID_EDGE_TYPES.has(raw as NavEdge['type'])) {
    return raw as NavEdge['type']
  }
  return 'walk'
}

export function normalizeEdge(raw: unknown): NavEdge | null {
  if (!isRecord(raw)) return null
  const { id, from, to, distance, weight } = raw
  if (
    typeof id !== 'string' || id === '' ||
    typeof from !== 'string' || from === '' ||
    typeof to !== 'string' || to === ''
  ) {
    return null
  }
  const dist = typeof distance === 'number' && distance >= 0 ? distance : 0
  const routing = isValidRoadEdgeRouting(raw.routing) ? raw.routing : undefined
  return {
    id,
    from,
    to,
    distance: dist,
    weight: typeof weight === 'number' && weight >= 0 ? weight : dist,
    type: mapEdgeType(raw.type),
    ...(routing ? { routing } : {}),
  }
}

function normalizeSearchEntry(raw: unknown): SearchEntry | null {
  if (!isRecord(raw)) return null
  const { id, label, nodeId, position, lat, lng, tags, buildingId, floor, floorId, category, source, sourceId, type } = raw
  if (typeof id !== 'string' || id === '' || typeof label !== 'string' || label === '') {
    return null
  }
  const normalizedType: SearchEntry['type'] = type === 'building'
    || type === 'room'
    || type === 'entrance'
    || type === 'facility'
    || type === 'poi'
    || type === 'node'
    ? type
    : 'room'
  const entry: SearchEntry = {
    id,
    label,
    type: normalizedType,
  }
  if (isRecord(position) && typeof position.lat === 'number' && typeof position.lng === 'number') {
    entry.position = { lat: position.lat, lng: position.lng }
  } else if (typeof lat === 'number' && typeof lng === 'number') {
    entry.position = { lat, lng }
  }
  if (typeof nodeId === 'string' && nodeId.trim() !== '') entry.nodeId = nodeId
  if (Array.isArray(tags)) {
    const strTags = tags.filter((t): t is string => typeof t === 'string')
    if (strTags.length > 0) entry.tags = strTags
  }
  if (typeof buildingId === 'string') entry.buildingId = buildingId
  if (typeof floor === 'number') entry.floor = floor
  if (typeof category === 'string' && category !== '') entry.category = category
  if (typeof floorId === 'string' && floorId !== '') entry.floorId = floorId
  if (source === 'authored' || source === 'graph-derived') entry.source = source
  if (typeof sourceId === 'string' && sourceId !== '') entry.sourceId = sourceId
  return entry
}

const FLOOR_ARRAY_FIELDS = [
  'walls', 'roomAttributes', 'rooms', 'hallways', 'staircases', 'elevators',
  'entrances', 'connectorStops', 'parametricComponents', 'pois', 'doors',
  'windows', 'openings', 'entranceAccess',
] as const

function normalizeFloorData(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw) || typeof raw.level !== 'number' || !Number.isFinite(raw.level)) return null
  const floor: Record<string, unknown> = { level: raw.level }
  for (const key of ['id', 'label', 'shortLabel', 'planImageId', 'floorPlanState', 'textureId', 'svgOverlayId'] as const) {
    if (typeof raw[key] === 'string') floor[key] = raw[key]
  }
  // Explicit null means the floor's plan was removed; do not revive a legacy URL.
  if (raw.planImageId === null) floor.planImageId = null
  for (const key of ['elevation', 'height', 'rotation'] as const) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) floor[key] = raw[key]
  }
  for (const key of ['visible', 'locked'] as const) {
    if (typeof raw[key] === 'boolean') floor[key] = raw[key]
  }
  for (const key of ['offset', 'planAlignment', 'routeNetwork', 'metadata'] as const) {
    if (isRecord(raw[key])) floor[key] = raw[key]
  }
  for (const key of FLOOR_ARRAY_FIELDS) {
    if (Array.isArray(raw[key])) floor[key] = raw[key]
  }
  return floor
}

function normalizeFloorPlanUrls(raw: unknown): Building['floorPlanUrls'] {
  if (!isRecord(raw)) return undefined
  const urls: Record<number, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const level = Number(key)
    if (Number.isFinite(level) && typeof value === 'string') urls[level] = value
  }
  return Object.keys(urls).length > 0 ? urls : undefined
}

function normalizeFloorPlanVisuals(raw: unknown): Building['floorPlanVisuals'] {
  if (!isRecord(raw)) return undefined
  const visuals: NonNullable<Building['floorPlanVisuals']> = {}
  for (const [key, value] of Object.entries(raw)) {
    const level = Number(key)
    if (!Number.isFinite(level) || !isRecord(value) || typeof value.imageUrl !== 'string') continue
    visuals[level] = {
      imageUrl: value.imageUrl,
      ...(isRecord(value.alignment) ? { alignment: value.alignment as NonNullable<Building['floorPlanVisuals']>[number]['alignment'] } : {}),
    }
  }
  return Object.keys(visuals).length > 0 ? visuals : undefined
}

function normalizeBuilding(raw: unknown, campusId: string): Building | null {
  if (!isRecord(raw)) return null
  const { id } = raw
  if (typeof id !== 'string' || id === '') return null
  const rawName = typeof raw.name === 'string' ? raw.name.trim() : ''
  const fallbackCode = typeof raw.code === 'string' ? raw.code.trim() : ''
  // Public snapshots can contain valid building geometry without an authored name.
  // Keep that geometry renderable instead of dropping the building from the User App.
  const name = rawName || fallbackCode || 'Unnamed building'
  const floorData = Array.isArray(raw.floorData)
    ? raw.floorData.map(normalizeFloorData).filter((floor): floor is Record<string, unknown> => floor !== null)
    : []
  const floors: number[] = []
  if (Array.isArray(raw.floors)) {
    for (const f of raw.floors) {
      let level: number
      if (isRecord(f) && typeof f.level === 'number') level = f.level
      else if (typeof f === 'number') level = f
      else continue
      if (Number.isFinite(level) && !floors.includes(level)) floors.push(level)
    }
  }
  for (const floor of floorData) {
    const level = floor.level as number
    if (!floors.includes(level)) floors.push(level)
  }
  const building: Building = {
    id,
    name,
    campusId,
    floors,
    footprint: [],
    baseElevation: 0,
    height: 0,
  }
  // Handle both 'position' (compiler output) and 'center' (graph_snapshots editor saves)
  const pos = raw.position ?? raw.center
  if (isRecord(pos) && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
    building.center = { lat: pos.lat, lng: pos.lng }
  }
  if (typeof raw.code === 'string') building.code = raw.code
  if (typeof raw.category === 'string') building.category = raw.category
  if (typeof raw.color === 'string') building.color = raw.color
  if (typeof raw.description === 'string') building.description = raw.description
  if (typeof raw.department === 'string') building.department = raw.department
  if (typeof raw.floorPlanUrl === 'string') building.floorPlanUrl = raw.floorPlanUrl
  if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) building.rotation = raw.rotation
  if (Array.isArray(raw.aliases)) building.aliases = raw.aliases.filter((alias): alias is string => typeof alias === 'string')
  if (isRecord(raw.metadata)) building.metadata = raw.metadata
  if (Array.isArray(raw.staircases)) building.staircases = raw.staircases
  if (Array.isArray(raw.elevators)) building.elevators = raw.elevators
  if (floorData.length > 0) building.floorData = floorData
  building.floorPlanUrls = normalizeFloorPlanUrls(raw.floorPlanUrls)
  building.floorPlanVisuals = normalizeFloorPlanVisuals(raw.floorPlanVisuals)
  if (typeof raw.baseElevation === 'number') building.baseElevation = raw.baseElevation
  if (typeof raw.height === 'number') building.height = raw.height
  if (Array.isArray(raw.footprint)) {
    const footprint = raw.footprint
      .map((p) =>
        isRecord(p) && typeof p.lat === 'number' && typeof p.lng === 'number'
          ? { lat: p.lat, lng: p.lng }
          : null,
      )
      .filter((p): p is LatLng => p !== null)
    if (footprint.length > 0) building.footprint = footprint
  }
  if (Array.isArray(raw.outline)) {
    const outline = raw.outline
      .map((p) => isRecord(p) && typeof p.lat === 'number' && typeof p.lng === 'number'
        ? { lat: p.lat, lng: p.lng } : null)
      .filter((p): p is LatLng => p !== null)
    if (outline.length > 0) building.outline = outline
  }
  if (Array.isArray(raw.entrances)) {
    const entrances = raw.entrances
      .map((e): BuildingEntrance | null => {
        if (!isRecord(e) || typeof e.id !== 'string' || e.id === '') return null
        const ep = e.position
        if (!isRecord(ep) || typeof ep.lat !== 'number' || typeof ep.lng !== 'number') return null
        return {
          id: e.id,
          position: { lat: ep.lat, lng: ep.lng },
          floor: typeof e.floor === 'number' ? e.floor : 0,
          label: typeof e.label === 'string' ? e.label : undefined,
        }
      })
      .filter((e): e is BuildingEntrance => e !== null)
    if (entrances.length > 0) building.entrances = entrances
  }
  return building
}

function normalizeBoundingBox(raw: unknown): CampusBundle['boundingBox'] {
  if (isRecord(raw)) {
    const { minLat, maxLat, minLng, maxLng } = raw
    if (
      typeof minLat === 'number' && typeof maxLat === 'number' &&
      typeof minLng === 'number' && typeof maxLng === 'number'
    ) {
      return { minLat, maxLat, minLng, maxLng }
    }
  }
  return null
}

function computeBoundingBox(nodes: NavNode[]): CampusBundle['boundingBox'] {
  if (nodes.length === 0) return null
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const n of nodes) {
    if (n.position.lat < minLat) minLat = n.position.lat
    if (n.position.lat > maxLat) maxLat = n.position.lat
    if (n.position.lng < minLng) minLng = n.position.lng
    if (n.position.lng > maxLng) maxLng = n.position.lng
  }
  return { minLat, maxLat, minLng, maxLng }
}

function parseGraph(raw: unknown, campusId: string): { nodes: NavNode[]; edges: NavEdge[]; boundingBox: CampusBundle['boundingBox'] } | null {
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
  const nodes = raw.nodes
    .map((n) => normalizeNode(n, campusId))
    .filter((n): n is NavNode => n !== null)
  const edges = raw.edges
    .map((e) => normalizeEdge(e))
    .filter((e): e is NavEdge => e !== null)
  const boundingBox = normalizeBoundingBox(isRecord(raw.metadata) ? raw.metadata.boundingBox : undefined)
  return { nodes, edges, boundingBox: boundingBox ?? computeBoundingBox(nodes) }
}

function parseSearchEntries(raw: unknown): SearchEntry[] {
  const entries = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.entries)
      ? raw.entries
      : []
  return entries
    .map((e) => normalizeSearchEntry(e))
    .filter((e): e is SearchEntry => e !== null)
}

function includeGraphSnapshotNodes(entries: SearchEntry[], nodes: NavNode[]): SearchEntry[] {
  const representedNodeIds = new Set(entries.flatMap((entry) => [entry.id, entry.nodeId ?? '']))
  const unindexedNodes = nodes.filter((node) => !representedNodeIds.has(node.id))
  const labelCounts = new Map<string, number>()
  for (const node of unindexedNodes) {
    const label = node.label?.trim() || node.name?.trim() || node.id
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }

  const nodeEntries = unindexedNodes.map((node): SearchEntry => {
    const label = node.label?.trim() || node.name?.trim() || node.id
    return {
      id: node.id,
      label: (labelCounts.get(label) ?? 0) > 1 ? `${label} (${node.id})` : label,
      type: 'node',
      nodeId: node.id,
      position: node.position,
      ...(node.buildingId ? { buildingId: node.buildingId } : {}),
      ...(typeof node.floor === 'number' ? { floor: node.floor } : {}),
      ...(node.type ? { tags: [node.type, node.id] } : { tags: [node.id] }),
      source: 'graph-derived',
      sourceId: node.id,
    }
  })

  return [...entries, ...nodeEntries]
}

function buildingNodeId(entry: SearchEntry | undefined, building: Building, nodes: NavNode[]): string | undefined {
  if (entry?.nodeId) {
    const indexedNode = nodes.find((node) => node.id === entry.nodeId)
    if (indexedNode && (!indexedNode.buildingId || indexedNode.buildingId === building.id)) {
      return indexedNode.id
    }
  }

  return nodes.find((node) => node.buildingId === building.id
    && (node.type === 'entrance' || node.type === 'building_entrance'))?.id
}

function includeGraphSnapshotBuildings(
  entries: SearchEntry[],
  buildings: Building[],
  nodes: NavNode[],
): SearchEntry[] {
  const normalizedEntries = entries.map((entry) => {
    if (entry.type !== 'building') return entry
    const relatedBuilding = buildings.find((building) =>
      [entry.id, entry.buildingId, entry.sourceId].includes(building.id),
    )
    if (!relatedBuilding) return entry

    const nodeId = buildingNodeId(entry, relatedBuilding, nodes)
    const normalizedEntry = { ...entry }
    if (nodeId) normalizedEntry.nodeId = nodeId
    else delete normalizedEntry.nodeId
    return normalizedEntry
  })
  const representedBuildingIds = new Set(normalizedEntries
    .filter((entry) => entry.type === 'building')
    .flatMap((entry) => [entry.id, entry.buildingId ?? '', entry.sourceId ?? '']))

  const buildingEntries = buildings
    .filter((building) => !representedBuildingIds.has(building.id))
    .map((building): SearchEntry => {
      const nodeId = buildingNodeId(undefined, building, nodes)
      return {
        id: building.id,
        label: building.name,
        type: 'building',
        ...(building.center ? { position: building.center } : {}),
        ...(building.code ? { tags: [building.code] } : {}),
        ...(nodeId ? { nodeId } : {}),
        source: 'graph-derived',
        sourceId: building.id,
      }
    })

  return [...normalizedEntries, ...buildingEntries]
}

function parseBuildings(raw: unknown, campusId: string): Building[] {
  if (!isRecord(raw) || !Array.isArray(raw.buildings)) return []
  return raw.buildings
    .map((b) => normalizeBuilding(b, campusId))
    .filter((b): b is Building => b !== null)
}

function isValidWorldPosition(value: unknown): value is LatLng {
  return validateWorldPointOfInterestGeometry({ type: 'point', position: value }).valid
}

function normalizePoi(raw: unknown): CampusPOI | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.trim().length === 0) return null

  const hasGeometry = raw.geometry !== undefined
  if (hasGeometry && !validateWorldPointOfInterestGeometry(raw.geometry).valid) return null
  const geometry = hasGeometry ? raw.geometry as WorldPOIGeometry : undefined
  const rawPosition = isValidWorldPosition(raw.position) ? raw.position : undefined
  const position = rawPosition ?? (geometry ? getWorldPointOfInterestRepresentative(geometry) : undefined)
  if (!position) return null

  const buildingId = typeof raw.buildingId === 'string' ? raw.buildingId : undefined
  const floor = typeof raw.floor === 'number' && Number.isFinite(raw.floor) ? raw.floor : undefined
  const isOutdoor = raw.scope === 'outdoor'
    || (geometry !== undefined && buildingId === undefined && floor === undefined)
  const normalizedGeometry = geometry ?? (isOutdoor ? { type: 'point', position } : undefined)
  const metadata = isRecord(raw.metadata) ? raw.metadata : undefined
  const properties = isRecord(raw.properties) ? raw.properties : metadata ?? {}
  const visibility = isRecord(raw.visibility) ? raw.visibility : undefined
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0
    ? raw.label
    : typeof raw.name === 'string' && raw.name.trim().length > 0
      ? raw.name
      : raw.id

  const normalized: Record<string, unknown> = {
    ...raw,
    id: raw.id,
    label,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    category: typeof raw.category === 'string' ? raw.category : 'other',
    position,
    ...(buildingId ? { buildingId } : {}),
    ...(floor !== undefined ? { floor } : {}),
    properties,
    ...(raw.source === 'authored' || raw.source === 'graph-derived' ? { source: raw.source } : {}),
    ...(typeof raw.sourceId === 'string' ? { sourceId: raw.sourceId } : {}),
    ...(typeof raw.floorId === 'string' ? { floorId: raw.floorId } : {}),
    ...(normalizedGeometry ? { geometry: normalizedGeometry } : {}),
    ...(visibility ? { visibility } : {}),
    ...(metadata ? { metadata } : {}),
    ...(typeof raw.showOnMap === 'boolean'
      ? { showOnMap: raw.showOnMap }
      : typeof visibility?.showOnMap === 'boolean'
        ? { showOnMap: visibility.showOnMap }
        : {}),
  }
  if (isOutdoor) normalized.scope = 'outdoor'
  else delete normalized.scope
  if (!normalizedGeometry) delete normalized.geometry
  if (!visibility) delete normalized.visibility
  if (!metadata) delete normalized.metadata
  return normalized as unknown as CampusPOI
}

function parsePoi(publishedIndex: unknown, snapshotPois: unknown): CampusPOI[] {
  const published = isRecord(publishedIndex) && Array.isArray(publishedIndex.points)
    ? publishedIndex.points
    : []
  const snapshot = Array.isArray(snapshotPois) ? snapshotPois : []
  const byId = new Map<string, CampusPOI>()

  for (const raw of [...published, ...snapshot]) {
    const poi = normalizePoi(raw)
    if (poi && !byId.has(poi.id)) byId.set(poi.id, poi)
  }

  return [...byId.values()]
}

function includeSearchablePois(entries: SearchEntry[], pois: CampusPOI[]): SearchEntry[] {
  const representedIds = new Set<string>()
  for (const entry of entries) {
    representedIds.add(entry.id)
    if (entry.sourceId) representedIds.add(entry.sourceId)
  }

  const poiEntries: SearchEntry[] = []
  for (const poi of pois) {
    if (poi.visibility?.searchable !== true) continue
    const sourceId = poi.sourceId ?? poi.id
    if (representedIds.has(poi.id) || representedIds.has(sourceId)) continue

    poiEntries.push({
      id: poi.id,
      label: poi.label,
      type: 'poi',
      ...(poi.nodeId ? { nodeId: poi.nodeId } : {}),
      position: poi.position,
      ...(poi.name && poi.name !== poi.label ? { tags: [poi.name] } : {}),
      ...(poi.buildingId ? { buildingId: poi.buildingId } : {}),
      ...(poi.floor !== undefined ? { floor: poi.floor } : {}),
      category: poi.category,
      ...(poi.floorId ? { floorId: poi.floorId } : {}),
      source: poi.source ?? 'authored',
      sourceId,
    })
    representedIds.add(poi.id)
    representedIds.add(sourceId)
  }

  return [...entries, ...poiEntries]
}

function parseTraces(raw: unknown): TracePath[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, TracePath>()
  const roadTypes = new Set<RoadType>(['arterial', 'connector', 'service', 'pedestrian'])

  for (const value of raw) {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim().length === 0) continue
    const canonicalPolyline = isRecord(value.polyline) && Array.isArray(value.polyline.points)
      ? value.polyline.points
      : null
    const sourcePoints = Array.isArray(value.points) ? value.points : canonicalPolyline
    if (!sourcePoints || sourcePoints.length < 2 || !sourcePoints.every(isValidWorldPosition)) continue

    const canonicalRoadType = (canonicalPolyline && roadTypes.has(value.type as RoadType))
      ? value.type as RoadType
      : roadTypes.has(value.roadType as RoadType)
        ? value.roadType as RoadType
        : undefined
    const legacyTraceType = value.type === 'arterial' || value.type === 'connector'
    const legacyPathType = value.type === 'path' || value.type === 'interior'
    if (!canonicalRoadType && !legacyTraceType && !legacyPathType) continue
    if (byId.has(value.id)) continue

    const trace: TracePath = {
      ...value,
      id: value.id,
      type: canonicalRoadType
        ? canonicalRoadType === 'connector' || canonicalRoadType === 'pedestrian' ? 'connector' : 'arterial'
        : value.type === 'connector' || legacyPathType ? 'connector' : 'arterial',
      floor: typeof value.floor === 'number' && Number.isFinite(value.floor) ? value.floor : 0,
      points: sourcePoints.map((point) => ({ ...point })) as LatLng[],
      displayMode: value.displayMode === 'navigation-only' ? 'navigation-only' : 'visible',
    } as TracePath
    if (canonicalRoadType) trace.roadType = canonicalRoadType
    else delete trace.roadType
    if (canonicalPolyline) trace.polyline = { points: trace.points }
    else delete trace.polyline
    if (isRecord(value.metadata)) trace.metadata = value.metadata
    else delete trace.metadata
    if (isRecord(value.routing)) trace.routing = value.routing as TracePath['routing']
    else delete trace.routing
    byId.set(trace.id, trace)
  }

  return [...byId.values()]
}

function parseDoors(raw: unknown): DoorData[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((door): door is Record<string, unknown> => isRecord(door))
    .filter((door) => {
      const position = door.position
      return typeof door.id === 'string'
        && typeof door.roomId === 'string'
        && typeof door.buildingId === 'string'
        && typeof door.floor === 'number'
        && typeof door.width === 'number'
        && isRecord(position)
        && typeof position.lat === 'number'
        && typeof position.lng === 'number'
    })
    .map((door) => ({
      id: door.id as string,
      roomId: door.roomId as string,
      buildingId: door.buildingId as string,
      floor: door.floor as number,
      position: {
        lat: (door.position as Record<string, number>).lat,
        lng: (door.position as Record<string, number>).lng,
      },
      width: door.width as number,
      ...(typeof door.angle === 'number' ? { angle: door.angle } : {}),
      ...(typeof door.connectedToId === 'string' ? { connectedToId: door.connectedToId } : {}),
      ...(typeof door.isExterior === 'boolean' ? { isExterior: door.isExterior } : {}),
    }))
}

function reportPublicCampusClientTiming(metrics: Record<string, number>) {
  if (process.env.NODE_ENV !== 'development') return
  console.debug('[public-campus] client timing', metrics)
}

async function fetchJson(url: string): Promise<unknown> {
  const isPublicCampusRequest = url.startsWith('/api/public-campus?')
  const requestStartedAt = performance.now()
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    if (isPublicCampusRequest) {
      reportPublicCampusClientTiming({ requestToFailureMs: performance.now() - requestStartedAt })
    }
    return null
  }
  if (!res.ok) return null

  const headersReceivedAt = performance.now()
  let responseText: string
  try {
    responseText = await res.text()
  } catch {
    return null
  }

  const bodyReadCompletedAt = performance.now()
  try {
    const parsed = JSON.parse(responseText) as unknown
    if (isPublicCampusRequest) {
      reportPublicCampusClientTiming({
        timeToHeadersMs: headersReceivedAt - requestStartedAt,
        bodyReadMs: bodyReadCompletedAt - headersReceivedAt,
        jsonParseMs: performance.now() - bodyReadCompletedAt,
        responseChars: responseText.length,
      })
    }
    return parsed
  } catch {
    return null
  }
}

async function fetchFromPublicCampus(campusId: string): Promise<PublicCampusResult | null> {
  const doc = await fetchJson(`/api/public-campus?campus_id=${encodeURIComponent(campusId)}`)
  if (!isRecord(doc)) return null
  if (typeof doc.campusId !== 'string' || doc.campusId !== campusId) return null
  const normalizationStartedAt = performance.now()
  const id = campusId

  // The /api/public-campus endpoint returns shape:
  // { campusId, source, buildings, components, nodes, edges, boundary, artifacts? }
  const rawNodes = Array.isArray(doc.nodes) ? doc.nodes : []
  const rawEdges = Array.isArray(doc.edges) ? doc.edges : []

  // Don't bail when nodes/edges are empty — buildings with valid footprints
  // (from graph_snapshots or published_maps) can render without graph nodes.
  const graph = parseGraph({ nodes: rawNodes, edges: rawEdges }, id)
  if (!graph) return null

  // If coming from published_maps, doc.artifacts has searchIndex and poiIndex
  const artifacts = isRecord(doc.artifacts) ? doc.artifacts : undefined
  const metadata = isRecord(artifacts?.metadata) ? artifacts.metadata : undefined
  const campusName = normalizeCampusDisplayName(
    doc.campusName
      ?? doc.name
      ?? artifacts?.campusName
      ?? artifacts?.name
      ?? metadata?.campusName
      ?? metadata?.name,
    id,
  )
  const compiledSearchEntries = artifacts ? parseSearchEntries(artifacts.searchIndex) : []
  const poi = parsePoi(artifacts?.poiIndex, doc.pois)
  const buildings = parseBuildings(doc, id)
  const graphSearchEntries = doc.source === 'graph_snapshots'
    ? includeGraphSnapshotNodes(compiledSearchEntries, graph.nodes)
    : compiledSearchEntries
  const entriesWithPois = includeSearchablePois(graphSearchEntries, poi)
  const searchEntries = doc.source === 'graph_snapshots'
    ? includeGraphSnapshotBuildings(entriesWithPois, buildings, graph.nodes)
    : entriesWithPois
  const traces = parseTraces(doc.traces)
  const floorGeometry = artifacts?.floorGeometry as FloorGeometryArtifact | undefined
  const panoramaIndex = artifacts?.panoramaIndex as PanoramaIndex | undefined
  const qrIndex = artifacts?.qrIndex as QrIndex | undefined

  // Components: indoor geometry (rooms, hallways, staircases, elevators, entrances)
  // delivered from the editor's GraphSnapshot via published artifacts or graph_snapshots.
  const rawComponents = Array.isArray(doc.components) ? doc.components : []
  const components: Component[] = rawComponents.filter(
    (c): c is Component => isRecord(c) && typeof c.id === 'string' && typeof c.type === 'string',
  )
  const rawDoors = Array.isArray(doc.doors)
    ? doc.doors
    : artifacts && Array.isArray(artifacts.doors)
      ? artifacts.doors
      : []
  const doors = parseDoors(rawDoors)

  const bundle: CampusBundle = {
    ...(campusName ? { campusName } : {}),
    nodes: graph.nodes,
    edges: graph.edges,
    searchEntries,
    buildings,
    components,
    doors,
    poi,
    traces,
    boundingBox: graph.boundingBox,
    floorGeometry,
    panoramaIndex,
    qrIndex,
  }
  const normalized = normalizePublicCampusResult({
    campusId: id,
    source: doc.source,
    revision: doc.revision ?? metadata?.revision ?? null,
    bundle,
  }, campusId)

  if (normalized) {
    reportPublicCampusClientTiming({
      normalizationMs: performance.now() - normalizationStartedAt,
      buildings: normalized.bundle.buildings.length,
      nodes: normalized.bundle.nodes.length,
      edges: normalized.bundle.edges.length,
      pois: normalized.bundle.poi.length,
      traces: normalized.bundle.traces.length,
    })
  }
  return normalized
}

type CampusOrigin = 'cache' | 'network'

function campusDataSource(result: PublicCampusResult): CampusSource {
  return result.source === 'published' ? 'published_maps' : 'graph_snapshots'
}

function hydrationState(result: PublicCampusResult, origin: CampusOrigin): Pick<
  PublicState,
  'campus' | 'campusData' | 'activeFloor' | 'campusOrigin' | 'campusRevision' | 'currentCampusId' | 'recentDestinations'
> {
  const bundle = result.bundle
  return {
    campus: bundle,
    currentCampusId: result.campusId,
    recentDestinations: loadRecentDestinationsForCampus(result.campusId, bundle),
    campusData: {
      campusId: result.campusId,
      ...(bundle.campusName ? { campusName: bundle.campusName } : {}),
      source: campusDataSource(result),
      buildings: bundle.buildings,
      components: bundle.components ?? [],
      doors: bundle.doors ?? [],
      nodes: bundle.nodes,
      edges: bundle.edges,
      boundary: null,
    },
    activeFloor: bundle.buildings[0]?.floors?.[0] ?? 0,
    campusOrigin: origin,
    campusRevision: result.revision,
  }
}

function cachedResult(record: CachedCampus): PublicCampusResult {
  return {
    campusId: record.campusId,
    revision: record.revision,
    source: 'published',
    bundle: record.payload,
  }
}

function cacheRecord(result: PublicCampusResult): CachedCampus | null {
  if (result.source !== 'published' || !isUsablePublicCampusBundle(result.bundle)) return null
  return {
    campusId: result.campusId,
    cacheSchemaVersion: 1,
    revision: result.revision,
    downloadedAt: Date.now(),
    source: 'published',
    payload: result.bundle,
  }
}

function hasFloorSpecificBuildingData(bundle: CampusBundle): boolean {
  return bundle.buildings.some((building) =>
    Boolean(building.floorData?.length)
    || Boolean(building.floorPlanUrls && Object.keys(building.floorPlanUrls).length)
    || Boolean(building.floorPlanVisuals && Object.keys(building.floorPlanVisuals).length))
}

export function createPublicStore(dependencies: PublicStoreDependencies = {}) {
  const cache = dependencies.cache ?? indexedDbCampusCacheRepository
  let requestSequence = 0
  let inFlight: { campusId: string; requestId: number; promise: Promise<void> } | null = null

  return create<PublicState>((set, get) => {
    const updatePreferences = (
      updater: (current: PublicPreferences) => PublicPreferences,
    ) => {
      const next = mergePublicPreferences(updater(get().preferences))
      savePublicPreferences(next)
      set({ preferences: next })
    }

    return {
  activeTab: 'home',
  sheetState: 'hidden',
  mapMode: 'explore',
  fromNode: null,
  toNode: null,
  poiDestination: null,
  selectedBuilding: null,
  selectedNode: null,
  currentCampusId: null,
  defaultCampusId: loadDefaultCampusId(),
  preferences: loadPublicPreferences(),

  campusData: null,
  campusStatus: 'idle',
  campusError: null,
  activeFloor: 0,

  /** W16C: Indoor context starts inactive — Campus Mode (no rooms, no walls). */
  indoorContext: { active: false },

  campus: null,
  qrLocation: null,
  campusLoading: false,
  campusOrigin: null,
  campusRevision: null,
  isRefreshing: false,
  refreshError: null,

  recentDestinations: loadArray(RECENT_DEST_KEY),
  recentSearches: loadArray(RECENT_SEARCH_KEY),
  // Transient public search reveal: never persisted, cleared when the search
  // query is cleared or the campus changes.
  revealedPoiIds: [],
  onboardingComplete: typeof window !== 'undefined'
    ? localStorage.getItem(ONBOARDING_KEY) === 'true'
    : false,

  setTab: (tab) => set({ activeTab: tab }),

  setSheet: (state) => set({ sheetState: state }),

  setMapMode: (mode) => set({ mapMode: mode }),

  setFrom: (nodeId) => set({ fromNode: nodeId, qrLocation: null }),
  setQrLocation: (location) => set({
    qrLocation: location,
    fromNode: location?.nodeId ?? null,
  }),
  setTo: (nodeId) => set({ toNode: nodeId, poiDestination: null }),
  setPoiDestination: (poiId) => set({
    poiDestination: poiId ? { destinationType: 'poi', poiId } : null,
    toNode: null,
  }),
  setDefaultCampus: (campusId) => {
    saveDefaultCampusId(campusId)
    set({ defaultCampusId: campusId })
  },
  setTheme: (theme) => updatePreferences((current) => ({ ...current, theme })),
  setMapAppearance: (mapAppearance) => updatePreferences((current) => ({ ...current, mapAppearance })),
  setNotifications: (notifications) => updatePreferences((current) => ({ ...current, notifications })),
  setNavigationPreferences: (navigation) => updatePreferences((current) => ({
    ...current,
    navigation: { ...current.navigation, ...navigation },
  })),
  setAccessibilityPreferences: (accessibility) => updatePreferences((current) => ({
    ...current,
    accessibility: { ...current.accessibility, ...accessibility },
  })),

  selectBuilding: (b) => {
    set({ selectedBuilding: b })
    // W16C: Entering a building activates indoor context, exiting clears it
    if (b) {
      const floorId = b.floors?.[0] ?? 0
      set({
        indoorContext: { active: true, buildingId: b.id, floorId },
        activeFloor: floorId,
      })
    } else {
      // Exiting building clears indoor context (return to Campus Mode)
      set({ indoorContext: { active: false } })
    }
  },
  selectNode: (n) => set({ selectedNode: n }),

  setActiveFloor: (floor) => {
    set({ activeFloor: floor })
    // W16C: Update indoor context floor when in indoor mode
    const { indoorContext } = get()
    if (indoorContext.active) {
      set({ indoorContext: { ...indoorContext, floorId: floor } })
    }
  },

  enterIndoorContext: (buildingId, floorId) => {
    set({
      indoorContext: { active: true, buildingId, floorId },
      activeFloor: floorId,
    })
  },

  exitIndoorContext: () => {
    set({
      indoorContext: { active: false },
      selectedBuilding: null,
    })
  },

  fetchCampusData: (campusId?: string) => {
    const id = campusId ?? get().defaultCampusId ?? loadDefaultCampusId()
    if (!id) return Promise.resolve()
    if (inFlight?.campusId === id) return inFlight.promise
    if (!inFlight && (get().campusLoading || get().campusStatus === 'loading')) {
      return Promise.resolve()
    }

    const currentCampusId = get().currentCampusId
    if (get().campus && currentCampusId === id) return Promise.resolve()

    const requestId = ++requestSequence
    const previousCampus = get().campus
    const previousCampusData = get().campusData
    const previousCurrentCampusId = currentCampusId
    const previousCampusOrigin = get().campusOrigin
    const previousCampusRevision = get().campusRevision
    const isCampusSwitch = Boolean(
      previousCampus
      && previousCampusData
      && previousCurrentCampusId
      && previousCurrentCampusId !== id,
    )

    const promise = (async () => {
      set({
        campusLoading: true,
        campusStatus: 'loading',
        campusError: null,
        isRefreshing: false,
        refreshError: null,
        campusOrigin: null,
        campusRevision: null,
      })

      let cached: CachedCampus | null = null
      try {
        const persisted = await cache.get(id)
        cached = persisted ? validateCachedCampus(persisted, id) : null
      } catch {
        // IndexedDB is an optional accelerator. Continue with the authoritative request.
      }

      if (requestSequence !== requestId) return

      const cachedCampus = cached ? cachedResult(cached) : null
      if (cachedCampus) {
        set({
          ...hydrationState(cachedCampus, 'cache'),
          ...(isCampusSwitch ? {
            selectedBuilding: null,
            selectedNode: null,
            fromNode: null,
            toNode: null,
            poiDestination: null,
            qrLocation: null,
            indoorContext: { active: false },
          } : {}),
          campusLoading: false,
          campusStatus: 'ready',
          campusError: null,
          isRefreshing: true,
          refreshError: null,
        })
      }

      let network: PublicCampusResult | null = null
      try {
        // Primary: /api/public-campus (published_maps first, graph_snapshots fallback).
        network = await fetchFromPublicCampus(id)
      } catch {
        network = null
      }

      if (requestSequence !== requestId) return

      if (!network) {
        if (cachedCampus) {
          set({
            campusLoading: false,
            campusStatus: 'ready',
            campusError: null,
            isRefreshing: false,
            refreshError: 'No campus data available',
          })
        } else if (isCampusSwitch) {
          set({
            campus: previousCampus!,
            campusData: previousCampusData!,
            currentCampusId: previousCurrentCampusId!,
            campusLoading: false,
            campusStatus: 'ready',
            campusError: null,
            campusOrigin: previousCampusOrigin,
            campusRevision: previousCampusRevision,
            isRefreshing: false,
            refreshError: 'No campus data available',
          })
        } else {
          set({
            campusLoading: false,
            campusStatus: 'error',
            campus: null,
            campusData: null,
            currentCampusId: null,
            campusOrigin: null,
            campusRevision: null,
            isRefreshing: false,
            refreshError: null,
            campusError: 'No campus data available',
          })
        }
        return
      }

      // A matching, non-null revision represents the same authoritative package;
      // keep the already-hydrated cache object stable in that case.
      const sameRevision = cachedCampus
        && cachedCampus.source === network.source
        && cachedCampus.revision !== null
        && cachedCampus.revision === network.revision
        // Earlier adapter versions cached published buildings without their
        // floor fields. A matching revision must not pin that lossy projection.
        && !(hasFloorSpecificBuildingData(network.bundle) && !hasFloorSpecificBuildingData(cachedCampus.bundle))
        // Revision identity is insufficient for caches written by an older
        // projection. The network must replace any incomplete runtime payload,
        // including missing buildings, geometry, POIs, traces, and floor fields.
        && JSON.stringify(cachedCampus.bundle) === JSON.stringify(network.bundle)
      if (!sameRevision) {
        set({
          ...hydrationState(network, 'network'),
          ...(isCampusSwitch ? {
            selectedBuilding: null,
            selectedNode: null,
            fromNode: null,
            toNode: null,
            poiDestination: null,
            qrLocation: null,
            indoorContext: { active: false },
          } : {}),
          campusLoading: false,
          campusStatus: 'ready',
          campusError: null,
          isRefreshing: false,
          refreshError: null,
        })
      } else {
        set({
          campusLoading: false,
          campusStatus: 'ready',
          campusError: null,
          isRefreshing: false,
          refreshError: null,
        })
      }
      const record = cacheRecord(network)
      if (record) {
        try {
          await cache.put(record)
        } catch {
          // Cache persistence is best effort; the network result is already active.
        }
      }
    })().finally(() => {
      if (inFlight?.requestId === requestId) inFlight = null
    })

    inFlight = { campusId: id, requestId, promise }
    return promise
  },

  search: (query) => {
    return search(get().campus?.searchEntries ?? [], query)
  },
  setRevealedPoiIds: (ids) => set((state) => {
    const current = state.revealedPoiIds
    if (current.length === ids.length && current.every((id, index) => id === ids[index])) return state
    return { revealedPoiIds: [...ids] }
  }),
  clearRevealedPoiIds: () => set({ revealedPoiIds: [] }),

  findRoute: (fromId, toId) =>
    findRoute(get().campus?.nodes ?? [], get().campus?.edges ?? [], fromId, toId),

  findDestinationRoute: (fromId) => {
    const state = get()
    if (state.poiDestination) {
      return findPoiNavRoute(
        state.campus?.nodes ?? [],
        state.campus?.edges ?? [],
        state.campus?.poi ?? [],
        fromId,
        state.poiDestination.poiId,
      )
    }
    if (!state.toNode) return null
    return state.findRoute(fromId, state.toNode)
  },

  nearestNode: (latlng, maxDistanceMeters = 50) =>
    nearestNode(get().campus?.nodes ?? [], latlng, maxDistanceMeters),

  addRecentDestination: (nodeId) => {
    const campusId = get().currentCampusId
    const bundle = get().campus
    if (!campusId || !bundle) return

    const validIds = reconcileRecentDestinationIds([nodeId], campusDestinationSource(bundle))
    if (validIds.length === 0) return

    const current = reconcileRecentDestinationIds(get().recentDestinations, campusDestinationSource(bundle))
    const updated = [nodeId, ...current.filter((id) => id !== nodeId)].slice(0, MAX_RECENT)
    saveRecentDestinationsForCampus(campusId, updated)
    set({ recentDestinations: updated })
  },

  clearRecentDestinations: () => {
    const campusId = get().currentCampusId
    if (campusId) {
      const byCampus = loadRecentDestinationsByCampus()
      byCampus[campusId] = []
      saveRecentDestinationsByCampus(byCampus)
    }
    saveArray(RECENT_DEST_KEY, [])
    set({ recentDestinations: [] })
  },

  addRecentSearch: (query) => {
    const current = get().recentSearches
    const updated = [query, ...current.filter((q) => q !== query)].slice(0, MAX_RECENT)
    saveArray(RECENT_SEARCH_KEY, updated)
    set({ recentSearches: updated })
  },

  completeOnboarding: () => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    set({ onboardingComplete: true })
  },

  resetOnboarding: () => {
    localStorage.removeItem(ONBOARDING_KEY)
    set({ onboardingComplete: false })
  },
  }
  })
}

export const usePublicStore = createPublicStore()
