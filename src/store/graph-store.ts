import { create } from 'zustand'
import { Graph } from '../engine/graph'
import type { NavNode, NavEdge, Building, Component, GraphSnapshot, TracePath } from '../types/nav-types'
import { compileComponent } from '../engine/component-compiler'
import { serializeSnapshot, type GraphSnapshotLike } from '../services/graph-snapshot-serializer'
import type { CampusDocument } from '@navi/core'
import {
  parseAuthoredGraphPayload,
  serializeAuthoredGraphPayload,
} from '../services/authored-snapshot-persistence'
import { appendIntent, evaluateAuthoredSave, intentsIncludedInSave, type AuthoredMutationIntent } from './authored-mutation-intent'
import type { GuardCollections } from '../lib/save-safety-guard'

const STORAGE_KEY = 'navi-graph'
const SYNC_STATUS_KEY = 'navi-sync-status'

function syncStatusKey(mapId: string | null): string {
  return mapId ? `${SYNC_STATUS_KEY}-${mapId}` : SYNC_STATUS_KEY
}

function snapshotFingerprint(snapshotJson: string): string {
  // A small synchronous fingerprint keeps the local sync marker tied to the
  // exact cached snapshot without storing another copy of the graph.
  let hash = 2166136261
  for (let i = 0; i < snapshotJson.length; i += 1) {
    hash ^= snapshotJson.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

type SyncStatus = 'idle' | 'syncing' | 'checking' | 'synced' | 'error' | 'conflict'

interface GraphState {
  graph: Graph
  /** Canonical authored state when the active snapshot uses the new format. */
  authoredDocument: CampusDocument | null
  setAuthoredDocument: (document: CampusDocument | null) => void
  currentMapId: string | null
  /** Incremented only after a server graph and its local cache are adopted. */
  serverAdoptionVersion: number
  renderVersion: number
  syncStatus: SyncStatus
  syncError: string | null
  /**
   * P0.11 — CAMPUS_READY_FOR_AUTHORED_SAVE. False while an authoritative load
   * or hydration is in flight; saves are refused until it settles true.
   */
  campusReady: boolean
  /** P0.11 — authored mutation intents pending since the last acknowledged save. */
  pendingAuthoredMutations: AuthoredMutationIntent[]
  recordAuthoredMutation: (kind: AuthoredMutationIntent['kind'], buildingId?: string | null, floor?: number | null) => void
  clearAuthoredMutations: (ackedSeq: number) => void
  /** P0.14 — real runtime readiness lifecycle (shared by runtime and fixtures). */
  beginCampusHydration: () => void
  completeCampusHydration: () => void

  addNode: (node: NavNode) => void
  removeNode: (id: string) => void
  updateNode: (id: string, partial: Partial<NavNode>) => void

  addEdge: (edge: NavEdge) => void
  removeEdge: (id: string) => void
  updateEdge: (id: string, partial: Partial<NavEdge>) => void

  addBuilding: (building: Building) => void
  updateBuilding: (id: string, partial: Partial<Building>) => void
  removeBuilding: (id: string) => void

  addComponent: (component: Component) => void
  updateComponent: (id: string, partial: Partial<Component>) => void
  removeComponent: (id: string) => void
  addTrace: (trace: TracePath) => void
  updateTrace: (id: string, partial: Partial<TracePath>) => void
  removeTrace: (id: string) => void
  recompileTrace: (id: string) => void
  addComponentWithPolygon: (component: Component) => void
  rotateBuilding: (buildingId: string, angleRad: number) => void

  setNodes: (nodes: NavNode[]) => void
  setEdges: (edges: NavEdge[]) => void
  setBuildings: (buildings: Building[]) => void

  loadMapData: (mapId: string) => void
  setCurrentMapId: (mapId: string | null) => void
  load: () => void
  save: (options?: { trigger?: SaveTrigger }) => Promise<void>
  reset: () => void

  syncToSupabase: (options?: { force?: boolean; trigger?: SaveTrigger }) => Promise<void>
  /**
   * Refresh-recovery: safe retry when local authored work is ahead of the last
   * acknowledged revision but the server is still at that acknowledged base.
   * Reuses the existing guarded save path; never force-overwrites.
   */
  syncLocalChanges: () => Promise<void>
  reSync: (options?: { force?: boolean }) => Promise<void>
  fetchFromSupabase: (mapId?: string) => Promise<void>
  adoptServerSnapshot: () => Promise<void>
}

function storageKey(mapId: string): string {
  return mapId ? `navi-graph-${mapId}` : STORAGE_KEY
}

/** One logical save attempt gets one stable mutation id (kept across transport retries). */
function newMutationId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined
    if (c?.randomUUID) return c.randomUUID()
  } catch {
    // fall through to non-crypto id
  }
  return `mut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Backoff delays (ms) between sync retries for transient network failures.
 * Total worst-case added latency before giving up: 1s + 3s = 4s.
 */
const SYNC_RETRY_DELAYS = [1000, 3000]

let onlineResyncBound = false

/** P0.11 — monotonic sequence for authored mutation intents. */
let authoredIntentSeq = 0

/**
 * P0.11 — last server-acknowledged canonical collections (guard baseline).
 * Null until an authoritative load or save acknowledgement is captured.
 */
let lastAcknowledgedCollections: GuardCollections | null = null
let lastAcknowledgedSeq = 0

const asEntityList = (items: unknown): GuardCollections['buildings'] =>
  (Array.isArray(items) ? items : []).map((raw) => {
    const e = raw as { id?: string; buildingId?: string | null; floor?: number | null; from?: string; to?: string }
    return { id: String(e.id ?? ''), buildingId: e.buildingId ?? null, floor: e.floor ?? null, from: e.from, to: e.to }
  })

/** Snapshot a serialized graph into guard-comparable collections. */
function collectionsOf(snapshot: unknown): GuardCollections {
  const s = snapshot as Record<string, unknown>
  return {
    buildings: asEntityList(s.buildings),
    components: asEntityList(s.components),
    nodes: asEntityList(s.nodes),
    edges: asEntityList(s.edges),
    traces: asEntityList(s.traces),
    doors: asEntityList(s.doors),
  }
}

/** Scope of an edge derived from its endpoints in the current graph. */
function edgeScope(
  graph: Graph,
  edge: { from?: string; to?: string } | undefined,
): { buildingId: string | null; floor: number | null } {
  const nodes = graph.nodes as Array<{ id: string; buildingId?: string | null; floor?: number | null }>
  const from = edge?.from ? nodes.find((n) => n.id === edge.from) : undefined
  const to = edge?.to ? nodes.find((n) => n.id === edge.to) : undefined
  const preferred = [from, to].find((n) => n?.buildingId) ?? from ?? to
  return { buildingId: preferred?.buildingId ?? null, floor: preferred?.floor ?? null }
}

/**
 * True for transport-level failures (undici "fetch failed", browser
 * "Failed to fetch", Firefox "NetworkError", Safari "Load failed", ...).
 * These are transient and worth retrying; HTTP/data errors are not.
 */
function isNetworkError(msg: string): boolean {
  return /fetch failed|failed to fetch|networkerror|load failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * After a sync fails because the browser is offline, resume syncing
 * automatically once the connection returns. Bound at most once.
 */
function bindOnlineResync() {
  if (typeof window === 'undefined' || onlineResyncBound) return
  onlineResyncBound = true
  window.addEventListener('online', () => {
    const state = useGraphStore.getState()
    if (state.currentMapId) void state.syncToSupabase().catch(() => {})
  })
}

interface SyncMarker {
  snapshotFingerprint?: string
  syncedAt?: string
  serverTimestamp?: string | null
}

function readSyncMarker(mapId: string): SyncMarker | null {
  try {
    const raw = localStorage.getItem(syncStatusKey(mapId))
    return raw ? (JSON.parse(raw) as SyncMarker) : null
  } catch {
    return null
  }
}

/**
 * `serverTimestamp` is only ever populated from a real server response.
 * It must never be stamped with the local clock, otherwise a stale local
 * snapshot can appear newer than the server during freshness comparison.
 */
function writeSyncMarker(
  mapId: string,
  fingerprint: string,
  syncedAt: string,
  serverTimestamp: string | null,
): boolean {
  try {
    localStorage.setItem(syncStatusKey(mapId), JSON.stringify({
      snapshotFingerprint: fingerprint,
      syncedAt,
      serverTimestamp,
    }))
    return true
  } catch {
    // Best effort: a missing marker only costs an extra server check.
    return false
  }
}

/** Canonical JSON with sorted keys so JSONB key reordering cannot fake a mismatch. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/**
 * Content fingerprint that ignores object key order and the volatile
 * `updatedAt` field that `Graph.toJSON()` regenerates on every call.
 */
function graphFingerprint(snapshot: unknown): string {
  const json = Graph.fromJSON(snapshot as GraphSnapshot).toJSON() as unknown as Record<string, unknown>
  delete json.updatedAt
  return snapshotFingerprint(stableStringify(json))
}

type PersistedGraphSnapshot = GraphSnapshot & {
  updatedAt?: string
  authoredDocument?: unknown
  authoredDocumentFormatVersion?: number
}

async function fetchServerSnapshot(mapId: string): Promise<PersistedGraphSnapshot | null> {
  try {
    const res = await fetch(`/api/graph?campus_id=${encodeURIComponent(mapId)}`, { credentials: 'include' })
    if (!res.ok) return null
    const data = (await res.json()) as PersistedGraphSnapshot
    if (!data || !Array.isArray(data.nodes)) return null
    return data
  } catch {
    return null
  }
}

function isServerSnapshotEmpty(data: GraphSnapshot): boolean {
  return (data.buildings?.length ?? 0) === 0 && (data.nodes?.length ?? 0) === 0
}

/**
 * Per-campus supersession epoch: bumped whenever the authoritative base is
 * replaced (server adoption/load). In-flight saves that started under an older
 * epoch must not stamp their acknowledgement onto the new base.
 */
const campusEpoch = new Map<string, number>()
const adoptingCampuses = new Set<string>()
const getCampusEpoch = (mapId: string): number => campusEpoch.get(mapId) ?? 0
const bumpCampusEpoch = (mapId: string): void => {
  campusEpoch.set(mapId, getCampusEpoch(mapId) + 1)
}

/**
 * Drop queued (not yet running) saves for a campus whose authoritative base has
 * been replaced. Waiters are rejected with a descriptive reason so callers can
 * surface the truth instead of silently re-persisting a discarded graph.
 */
function invalidateQueuedCampusSaves(mapId: string, reason: string): void {
  const queue = campusSaveQueues.get(mapId)
  if (!queue) return
  const pending = queue.waiters.splice(0)
  queue.hasPending = false
  queue.pendingForce = false
  for (const waiter of pending) waiter.reject(new Error(reason))
}

/** Replace the active graph with a server snapshot and record the synced marker. */
function adoptServerSnapshotData(mapId: string, data: PersistedGraphSnapshot): void {
  const persisted = parseAuthoredGraphPayload(data)
  const graph = Graph.fromJSON(data)
  graph.campusId = mapId
  const snapshot = graph.toJSON()
  try {
    localStorage.setItem(
      storageKey(mapId),
      JSON.stringify(serializeAuthoredGraphPayload(snapshot as unknown as Record<string, unknown>, persisted.authoredDocument)),
    )
  } catch (error) {
    throw new Error(`Unable to persist the server version locally: ${error instanceof Error ? error.message : 'storage write failed'}`)
  }
  const markerWritten = writeSyncMarker(mapId, graphFingerprint(snapshot), data.updatedAt ?? new Date().toISOString(), data.updatedAt ?? null)
  if (!markerWritten) throw new Error('Unable to record the adopted server revision locally.')
  lastAcknowledgedCollections = collectionsOf(snapshot)
  // Adopting the authoritative snapshot DISCARDS local edits: their pending
  // intents and any queued saves must not resurrect the discarded graph.
  authoredIntentSeq = 0
  bumpCampusEpoch(mapId)
  invalidateQueuedCampusSaves(mapId, 'Superseded by authoritative server adoption')
  useGraphStore.setState({
    graph,
    authoredDocument: persisted.authoredDocument,
    currentMapId: mapId,
    syncStatus: 'synced',
    syncError: null,
    pendingAuthoredMutations: [],
    serverAdoptionVersion: useGraphStore.getState().serverAdoptionVersion + 1,
  })
}

/**
 * Compare the local snapshot with the server and reconcile:
 * - identical content -> mark synced;
 * - server differs, local clean -> adopt the server snapshot;
 * - server differs, local has unsynced changes -> visible conflict (no side is discarded).
 * Network failures keep the local snapshot but surface an explicit unverified
 * state; empty server snapshots settle to idle. `synced` requires server data.
 */
async function checkServerFreshness(mapId: string): Promise<void> {
  const data = await fetchServerSnapshot(mapId)

  const state = useGraphStore.getState()
  if (state.currentMapId !== mapId) return

  const localRaw = localStorage.getItem(storageKey(mapId))

  if (!data) {
    // The server copy could not be read (offline or HTTP failure). The local
    // snapshot is preserved, but synchronization is unverified: never claim
    // `synced` from a marker alone.
    if (localRaw) {
      useGraphStore.setState({
        syncStatus: 'error',
        syncError: 'Offline — could not verify the server copy. Local changes are preserved.',
      })
    } else {
      useGraphStore.setState({ syncStatus: 'idle', syncError: null })
    }
    return
  }

  if (isServerSnapshotEmpty(data)) {
    // Nothing on the server to reconcile against. Keep the local snapshot but
    // settle on an explicit state — never leave load-time `checking` stuck.
    useGraphStore.setState({ syncStatus: 'idle', syncError: null })
    return
  }

  if (!localRaw) return
  let localSnapshot: unknown
  try {
    localSnapshot = JSON.parse(localRaw)
  } catch {
    return
  }

  const localFingerprint = graphFingerprint(localSnapshot)
  const serverFingerprint = graphFingerprint(data)
  const storeFingerprint = graphFingerprint(state.graph.toJSON())

  if (serverFingerprint === localFingerprint && storeFingerprint === localFingerprint) {
    writeSyncMarker(mapId, localFingerprint, new Date().toISOString(), data.updatedAt ?? null)
    useGraphStore.setState({ syncStatus: 'synced', syncError: null })
    return
  }

  const marker = readSyncMarker(mapId)

  const localDirty = !marker || marker.snapshotFingerprint !== localFingerprint
  const storeAhead = storeFingerprint !== localFingerprint

  if (!localDirty && (!storeAhead || state.pendingAuthoredMutations.length === 0)) {
    const lastServerTime = marker?.serverTimestamp ? Date.parse(marker.serverTimestamp) : Number.NaN
    const incomingServerTime = data.updatedAt ? Date.parse(data.updatedAt) : Number.NaN
    if (Number.isFinite(lastServerTime) && Number.isFinite(incomingServerTime)) {
      if (incomingServerTime <= lastServerTime) {
        // A stale replica/response or matching revision with post-mount projection
        // must not roll a clean snapshot back or surface a false conflict.
        useGraphStore.setState({ syncStatus: 'synced', syncError: null })
        return
      }
      if (incomingServerTime > lastServerTime) {
        try {
          adoptServerSnapshotData(mapId, data)
        } catch (error) {
          useGraphStore.setState({ syncStatus: 'error', syncError: error instanceof Error ? error.message : 'Unable to persist server version locally.' })
        }
        return
      }
    } else {
      // Legacy markers have no server revision. Preserve established behavior
      // while the next successful response upgrades the marker.
      try {
        adoptServerSnapshotData(mapId, data)
      } catch (error) {
        useGraphStore.setState({ syncStatus: 'error', syncError: error instanceof Error ? error.message : 'Unable to persist server version locally.' })
      }
      return
    }
  }

  const stamp = data.updatedAt ? ` (updated ${data.updatedAt})` : ''
  useGraphStore.setState({
    syncStatus: 'conflict',
    syncError: `The server has a different version of this map${stamp}. Your unsynced local changes are preserved. Use "Load server version" to replace them, or reSync({ force: true }) to overwrite the server.`,
  })
}

export const useGraphStore = create<GraphState>((set, get) => ({
  graph: new Graph(),
  authoredDocument: null,
  setAuthoredDocument: (document) => {
    const snapshot = document ? JSON.parse(JSON.stringify(document)) as CampusDocument : null
    set({ authoredDocument: snapshot })
  },
  currentMapId: null,
  serverAdoptionVersion: 0,
  renderVersion: 0,
  syncStatus: 'idle',
  syncError: null,
  campusReady: true,
  pendingAuthoredMutations: [],

  recordAuthoredMutation: (kind, buildingId, floor) => {
    authoredIntentSeq += 1
    set((state) => {
      const next = appendIntent(state.pendingAuthoredMutations, { kind, buildingId, floor }, authoredIntentSeq)
      return next === state.pendingAuthoredMutations ? {} : { pendingAuthoredMutations: next }
    })
  },

  clearAuthoredMutations: (ackedSeq) => {
    set((state) => ({ pendingAuthoredMutations: intentsIncludedInSave(state.pendingAuthoredMutations, ackedSeq) }))
  },

  beginCampusHydration: () => set({ campusReady: false }),
  completeCampusHydration: () => {
    const currentJson = get().graph.toJSON()
    lastAcknowledgedCollections = collectionsOf(currentJson)
    set({ campusReady: true })
  },

  addNode: (node) => {
    const n = node as { buildingId?: string | null; floor?: number | null; type?: string }
    get().recordAuthoredMutation(n.type === 'room_door' ? 'door' : n.buildingId ? 'route' : 'outdoor', n.buildingId ?? null, n.floor ?? null)
    get().graph.addNode(node)
    set({ renderVersion: get().renderVersion + 1 })
  },

  removeNode: (id) => {
    const n = get().graph.nodes.find((x) => x.id === id) as { buildingId?: string | null; floor?: number | null; type?: string } | undefined
    get().recordAuthoredMutation(n?.type === 'room_door' ? 'door' : n?.buildingId ? 'route' : 'outdoor', n?.buildingId ?? null, n?.floor ?? null)
    get().graph.removeNode(id)
    set({ renderVersion: get().renderVersion + 1 })
  },

  updateNode: (id, partial) => {
    const n = get().graph.nodes.find((x) => x.id === id) as { buildingId?: string | null; floor?: number | null; type?: string } | undefined
    get().recordAuthoredMutation(n?.type === 'room_door' ? 'door' : n?.buildingId ? 'route' : 'outdoor', n?.buildingId ?? null, n?.floor ?? null)
    get().graph.updateNode(id, partial)
    set({ renderVersion: get().renderVersion + 1 })
  },

  addEdge: (edge) => {
    const scope = edgeScope(get().graph, edge)
    get().recordAuthoredMutation(scope.buildingId ? 'route' : 'outdoor', scope.buildingId, scope.floor)
    get().graph.addEdge(edge)
    set({ renderVersion: get().renderVersion + 1 })
  },

  removeEdge: (id) => {
    const edge = get().graph.edges.find((x) => x.id === id)
    const scope = edgeScope(get().graph, edge)
    get().recordAuthoredMutation(scope.buildingId ? 'route' : 'outdoor', scope.buildingId, scope.floor)
    get().graph.removeEdge(id)
    set({ renderVersion: get().renderVersion + 1 })
  },

  updateEdge: (id, partial) => {
    const edge = get().graph.edges.find((x) => x.id === id)
    const scope = edgeScope(get().graph, edge)
    get().recordAuthoredMutation(scope.buildingId ? 'route' : 'outdoor', scope.buildingId, scope.floor)
    get().graph.updateEdge(id, partial)
    set({ renderVersion: get().renderVersion + 1 })
  },

  addBuilding: (building) => {
    get().recordAuthoredMutation('building', building.id, null)
    get().graph.addBuilding(building)
    set({ renderVersion: get().renderVersion + 1 })
  },

  updateBuilding: (id, partial) => {
    get().recordAuthoredMutation('building', id, null)
    get().graph.updateBuilding(id, partial)
    set({ renderVersion: get().renderVersion + 1 })
  },

  removeBuilding: (id) => {
    get().recordAuthoredMutation('building', id, null)
    get().graph.removeBuilding(id)
    set({ renderVersion: get().renderVersion + 1 })
  },

  setNodes: (nodes) => {
    // Hydration boundary — NOT an authored mutation (P0.11 §7).
    get().graph.setNodes(nodes)
    set({ renderVersion: get().renderVersion + 1 })
  },

  setEdges: (edges) => {
    // Hydration boundary — NOT an authored mutation (P0.11 §7).
    get().graph.setEdges(edges)
    set({ renderVersion: get().renderVersion + 1 })
  },

  setBuildings: (buildings) => {
    // Hydration boundary — NOT an authored mutation (P0.11 §7).
    get().graph.setBuildings(buildings)
    set({ renderVersion: get().renderVersion + 1 })
  },

  addComponent: (component) => {
    const c = component as Component & { buildingId?: string | null; floor?: number | null }
    get().recordAuthoredMutation('floor', c.buildingId ?? null, c.floor ?? null)
    const graph = get().graph
    const buildingsMap = new Map(graph.buildings.map((b) => [b.id, b]))
    const currentMapId = get().currentMapId
    const result = compileComponent(component, {
      buildings: buildingsMap,
      existingNodes: graph.nodes,
      existingEdges: graph.edges,
      componentId: component.id,
      campusId: component.campusId ?? currentMapId ?? undefined,
    })
    graph.addComponent({ ...component, polygon: component.polygon ?? result.polygon })
    for (const node of result.nodes) {
      graph.addNode(node)
    }
    for (const edge of result.edges) {
      graph.addEdge(edge)
    }
    if (component.type === 'hallway') {
      graph.syncHallwayIntersections(component.buildingId, component.floor)
    }
    set({ renderVersion: get().renderVersion + 1 })
  },

  updateComponent: (id, partial) => {
    const c = get().graph.getComponent(id) as (Component & { buildingId?: string | null; floor?: number | null }) | undefined
    get().recordAuthoredMutation('floor', c?.buildingId ?? null, c?.floor ?? null)
    get().graph.updateComponent(id, partial)
    set({ renderVersion: get().renderVersion + 1 })
  },

  removeComponent: (id) => {
    const graph = get().graph
    const component = graph.getComponent(id) as (Component & { buildingId?: string | null; floor?: number | null }) | undefined
    get().recordAuthoredMutation('floor', component?.buildingId ?? null, component?.floor ?? null)
    graph.removeComponent(id)
    if (component?.type === 'entrance') {
      const building = graph.getBuilding(component.buildingId)
      if (building && building.entrances) {
        graph.updateBuilding(component.buildingId, {
          entrances: building.entrances.filter((e) => e.id !== id),
        })
      }
    }
    set({ renderVersion: get().renderVersion + 1 })
  },

  addTrace: (trace) => {
    const t = trace as { buildingId?: string | null; floor?: number | null }
    get().recordAuthoredMutation(t.buildingId ? 'route' : 'outdoor', t.buildingId ?? null, t.floor ?? null)
    const roomNodes = get().graph.nodes.filter(n => n.type === 'room_door' || n.type === 'room')
    get().graph.addTraceWithCompile(trace, roomNodes)
    set({ renderVersion: get().renderVersion + 1 })
  },

  updateTrace: (id, partial) => {
    const t = (get().graph.traces ?? []).find((x) => x.id === id) as { buildingId?: string | null; floor?: number | null } | undefined
    get().recordAuthoredMutation(t?.buildingId ? 'route' : 'outdoor', t?.buildingId ?? null, t?.floor ?? null)
    get().graph.updateTrace(id, partial)
    set({ renderVersion: get().renderVersion + 1 })
  },

  removeTrace: (id) => {
    const t = (get().graph.traces ?? []).find((x) => x.id === id) as { buildingId?: string | null; floor?: number | null } | undefined
    get().recordAuthoredMutation(t?.buildingId ? 'route' : 'outdoor', t?.buildingId ?? null, t?.floor ?? null)
    get().graph.removeTrace(id)
    set({ renderVersion: get().renderVersion + 1 })
  },

  recompileTrace: (id: string) => {
    const t = (get().graph.traces ?? []).find((x) => x.id === id) as { buildingId?: string | null; floor?: number | null } | undefined
    get().recordAuthoredMutation(t?.buildingId ? 'route' : 'outdoor', t?.buildingId ?? null, t?.floor ?? null)
    get().graph.recompileTrace(id)
    set({ renderVersion: get().renderVersion + 1 })
  },

  addComponentWithPolygon: (component: Component) => get().addComponent(component),

  rotateBuilding: (buildingId: string, angleRad: number) => {
    const graph = get().graph
    const building = graph.buildings.find((b) => b.id === buildingId)
    if (!building || !building.footprint || building.footprint.length === 0) return
    get().recordAuthoredMutation('building', buildingId, null)

    const centroid = building.footprint.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
      { lat: 0, lng: 0 },
    )
    centroid.lat /= building.footprint.length
    centroid.lng /= building.footprint.length

    const cosA = Math.cos(angleRad)
    const sinA = Math.sin(angleRad)
    const newFootprint = building.footprint.map((p) => {
      const dx = p.lng - centroid.lng
      const dy = p.lat - centroid.lat
      return {
        lat: centroid.lat + (dy * cosA - dx * sinA),
        lng: centroid.lng + (dx * cosA + dy * sinA),
      }
    })

    graph.updateBuilding(buildingId, { footprint: newFootprint })
    set({ renderVersion: get().renderVersion + 1 })
  },

  load: async () => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      await get().fetchFromSupabase()
      return
    }
    try {
      const snapshot = JSON.parse(raw)
      const persisted = parseAuthoredGraphPayload(snapshot)
      const graph = Graph.fromJSON(persisted.graphPayload as GraphSnapshot)
      set({ graph, authoredDocument: persisted.authoredDocument })
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[graph-store] Failed to parse localStorage graph:', e)
      }
      await get().fetchFromSupabase()
    }
  },

  loadMapData: (mapId: string) => {
    if (typeof window === 'undefined') return
    // P0.12: a campus load begins — the acknowledged baseline is unknown until
    // the load settles, so it must not authorize or block saves meanwhile.
    lastAcknowledgedCollections = null
    authoredIntentSeq = 0
    // P0.14: not ready while an authoritative campus load is in flight.
    get().beginCampusHydration()
    const key = storageKey(mapId)
    const raw = localStorage.getItem(key)
    let graph = new Graph()
    let authoredDocument: CampusDocument | null = null
    if (raw) {
      try {
        const snapshot = JSON.parse(raw)
        const persisted = parseAuthoredGraphPayload(snapshot)
        graph = Graph.fromJSON(persisted.graphPayload as GraphSnapshot)
        authoredDocument = persisted.authoredDocument
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[graph-store] Failed to parse map data from localStorage:', e)
        }
        // A malformed authored companion must not make the legacy Graph
        // unreadable. Keep the established compatibility path, but do not
        // manufacture authored state from it.
        try {
          graph = Graph.fromJSON(JSON.parse(raw))
        } catch {
          graph = new Graph()
        }
      }
    }
    // Ensure graph identity matches the map being loaded
    graph.campusId = mapId

    // CASE A — No local graph or empty: fetch from Supabase
    if (!raw || !graph.buildings.length) {
      set({ graph, authoredDocument, currentMapId: null })
      void get().fetchFromSupabase(mapId)
      return
    }

    // CASE B — Local graph exists with buildings.
    // Fast paint from the local cache, then always check the server. A local
    // snapshot must never be silently preferred over newer server data. A
    // matching marker only means "was saved last session" — synchronization is
    // unconfirmed until checkServerFreshness settles it.
    let locallySynced = false
    try {
      const marker = readSyncMarker(mapId)
      locallySynced = marker?.snapshotFingerprint === graphFingerprint(JSON.parse(raw))
    } catch {
      locallySynced = false
    }
    set({ graph, authoredDocument, currentMapId: mapId, syncStatus: locallySynced ? 'checking' : 'idle', syncError: null })
    void checkServerFreshness(mapId)
  },

  setCurrentMapId: (mapId: string | null) => {
    const graph = get().graph
    if (mapId) graph.campusId = mapId
    if (mapId !== get().currentMapId) {
      // P0.12 campus isolation: per-campus authored intents and the
      // acknowledged baseline must never carry across campuses.
      lastAcknowledgedCollections = null
      authoredIntentSeq = 0
      set({ currentMapId: mapId, authoredDocument: null, pendingAuthoredMutations: [], campusReady: false })
    } else {
      set({ currentMapId: mapId })
    }
  },

  save: async (options?: { trigger?: SaveTrigger }) => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (mapId && adoptingCampuses.has(mapId)) throw new Error('Save paused while the server version is being adopted.')
    // Keep graph identity in sync with the active map
    if (mapId) get().graph.campusId = mapId
    const key = mapId ? storageKey(mapId) : STORAGE_KEY
    const json = get().graph.toJSON()
    const currentAuthored = get().authoredDocument ?? useGraphStore.getState().authoredDocument
    const persisted = serializeAuthoredGraphPayload(json as unknown as Record<string, unknown>, currentAuthored)
    localStorage.setItem(key, JSON.stringify(persisted))
    await get().syncToSupabase({ trigger: options?.trigger })
  },

  reset: () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    const key = mapId ? storageKey(mapId) : STORAGE_KEY
    localStorage.removeItem(key)
    set({ graph: new Graph(), authoredDocument: null, currentMapId: null, syncStatus: 'idle', syncError: null })
  },

  syncToSupabase: async (options?: { force?: boolean; trigger?: SaveTrigger }) => {
    if (typeof window === 'undefined') return
    const unresolvedConflict = get().syncStatus === 'conflict' ? get().syncError : null
    if (unresolvedConflict) {
      // Never overwrite a divergent server snapshot from an autosave. The user
      // must resolve explicitly via reSync({ force: true }) or adoptServerSnapshot().
      console.warn('[graph-store] syncToSupabase blocked while a server conflict is unresolved:', unresolvedConflict)
      throw new Error(unresolvedConflict)
    }
    const mapId = get().currentMapId
    if (mapId && adoptingCampuses.has(mapId)) throw new Error('Sync paused while the server version is being adopted.')
    if (!mapId) {
      const message = 'Cannot sync without an active map'
      set({ syncStatus: 'error', syncError: message })
      throw new Error(message)
    }
    // Per-campus queue: overlapping autosave/visibility/manual writes must not
    // race each other with the same expectedServerUpdatedAt.
    await enqueueCampusSave(mapId, options?.force === true, options?.trigger ?? 'manual')
  },

  /**
   * Force re-sync the current graph to Supabase.
   * Useful for recovering from a failed sync (e.g. after fixing field mappings).
   * Call this from the browser console:
   *   useGraphStore.getState().reSync()
   *
   * Without `force`, refuses to overwrite a server snapshot whose content
   * differs from the local copy and reports a recoverable conflict instead.
   *   useGraphStore.getState().reSync({ force: true }) — overwrite the server.
   */
  reSync: async (options?: { force?: boolean }) => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (!mapId) {
      console.warn('[graph-store] reSync: no active map')
      return
    }
    if (adoptingCampuses.has(mapId)) throw new Error('Re-sync paused while the server version is being adopted.')

    if (!options?.force) {
      const data = await fetchServerSnapshot(mapId)
      if (data && !isServerSnapshotEmpty(data)) {
        const localRaw = localStorage.getItem(storageKey(mapId))
        let localSnapshot: unknown = null
        if (localRaw) {
          try {
            localSnapshot = JSON.parse(localRaw)
          } catch {
            localSnapshot = null
          }
        }
        if (!localSnapshot || graphFingerprint(localSnapshot) !== graphFingerprint(data)) {
          const stamp = data.updatedAt ? ` (updated ${data.updatedAt})` : ''
          const message = `The server has a different version of this map${stamp}. reSync refused to overwrite it. Use reSync({ force: true }) to overwrite the server, or adoptServerSnapshot() to load the server version.`
          console.warn('[graph-store] reSync blocked by server conflict:', message)
          set({ syncStatus: 'conflict', syncError: message })
          throw new Error(message)
        }
      }
    }

    if (options?.force) {
      // Explicit overwrite: leave the conflict state and push the local copy.
      set({ syncStatus: 'idle', syncError: null })
    }

    const key = storageKey(mapId)
    const raw = localStorage.getItem(key)
    if (raw) {
      try {
        const persisted = parseAuthoredGraphPayload(JSON.parse(raw))
        const graph = Graph.fromJSON(persisted.graphPayload as GraphSnapshot)
        graph.campusId = mapId
        set({ graph, authoredDocument: persisted.authoredDocument, currentMapId: mapId })
      } catch (e) {
        console.warn('[graph-store] reSync: failed to parse local data', e)
      }
    }
    await get().syncToSupabase({ force: options?.force })
  },

  /**
   * Resolve a local/server conflict in favour of the server snapshot.
   * The unsynced local copy is replaced only after the user confirms. Do not
   * duplicate large snapshots in localStorage: quota pressure can block the
   * authoritative replacement itself.
   */
  adoptServerSnapshot: async () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (!mapId) return
    if (adoptingCampuses.has(mapId)) throw new Error('Server adoption is already in progress.')
    adoptingCampuses.add(mapId)
    try {
      // Stop queued local snapshots and let any already-running request settle
      // before fetching the revision to adopt. This prevents an older POST from
      // racing the authoritative GET.
      invalidateQueuedCampusSaves(mapId, 'Superseded by authoritative server adoption')
      await waitForCampusSavesToSettle(mapId)
      if (get().currentMapId !== mapId) throw new Error('Server adoption cancelled because Studio navigated to another campus.')

      const data = await fetchServerSnapshot(mapId)
      if (!data || isServerSnapshotEmpty(data)) {
        throw new Error('Unable to load the server version. Check your connection and try again.')
      }
      if (get().currentMapId !== mapId) throw new Error('Server adoption cancelled because Studio navigated to another campus.')
      adoptServerSnapshotData(mapId, data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to adopt the server version.'
      if (get().currentMapId === mapId) set({ syncStatus: 'conflict', syncError: message })
      throw error
    } finally {
      adoptingCampuses.delete(mapId)
    }
  },

  syncLocalChanges: async () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (!mapId) return
    if (get().syncStatus !== 'conflict') return

    const acknowledged = readSyncMarker(mapId)?.snapshotFingerprint ?? null
    const data = await fetchServerSnapshot(mapId)
    if (!data) {
      const message = 'Could not reach the server. Your local work is preserved; try again.'
      set({ syncStatus: 'error', syncError: message })
      throw new Error(message)
    }

    // Genuine divergence (CASE C): the server moved beyond the acknowledged
    // base. Never overwrite; keep the local work and the conflict state.
    if (acknowledged !== null && graphFingerprint(data) !== acknowledged) {
      const message = 'Server and local changes differ. Your local work is preserved.'
      set({ syncStatus: 'conflict', syncError: message })
      throw new Error(message)
    }

    // Server is still at the acknowledged base (CASE B): retry the preserved
    // local work through the normal guarded save queue with the latest
    // expected revision. Clear conflict only after an authoritative ack.
    set({ syncStatus: 'idle', syncError: null })
    try {
      await enqueueCampusSave(mapId, false, 'manual')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed'
      set({ syncStatus: 'conflict', syncError: message })
      throw error
    }
  },

  fetchFromSupabase: async (mapId?: string) => {
    if (typeof window === 'undefined') return
    const effectiveMapId = mapId || get().currentMapId
    // P0.12: baseline unknown while an authoritative fetch is in flight.
    lastAcknowledgedCollections = null
    authoredIntentSeq = 0
    // P0.14: not ready until the fetched graph is reconciled by the editor.
    get().beginCampusHydration()
    set({ syncStatus: 'syncing' })
    try {
      const url = effectiveMapId ? `/api/graph?campus_id=${encodeURIComponent(effectiveMapId)}` : `/api/graph`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as PersistedGraphSnapshot
      let authoredDocument: CampusDocument | null = null
      try {
        authoredDocument = parseAuthoredGraphPayload(data).authoredDocument
      } catch (error) {
        console.warn('[graph-store] server authored snapshot could not be hydrated:', error)
      }
      if (!data || !data.nodes) {
        // F3: metadata-only or legacy rows carry an authoritative revision but
        // no graph arrays. Record that revision and mount an empty graph so the
        // editor can open and adopt the row on its first save.
        if (effectiveMapId && data?.updatedAt) {
          let fingerprint: string
          try {
            fingerprint = graphFingerprint(data)
          } catch {
            fingerprint = snapshotFingerprint(stableStringify(data))
          }
          writeSyncMarker(effectiveMapId, fingerprint, data.updatedAt, data.updatedAt)
        }
        const emptyGraph = new Graph()
        if (effectiveMapId) emptyGraph.campusId = effectiveMapId
        set({ graph: emptyGraph, authoredDocument, currentMapId: effectiveMapId ?? null, syncStatus: 'idle' })
        return
      }
      const graph = Graph.fromJSON(data)
      // Keep graph identity in sync with the map we loaded
      if (effectiveMapId) graph.campusId = effectiveMapId
      // Record server freshness for future load comparisons. Only real server
      // timestamps may enter the marker.
      if (effectiveMapId && data.updatedAt) {
        writeSyncMarker(effectiveMapId, graphFingerprint(data), data.updatedAt, data.updatedAt)
      }
      lastAcknowledgedCollections = collectionsOf(data)
      // A fresh authoritative load replaces any retained local edits: discard
      // their intents and queued saves so they cannot resurrect after load.
      if (effectiveMapId) {
        authoredIntentSeq = 0
        bumpCampusEpoch(effectiveMapId)
        invalidateQueuedCampusSaves(effectiveMapId, 'Superseded by authoritative server load')
      }
      useGraphStore.setState({ pendingAuthoredMutations: [] })
      set({ graph, authoredDocument, currentMapId: effectiveMapId, syncStatus: 'synced' })
    } catch (e) {
      console.warn('[graph-store] fetchFromSupabase failed:', e)
      set({ syncStatus: 'idle' })
    }
  },
}))

// ── Per-campus save serialization ─────────────────────────────────────────
//
// Optimistic concurrency requires a single writer per campus: when two POSTs
// read the same expectedServerUpdatedAt, the second one conflicts against the
// revision produced by the first (a self-conflict). All save triggers
// (autosave debounce, visibility/unload flush, building drag, wizard, online
// resync, forced re-sync) funnel through this queue.
//
// Contract:
//   - at most one `/api/graph` POST in flight per campus;
//   - while one runs, callers join a single coalesced follow-up;
//   - the follow-up re-reads the newest graph and the latest acknowledged
//     revision at execution time, so a later local edit is never lost.

/** P0.11 — explicit save trigger (manual vs autosave) — never inferred from timing. */
export type SaveTrigger = 'autosave' | 'manual'

interface CampusSaveQueue {
  running: boolean
  hasPending: boolean
  pendingForce: boolean
  pendingTrigger: SaveTrigger
  waiters: Array<{ resolve: () => void; reject: (reason: unknown) => void }>
  idleWaiters: Array<() => void>
}

const campusSaveQueues = new Map<string, CampusSaveQueue>()

/** Test-only: clears queued/running save state between test cases. */
export function __resetGraphSaveQueuesForTests(): void {
  campusSaveQueues.clear()
  // P0.12: module-level safety state must not leak across test cases (the
  // acknowledged baseline and authored sequence are per-campus runtime state).
  lastAcknowledgedCollections = null
  authoredIntentSeq = 0
  campusEpoch.clear()
  adoptingCampuses.clear()
  // P0.14: fixtures start from a fully hydrated campus; tests that exercise the
  // load lifecycle call beginCampusHydration()/completeCampusHydration() explicitly.
  useGraphStore.setState({ pendingAuthoredMutations: [], campusReady: true })
}

function getCampusSaveQueue(mapId: string): CampusSaveQueue {
  let queue = campusSaveQueues.get(mapId)
  if (!queue) {
    queue = { running: false, hasPending: false, pendingForce: false, pendingTrigger: 'manual', waiters: [], idleWaiters: [] }
    campusSaveQueues.set(mapId, queue)
  }
  return queue
}

function waitForCampusSavesToSettle(mapId: string): Promise<void> {
  const queue = campusSaveQueues.get(mapId)
  if (!queue?.running) return Promise.resolve()
  return new Promise<void>((resolve) => queue.idleWaiters.push(resolve))
}

function resolveCampusQueueIdle(queue: CampusSaveQueue): void {
  const waiters = queue.idleWaiters.splice(0)
  for (const resolve of waiters) resolve()
}

function enqueueCampusSave(mapId: string, force: boolean, trigger: SaveTrigger = 'manual'): Promise<void> {
  const queue = getCampusSaveQueue(mapId)

  if (queue.running) {
    queue.hasPending = true
    queue.pendingForce = queue.pendingForce || force
    // A pending manual request must not be downgraded to autosave semantics.
    queue.pendingTrigger = queue.pendingTrigger === 'manual' || trigger === 'manual' ? 'manual' : 'autosave'
    return new Promise<void>((resolve, reject) => {
      queue.waiters.push({ resolve, reject })
    })
  }

  queue.running = true
  const firstRun = performSyncToSupabase(mapId, force, trigger)
  // Drain after the first run settles. `firstRun` is also the first caller's
  // result, so its outcome is not coupled to later queued writes.
  void firstRun.then(
    () => {
      void drainCampusSaveQueue(mapId, queue)
    },
    (error: unknown) => {
      rejectQueuedSaves(queue, error)
      queue.running = false
      resolveCampusQueueIdle(queue)
    },
  )
  return firstRun
}

async function drainCampusSaveQueue(mapId: string, queue: CampusSaveQueue): Promise<void> {
  while (queue.hasPending) {
    const force = queue.pendingForce
    const trigger = queue.pendingTrigger
    const waiters = queue.waiters.splice(0)
    queue.hasPending = false
    queue.pendingForce = false
    queue.pendingTrigger = 'manual'
    try {
      await performSyncToSupabase(mapId, force, trigger)
      for (const waiter of waiters) waiter.resolve()
    } catch (error) {
      rejectQueuedSaves(queue, error, waiters)
      break
    }
  }
  queue.running = false
  resolveCampusQueueIdle(queue)
}

function rejectQueuedSaves(
  queue: CampusSaveQueue,
  error: unknown,
  settled: CampusSaveQueue['waiters'] = [],
): void {
  const stillWaiting = queue.waiters.splice(0)
  queue.hasPending = false
  queue.pendingForce = false
  for (const waiter of [...settled, ...stillWaiting]) waiter.reject(error)
}

async function performSyncToSupabase(mapId: string, force: boolean, trigger: SaveTrigger = 'manual'): Promise<void> {
  const unresolvedConflict =
    useGraphStore.getState().syncStatus === 'conflict' ? useGraphStore.getState().syncError : null
  if (unresolvedConflict) {
    console.warn('[graph-store] syncToSupabase blocked while a server conflict is unresolved:', unresolvedConflict)
    throw new Error(unresolvedConflict)
  }
  if (useGraphStore.getState().currentMapId !== mapId) {
    // The editor moved to another map while this save was queued; the graph
    // for `mapId` is no longer the active one. Its local cache is intact.
    console.warn(`[graph-store] syncToSupabase skipped: map "${mapId}" is no longer active`)
    return
  }

  // ── P0.11 save contract (trigger + authored intent + readiness) ──────────
  const preState = useGraphStore.getState()
  if (!preState.campusReady) {
    // Never write a partially hydrated candidate — manual save included.
    console.warn(`[graph-store] save refused: campus not ready (trigger=${trigger})`)
    return
  }
  const candidateSnapshot = preState.graph.toJSON()
  const candidateHash = graphFingerprint(candidateSnapshot)
  const acknowledgedFingerprint = readSyncMarker(mapId)?.snapshotFingerprint ?? null
  const pending = preState.pendingAuthoredMutations
  const candidateUnchanged = acknowledgedFingerprint !== null && acknowledgedFingerprint === candidateHash
  let includedUpTo = 0

  if (trigger === 'autosave' && pending.length === 0) {
    // CASE A: nothing authored to persist — no POST.
    return
  }

  if (pending.length === 0) {
    // CASE D/E: clean manual save = explicit revision refresh (POST).
    // CASE E: a changed candidate with no authored intent is an unattributed
    // persistent mutation and fails closed — but only once this session has an
    // acknowledged baseline AND has performed at least one authored edit.
    // Hydration-only sessions (fixtures, programmatic document writes) keep the
    // legacy save behavior; their state never claims authored authority.
    if (!candidateUnchanged && lastAcknowledgedCollections !== null && authoredIntentSeq > 0) {
      const message = 'Unattributed persistent graph mutation blocked during manual save'
      console.warn(`[graph-store] ${message}`)
      useGraphStore.setState({ syncStatus: 'error', syncError: message })
      return
    }
  } else {
    // CASE B/C: evaluate every pending intent against the last acknowledged
    // canonical baseline before any network write.
    includedUpTo = Math.max(...pending.map((p) => p.seq))
    if (lastAcknowledgedCollections) {
      const verdict = evaluateAuthoredSave(lastAcknowledgedCollections, collectionsOf(candidateSnapshot), pending)
      if (!verdict.allowed) {
        console.warn(`[graph-store] save blocked by safety guard: ${verdict.reason}`)
        useGraphStore.setState({ syncStatus: 'error', syncError: verdict.reason })
        return
      }
    }
  }

  useGraphStore.setState({ syncStatus: 'syncing', syncError: null })
  const snapshot = useGraphStore.getState().graph.toJSON()
  const snapshotHash = graphFingerprint(snapshot)
  const effectiveAuthored = preState.authoredDocument ?? useGraphStore.getState().authoredDocument
  const payload = serializeSnapshot(snapshot as unknown as GraphSnapshotLike, mapId, effectiveAuthored)
  const expectedServerUpdatedAt = readSyncMarker(mapId)?.serverTimestamp ?? null
  // One logical save attempt keeps one mutation id for every transport retry.
  const mutationId = newMutationId()
  const body = JSON.stringify({ ...payload, expectedServerUpdatedAt, forceServerOverwrite: force, mutationId })
  const epochAtStart = getCampusEpoch(mapId)

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('/api/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        ...(typeof body === 'string' && body.length < 60000 ? { keepalive: true } : {}),
        body,
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        const msg = errBody.error ?? `HTTP ${res.status}`
        if (isNetworkError(msg) && attempt < SYNC_RETRY_DELAYS.length) {
          await sleep(SYNC_RETRY_DELAYS[attempt])
          continue
        }
        throw new Error(msg)
      }
      const serverResult = (await res.json().catch(() => ({}))) as { updatedAt?: string | null }
      const acknowledgedRevision = await resolveAcknowledgedRevision(mapId, serverResult.updatedAt ?? null)
      if (getCampusEpoch(mapId) !== epochAtStart) {
        // The authoritative base was replaced while this save was in flight;
        // its acknowledgement must not be stamped onto the new base.
        console.warn('[graph-store] save superseded by authoritative adoption — ack discarded')
        return
      }
      if (!acknowledgedRevision) {
        // No authoritative revision means the next save would claim a stale
        // expectedServerUpdatedAt. Never report synchronized in that state.
        const message =
          'The save reached the server, but the authoritative revision could not be confirmed. Local changes remain cached; retry when the server is reachable.'
        console.warn('[graph-store] syncToSupabase could not confirm the server revision.')
        useGraphStore.setState({ syncStatus: 'error', syncError: message })
        throw new Error(message)
      }
      // A confirmed server revision always becomes the marker's revision. The
      // fingerprint records the exact content the server acknowledged, while
      // newer local edits remain tracked as unsynced by the fingerprint mismatch.
      writeSyncMarker(mapId, snapshotHash, new Date().toISOString(), acknowledgedRevision)
      // P0.11: the acknowledged snapshot is the new canonical guard baseline;
      // clear ONLY the intents included in this save (newer edits stay pending).
      lastAcknowledgedCollections = collectionsOf(snapshot)
      lastAcknowledgedSeq = Math.max(lastAcknowledgedSeq, includedUpTo)
      if (includedUpTo > 0) useGraphStore.getState().clearAuthoredMutations(includedUpTo)
      useGraphStore.setState({ syncStatus: 'synced', syncError: null })
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed'
      if (isNetworkError(msg) && attempt < SYNC_RETRY_DELAYS.length) {
        await sleep(SYNC_RETRY_DELAYS[attempt])
        continue
      }
      if (isNetworkError(msg)) {
        // Transient network failure — the graph is already safe in
        // localStorage, so surface a calm status and resume automatically
        // when the connection comes back.
        bindOnlineResync()
        const offlineMessage = 'Offline — changes saved locally. Will retry when back online.'
        console.warn('[graph-store] syncToSupabase offline — saved locally, will retry when back online:', msg)
        useGraphStore.setState({ syncStatus: 'error', syncError: offlineMessage })
        throw new Error(offlineMessage)
      } else if (/server changed|snapshot conflict/i.test(msg)) {
        useGraphStore.setState({ syncStatus: 'conflict', syncError: msg })
        throw new Error(msg)
      } else if (/mutation[_ ]?id[_ ]collision/i.test(msg)) {
        // Same mutation id reused with different content: never silently treat as a retry.
        console.error('[graph-store] syncToSupabase mutation id collision:', msg)
        useGraphStore.setState({ syncStatus: 'error', syncError: msg })
        throw new Error(msg)
      } else {
        console.error('[graph-store] syncToSupabase failed:', msg)
        useGraphStore.setState({ syncStatus: 'error', syncError: msg })
        throw new Error(msg)
      }
    }
  }
}

/**
 * Resolve the revision the save must acknowledge.
 *
 * Migration 009 returns `updatedAt`; the deployed 004/005 RPC does not. When
 * the POST response carries no revision, read the authoritative value back so
 * the next save never claims a revision the server has already advanced past.
 */
async function resolveAcknowledgedRevision(
  mapId: string,
  responseUpdatedAt: string | null,
): Promise<string | null> {
  if (typeof responseUpdatedAt === 'string' && responseUpdatedAt.length > 0) {
    return responseUpdatedAt
  }
  const data = await fetchServerSnapshot(mapId)
  return data?.updatedAt ?? null
}
