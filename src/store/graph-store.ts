import { create } from 'zustand'
import { Graph } from '../engine/graph'
import type { NavNode, NavEdge, Building, Component, GraphSnapshot, TracePath } from '../types/nav-types'
import { compileComponent } from '../engine/component-compiler'
import { serializeSnapshot, type GraphSnapshotLike } from '../services/graph-snapshot-serializer'
import { authoredFingerprint as authoredDocumentFingerprint } from '@navi/core'
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

/**
 * Test/development-only lifecycle trace.  The reload audit needs the exact
 * writer that runs last, including writes made through a function-local
 * Zustand setter.  Keeping the trace here avoids changing sync semantics or
 * exposing it to the production UI.
 */
export interface SyncStatusTraceEntry {
  source: string
  from: SyncStatus | null
  to: SyncStatus
  error: string | null
  at: number
  stack: string | null
}

const syncStatusTrace: SyncStatusTraceEntry[] = []

function inferSyncStatusSource(stack: string | undefined): string {
  const frames = (stack ?? '').split('\n').map((frame) => frame.trim())
  const known = [
    'checkServerFreshness',
    'syncLocalChanges',
    'performSyncToSupabase',
    'reSync',
    'adoptServerSnapshot',
    'fetchFromSupabase',
    'loadMapData',
    'reset',
  ]
  for (const name of known) {
    if (frames.some((frame) => frame.includes(name))) return name
  }
  return 'GRAPH_STORE_OTHER'
}

function recordSyncStatusTrace(next: Partial<Pick<SyncStatusTraceEntry, 'to' | 'error'>>, previous: SyncStatus | null): void {
  if (process.env.NODE_ENV === 'production') return
  if (!next.to) return
  const stack = new Error().stack ?? null
  syncStatusTrace.push({
    source: inferSyncStatusSource(stack ?? undefined),
    from: previous,
    to: next.to,
    error: next.error ?? null,
    at: Date.now(),
    stack,
  })
  // Keep repeated reloads bounded in a long-lived development tab.
  if (syncStatusTrace.length > 250) syncStatusTrace.splice(0, syncStatusTrace.length - 250)
}

export function __getSyncStatusTraceForTests(): SyncStatusTraceEntry[] {
  return syncStatusTrace.slice()
}

export function __resetSyncStatusTraceForTests(): void {
  syncStatusTrace.length = 0
}

interface GraphState {
  graph: Graph
  /** Canonical authored state when the active snapshot uses the new format. */
  authoredDocument: CampusDocument | null
  setAuthoredDocument: (document: CampusDocument | null) => void
  currentMapId: string | null
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
  /**
   * Phase 3B — local draft persistence: make the latest committed graph durable
   * on this device WITHOUT any server interaction. Never writes the sync
   * marker, never enqueues a save, never contacts /api/graph.
   */
  persistLocalDraft: () => void
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
 * Backoff delays (ms) between guarded retries for transient save failures.
 * The sequence is deliberately bounded so an outage never creates a 5-second
 * write loop; after the final delay the online listener provides the next
 * prompt recovery opportunity.
 */
const SYNC_RETRY_DELAYS = [2000, 5000, 10000, 30000]

class RetryableSyncError extends Error {
  readonly retryable = true

  constructor(message: string) {
    super(message)
    this.name = 'RetryableSyncError'
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

function isRetryableSyncFailure(error: unknown): boolean {
  return error instanceof RetryableSyncError || isNetworkError(error instanceof Error ? error.message : String(error))
}

const AUTH_REQUIRED_MESSAGE = 'Saving failed: authentication required. Sign in again to continue.'

function isAuthenticationFailureStatus(status: number): boolean {
  return status === 401 || status === 403
}

function isAuthenticationFailureMessage(message: string): boolean {
  return message === AUTH_REQUIRED_MESSAGE
}

/**
 * Per-campus supersession epoch (Phase 3A). Bumped whenever the authoritative
 * base is replaced (server adoption/load) INSIDE the same campus session.
 * Session generation protects across sessions; this protects stale work within
 * the active session. In-flight saves must not stamp an acknowledgement after
 * their base was superseded.
 */
const campusEpoch = new Map<string, number>()
const adoptingCampuses = new Set<string>()
const getCampusEpoch = (mapId: string): number => campusEpoch.get(mapId) ?? 0
const bumpCampusEpoch = (mapId: string): void => {
  campusEpoch.set(mapId, getCampusEpoch(mapId) + 1)
}

/**
 * Phase 3C — single-shot safe local-ahead resume. Set when freshness proves
 * server == acknowledged && local newer (server unchanged); drained exactly once
 * after campus readiness through the existing guarded save pipeline.
 */
let pendingLocalAheadResumeMapId: string | null = null

/**
 * Drain the single-shot local-ahead resume exactly once, only when both the
 * detection happened AND the campus is ready. Order-independent: called from
 * both checkServerFreshness (detection) and completeCampusHydration (readiness).
 */
function maybeDrainLocalAheadResume(mapId: string): void {
  if (pendingLocalAheadResumeMapId !== mapId) return
  if (!useGraphStore.getState().campusReady) return
  pendingLocalAheadResumeMapId = null
  // Same trigger semantics as syncLocalChanges CASE B: this is a deliberate,
  // guarded recovery write of preserved local work — not a blind autosave.
  void enqueueCampusSave(mapId, false, 'manual').catch(() => {
    console.warn('[graph-store] local-ahead auto-resume failed')
  })
}

let onlineResyncBound = false

/** Monotonic identity for one mounted campus editing session, including A → B → A. */
let campusSessionGeneration = 0

/**
 * Monotonic ordering for async sync/recovery work in the active editor.
 * Campus/session and epoch checks protect identity; this sequence prevents an
 * older same-session completion from replacing a newer save's final status.
 */
let syncOperationGeneration = 0
const latestSaveChainByCampus = new Map<string, string>()

function beginSyncOperation(): number {
  syncOperationGeneration += 1
  return syncOperationGeneration
}

function isCurrentSyncOperation(generation: number): boolean {
  return syncOperationGeneration === generation
}

type SaveLifecycleLogEntry = {
  event: 'request' | 'response' | 'recovery-read-request' | 'recovery-read-response' | 'recovery-read-comparison' | 'recovery-read-disposition'
  attemptNumber?: number
  httpStatus?: number | null
  retryable?: boolean
  retryScheduled?: boolean
  retryDelayMs?: number | null
  finalClientStatus?: string
  readOutcome?: SnapshotReadLifecycleResult['outcome'] | null
  outcome?: string
  staleDiscarded?: boolean
  statusWriteApplied?: boolean
  canonicalMatch?: boolean
  graphMatch?: boolean
  authoredMatch?: boolean
}

const SAVE_LIFECYCLE_LOG_FIELDS = new Set([
  'event', 'attemptNumber', 'httpStatus', 'retryable', 'retryScheduled', 'retryDelayMs',
  'finalClientStatus', 'readOutcome', 'outcome', 'staleDiscarded', 'statusWriteApplied',
  'canonicalMatch', 'graphMatch', 'authoredMatch',
])

function logSaveLifecycle(entry: SaveLifecycleLogEntry): void {
  const safeEntry = Object.fromEntries(
    Object.entries(entry).filter(([field]) => SAVE_LIFECYCLE_LOG_FIELDS.has(field)),
  )
  console.info(`[graph-store] save lifecycle ${JSON.stringify(safeEntry)}`)
}

/** P0.11 — monotonic sequence for authored mutation intents. */
let authoredIntentSeq = 0

function isActiveCampusSession(mapId: string, generation: number): boolean {
  return campusSessionGeneration === generation && useGraphStore.getState().currentMapId === mapId
}

/** Test-only lifecycle context for the P0 save trace; never used by the UI. */
export function __getGraphSaveSessionContextForTests(mapId: string): {
  sessionGeneration: number
  campusEpoch: number
} {
  return { sessionGeneration: campusSessionGeneration, campusEpoch: getCampusEpoch(mapId) }
}

function saveWasSuperseded(
  mapId: string,
  sessionGeneration: number,
  epochAtStart: number,
  snapshotHash: string,
  authoredHash: string | null,
  includedUpTo: number,
): boolean {
  if (!isActiveCampusSession(mapId, sessionGeneration)) return true
  if (getCampusEpoch(mapId) !== epochAtStart) return true
  const state = useGraphStore.getState()
  if (graphFingerprint(state.graph.toJSON()) !== snapshotHash) return true
  const currentAuthoredHash = state.authoredDocument ? authoredDocumentFingerprint(state.authoredDocument) : null
  if (currentAuthoredHash !== authoredHash) return true
  return state.pendingAuthoredMutations.some((intent) => intent.seq > includedUpTo)
}

/**
 * P0.11 — last server-acknowledged canonical collections (guard baseline).
 * Null until an authoritative load or save acknowledgement is captured.
 */
let lastAcknowledgedCollections: GuardCollections | null = null
let lastAcknowledgedSeq = 0

/** Safe diagnostic context for a guard rejection; never participates in save decisions. */
let lastConfirmedSaveSucceeded = false
let lastConfirmedSaveDocumentVersion: number | null = null

function resetSaveAcknowledgmentDiagnostic(): void {
  lastConfirmedSaveSucceeded = false
  lastConfirmedSaveDocumentVersion = null
}

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
    // Reconcile first so an uncertain acknowledgement that already committed
    // on the server is adopted without a fresh mutation id/CAS conflict. If
    // the server still has the acknowledged base, syncLocalChanges funnels the
    // preserved draft through the guarded save queue.
    if (state.currentMapId) void state.syncLocalChanges().catch(() => {})
  })
}

interface SyncMarker {
  snapshotFingerprint?: string
  /** Phase 3A.1 authored identity; absent means legacy Graph-only marker. */
  authoredFingerprint?: string | null
  syncedAt?: string
  serverTimestamp?: string | null
}

interface CanonicalSnapshotIdentity {
  /** Persistent Graph projection identity (legacy/compatibility fallback). */
  graphFingerprint: string
  /** Authored identity when the additive Phase 3A.1 companion is present. */
  authoredFingerprint: string | null
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
  authoredFingerprint?: string | null,
): boolean {
  try {
    const marker: SyncMarker = {
      snapshotFingerprint: fingerprint,
      syncedAt,
      serverTimestamp,
    }
    // Keep the field absent for untouched legacy markers, but make every new
    // authored-format acknowledgement explicit (including null for Graph-only
    // payloads). This preserves the old marker contract for compatibility.
    if (authoredFingerprint !== undefined) marker.authoredFingerprint = authoredFingerprint
    localStorage.setItem(syncStatusKey(mapId), JSON.stringify(marker))
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

/**
 * Build the identity used by the reload/recovery classifier.
 *
 * Authored snapshots are the canonical source whenever both sides carry the
 * Phase 3A.1 companion. The Graph fingerprint remains the compatibility path
 * for legacy payloads and for markers written before the companion existed.
 */
function canonicalSnapshotIdentity(
  snapshot: unknown,
  authoredDocument?: CampusDocument | null,
): CanonicalSnapshotIdentity {
  let authored = authoredDocument
  if (authoredDocument === undefined) {
    try {
      authored = parseAuthoredGraphPayload(snapshot).authoredDocument
    } catch {
      authored = null
    }
  }
  return {
    graphFingerprint: graphFingerprint(snapshot),
    authoredFingerprint: authored ? authoredDocumentFingerprint(authored) : null,
  }
}

function markerIdentity(marker: SyncMarker | null): CanonicalSnapshotIdentity | null {
  if (!marker?.snapshotFingerprint) return null
  return {
    graphFingerprint: marker.snapshotFingerprint,
    authoredFingerprint: marker.authoredFingerprint ?? null,
  }
}

/** Authored identity wins when present on both values; otherwise use Graph. */
function canonicalIdentityEqual(
  left: CanonicalSnapshotIdentity,
  right: CanonicalSnapshotIdentity,
): boolean {
  if (left.authoredFingerprint !== null && right.authoredFingerprint !== null) {
    return left.authoredFingerprint === right.authoredFingerprint
  }
  return left.graphFingerprint === right.graphFingerprint
}

function storeMatchesCanonical(
  store: CanonicalSnapshotIdentity,
  persisted: CanonicalSnapshotIdentity,
): boolean {
  // Authored equality classifies content, but a different persistent Graph
  // projection still needs reconciliation so the active renderer cannot keep
  // displaying a stale derived snapshot after a reload race.
  if (persisted.authoredFingerprint !== null && store.authoredFingerprint !== persisted.authoredFingerprint) {
    return false
  }
  return canonicalIdentityEqual(store, persisted) && store.graphFingerprint === persisted.graphFingerprint
}

/**
 * Authored snapshots remain canonical while the legacy Graph projection is
 * rebuilt by EditorBridge. This weaker match is used only for local-ahead
 * classification; strict Graph equality still governs authoritative adoption.
 */
function storeMatchesAuthoredCanonical(
  store: CanonicalSnapshotIdentity,
  persisted: CanonicalSnapshotIdentity,
): boolean {
  return persisted.authoredFingerprint !== null
    && store.authoredFingerprint === persisted.authoredFingerprint
}

function clearAcknowledgedAuthoredMutations(): void {
  const pending = useGraphStore.getState().pendingAuthoredMutations
  const acknowledgedSeq = pending.length > 0 ? Math.max(...pending.map((intent) => intent.seq)) : 0
  if (acknowledgedSeq > 0) useGraphStore.getState().clearAuthoredMutations(acknowledgedSeq)
}

type PersistedGraphSnapshot = GraphSnapshot & {
  updatedAt?: string
  authoredDocument?: unknown
  authoredDocumentFormatVersion?: number
}

type SnapshotReadLifecycleResult = {
  httpStatus: number | null
  outcome: 'authentication-required' | 'http-error' | 'success' | 'invalid' | 'response-error' | 'network-error'
  updatedAt: string | null
  graphFingerprint: string | null
  authoredFingerprint: string | null
  hasAuthoredDocument: boolean
  error: string | null
}

function emitSnapshotReadLifecycle(
  callback: ((entry: SnapshotReadLifecycleResult) => void) | undefined,
  entry: SnapshotReadLifecycleResult,
): void {
  try {
    callback?.(entry)
  } catch {
    // Diagnostic callbacks must never alter snapshot read behavior.
  }
}

async function fetchServerSnapshot(
  mapId: string,
  options?: {
    surfaceAuthenticationFailure?: boolean
    onLifecycle?: (entry: SnapshotReadLifecycleResult) => void
  },
): Promise<PersistedGraphSnapshot | null> {
  let responseStatus: number | null = null
  let lifecycleReported = false
  const report = (entry: SnapshotReadLifecycleResult) => {
    lifecycleReported = true
    emitSnapshotReadLifecycle(options?.onLifecycle, entry)
  }
  try {
    const res = await fetch(`/api/graph?campus_id=${encodeURIComponent(mapId)}`, { credentials: 'include' })
    responseStatus = res.status
    if (options?.surfaceAuthenticationFailure && isAuthenticationFailureStatus(res.status)) {
      report({
        httpStatus: res.status,
        outcome: 'authentication-required',
        updatedAt: null,
        graphFingerprint: null,
        authoredFingerprint: null,
        hasAuthoredDocument: false,
        error: AUTH_REQUIRED_MESSAGE,
      })
      throw new Error(AUTH_REQUIRED_MESSAGE)
    }
    if (!res.ok) {
      report({
        httpStatus: res.status,
        outcome: 'http-error',
        updatedAt: null,
        graphFingerprint: null,
        authoredFingerprint: null,
        hasAuthoredDocument: false,
        error: `HTTP ${res.status}`,
      })
      return null
    }
    const data = (await res.json()) as PersistedGraphSnapshot
    if (!data || !Array.isArray(data.nodes)) {
      report({
        httpStatus: res.status,
        outcome: 'invalid',
        updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : null,
        graphFingerprint: null,
        authoredFingerprint: null,
        hasAuthoredDocument: Boolean(data?.authoredDocument),
        error: 'Server snapshot did not contain a nodes array',
      })
      return null
    }
    if (options?.onLifecycle) {
      let identity: CanonicalSnapshotIdentity | null = null
      try {
        identity = canonicalSnapshotIdentity(data)
      } catch {
        // The existing caller retains responsibility for validating/adopting data.
      }
      report({
        httpStatus: res.status,
        outcome: 'success',
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
        graphFingerprint: identity?.graphFingerprint ?? null,
        authoredFingerprint: identity?.authoredFingerprint ?? null,
        hasAuthoredDocument: Boolean(data.authoredDocument),
        error: null,
      })
    }
    return data
  } catch (error) {
    if (!lifecycleReported) {
      report({
        httpStatus: responseStatus,
        outcome: responseStatus === null ? 'network-error' : 'response-error',
        updatedAt: null,
        graphFingerprint: null,
        authoredFingerprint: null,
        hasAuthoredDocument: false,
        error: (error instanceof Error ? error.message : 'Snapshot read failed').slice(0, 240),
      })
    }
    if (error instanceof Error && isAuthenticationFailureMessage(error.message)) throw error
    return null
  }
}

function isServerSnapshotEmpty(data: GraphSnapshot): boolean {
  return (data.buildings?.length ?? 0) === 0 && (data.nodes?.length ?? 0) === 0
}

/**
 * Drop queued (not yet running) saves for a campus whose authoritative base has
 * been replaced. Waiters are rejected with a descriptive reason so callers see
 * the truth instead of silently re-persisting a discarded graph.
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
  const identity = canonicalSnapshotIdentity(data, persisted.authoredDocument)
  try {
    localStorage.setItem(
      storageKey(mapId),
      JSON.stringify(serializeAuthoredGraphPayload(snapshot as unknown as Record<string, unknown>, persisted.authoredDocument)),
    )
  } catch (error) {
    throw new Error(`Unable to persist the server version locally: ${error instanceof Error ? error.message : "storage write failed"}`)
  }
  const markerWritten = writeSyncMarker(
    mapId,
    identity.graphFingerprint,
    data.updatedAt ?? new Date().toISOString(),
    data.updatedAt ?? null,
    identity.authoredFingerprint,
  )
  if (!markerWritten) throw new Error("Unable to record the adopted server revision locally.")
  lastAcknowledgedCollections = collectionsOf(snapshot)
  // Phase 3A — adopting the authoritative snapshot DISCARDS local edits: their
  // intents, queued saves, and stale in-flight acknowledgements must not
  // resurrect the discarded graph.
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
async function checkServerFreshness(mapId: string, sessionGeneration: number): Promise<void> {
  const data = await fetchServerSnapshot(mapId)

  const state = useGraphStore.getState()
  // A later reload of the same campus can replace both the in-memory graph
  // and its local draft while this request is still in flight. Only the
  // freshness check that belongs to the active load may write a status; an
  // older response must not re-run the divergence classifier against the new
  // graph and reassert a false conflict.
  if (!isActiveCampusSession(mapId, sessionGeneration)) return

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

  let localAuthoredDocument: CampusDocument | null = null
  try {
    localAuthoredDocument = parseAuthoredGraphPayload(localSnapshot).authoredDocument
  } catch {
    // A malformed companion falls back to the established Graph-only path.
  }
  const localIdentity = canonicalSnapshotIdentity(localSnapshot, localAuthoredDocument)
  const serverIdentity = canonicalSnapshotIdentity(data)
  const storeIdentity = canonicalSnapshotIdentity(state.graph.toJSON(), state.authoredDocument)
  const marker = readSyncMarker(mapId)
  const acknowledged = markerIdentity(marker)

  // Three-way CASE 1/I: local and server canonical authored content already
  // converge. Marker age, updatedAt drift, workflow timing, and a stale active
  // projection are metadata/runtime concerns—not a user conflict.
  if (canonicalIdentityEqual(localIdentity, serverIdentity)) {
    pendingLocalAheadResumeMapId = null
    if (!storeMatchesCanonical(storeIdentity, localIdentity)) {
      // Rebuild the active projection and authored companion from the
      // authoritative converged payload. This closes the reload/hydration race
      // without issuing a redundant network write.
      adoptServerSnapshotData(mapId, data)
      return
    }
    writeSyncMarker(
      mapId,
      serverIdentity.graphFingerprint,
      new Date().toISOString(),
      data.updatedAt ?? null,
      serverIdentity.authoredFingerprint,
    )
    lastAcknowledgedCollections = collectionsOf(data)
    clearAcknowledgedAuthoredMutations()
    useGraphStore.setState({ syncStatus: 'synced', syncError: null })
    return
  }

  const localDirty = acknowledged === null || !canonicalIdentityEqual(localIdentity, acknowledged)
  const serverDirty = acknowledged === null || !canonicalIdentityEqual(serverIdentity, acknowledged)
  const storeAhead = !storeMatchesCanonical(storeIdentity, localIdentity)
    && !storeMatchesAuthoredCanonical(storeIdentity, localIdentity)

  // Phase 3C — SAFE LOCAL-AHEAD (not divergence): the server has not changed
  // since our last acknowledgement; this device holds newer committed work
  // (Phase 3B local draft). Retain it and auto-resume after readiness.
  if (acknowledged !== null && !serverDirty && localDirty && !storeAhead) {
    pendingLocalAheadResumeMapId = mapId
    useGraphStore.setState({ syncStatus: 'idle', syncError: null })
    maybeDrainLocalAheadResume(mapId)
    return
  }

  // Three-way CASE 3: the local content is still exactly the acknowledged
  // baseline while the server has advanced. Adopt it; this is not a conflict.
  if (acknowledged !== null && !localDirty && serverDirty && !storeAhead) {
    const lastServerTime = marker?.serverTimestamp ? Date.parse(marker.serverTimestamp) : Number.NaN
    const incomingServerTime = data.updatedAt ? Date.parse(data.updatedAt) : Number.NaN
    if (!(Number.isFinite(lastServerTime) && Number.isFinite(incomingServerTime) && incomingServerTime < lastServerTime)) {
      adoptServerSnapshotData(mapId, data)
      return
    }
    // A stale replica/response must not roll a known-newer clean snapshot back.
    useGraphStore.setState({ syncStatus: 'synced', syncError: null })
    return
  }

  // Preserve the established legacy timestamp behavior for clean markers when
  // the authored companion is unavailable or internally inconsistent.
  if (acknowledged !== null && !localDirty && !storeAhead) {
    const lastServerTime = marker?.serverTimestamp ? Date.parse(marker.serverTimestamp) : Number.NaN
    const incomingServerTime = data.updatedAt ? Date.parse(data.updatedAt) : Number.NaN
    if (Number.isFinite(lastServerTime) && Number.isFinite(incomingServerTime)) {
      if (incomingServerTime < lastServerTime) {
        useGraphStore.setState({ syncStatus: 'synced', syncError: null })
        return
      }
      if (incomingServerTime > lastServerTime) {
        adoptServerSnapshotData(mapId, data)
        return
      }
    } else {
      adoptServerSnapshotData(mapId, data)
      return
    }
  }

  const stamp = data.updatedAt ? ` (updated ${data.updatedAt})` : ''
  useGraphStore.setState({
    syncStatus: 'conflict',
    syncError: `The server has a different version of this map${stamp}. Your unsynced local changes are preserved. Use "Load server version" to replace them, or reSync({ force: true }) to overwrite the server.`,
  })
}

const graphStore = create<GraphState>((rawSet, get) => {
  // Capture every internal sync-status mutation without requiring each
  // production branch to carry audit-only bookkeeping. Function updaters that
  // do not return a status are intentionally left untouched.
  const set: typeof rawSet = (partial, replace) => {
    if (typeof partial !== 'function' && partial && 'syncStatus' in partial) {
      const next = partial as Partial<GraphState>
      recordSyncStatusTrace(
        { to: next.syncStatus, error: next.syncError ?? null },
        get().syncStatus,
      )
    }
    rawSet(partial, replace)
  }

  return ({
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
    set({ campusReady: true })
    const mapId = get().currentMapId
    if (mapId) maybeDrainLocalAheadResume(mapId)
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
    } catch {
      if (process.env.NODE_ENV === 'development') {
        console.error('[graph-store] Failed to parse localStorage graph')
      }
      await get().fetchFromSupabase()
    }
  },

  loadMapData: (mapId: string) => {
    if (typeof window === 'undefined') return
    campusSessionGeneration += 1
    const sessionGeneration = campusSessionGeneration
    // P0.12: a campus load begins — the acknowledged baseline is unknown until
    // the load settles, so it must not authorize or block saves meanwhile.
    lastAcknowledgedCollections = null
    resetSaveAcknowledgmentDiagnostic()
    authoredIntentSeq = 0
    pendingLocalAheadResumeMapId = null
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
      } catch {
        if (process.env.NODE_ENV === 'development') {
          console.error('[graph-store] Failed to parse map data from localStorage')
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

    // CASE A — No local graph: fetch from Supabase. An existing empty graph is
    // still a real local draft (for example, deleting the last building during
    // the autosave debounce), so it must be painted and freshness-checked
    // rather than replaced by the old server snapshot.
    if (!raw) {
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
      const markerCanonical = markerIdentity(marker)
      locallySynced = markerCanonical !== null && canonicalIdentityEqual(
        canonicalSnapshotIdentity(JSON.parse(raw), authoredDocument),
        markerCanonical,
      )
    } catch {
      locallySynced = false
    }
    set({ graph, authoredDocument, currentMapId: mapId, syncStatus: locallySynced ? 'checking' : 'idle', syncError: null })
    void checkServerFreshness(mapId, sessionGeneration)
  },

  setCurrentMapId: (mapId: string | null) => {
    const graph = get().graph
    if (mapId) graph.campusId = mapId
    if (mapId !== get().currentMapId) {
      // P0.12 campus isolation: per-campus authored intents and the
      // acknowledged baseline must never carry across campuses.
      lastAcknowledgedCollections = null
      resetSaveAcknowledgmentDiagnostic()
      authoredIntentSeq = 0
      campusSessionGeneration += 1
      pendingLocalAheadResumeMapId = null
      set({ currentMapId: mapId, authoredDocument: null, pendingAuthoredMutations: [], campusReady: false })
    } else {
      set({ currentMapId: mapId })
    }
  },

  save: async (options?: { trigger?: SaveTrigger }) => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (mapId && adoptingCampuses.has(mapId)) throw new Error("Save paused while the server version is being adopted.")
    // Keep graph identity in sync with the active map
    if (mapId) get().graph.campusId = mapId
    const key = mapId ? storageKey(mapId) : STORAGE_KEY
    const json = get().graph.toJSON()
    const persisted = serializeAuthoredGraphPayload(json as unknown as Record<string, unknown>, get().authoredDocument)
    localStorage.setItem(key, JSON.stringify(persisted))
    await get().syncToSupabase({ trigger: options?.trigger })
  },

  persistLocalDraft: () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    const key = mapId ? storageKey(mapId) : STORAGE_KEY
    try {
      // Local-only: the sync marker is intentionally NOT advanced here; the
      // cache may legitimately be newer than the acknowledged server state.
      const persisted = serializeAuthoredGraphPayload(
        get().graph.toJSON() as unknown as Record<string, unknown>,
        get().authoredDocument,
      )
      localStorage.setItem(key, JSON.stringify(persisted))
    } catch {
      // Best effort: draft persistence must never throw into lifecycle handlers.
    }
  },

  reset: () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    const key = mapId ? storageKey(mapId) : STORAGE_KEY
    localStorage.removeItem(key)
    campusSessionGeneration += 1
    set({ graph: new Graph(), authoredDocument: null, currentMapId: null, syncStatus: 'idle', syncError: null })
  },

  syncToSupabase: async (options?: { force?: boolean; trigger?: SaveTrigger }) => {
    if (typeof window === 'undefined') return
    const unresolvedConflict = get().syncStatus === 'conflict' ? get().syncError : null
    if (unresolvedConflict) {
      // Never overwrite a divergent server snapshot from an autosave. The user
      // must resolve explicitly via reSync({ force: true }) or adoptServerSnapshot().
      console.warn('[graph-store] syncToSupabase blocked while a server conflict is unresolved')
      throw new Error(unresolvedConflict)
    }
    const mapId = get().currentMapId
    if (mapId && adoptingCampuses.has(mapId)) throw new Error("Save paused while the server version is being adopted.")
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
    if (mapId && adoptingCampuses.has(mapId)) throw new Error("Save paused while the server version is being adopted.")
    if (!mapId) {
      console.warn('[graph-store] reSync: no active map')
      return
    }

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
        const localIdentity = localSnapshot
          ? canonicalSnapshotIdentity(localSnapshot)
          : null
        const serverIdentity = canonicalSnapshotIdentity(data)
        if (!localIdentity || !canonicalIdentityEqual(localIdentity, serverIdentity)) {
          const stamp = data.updatedAt ? ` (updated ${data.updatedAt})` : ''
          const message = `The server has a different version of this map${stamp}. reSync refused to overwrite it. Use reSync({ force: true }) to overwrite the server, or adoptServerSnapshot() to load the server version.`
          console.warn('[graph-store] reSync blocked by server conflict')
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
      } catch {
        console.warn('[graph-store] reSync: failed to parse local data')
      }
    }
    await get().syncToSupabase({ force: options?.force })
  },

  /**
   * Resolve a local/server conflict in favour of the server snapshot.
   * The unsynced local copy is preserved at `navi-graph-backup-<mapId>`
   * before the server version replaces it.
   */
  adoptServerSnapshot: async () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (!mapId) return
    if (adoptingCampuses.has(mapId)) throw new Error('Server adoption is already in progress.')
    const sessionGeneration = campusSessionGeneration
    beginSyncOperation()
    adoptingCampuses.add(mapId)
    try {
      // Stop queued local snapshots and let any already-running request settle
      // before fetching the revision to adopt. This prevents an older POST from
      // racing the authoritative GET.
      invalidateQueuedCampusSaves(mapId, 'Superseded by authoritative server adoption')
      await waitForCampusSavesToSettle(mapId)
      if (!isActiveCampusSession(mapId, sessionGeneration)) throw new Error('Server adoption cancelled because Studio navigated to another campus.')

      const data = await fetchServerSnapshot(mapId)
      if (!data || isServerSnapshotEmpty(data)) {
        throw new Error('Unable to load the server version. Check your connection and try again.')
      }
      if (!isActiveCampusSession(mapId, sessionGeneration)) throw new Error('Server adoption cancelled because Studio navigated to another campus.')
      adoptServerSnapshotData(mapId, data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to adopt the server version.'
      if (isActiveCampusSession(mapId, sessionGeneration)) set({ syncStatus: 'conflict', syncError: message })
      throw error
    } finally {
      adoptingCampuses.delete(mapId)
    }
  },

  syncLocalChanges: async () => {
    if (typeof window === 'undefined') return
    const mapId = get().currentMapId
    if (!mapId) return
    if (get().syncStatus !== 'conflict' && get().syncStatus !== 'error') return
    const sessionGeneration = campusSessionGeneration
    const operationGeneration = beginSyncOperation()

    const marker = readSyncMarker(mapId)
    const acknowledged = markerIdentity(marker)
    logSaveLifecycle({ event: 'recovery-read-request' })
    let readResult: SnapshotReadLifecycleResult | null = null
    const logRecoveryDisposition = (outcome: string, statusWriteApplied: boolean) => {
      const currentState = get()
      logSaveLifecycle({
        event: 'recovery-read-disposition',
        httpStatus: readResult?.httpStatus ?? null,
        readOutcome: readResult?.outcome ?? null,
        outcome,
        staleDiscarded: outcome === 'ignored-stale-failure' || outcome === 'ignored-stale-response',
        statusWriteApplied,
        finalClientStatus: currentState.syncStatus,
      })
    }
    let data: (GraphSnapshot & { updatedAt?: string }) | null
    try {
      data = await fetchServerSnapshot(mapId, {
        surfaceAuthenticationFailure: true,
        onLifecycle: (entry) => {
          readResult = entry
          logSaveLifecycle({
            event: 'recovery-read-response',
            httpStatus: entry.httpStatus,
            readOutcome: entry.outcome,
          })
        },
      })
    } catch (error) {
      if (!isActiveCampusSession(mapId, sessionGeneration) || !isCurrentSyncOperation(operationGeneration)) {
        logRecoveryDisposition('ignored-stale-failure', false)
        return
      }
      const message = error instanceof Error ? error.message : AUTH_REQUIRED_MESSAGE
      set({ syncStatus: 'error', syncError: message })
      logRecoveryDisposition('current-read-failure', true)
      throw error
    }
    if (!isActiveCampusSession(mapId, sessionGeneration) || !isCurrentSyncOperation(operationGeneration)) {
      logRecoveryDisposition(data ? 'ignored-stale-response' : 'ignored-stale-failure', false)
      return
    }
    if (!data) {
      const message = 'Could not reach the server. Your local work is preserved; try again.'
      set({ syncStatus: 'error', syncError: message })
      logRecoveryDisposition('current-read-failure', true)
      throw new Error(message)
    }

    const serverIdentity = canonicalSnapshotIdentity(data)
    const currentState = get()
    const localIdentity = canonicalSnapshotIdentity(currentState.graph.toJSON(), currentState.authoredDocument)
    logSaveLifecycle({
      event: 'recovery-read-comparison',
      httpStatus: readResult?.httpStatus ?? null,
      canonicalMatch: canonicalIdentityEqual(serverIdentity, localIdentity),
      graphMatch: serverIdentity.graphFingerprint === localIdentity.graphFingerprint,
      authoredMatch: serverIdentity.authoredFingerprint !== null
        && serverIdentity.authoredFingerprint === localIdentity.authoredFingerprint,
    })

    // Missed acknowledgement (CASE A): the server already contains exactly
    // the preserved local graph. Adopt only its authoritative revision; a
    // second POST would be redundant and could create a false conflict.
    if (canonicalIdentityEqual(serverIdentity, localIdentity)) {
      writeSyncMarker(
        mapId,
        serverIdentity.graphFingerprint,
        new Date().toISOString(),
        data.updatedAt ?? null,
        serverIdentity.authoredFingerprint,
      )
      lastAcknowledgedCollections = collectionsOf(data)
      clearAcknowledgedAuthoredMutations()
      set({ syncStatus: 'synced', syncError: null })
      logRecoveryDisposition('server-matches-local', true)
      return
    }

    // Genuine divergence (CASE C): the server moved beyond the acknowledged
    // base. Never overwrite; keep the local work and the conflict state.
    if (acknowledged === null || !canonicalIdentityEqual(serverIdentity, acknowledged)) {
      const message = 'Server and local changes differ. Your local work is preserved.'
      set({ syncStatus: 'conflict', syncError: message })
      logRecoveryDisposition('true-divergence', true)
      throw new Error(message)
    }

    // Server is still at the acknowledged base (CASE B): retry the preserved
    // local work through the normal guarded save queue with the latest
    // expected revision. Clear conflict only after an authoritative ack.
    writeSyncMarker(
      mapId,
      acknowledged.graphFingerprint,
      marker?.syncedAt ?? new Date().toISOString(),
      data.updatedAt ?? marker?.serverTimestamp ?? null,
      acknowledged.authoredFingerprint,
    )
    set({ syncStatus: 'idle', syncError: null })
    try {
      await enqueueCampusSave(mapId, false, 'manual')
    } catch (error) {
      if (!isActiveCampusSession(mapId, sessionGeneration)) return
      const message = error instanceof Error ? error.message : 'Sync failed'
      // The queued save owns the next operation generation. Reject its failure
      // without allowing an older recovery to overwrite a later operation.
      if (isCurrentSyncOperation(operationGeneration + 1)) {
        set({ syncStatus: isAuthenticationFailureMessage(message) ? 'error' : 'conflict', syncError: message })
      }
      throw error
    }
  },

  fetchFromSupabase: async (mapId?: string) => {
    if (typeof window === 'undefined') return
    const effectiveMapId = mapId || get().currentMapId
    // P0.12: baseline unknown while an authoritative fetch is in flight.
    lastAcknowledgedCollections = null
    resetSaveAcknowledgmentDiagnostic()
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
      } catch {
        console.warn('[graph-store] server authored snapshot could not be hydrated')
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
          writeSyncMarker(
            effectiveMapId,
            fingerprint,
            data.updatedAt,
            data.updatedAt,
            authoredDocument ? authoredDocumentFingerprint(authoredDocument) : null,
          )
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
        const identity = canonicalSnapshotIdentity(data, authoredDocument)
        writeSyncMarker(
          effectiveMapId,
          identity.graphFingerprint,
          data.updatedAt,
          data.updatedAt,
          identity.authoredFingerprint,
        )
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
    } catch {
      console.warn('[graph-store] fetchFromSupabase failed')
      set({ syncStatus: 'idle' })
    }
  },
  })
})

// A few recovery helpers intentionally use the public Zustand API because
// they run outside the store initializer. Trace those writes as well so the
// audit cannot miss a late conflict transition.
const originalGraphSetState = graphStore.setState
graphStore.setState = ((partial, replace) => {
  if (typeof partial !== 'function' && partial && 'syncStatus' in partial) {
    const next = partial as Partial<GraphState>
    recordSyncStatusTrace(
      { to: next.syncStatus, error: next.syncError ?? null },
      graphStore.getState().syncStatus,
    )
  }
  return originalGraphSetState(partial, replace)
}) as typeof graphStore.setState

export const useGraphStore = graphStore

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
  latestSaveChainByCampus.clear()
  // P0.12: module-level safety state must not leak across test cases (the
  // acknowledged baseline and authored sequence are per-campus runtime state).
  lastAcknowledgedCollections = null
  resetSaveAcknowledgmentDiagnostic()
  authoredIntentSeq = 0
  campusSessionGeneration = 0
  // Invalidate any unresolved async work from the previous test boundary.
  syncOperationGeneration += 1
  campusEpoch.clear()
  adoptingCampuses.clear()
  pendingLocalAheadResumeMapId = null
  campusEpoch.clear()
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
  const sessionGeneration = campusSessionGeneration
  const unresolvedConflict =
    useGraphStore.getState().syncStatus === 'conflict' ? useGraphStore.getState().syncError : null
  if (unresolvedConflict) {
    console.warn('[graph-store] syncToSupabase blocked while a server conflict is unresolved')
    throw new Error(unresolvedConflict)
  }
  if (!isActiveCampusSession(mapId, sessionGeneration)) {
    // The editor moved to another map while this save was queued; the graph
    // for `mapId` is no longer the active one. Its local cache is intact.
    console.warn('[graph-store] syncToSupabase skipped: map is no longer active')
    return
  }

  // ── P0.11 save contract (trigger + authored intent + readiness) ──────────
  const preState = useGraphStore.getState()
  if (!preState.campusReady) {
    // Never write a partially hydrated candidate — manual save included.
    console.warn(`[graph-store] save refused: campus not ready (trigger=${trigger})`)
    return
  }
  const operationGeneration = beginSyncOperation()
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
        const currentDocumentVersion = preState.authoredDocument?.version
        const documentChangedAfterPreviousAck =
          lastConfirmedSaveSucceeded &&
          lastConfirmedSaveDocumentVersion !== null &&
          typeof currentDocumentVersion === 'number' &&
          currentDocumentVersion !== lastConfirmedSaveDocumentVersion
        console.warn('[graph-store] save blocked by safety guard', {
          ...verdict.diagnostic,
          operation: 'performSyncToSupabase',
          phase: 'pre-network-save-guard',
          acknowledgedBaselinePresent: lastAcknowledgedCollections !== null,
          pendingIntentPresent: pending.length > 0,
          documentChangedAfterPreviousAck,
          previousSaveSucceeded: lastConfirmedSaveSucceeded,
        })
        useGraphStore.setState({ syncStatus: 'error', syncError: verdict.reason })
        return
      }
    }
  }

  useGraphStore.setState({ syncStatus: 'syncing', syncError: null })
  const snapshot = useGraphStore.getState().graph.toJSON()
  const snapshotHash = graphFingerprint(snapshot)
  const authoredHash = preState.authoredDocument ? authoredDocumentFingerprint(preState.authoredDocument) : null
  // Serialize through the mapping layer to ensure RPC-compatible format
  // and inject the correct campusId from currentMapId
  const payload = serializeSnapshot(snapshot as unknown as GraphSnapshotLike, mapId, preState.authoredDocument)
  const expectedServerUpdatedAt = readSyncMarker(mapId)?.serverTimestamp ?? null
  // One logical save attempt keeps one mutation id for every transport retry.
  const mutationId = newMutationId()
  latestSaveChainByCampus.set(mapId, mutationId)
  const body = JSON.stringify({ ...payload, expectedServerUpdatedAt, forceServerOverwrite: force, mutationId })
  const epochAtStart = getCampusEpoch(mapId)

  for (let attempt = 0; ; attempt++) {
    if (!isActiveCampusSession(mapId, sessionGeneration) || !isCurrentSyncOperation(operationGeneration)) return
    if (attempt > 0 && saveWasSuperseded(mapId, sessionGeneration, epochAtStart, snapshotHash, authoredHash, includedUpTo)) {
      // A newer authored revision owns the next queue turn. Never let a
      // delayed retry write the older snapshot over that newer local state.
      useGraphStore.setState({ syncStatus: 'idle', syncError: null })
      return
    }
    let responseStatus: number | null = null
    let responseUpdatedAt: string | null = null
    try {
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-navi-save-chain-id': mutationId,
        'x-navi-save-attempt': String(attempt + 1),
        'x-navi-session-generation': String(sessionGeneration),
        'x-navi-campus-epoch': String(epochAtStart),
        'x-navi-graph-fingerprint': snapshotHash,
      }
      if (authoredHash !== null) requestHeaders['x-navi-authored-fingerprint'] = authoredHash
      logSaveLifecycle({ event: 'request', attemptNumber: attempt + 1 })
      const res = await fetch('/api/graph', {
        method: 'POST',
        headers: requestHeaders,
        credentials: 'include',
        ...(typeof body === 'string' && body.length < 60000 ? { keepalive: true } : {}),
      body,
      })
      responseStatus = res.status
      if (!isActiveCampusSession(mapId, sessionGeneration) || !isCurrentSyncOperation(operationGeneration)) return
      if (!res.ok) {
        if (isAuthenticationFailureStatus(res.status)) {
          throw new Error(AUTH_REQUIRED_MESSAGE)
        }
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        const msg = errBody.error ?? `HTTP ${res.status}`
        if (isRetryableHttpStatus(res.status)) throw new RetryableSyncError(msg)
        throw new Error(msg)
      }
      const serverResult = (await res.json().catch(() => ({}))) as {
        updatedAt?: string | null
      }
      responseUpdatedAt = typeof serverResult.updatedAt === 'string' ? serverResult.updatedAt : null
      const acknowledgedRevision = await resolveAcknowledgedRevision(
        mapId,
        responseUpdatedAt,
        () => isActiveCampusSession(mapId, sessionGeneration)
          && getCampusEpoch(mapId) === epochAtStart
          && isCurrentSyncOperation(operationGeneration),
      )
      if (!isCurrentSyncOperation(operationGeneration)) return
      if (getCampusEpoch(mapId) !== epochAtStart) {
        // Phase 3A: the authoritative base was replaced while this save was in
        // flight; its acknowledgement must not be stamped onto the new base.
        console.warn('[graph-store] save superseded by authoritative adoption — ack discarded')
        return
      }
      if (!isActiveCampusSession(mapId, sessionGeneration) || !isCurrentSyncOperation(operationGeneration)) return
      if (!acknowledgedRevision) {
        // No authoritative revision means the next save would claim a stale
        // expectedServerUpdatedAt. Never report synchronized in that state.
        const message =
          'The save reached the server, but the authoritative revision could not be confirmed. Local changes remain cached; retry when the server is reachable.'
        console.warn('[graph-store] syncToSupabase could not confirm the server revision.')
        // The write itself already returned success. Do not issue another
        // mutation here: legacy RPC deployments may not have idempotency and
        // would turn a committed write into a false CAS conflict. The online
        // recovery path will reconcile the server before attempting anything
        // new if this final read-back remains unavailable.
        throw new Error(message)
      }
      // A confirmed server revision always becomes the marker's revision. The
      // fingerprint records the exact content the server acknowledged, while
      // newer local edits remain tracked as unsynced by the fingerprint mismatch.
      writeSyncMarker(
        mapId,
        snapshotHash,
        new Date().toISOString(),
        acknowledgedRevision,
        preState.authoredDocument ? authoredDocumentFingerprint(preState.authoredDocument) : null,
      )
      // P0.11: the acknowledged snapshot is the new canonical guard baseline;
      // clear ONLY the intents included in this save (newer edits stay pending).
      lastAcknowledgedCollections = collectionsOf(snapshot)
      lastConfirmedSaveSucceeded = true
      lastConfirmedSaveDocumentVersion =
        typeof preState.authoredDocument?.version === 'number' ? preState.authoredDocument.version : null
      lastAcknowledgedSeq = Math.max(lastAcknowledgedSeq, includedUpTo)
      if (includedUpTo > 0) useGraphStore.getState().clearAuthoredMutations(includedUpTo)
      useGraphStore.setState({ syncStatus: 'synced', syncError: null })
      logSaveLifecycle({
        event: 'response',
        attemptNumber: attempt + 1,
        httpStatus: responseStatus,
        outcome: 'success',
        retryable: false,
        retryScheduled: false,
        retryDelayMs: null,
        finalClientStatus: 'synced',
      })
      return
    } catch (e) {
      if (!isActiveCampusSession(mapId, sessionGeneration) || !isCurrentSyncOperation(operationGeneration)) return
      const msg = e instanceof Error ? e.message : 'Sync failed'
      if (isRetryableSyncFailure(e)) {
        if (saveWasSuperseded(mapId, sessionGeneration, epochAtStart, snapshotHash, authoredHash, includedUpTo)) {
          useGraphStore.setState({ syncStatus: 'idle', syncError: null })
          return
        }
        bindOnlineResync()
        if (attempt < SYNC_RETRY_DELAYS.length) {
          const retryDelayMs = SYNC_RETRY_DELAYS[attempt]
          logSaveLifecycle({
            event: 'response',
            attemptNumber: attempt + 1,
            httpStatus: responseStatus,
            outcome: 'retry-scheduled',
            retryable: true,
            retryScheduled: true,
            retryDelayMs,
            finalClientStatus: 'syncing',
          })
          // Keep the active request in a single retry chain. The final error
          // remains truthful if every guarded attempt is exhausted, while the
          // online listener can recover without a page reload.
          useGraphStore.setState({ syncStatus: 'syncing', syncError: 'Save failed — retrying automatically' })
          await sleep(retryDelayMs)
          continue
        }
        const offlineMessage = 'Offline — changes saved locally. Will retry when back online.'
        const finalMessage = isNetworkError(msg) ? offlineMessage : msg
        console.warn('[graph-store] syncToSupabase retry chain exhausted')
        logSaveLifecycle({
          event: 'response',
          attemptNumber: attempt + 1,
          httpStatus: responseStatus,
          outcome: 'retry-exhausted',
          retryable: true,
          retryScheduled: false,
          retryDelayMs: null,
          finalClientStatus: 'error',
        })
        useGraphStore.setState({ syncStatus: 'error', syncError: finalMessage })
        throw new Error(finalMessage)
      } else if (/server changed|snapshot conflict/i.test(msg)) {
        logSaveLifecycle({
          event: 'response',
          attemptNumber: attempt + 1,
          httpStatus: responseStatus,
          outcome: 'conflict',
          retryable: false, retryScheduled: false, retryDelayMs: null, finalClientStatus: 'conflict',
        })
        useGraphStore.setState({ syncStatus: 'conflict', syncError: msg })
        throw new Error(msg)
      } else if (/mutation[_ ]?id[_ ]collision/i.test(msg)) {
        // Same mutation id reused with different content: never silently treat as a retry.
        console.error('[graph-store] syncToSupabase mutation id collision')
        logSaveLifecycle({
          event: 'response',
          attemptNumber: attempt + 1,
          httpStatus: responseStatus,
          outcome: 'mutation-collision',
          retryable: false, retryScheduled: false, retryDelayMs: null, finalClientStatus: 'error',
        })
        useGraphStore.setState({ syncStatus: 'error', syncError: msg })
        throw new Error(msg)
      } else {
        if (/^The save reached the server, but the authoritative revision could not be confirmed/i.test(msg)) {
          bindOnlineResync()
        }
        console.error('[graph-store] syncToSupabase failed')
        logSaveLifecycle({
          event: 'response',
          attemptNumber: attempt + 1,
          httpStatus: responseStatus,
          outcome: 'failure',
          retryable: false, retryScheduled: false, retryDelayMs: null, finalClientStatus: 'error',
        })
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
  isCurrent?: () => boolean,
): Promise<string | null> {
  if (typeof responseUpdatedAt === 'string' && responseUpdatedAt.length > 0) {
    return responseUpdatedAt
  }
  // A successful POST without an echoed revision is an acknowledgement
  // uncertainty, not a second mutation opportunity. Retry only the read-back;
  // this is safe for both idempotent and legacy RPC deployments.
  for (let attempt = 0; ; attempt += 1) {
    if (isCurrent && !isCurrent()) return null
    const data = await fetchServerSnapshot(mapId, { surfaceAuthenticationFailure: true })
    if (isCurrent && !isCurrent()) return null
    if (data?.updatedAt) return data.updatedAt
    if (attempt >= SYNC_RETRY_DELAYS.length) return null
    await sleep(SYNC_RETRY_DELAYS[attempt])
  }
}
