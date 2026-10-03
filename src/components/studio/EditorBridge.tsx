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
  GraphAdapter,
} from '@navi/editor'
import type { EntitySelector, PersistenceAdapter, EditorContext, DocumentEventBus } from '@navi/editor'
import type { PersistenceSyncState } from '@navi/editor'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'
import { useCompiledGraphStore } from '@/store/compiled-graph-store'
import { createCompilerAdapter } from '@/services/compiler-adapter'
import { persistStudioGraph } from './studio-persistence'

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

  // GraphAdapter is a projection step. Capture its document only when the
  // campus already has a new-format authored snapshot or a real editor change
  // has advanced the legacy document version; initial legacy hydration remains
  // Graph-only and therefore cannot trigger an automatic rewrite.
  const syncDocumentAndCapture = () => {
    const ctx = contextRef.current
    if (!ctx) return
    const state = useGraphStore.getState()
    const activeBuildingId = useStudioStore.getState().activeBuildingId
    const scope = activeBuildingId ? { kind: 'building', buildingId: activeBuildingId, floor: null } : undefined
    const ga = new GraphAdapter(state.graph, ctx.transformer)
    ga.sync(ctx.document, scope)
    const nextState = useGraphStore.getState()
    nextState.setAuthoredDocument(ctx.document)
  }

  const persistenceAdapter: PersistenceAdapter = {
    save: () => persistStudioGraph({
      syncDocument: () => {
        syncDocumentAndCapture()
      },
      saveGraph: async () => {
        try {
          const activeBuildingId = useStudioStore.getState().activeBuildingId
          // Fallback attribution is gated on a real editor change: a document
          // version advance proves an authored mutation happened even when its
          // intent record was missed (e.g. floor.create from the Manage Floors
          // dialog). Hydration/view-only sessions keep version 0, so the P0.11
          // unattributed-mutation guard still fails closed for them.
          const hasRealDocumentEdit = (contextRef.current?.document.version ?? 0) > 0
          if (useGraphStore.getState().pendingAuthoredMutations.length === 0 && hasRealDocumentEdit) {
            if (activeBuildingId) {
              useGraphStore.getState().recordAuthoredMutation('building', activeBuildingId, null)
            } else {
              useGraphStore.getState().recordAuthoredMutation('outdoor', null, null)
            }
          }
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
    syncToSupabase: () => {
      const activeBuildingId = useStudioStore.getState().activeBuildingId
      // Same gate as saveGraph: only a real document version advance may
      // fabricate fallback attribution; version-0 sessions stay fail-closed.
      const hasRealDocumentEdit = (contextRef.current?.document.version ?? 0) > 0
      if (useGraphStore.getState().pendingAuthoredMutations.length === 0 && hasRealDocumentEdit) {
        if (activeBuildingId) {
          useGraphStore.getState().recordAuthoredMutation('building', activeBuildingId, null)
        } else {
          useGraphStore.getState().recordAuthoredMutation('outdoor', null, null)
        }
      }
      return useGraphStore.getState().syncToSupabase({ trigger: 'autosave' })
    },
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
    const ctx = createEditorContext(
      useGraphStore.getState().graph,
      persistenceAdapter,
      navCompiler,
      useGraphStore.getState().authoredDocument ?? undefined,
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
    new GraphAdapter(graph, context.transformer).sync(context.document)
    useGraphStore.getState().setAuthoredDocument(context.document)
    useGraphStore.setState((state) => ({ renderVersion: state.renderVersion + 1 }))
    // P0.13 CAMPUS_READY_FOR_AUTHORED_SAVE: the initial GraphAdapter/EditorBridge
    // reconciliation has completed — the campus is now READY_CLEAN and authored
    // persistence may proceed (P0.14: shared lifecycle action).
    useGraphStore.getState().completeCampusHydration()
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

    const unsubscribe = eventBus.on('document.changed', (evt?: { entityType?: string; entityId?: string }) => {
      const activeBuildingId = useStudioStore.getState().activeBuildingId
      const entityType = evt?.entityType

      // Record authored mutation so P0.11 save guard attributes the change and permits autosave
      if (entityType === 'floor' || entityType === 'building') {
        useGraphStore.getState().recordAuthoredMutation('building', activeBuildingId ?? evt?.entityId ?? null, null)
      } else if (entityType === 'road') {
        useGraphStore.getState().recordAuthoredMutation('outdoor', null, null)
      } else if (activeBuildingId) {
        useGraphStore.getState().recordAuthoredMutation('building', activeBuildingId, null)
      } else {
        useGraphStore.getState().recordAuthoredMutation('outdoor', null, null)
      }

      const graph = useGraphStore.getState().graph
      const scope = activeBuildingId ? { kind: 'building', buildingId: activeBuildingId, floor: null } : undefined
      new GraphAdapter(graph, context.transformer).sync(context.document, scope)
      useGraphStore.getState().setAuthoredDocument(context.document)
      useGraphStore.setState((state) => ({ renderVersion: state.renderVersion + 1 }))

      // Undo can remove the currently selected Building through an inverse
      // command without going through the normal canvas selection path. Clear
      // that stale selection so the inspector does not show "Entity not
      // found" for an entity that was just removed.
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

    return () => unsubscribe()
  }, [context])

  // Save on tab close / navigation away — fires even if autosave debounce hasn't
  // elapsed. Uses synchronous localStorage write (via graphStore.save()) so data
  // survives browser close. The async Supabase sync runs in the background.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        syncDocumentAndCapture()
        const activeBuildingId = useStudioStore.getState().activeBuildingId
        if (useGraphStore.getState().pendingAuthoredMutations.length === 0 && context.document.version > 0) {
          useGraphStore.getState().recordAuthoredMutation(activeBuildingId ? 'building' : 'outdoor', activeBuildingId, null)
        }
        void useGraphStore.getState().save().catch((error: unknown) => {
          console.warn('EditorBridge visibility persistence failed:', error)
        })
      }
    }
    const handleBeforeUnload = () => {
      syncDocumentAndCapture()
      const activeBuildingId = useStudioStore.getState().activeBuildingId
      if (useGraphStore.getState().pendingAuthoredMutations.length === 0 && context.document.version > 0) {
        useGraphStore.getState().recordAuthoredMutation(activeBuildingId ? 'building' : 'outdoor', activeBuildingId, null)
      }
      void useGraphStore.getState().save().catch((error: unknown) => {
        console.warn('EditorBridge unload persistence failed:', error)
      })
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [context])

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
