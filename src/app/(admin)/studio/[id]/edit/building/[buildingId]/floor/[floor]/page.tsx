'use client'

import { useEffect, use, useMemo, useRef, useState } from 'react'
import { FloorEditor } from '@/components/floor-editor/FloorEditor'
import { ErrorBoundary } from '@/components/floor-editor/ErrorBoundary'
import {
  EditorProvider,
  NavigationCompiler,
  createEditorContext,
  GraphAdapter,
} from '@navi/editor'
import type { PersistenceAdapter, EditorContext, DocumentEventBus, PersistenceSyncState } from '@navi/editor'
import { useGraphStore } from '@/store/graph-store'
import { createCompilerAdapter } from '@/services/compiler-adapter'

export default function FloorEditorPage({ params }: { params: Promise<{ id: string; buildingId: string; floor: string }> }) {
  const { id: mapId, buildingId, floor: floorStr } = use(params)
  const floor = parseInt(floorStr, 10)
  const loadMapData = useGraphStore((s) => s.loadMapData)
  const currentMapId = useGraphStore((s) => s.currentMapId)

  useEffect(() => {
    if (currentMapId !== mapId) {
      loadMapData(mapId)
    }
  }, [mapId, currentMapId, loadMapData])

  if (currentMapId !== mapId) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 13 }}>
        Loading map…
      </div>
    )
  }

  return <FloorEditorBridge mapId={mapId} buildingId={buildingId} floor={floor} />
}

function FloorEditorBridge({ mapId, buildingId, floor }: { mapId: string; buildingId: string; floor: number }) {
  const adoptionVersion = useGraphStore((state) => state.serverAdoptionVersion)
  return (
    <FloorEditorBridgeSession
      key={`${mapId}-${buildingId}-${floor}-${adoptionVersion}`}
      mapId={mapId}
      buildingId={buildingId}
      floor={floor}
      adoptionVersion={adoptionVersion}
    />
  )
}

function FloorEditorBridgeSession({
  mapId,
  buildingId,
  floor,
  adoptionVersion,
}: {
  mapId: string
  buildingId: string
  floor: number
  adoptionVersion: number
}) {
  // Stable identity so effects can list it as a dependency without re-running
  // on every render.
  const floorScope = useMemo(
    () => ({ kind: 'floor', buildingId, floor }),
    [buildingId, floor],
  )

  const [context] = useState(() => {
    let currentCtx: EditorContext | null = null

    const syncDocumentAndCapture = () => {
      if (!currentCtx) return
      const state = useGraphStore.getState()
      if (state.serverAdoptionVersion !== adoptionVersion) {
        throw new Error('This editor context was superseded by server adoption.')
      }
      const ga = new GraphAdapter(state.graph, currentCtx.transformer)
      ga.sync(currentCtx.document, floorScope)
      const nextState = useGraphStore.getState()
      nextState.setAuthoredDocument(currentCtx.document)
    }

    const persistenceAdapter: PersistenceAdapter = {
      save: async () => {
        syncDocumentAndCapture()
        useGraphStore.getState().recordAuthoredMutation('floor', buildingId, floor)
        await useGraphStore.getState().save({ trigger: 'manual' })
      },
      syncToSupabase: async () => {
        syncDocumentAndCapture()
        useGraphStore.getState().recordAuthoredMutation('floor', buildingId, floor)
        await useGraphStore.getState().syncToSupabase({ trigger: 'manual' })
      },
      publish: async () => ({ success: true, version: '1.0.0' }),
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
    }

    const navCompiler = new NavigationCompiler(createCompilerAdapter())
    currentCtx = createEditorContext(
      useGraphStore.getState().graph,
      persistenceAdapter,
      navCompiler,
      useGraphStore.getState().authoredDocument ?? undefined,
    )
    return currentCtx
  })

  // Destroy autosave timers and other services when this context is replaced.
  // The microtask guard tolerates React Strict Mode's setup/cleanup replay.
  const contextLifecycle = useRef(0)
  useEffect(() => {
    contextLifecycle.current += 1
    return () => {
      const cleanupToken = ++contextLifecycle.current
      queueMicrotask(() => {
        if (contextLifecycle.current === cleanupToken) {
          void context.services.destroy().catch((error: unknown) => {
            console.warn('Editor context cleanup failed:', error)
          })
        }
      })
    }
  }, [context])

  // Initial reconciliation on mount: ensure the graph projection is synchronized
  // and mark the campus ready so floor-scoped saves are permitted by the safety guard.
  useEffect(() => {
    const graph = useGraphStore.getState().graph
    if (typeof graph?.setBuildings !== 'function') return
    new GraphAdapter(graph, context.transformer).sync(context.document, floorScope)
    useGraphStore.getState().setAuthoredDocument(context.document)
    useGraphStore.setState((state) => ({ renderVersion: state.renderVersion + 1 }))
    useGraphStore.getState().completeCampusHydration()
  }, [context, floorScope])

  // Continuous projection: keep graph and authoredDocument in lockstep as the user edits.
  useEffect(() => {
    const eventBus = context.services.get('eventBus') as DocumentEventBus | undefined
    if (!eventBus) return

    const unsubscribe = eventBus.on('document.changed', () => {
      if (useGraphStore.getState().serverAdoptionVersion !== adoptionVersion) return
      const graph = useGraphStore.getState().graph
      new GraphAdapter(graph, context.transformer).sync(context.document, floorScope)
      useGraphStore.getState().setAuthoredDocument(context.document)
      useGraphStore.getState().recordAuthoredMutation('floor', buildingId, floor)
      useGraphStore.setState((state) => ({ renderVersion: state.renderVersion + 1 }))
    })

    return () => unsubscribe()
  }, [context, floorScope, buildingId, floor, adoptionVersion])

  // Route transitions and tab exits can unmount the editor without giving the
  // normal command autosave debounce a chance to run. Phase 3B: the committed
  // LOCAL draft is made durable here — no server synchronization from teardown.
  useEffect(() => {
    const flushLocalPersistence = () => {
      const state = useGraphStore.getState()
      if (state.serverAdoptionVersion !== adoptionVersion) return
      const workflow = context.services.get('workflow') as { isDirty?: () => boolean } | undefined
      const isDirty = typeof workflow?.isDirty === 'function' ? workflow.isDirty() : false
      if (!isDirty && state.pendingAuthoredMutations.length === 0) {
        return
      }
      const ga = new GraphAdapter(state.graph, context.transformer)
      ga.sync(context.document, floorScope)
      const nextState = useGraphStore.getState()
      nextState.setAuthoredDocument(context.document)
      useGraphStore.getState().persistLocalDraft()
      useGraphStore.getState().recordAuthoredMutation('floor', buildingId, floor)
      void useGraphStore.getState().save({ trigger: 'autosave' }).catch((error: unknown) => {
        console.warn('Floor editor exit persistence failed:', error)
      })
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushLocalPersistence()
    }
    window.addEventListener('beforeunload', flushLocalPersistence)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', flushLocalPersistence)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      flushLocalPersistence()
    }
  }, [buildingId, floor, context, floorScope, adoptionVersion])

  return (
    <ErrorBoundary>
      <EditorProvider context={context}>
        <FloorEditor mapId={mapId} buildingId={buildingId} floor={floor} />
      </EditorProvider>
    </ErrorBoundary>
  )
}
