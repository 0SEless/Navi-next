'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import {
  EditorProvider,
  SelectionBridge,
  SelectionOrigin,
  asEntityId,
  findEntityById,
  NavigationCompiler,
  createEditorContext,
  createDocument,
  GraphAdapter,
} from '@navi/editor'
import type { CampusDocument } from '@navi/core'
import type { EntitySelector, PersistenceAdapter, EditorContext, DocumentEventBus } from '@navi/editor'
import type { PersistenceSyncState } from '@navi/editor'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'
import { useCompiledGraphStore } from '@/store/compiled-graph-store'
import { createCompilerAdapter } from '@/services/compiler-adapter'
import { persistStudioGraph } from './studio-persistence'
import type { Graph } from '@/engine/graph'

type AuthoredIntentKind = 'door' | 'route' | 'poi' | 'building' | 'floor' | 'outdoor'

type DocumentEntityScope = {
  path: string
  buildingId: string | null
  floor: number | null
}

/** Resolve the owning authored scope for an entity after a committed change. */
function findDocumentEntityScope(document: CampusDocument, entityId: string): DocumentEntityScope | null {
  for (const building of document.buildings) {
    if (building.id === entityId) return { path: 'building', buildingId: building.id, floor: null }
    for (const floor of building.floors) {
      if (floor.id === entityId) return { path: 'floor', buildingId: building.id, floor: floor.level }
      const collections: Array<[string, unknown]> = [
        ['room', floor.rooms], ['hallway', floor.hallways], ['staircase', floor.staircases],
        ['elevator', floor.elevators], ['entrance', floor.entrances], ['poi', floor.pois],
        ['door', floor.doors], ['window', floor.windows], ['opening', floor.openings],
        ['route-node', floor.routeNetwork?.nodes], ['route-edge', floor.routeNetwork?.edges],
        ['roomAttributes', floor.roomAttributes], ['component', floor.parametricComponents],
      ]
      for (const [path, items] of collections) {
        if (Array.isArray(items) && items.some((item) => (item as { id?: unknown })?.id === entityId)) {
          return { path, buildingId: building.id, floor: floor.level }
        }
      }
    }
    const buildingCollections: Array<[string, unknown]> = [
      ['verticalConnector', building.verticalConnectors],
      ['staircase', building.staircases], ['elevator', building.elevators],
    ]
    for (const [path, items] of buildingCollections) {
      if (Array.isArray(items) && items.some((item) => (item as { id?: unknown })?.id === entityId)) {
        return { path, buildingId: building.id, floor: null }
      }
    }
  }

  const topLevel: Array<[string, unknown]> = [
    ['road', document.roads], ['panorama', document.panoramas],
    ['qr', document.qrCheckpoints], ['area', document.areas], ['poi', document.pois],
  ]
  for (const [path, items] of topLevel) {
    if (!Array.isArray(items)) continue
    const entity = items.find((item) => (item as { id?: unknown })?.id === entityId) as {
      buildingId?: unknown
      floor?: unknown
    } | undefined
    if (entity) {
      return {
        path,
        buildingId: typeof entity.buildingId === 'string' ? entity.buildingId : null,
        floor: typeof entity.floor === 'number' ? entity.floor : null,
      }
    }
  }
  return null
}

function intentForDocumentEntity(
  document: CampusDocument,
  entityId: string,
  entityType: string,
): { kind: AuthoredIntentKind; buildingId: string | null; floor: number | null } {
  const scope = findDocumentEntityScope(document, entityId)
  const path = scope?.path ?? entityType
  const buildingId = scope?.buildingId ?? null
  const floor = scope?.floor ?? null
  if (path === 'building') return { kind: 'building', buildingId: entityId, floor: null }
  if (path === 'door') return { kind: 'door', buildingId, floor }
  if (path === 'poi') return { kind: 'poi', buildingId, floor }
  if (path === 'road' || path === 'route-node' || path === 'route-edge') {
    return { kind: buildingId ? 'route' : 'outdoor', buildingId, floor }
  }
  if (buildingId) return { kind: 'floor', buildingId, floor }
  return { kind: 'outdoor', buildingId: null, floor: null }
}

/**
 * Reconcile a newly authoritative graph into the long-lived editor document.
 *
 * GraphAdapter.sync() is intentionally document → legacy graph. Recovery and
 * server adoption replace the graph in the opposite direction, so leaving the
 * old CampusDocument mounted would let visibility/beforeunload project stale
 * data back into localStorage on the next reload. This boundary updates the
 * existing document identity without emitting an authored revision.
 */
export function reconcileAuthoritativeDocument(context: EditorContext, graph: Graph): void {
  const authoredDocument = useGraphStore.getState().authoredDocument
  const replacement = authoredDocument && authoredDocument.metadata.campusId === context.document.metadata.campusId
    ? structuredClone(authoredDocument)
    : createDocument(graph, context.transformer)
  const documentStore = context.services.get('documentStore')
  if (documentStore && typeof documentStore.replaceAuthoritative === 'function') {
    documentStore.replaceAuthoritative(replacement)
  } else {
    for (const key of Object.keys(context.document)) {
      Reflect.deleteProperty(context.document, key)
    }
    Object.assign(context.document, structuredClone(replacement))
  }

  context.services.get('history')?.clear()
  context.services.get('selection')?.clear(SelectionOrigin.Programmatic)
}

/**
 * Project the document into the legacy graph only after an authored document
 * version has advanced. Authoritative hydration replaces the document in
 * place without a revision, so running the lossy document→graph adapter from
 * visibility/beforeunload would rewrite a clean server snapshot before reload.
 */
function projectDocumentIfAuthored(
  context: EditorContext,
  lastProjectedVersionRef: { current: number | null },
): void {
  const documentStore = context.services.get('documentStore') as { version?: number } | undefined
  const version = typeof documentStore?.version === 'number' ? documentStore.version : null
  if (version !== null && lastProjectedVersionRef.current === version) return

  const ga = new GraphAdapter(useGraphStore.getState().graph, context.transformer)
  ga.sync(context.document)
  if (version !== null) lastProjectedVersionRef.current = version
}

/**
 * ── Selection Ownership Invariant ─────────────────────────────────
 *
 * `SelectionManager` (inside the editor package) is the single
 * authoritative source of "what is currently selected." All panels
 * (PropertiesPanel, Inspector) MUST consume selection via the
 * `useSelection()` hook rather than reading `useStudioStore` directly.
 *
 * `useStudioStore.{selectedNodeId, activeBuildingId}` are legacy
 * compatibility values — a view-only projection of SelectionManager
 * state, maintained by the bridge's Direction A callback. They are
 * NOT the source of truth. Canvas highlight sync / camera fly-to may
 * read them, but they MUST NOT drive panel rendering.
 *
 * The bridge (SelectionBridge) synchronizes in both directions:
 *   Direction A: SelectionManager → Zustand (legacy store).
 *   Direction B: Zustand → SelectionManager (canvas click origin).
 *
 * Origin gating: Explorer-originated selections pass through Direction
 * A to set `activeBuildingId` → StudioCanvas flyTo. Canvas-originated
 * selections are suppressed by `SelectionBridge.syncing` (Direction B
 * sets `syncing=true`, preventing Direction A from firing for the
 * canvas-initiated cycle). See `useEffect` below for details.
 * ──────────────────────────────────────────────────────────────────
 *
 * Bridge: converts legacy Graph → CampusDocument and provides
 * a single EditorProvider context so Explorer + PropertiesPanel share
 * one document, one SelectionManager, one dispatcher, one history.
 *
 * The context (document + services) is created ONCE per bridge mount
 * (lifetime invariant) — never recreated on graph/selection/edit changes.
 */

export function EditorBridge({ children }: { children: ReactNode }) {
  const contextRef = useRef<EditorContext | null>(null)
  const lastProjectedDocumentVersionRef = useRef<number | null>(null)

  // GraphAdapter is a projection step. Capture its document only when the
  // campus already has a new-format authored snapshot or a real editor change
  // has advanced the legacy document version; initial legacy hydration remains
  // Graph-only and therefore cannot trigger an automatic rewrite.
  const syncDocumentAndCapture = () => {
    const ctx = contextRef.current
    if (!ctx) return
    const state = useGraphStore.getState()
    const ga = new GraphAdapter(state.graph, ctx.transformer)
    ga.sync(ctx.document)
    const nextState = useGraphStore.getState()
    if (nextState.authoredDocument !== null || ctx.document.version > 0) {
      nextState.setAuthoredDocument(ctx.document)
    }
  }

  const persistenceAdapter: PersistenceAdapter = {
    save: () => persistStudioGraph({
      syncDocument: () => {
        syncDocumentAndCapture()
      },
      saveGraph: async () => {
        try {
          await useGraphStore.getState().save({ trigger: 'autosave' })
        } catch (error: unknown) {
          console.warn('EditorBridge adapter save failed:', error)
          throw error
        }
      },
      // Bump renderVersion only after graph persistence has completed.
      bumpRenderVersion: () => {
        useGraphStore.setState((s) => ({ renderVersion: s.renderVersion + 1 }))
      },
    }),
    syncToSupabase: () => useGraphStore.getState().syncToSupabase({ trigger: 'autosave' }),
    getSyncState: (): PersistenceSyncState => {
      const state = useGraphStore.getState()
      return { status: state.syncStatus, error: state.syncError }
    },
    subscribeSyncState: (listener) => {
      let previous = {
        status: useGraphStore.getState().syncStatus,
        error: useGraphStore.getState().syncError,
      }
      return useGraphStore.subscribe(() => {
        const state = useGraphStore.getState()
        const next = { status: state.syncStatus, error: state.syncError }
        if (next.status === previous.status && next.error === previous.error) return
        previous = next
        listener(next)
      })
    },
    publish: async (artifacts) => {
      const ctx = contextRef.current
      const campusId = ctx?.document?.metadata?.campusId
      if (!campusId) {
        return { success: false, message: 'Cannot publish: document has no campusId' }
      }
      const revision = ctx?.document?.version ?? 1
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifacts, campusId, revision }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        return {
          success: false,
          message: err?.message ?? `Server error: ${response.status}`,
        }
      }
      const data = await response.json()
      return {
        success: data.success,
        version: data.manifest?.compilerVersion ?? '1.0.0',
        message: data.message,
      }
    },
  }
  const navCompiler = new NavigationCompiler(createCompilerAdapter())
  const [context] = useState(() => {
    const state = useGraphStore.getState()
    const authoredDocument = state.authoredDocument
    const activeCampusId = state.currentMapId ?? state.graph.campusId
    const ctx = createEditorContext(
      state.graph,
      persistenceAdapter,
      navCompiler,
      authoredDocument && authoredDocument.metadata.campusId === activeCampusId
        ? authoredDocument
        : undefined,
    )
    return ctx
  })

  // Ensure contextRef.current is always in sync with the active committed context
  contextRef.current = context

  // Existing map snapshots may predate derived road endpoint markers. Rebuild
  // the legacy graph once at mount so both authored endpoints are immediately
  // visible after load, without inferring any new connection edges.
  useEffect(() => {
    const graph = useGraphStore.getState().graph
    if (typeof graph?.setBuildings !== 'function') return
    const syncState = useGraphStore.getState().syncStatus
    // A `checking`/`synced` graph came from an authoritative cache/server
    // hydration. Rebuilding it through the document→legacy adapter here can
    // apply lossy migrations before freshness settles and manufacture a
    // store-ahead fingerprint on an otherwise clean reload. Local-ahead and
    // legacy drafts still use the existing rebuild path.
    if (syncState !== 'checking' && syncState !== 'synced') {
      new GraphAdapter(graph, context.transformer).sync(context.document)
    }
    const documentStore = context.services.get('documentStore') as { version?: number } | undefined
    lastProjectedDocumentVersionRef.current = typeof documentStore?.version === 'number' ? documentStore.version : null
    if (useGraphStore.getState().authoredDocument !== null) {
      useGraphStore.getState().setAuthoredDocument(context.document)
    }
    useGraphStore.setState((state) => ({ renderVersion: state.renderVersion + 1 }))
    // P0.13 CAMPUS_READY_FOR_AUTHORED_SAVE: the initial GraphAdapter/EditorBridge
    // reconciliation has completed — the campus is now READY_CLEAN and authored
    // persistence may proceed (P0.14: shared lifecycle action).
    useGraphStore.getState().completeCampusHydration()
  }, [context])

  // Recovery/server adoption replaces the graph object while this bridge stays
  // mounted. Keep the editor's long-lived CampusDocument aligned before any
  // visibility or unload persistence can project it back into the graph.
  useEffect(() => {
    let observedGraph = useGraphStore.getState().graph
    const unsubscribe = useGraphStore.subscribe((state) => {
      if (state.graph === observedGraph) return
      observedGraph = state.graph
      if (state.currentMapId !== context.document.metadata.campusId) return
      reconcileAuthoritativeDocument(context, state.graph)
      const documentStore = context.services.get('documentStore') as { version?: number } | undefined
      lastProjectedDocumentVersionRef.current = typeof documentStore?.version === 'number' ? documentStore.version : null
    })
    return unsubscribe
  }, [context])

  // The editor document is authoritative, but the Studio map still has a
  // legacy Graph projection for areas, navigation nodes, and edges. Keep that
  // projection in lockstep with every document mutation, including the
  // inverse command dispatched by HistoryStack.undo(). Without this bridge,
  // undo removes an Explorer/document entity while its old map geometry stays
  // rendered until a later Save happens to rebuild the graph.
  useEffect(() => {
    const eventBus = context.services.get('eventBus') as DocumentEventBus | undefined
    if (!eventBus) return
    const selectionManager = context.services.get('selection') as {
      lastSelectedId: string | null
      clear: (origin?: SelectionOrigin) => void
    } | undefined

    // Document commands bypass the legacy Graph mutators, so they do not
    // reach graph-store's authored-intent boundary on their own. Record the
    // committed authored scope for every document change; without this event
    // bridge, normal autosave sees no intent and correctly refuses to POST.
    const unsubscribeBuildingDelete = eventBus.on('entity.deleted', (payload: {
      entityId?: unknown
      entityType?: unknown
    }) => {
      if (payload?.entityType !== 'building' || typeof payload.entityId !== 'string') return
      useGraphStore.getState().recordAuthoredMutation('building', payload.entityId, null)
    })

    const unsubscribe = eventBus.on('document.changed', (payload: {
      entityId?: unknown
      entityType?: unknown
    }) => {
      if (typeof payload?.entityId === 'string') {
        const intent = intentForDocumentEntity(
          context.document,
          payload.entityId,
          typeof payload.entityType === 'string' ? payload.entityType : 'entity',
        )
        useGraphStore.getState().recordAuthoredMutation(intent.kind, intent.buildingId, intent.floor)
      }
      const graph = useGraphStore.getState().graph
      new GraphAdapter(graph, context.transformer).sync(context.document)
      const documentStore = context.services.get('documentStore') as { version?: number } | undefined
      lastProjectedDocumentVersionRef.current = typeof documentStore?.version === 'number' ? documentStore.version : null
      useGraphStore.getState().setAuthoredDocument(context.document)
      useGraphStore.setState((state) => ({ renderVersion: state.renderVersion + 1 }))
      // Phase 3B: every committed document change is made durable locally right
      // away — no network, no marker advance. Server autosave remains separate.
      useGraphStore.getState().persistLocalDraft()

      // Undo can remove the currently selected Building through an inverse
      // command without going through the normal canvas selection path. Clear
      // that stale selection so the inspector does not show "Entity not
      // found" for an entity that was just removed.
      const activeBuildingId = useStudioStore.getState().activeBuildingId
      if (activeBuildingId && !context.document.buildings.some((building) => building.id === activeBuildingId)) {
        useStudioStore.getState().setActiveBuilding(null)
      }

      // Undo/delete can remove the selected entity without going through a
      // canvas click. Clear the authoritative selection immediately so the
      // Inspector cannot render a stale "Entity not found" state.
      const selectedId = selectionManager?.lastSelectedId
      if (selectedId && !findEntityById(context.document, selectedId)) {
        selectionManager.clear(SelectionOrigin.Programmatic)
      }
    })

    return () => {
      unsubscribe()
      unsubscribeBuildingDelete()
    }
  }, [context])

  // Phase 3B — unload/visibility now ensure ONLY the committed LOCAL draft is
  // durable. No normal server synchronization is started from teardown paths.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        const ctx = contextRef.current
        if (ctx) projectDocumentIfAuthored(ctx, lastProjectedDocumentVersionRef)
        useGraphStore.getState().persistLocalDraft()
      }
    }
    const handleBeforeUnload = () => {
      const ctx = contextRef.current
      if (ctx) projectDocumentIfAuthored(ctx, lastProjectedDocumentVersionRef)
      useGraphStore.getState().persistLocalDraft()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // Wire SelectionBridge once per mount: keep the legacy studio store and the
  // new SelectionManager in sync (selection only, loop-guarded).
  useEffect(() => {
    const selectionManager = context.services.get('selection')
    if (!selectionManager) return

    const bridge = new SelectionBridge(selectionManager)

    // Direction A — SelectionManager → legacy store.
    // Origin gating:
    //   Explorer origin → sets activeBuildingId → map flyTo in StudioCanvas
    //   Canvas origin   → suppressed by SelectionBridge.syncing guard
    //                     (canvas already handled its own camera)
    //   Programmatic    → sets activeBuildingId (no map in test, no-op)
    const unsubBridge = bridge.connect({
      onSelectionChanged(state, legacy) {
        useStudioStore.setState({
          selectedNodeId: legacy.selectedNodeId,
          // activeBuildingId triggers the camera fly-to effect in StudioCanvas.
          // Canvas-origin selections are already suppressed by the syncing guard
          // in SelectionBridge (Direction B sets syncing=true, so this callback
          // is skipped during canvas→SelectionManager cycles).
          activeBuildingId: legacy.activeBuildingId,
        })
      },
    })

    // Direction B — legacy store → SelectionManager (loop-guarded).
    const unsubLegacy = useStudioStore.subscribe(() => {
      const s = useStudioStore.getState()
      const legacyId = s.selectedTraceId ?? s.selectedNodeId ?? s.activeBuildingId
      if (!legacyId) {
        bridge.pushExternal(null, SelectionOrigin.Canvas)
        return
      }
      // Id-equality short-circuit: SelectionManager already reflects this id,
      // so pushing again would be a redundant cycle (also blocked by `syncing`).
      if (legacyId === selectionManager.lastSelectedId) return
      const found = findEntityById(context.document, legacyId)
      let selector: EntitySelector
      if (found?.path === 'poi') {
        const owner = context.document.buildings
          .flatMap(building => building.floors.map(floor => ({ building, floor })))
          .find(({ floor }) => floor.pois?.some(poi => poi.id === legacyId))
        selector = owner
          ? {
              type: 'poi',
              id: asEntityId(legacyId),
              buildingId: asEntityId(owner.building.id),
              floorId: asEntityId(owner.floor.id),
            }
          : ({ type: 'poi', id: asEntityId(legacyId) } as unknown as EntitySelector)
      } else {
        selector = found
          ? ({ type: found.path, id: asEntityId(legacyId) } as unknown as EntitySelector)
          : ({ type: 'building', id: asEntityId(legacyId) } as unknown as EntitySelector)
      }
      bridge.pushExternal(selector, SelectionOrigin.Canvas)
    })

    return () => {
      unsubBridge()
      unsubLegacy()
    }
  }, [context])

  // ── Vertex editing bridge: listen for road.edit events from editor package ──
  useEffect(() => {
    const eventBus = context.services.get('eventBus') as any
    if (!eventBus?.on) return
    const unsub = eventBus.on('road.edit', (payload: { roadId: string }) => {
      useStudioStore.getState().setVertexEditing('trace', payload.roadId)
    })
    return () => { unsub?.() }
  }, [context])

  // ── Bridge compile result to compiled-graph-store ──
  // After a successful publish, the compile result contains the NavigationGraph
  // which we need for Route Testing and other features.
  useEffect(() => {
    const eventBus = context.services.get('eventBus') as any
    if (!eventBus?.on) return

    const unsub = eventBus.on('publish.completed', (payload: any) => {
      // Use the navigation graph from the publish event directly — no recompile needed.
      // The PublishService already compiled the document; recompiling here was fragile
      // and silently swallowed errors, leaving Route Testing on mock data.
      const navGraph = payload?.navigationGraph
      if (!navGraph?.nodes?.length) return

      useCompiledGraphStore.getState().setResult(navGraph)

      // Also push V2 nodes/edges into useGraphStore so NavigationGraphRenderer
      // shows the real compiled graph on the Studio map (not the legacy graph).
      const { nodes, edges } = useCompiledGraphStore.getState()
      useGraphStore.getState().setNodes(nodes as any)
      useGraphStore.getState().setEdges(edges as any)
    })

    return () => { unsub?.() }
  }, [context])

  return (
    <EditorProvider context={context}>
      {children}
    </EditorProvider>
  )
}
