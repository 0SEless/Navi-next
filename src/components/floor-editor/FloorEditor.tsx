'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useEditor, useSelection, useDocumentVersion, Viewport, CurrentToolStore, ContextHeader, ToolDock, ICONS, buildInteriorToolGroups, useToolDockShortcuts, toolRegistry, SUPPORTED_PLAN_ACCEPT, needsDoorOwnershipReconcile } from '@navi/editor'
import { useLegacyBuilding, useFloorSyncStatus, useFloorSyncError, useFloorComponents, useFloorWorkflowSaveState, deriveFloorHeaderStatus } from '@/hooks/floor-graph-selectors'
import { DiagnosticsPanel } from '@/components/diagnostics/DiagnosticsPanel'
import { runValidationChecks } from './validation-checks'
import { FloorOutliner } from './FloorOutliner'
import { ComponentProperties } from './ComponentProperties'
import { OutdoorRoutePicker } from './OutdoorRoutePicker'
import type { OutdoorRouteCandidate } from './outdoor-route-picker-model'
import type { EntranceAccessRequiredRequest } from './useFloorDrawing'
import type { DoorRouteConnectTarget } from './route-target-authoring'
import { InteractionProvider, useInteraction } from './InteractionContext'
import { StatusBar } from './StatusBar'
import { useFloorAdapter } from './adapters/floor-adapter'
import { useToolAdapter } from './adapters/tool-adapter'
import type { LayerVisibility } from '@/types/studio-types'
import { DEFAULT_LAYER_VISIBILITY } from '@/types/studio-types'

const FloorEditorCanvas = dynamic(
  () => import('./FloorEditorCanvas').then((m) => m.FloorEditorCanvas),
  { ssr: false, loading: () => <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', fontSize: 12 }}>Loading mapâ€¦</div> }
)
import { ScaleCalibration } from './ScaleCalibration'
import { TwoPointCalibration, validateCalibrationPoints, computeCalibration } from './TwoPointCalibration'
import type { CalibrationStep, CalibrationError } from './TwoPointCalibration'
import type { Point2D } from '@/lib/two-point-calibration'
import { getFootprintFrameMeters } from '@/lib/floor-plan-transform'
import { normalizePlanAlignmentForWrite } from '@/lib/floor-plan-inspector'
import { commitFloorPlanAlignment } from '@/lib/floor-plan-commit'
import { uploadFloorPlanImage, deleteFloorPlanImage } from '@/services/floor-plan-storage'
import {
  buildFloorPlanReplaceAlignment,
  collectBuildingFloorPlanReferences,
  readFloorPlanImageDimensions,
  resolveFloorPlanUrl,
} from '@/services/floor-plan-lifecycle'
import type { FloorPlanStorageScope } from '@/services/floor-plan-lifecycle'
import { FloorPlanTransformInspector } from './FloorPlanTransformInspector'
import { Eye, EyeOff, Upload, Trash2, RefreshCw, Box, Layers } from 'lucide-react'
import { useGraphStore } from '@/store/graph-store'
import { canonicalRoomIds } from '@navi/core'
import type { PlanAlignment } from '@navi/core'

interface FloorEditorProps {
  mapId: string
  buildingId: string
  floor: number
}

const ARCHITECTURE_LAYERS: { key: keyof LayerVisibility; label: string }[] = [
  { key: 'floor_plan', label: 'Floor Plan' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'hallways', label: 'Hallways' },
  { key: 'assets', label: 'Assets' },
  { key: 'labels', label: 'Labels' },
]

export function FloorEditor({ mapId, buildingId, floor }: FloorEditorProps) {
  const { services, document: editorDoc } = useEditor()
  const viewport = services.get('viewport')

  const building = useLegacyBuilding(buildingId)
  const syncStatus = useFloorSyncStatus()
  const syncError = useFloorSyncError()
  const workflowSaveState = useFloorWorkflowSaveState()

  const { activeTool, activateTool } = useToolAdapter(services.get('toolRegistry') as CurrentToolStore)
  const floorAdapter = useFloorAdapter(viewport as Viewport, building ?? null, floor)
  const { lastSelected, select, clear } = useSelection()
  const selectedId = lastSelected?.id ?? null
  const selectedCount = lastSelected ? 1 : 0

  // "Saved" requires a server-confirmed graph sync AND a clean workflow
  // document. Graph syncStatus alone stays `synced` through the autosave
  // debounce after a committed edit, so it is never sufficient on its own.
  const headerStatus = deriveFloorHeaderStatus(syncStatus, workflowSaveState)
  const headerStatusMessage =
    syncStatus === 'conflict'
      ? 'Changes not synced'
      : syncStatus === 'error'
        ? syncError?.startsWith('Offline')
          ? 'Saved on this device'
          : 'Sync failed'
        : undefined

  const [layers, setLayers] = useState<LayerVisibility>({
    ...DEFAULT_LAYER_VISIBILITY,
    floor_plan: true, buildings: false,
  })

  const [editorMode, setEditorMode] = useState<'architecture' | 'navigation'>('architecture')
  const [viewMode, setViewMode] = useState<'2d' | '2.5d'>('2d')
  // Camera snapshot for deterministic restore when toggling 2D ↔ 2.5D
  const cameraSnapshotRef = useRef<{ pitch: number; bearing: number; zoom: number; center: [number, number] } | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  // Snap mode for wall drawing
  const [snapMode, setSnapMode] = useState<'architectural' | 'trace' | 'free'>('trace')


  const canonicalFloor = editorDoc.buildings
    .find((candidate) => candidate.id === buildingId)
    ?.floors.find((candidate) => candidate.level === floor)
  const currentFloorData = building?.floorData?.find((fd: any) => fd.level === floor || (canonicalFloor?.id && fd.id === canonicalFloor.id))
  const currentFloorId = canonicalFloor?.id ?? ((currentFloorData as any)?.id as string | undefined)
  const currentLevel = canonicalFloor?.level ?? (typeof (currentFloorData as any)?.level === 'number' ? (currentFloorData as any).level : floor)
  const planAlignment = (currentFloorData as any)?.planAlignment as PlanAlignment | undefined

  // ROU Task 5: canonical room-id fingerprint of the active floor. The document
  // version subscription re-renders on every commit; the derived string only
  // changes when the canonical room set changes, so edits that leave the room
  // set untouched never re-dispatch the reconcile effect.
  useDocumentVersion()



  const roomIdFingerprint = canonicalFloor ? canonicalRoomIds(canonicalFloor).join('|') : ''
  // Bug A fix (T1): use currentLevel (the floor's level number) as the floorPlanUrls key,
  // not the raw `floor` prop (which is a 0-based array index, not a level number).
  // floorPlanUrls is keyed by level (0=GF, 1=1F, …) so using the index silently
  // reads the wrong slot when level ≠ index. currentFloorData.planImageId is always
  // preferred (per-floor, isolated); floorPlanUrls[currentLevel] is a read-only
  // legacy fallback and must never be mutated by a replace operation.
  const planImageUrl = resolveFloorPlanUrl(building?.floorPlanUrls?.[currentLevel], currentFloorData as any)
  const hasPlan = !!planImageUrl
  const persistedLocked = !!(currentFloorData as any)?.locked

  const [mode, setMode] = useState<'setup' | 'mapping'>(
    persistedLocked ? 'mapping' : 'setup'
  )
  const [locked, setLocked] = useState(persistedLocked)
  const [showGotIt, setShowGotIt] = useState(false)
  const [setupCardHidden, setSetupCardHidden] = useState(false)
  const [showCalibrate, setShowCalibrate] = useState(false)
  const [twoPointCalibration, setTwoPointCalibration] = useState(false)
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>('plan-a')
  const [calPlanA, setCalPlanA] = useState<Point2D | null>(null)
  const [calPlanB, setCalPlanB] = useState<Point2D | null>(null)
  const [calMapA, setCalMapA] = useState<Point2D | null>(null)
  const [calMapB, setCalMapB] = useState<Point2D | null>(null)
  const [calError, setCalError] = useState<CalibrationError | null>(null)
  const [calImageWidth, setCalImageWidth] = useState(0)
  const [calImageHeight, setCalImageHeight] = useState(0)
  const [uploadCardDismissed, setUploadCardDismissed] = useState(false)
  const [showUnlockWarning, setShowUnlockWarning] = useState(false)
  const [aspectRatioLocked, setAspectRatioLocked] = useState(true)

  const calibrationFrame = useMemo(
    () => getFootprintFrameMeters(building?.footprint ?? []),
    [building?.footprint],
  )
  const calibrationFootprintLocal = useMemo(
    () => calibrationFrame.corners.map((point) => [point.x, point.y] as Point2D),
    [calibrationFrame],
  )

  // Keep viewport activeBuildingId and activeFloorId synchronized with the active FloorEditor scope
  useEffect(() => {
    const vp = viewport as Viewport | undefined
    if (!vp) return
    if (typeof vp.setActiveBuilding === 'function' && buildingId && vp.activeBuildingId !== buildingId) {
      vp.setActiveBuilding(buildingId)
    }
    const resolvedFloorId = canonicalFloor?.id ?? currentFloorId
    if (typeof vp.setActiveFloor === 'function' && resolvedFloorId && vp.activeFloorId !== resolvedFloorId) {
      vp.setActiveFloor(resolvedFloorId)
    }
  }, [viewport, buildingId, canonicalFloor?.id, currentFloorId])

  // The editor document can hydrate after this component's first render. Keep
  // the local interaction gate aligned with the persisted floor lock once the
  // active floor record is available.
  useEffect(() => {
    if (!currentFloorId) return
    setLocked(persistedLocked)
    if (persistedLocked) setMode('mapping')
  }, [currentFloorId, persistedLocked])

  // ROU Task 5: silent auto-reconcile. The effect depends on the stable
  // fingerprint only — the command rewrites door ownership, not the canonical
  // room-id set, so its own commit cannot re-trigger this effect. The pure
  // predicate mirrors the handler's change detection (F1): a floor with
  // nothing to fix skips the dispatch entirely, so it never commits, never
  // bumps the document version, and never dirties the project.
  useEffect(() => {
    if (!currentFloorId) return
    if (!canonicalFloor || !needsDoorOwnershipReconcile(canonicalFloor)) return
    services.get('dispatcher')?.execute(
      {
        id: 'door.ownership.reconcile',
        label: 'Reconcile Room Ownership',
        payload: { buildingId, floorId: currentFloorId },
      },
      { skipHooks: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- [buildingId, currentFloorId, roomIdFingerprint] is the loop guard; `services` is stable
  }, [buildingId, currentFloorId, roomIdFingerprint])

  const [navPreviewOpen, setNavPreviewOpen] = useState(false)
  const [validationVisible, setValidationVisible] = useState(false)
  const floorComponents = useFloorComponents(buildingId, currentLevel, currentFloorId)

  // Clear stale selection if the selected entity does not belong to the active floor
  useEffect(() => {
    if (!lastSelected) return
    const belongsToFloor = floorComponents.some((comp) => comp.id === lastSelected.id)
    if (!belongsToFloor) {
      clear()
    }
  }, [currentFloorId, currentLevel, floorComponents, lastSelected, clear])
  const graphNodes = useGraphStore((state) => state.graph.nodes)
  const graphEdges = useGraphStore((state) => state.graph.edges)
  const graphBuildings = useGraphStore((state) => state.graph.buildings)
  const graphAreas = useGraphStore((state) => state.graph.areas)
  const [outdoorPickerEntranceId, setOutdoorPickerEntranceId] = useState<string | null>(null)
  const [pendingEntranceRoute, setPendingEntranceRoute] = useState<{
    entranceId: string
    candidate: OutdoorRouteCandidate
  } | null>(null)
  const [routeAuthoringMessage, setRouteAuthoringMessage] = useState<string | null>(null)
  const [pendingFinishAccess, setPendingFinishAccess] = useState<EntranceAccessRequiredRequest | null>(null)
  const [doorRoutePick, setDoorRoutePick] = useState<{ doorId: string } | null>(null)
  const handleStartRouteConnect = useCallback((doorId: string) => {
    setDoorRoutePick({ doorId })
    setLayers((prev) => ({ ...prev, nodes: true, edges: true }))
    setRouteAuthoringMessage('Click a route node to reuse it, or a route line to create a junction for this door.')
  }, [])
  const handleRouteConnectResolved = useCallback((target: DoorRouteConnectTarget) => {
    services.get('dispatcher')?.execute({ id: 'door.route.connect', label: 'Connect Door to Route', payload: target })
    setDoorRoutePick(null)
    setRouteAuthoringMessage(null)
  }, [services])
  const handleRouteConnectCancel = useCallback(() => { setDoorRoutePick(null); setRouteAuthoringMessage(null) }, [])
  const pendingRouteAnchor = useMemo(() => pendingEntranceRoute ? {
    entranceId: pendingEntranceRoute.entranceId,
    outdoorNodeId: pendingEntranceRoute.candidate.id,
    position: pendingEntranceRoute.candidate.position,
    ...(pendingEntranceRoute.candidate.routeId ? { outdoorRouteId: pendingEntranceRoute.candidate.routeId } : {}),
  } : undefined, [pendingEntranceRoute])
  const selectedEntranceForPicker = useMemo(() => {
    if (!outdoorPickerEntranceId) return null
    const selected = floorComponents.find((component) => component.id === outdoorPickerEntranceId && component.type === 'entrance')
    return selected ? { id: selected.id, name: selected.name, position: selected.position } : null
  }, [floorComponents, outdoorPickerEntranceId])
  const handleOpenOutdoorRoutePicker = useCallback((entranceId: string) => {
    const entrance = floorComponents.find((component) => component.id === entranceId && component.type === 'entrance')
    if (!entrance) return
    setRouteAuthoringMessage(null)
    setOutdoorPickerEntranceId(entranceId)
  }, [floorComponents])
  const handleOutdoorRouteConfirm = useCallback((candidate: OutdoorRouteCandidate) => {
    if (!selectedEntranceForPicker) return
    setPendingEntranceRoute({ entranceId: selectedEntranceForPicker.id, candidate })
    setOutdoorPickerEntranceId(null)
    setEditorMode('navigation')
    setMode('mapping')
    setRouteAuthoringMessage('Outdoor target selected. The Route starts at the selected Entrance; click each next turn or branch point.')
    activateTool('hallway')
  }, [activateTool, selectedEntranceForPicker])
  const handleOutdoorRouteCancel = useCallback(() => setOutdoorPickerEntranceId(null), [])
  const handleRouteStartRejected = useCallback((reason: string) => setRouteAuthoringMessage(reason), [])
  const handleRouteAccessAssigned = useCallback(() => {
    setPendingEntranceRoute(null)
    setRouteAuthoringMessage(null)
  }, [])
  const handleEntranceAccessRequired = useCallback((request: EntranceAccessRequiredRequest) => {
    setPendingFinishAccess(request)
    setOutdoorPickerEntranceId(request.entranceId)
  }, [])
  const handleFinishAccessConfirm = useCallback((candidate: OutdoorRouteCandidate) => {
    if (!pendingFinishAccess) return
    const dispatcher = services.get('dispatcher')
    const result = dispatcher?.execute({
      id: 'entrance.access.assign',
      label: 'Assign Entrance Route Access',
      payload: {
        buildingId: pendingFinishAccess.buildingId,
        floorId: pendingFinishAccess.floorId,
        entranceId: pendingFinishAccess.entranceId,
        outdoorNodeId: candidate.id,
        indoorRouteNodeId: pendingFinishAccess.indoorRouteNodeId,
        ...(candidate.routeId ? { outdoorRouteId: candidate.routeId, outdoorPosition: candidate.position } : {}),
      },
    })
    if (!result?.success) {
      dispatcher?.execute({ id: 'route.path.create', label: 'Restore Route after failed Entrance connection', payload: { restore: true, ...pendingFinishAccess.restore } })
      const anchorAccessRestore = pendingFinishAccess.restore.anchorAccessRestore
      if (anchorAccessRestore) {
        dispatcher?.execute({
          id: 'entrance.access.unassign',
          label: 'Restore Entrance Access after cancelled finish',
          payload: {
            buildingId: pendingFinishAccess.buildingId,
            floorId: pendingFinishAccess.floorId,
            entranceId: anchorAccessRestore.entranceId,
            restoreEntranceAccess: anchorAccessRestore.previousEntranceAccess,
          },
        })
      }
      setRouteAuthoringMessage(result?.error ?? 'The Route was restored because the Entrance connection could not be saved.')
    } else {
      setRouteAuthoringMessage(null)
    }
    setOutdoorPickerEntranceId(null)
    setPendingFinishAccess(null)
  }, [pendingFinishAccess, services])
  const handleFinishAccessCancel = useCallback(() => {
    if (pendingFinishAccess) {
      const dispatcher = services.get('dispatcher')
      dispatcher?.execute({ id: 'route.path.create', label: 'Restore Route after cancelled Entrance connection', payload: { restore: true, ...pendingFinishAccess.restore } })
      const anchorAccessRestore = pendingFinishAccess.restore.anchorAccessRestore
      if (anchorAccessRestore) {
        dispatcher?.execute({
          id: 'entrance.access.unassign',
          label: 'Restore Entrance Access after cancelled finish',
          payload: {
            buildingId: pendingFinishAccess.buildingId,
            floorId: pendingFinishAccess.floorId,
            entranceId: anchorAccessRestore.entranceId,
            restoreEntranceAccess: anchorAccessRestore.previousEntranceAccess,
          },
        })
      }
    }
    setOutdoorPickerEntranceId(null)
    setPendingFinishAccess(null)
  }, [pendingFinishAccess, services])
  const validationChecks = useMemo(
    () => {
      const floorIndex = building?.floors ? Math.max(0, building.floors.indexOf(currentLevel)) : 0
      return runValidationChecks(building, floorIndex, floorComponents, undefined, editorDoc.roads, editorDoc)
    },
    [building, currentLevel, floorComponents, editorDoc],
  )

  // Sync nav preview state when editor mode changes
  useEffect(() => {
    if (editorMode === 'navigation') {
      setNavPreviewOpen(true)
      if (!(layers.nodes && layers.edges)) {
        setLayers((prev) => ({ ...prev, nodes: true, edges: true }))
      }
    }
  }, [editorMode])

  const graphVisible = layers.nodes && layers.edges
  const toggleGraph = useCallback(() => {
    const newVal = !(layers.nodes && layers.edges)
    setLayers((prev) => ({ ...prev, nodes: newVal, edges: newVal }))
  }, [layers.nodes, layers.edges])

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Tools that create geometry — disabled in 2.5D preview mode
  const CREATION_TOOLS_2_5D = useMemo(() => new Set(['wall', 'door', 'window', 'hallway']), [])

  const handleToolActivate = useCallback((toolId: string) => {
    if (viewMode === '2.5d' && CREATION_TOOLS_2_5D.has(toolId)) return
    if (toolId === 'align') {
      if (locked) return
      // Enter setup mode for alignment
      setMode('setup')
      setLocked(false)
      return
    }
    // Exit setup mode when selecting other tools
    if (mode === 'setup' && toolId !== 'align') {
      setMode('mapping')
    }
    activateTool(toolId)
    clear()
  }, [activateTool, clear, editorMode, viewMode, CREATION_TOOLS_2_5D, mode, locked])

  const interiorToolGroups = useMemo(
    () => buildInteriorToolGroups(toolRegistry, ICONS, editorMode),
    [editorMode],
  )
  const dockToolGroups = useMemo(
    () => locked ? interiorToolGroups.filter((group) => group.id !== 'alignment') : interiorToolGroups,
    [interiorToolGroups, locked],
  )

  // Find the active tool ID in the groups (reverse mapping)
  const dockActiveTool = mode === 'setup' ? 'select' : viewMode === '2.5d' ? 'select' : activeTool

  useToolDockShortcuts(dockToolGroups, dockActiveTool, handleToolActivate)

  const handleViewModeToggle = useCallback(() => {
    setViewMode((prev) => (prev === '2d' ? '2.5d' : '2d'))
  }, [])

  // When switching to 2.5D, if a creation tool is active, force select
  useEffect(() => {
    if (viewMode === '2.5d' && CREATION_TOOLS_2_5D.has(activeTool)) {
      activateTool('select')
    }
  }, [viewMode, activeTool, activateTool, CREATION_TOOLS_2_5D])

  const handleManualSave = useCallback(async () => {
    const workflow = services.get('workflow') as any
    try {
      await workflow?.save('manual')
    } catch (error: unknown) {
      console.warn('Manual save failed in FloorEditor:', error)
    }
  }, [services])

  const historyRef = useRef(services.get('history'))
  const dispatcher = services.get('dispatcher')
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.repeat) {
        e.preventDefault()
        void handleManualSave()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.repeat) {
        e.preventDefault()
        if (e.shiftKey) {
          historyRef.current.redo()
        } else {
          historyRef.current.undo()
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y') && !e.repeat) {
        e.preventDefault()
        historyRef.current.redo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !e.shiftKey && !e.repeat) {
        const target = e.target as HTMLElement | null
        if (target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
        if (!selectedId) return
        const selectedComponent = floorComponents.find((component) => component.id === selectedId)
        if (selectedComponent?.type !== 'door') return
        e.preventDefault()
        const result = dispatcher?.execute({ id: 'door.duplicate', label: 'Duplicate Door', payload: { doorId: selectedId } })
        if (result?.success && typeof result.entityId === 'string') select(result.entityId)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [editorMode, selectedId, floorComponents, select, dispatcher, handleManualSave])

  const floorExists = (building?.floors ? building.floors.includes(floor) : false) || !!canonicalFloor
  const floorLabel = floor === 0 ? 'GF' : floor > 0 ? `${floor}F` : `${floor}F`
  const canvasTool = mode === 'setup' ? 'select' : viewMode === '2.5d' ? 'select' : activeTool

  const [editorAlignment, setEditorAlignment] = useState(planAlignment)
  useEffect(() => setEditorAlignment(planAlignment), [planAlignment])

  /**
   * Sole committed-alignment authority. Pointermove never reaches this
   * callback; FloorPlanAlignment calls it only after a completed gesture.
   */
  const commitAlignment = useCallback((candidate: PlanAlignment) => {
    const next = normalizePlanAlignmentForWrite(candidate)
    if (!currentFloorId) {
      setEditorAlignment(next)
      return
    }
    const dispatcher = services.get('dispatcher') as any
    const committed = dispatcher ? commitFloorPlanAlignment(dispatcher, currentFloorId, next) : next
    if (committed) setEditorAlignment(committed)
  }, [currentFloorId, services])

  // T1: Supabase Storage Upload Handler
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentFloorId || !buildingId) return
    const existingUrl = planImageUrl
    setIsUploading(true)
    try {
      const publicUrl = await uploadFloorPlanImage(file, mapId, buildingId, currentLevel)
      if (publicUrl) {
        const dispatcher = services.get('dispatcher') as any
        if (!dispatcher?.execute) return
        const [previousDimensions, replacementDimensions] = await Promise.all([
          readFloorPlanImageDimensions(existingUrl),
          readFloorPlanImageDimensions(publicUrl),
        ])
        const nextAlignment = buildFloorPlanReplaceAlignment(
          editorAlignment,
          previousDimensions,
          replacementDimensions,
        )
        const updateResult = dispatcher?.execute({
          id: 'entity.update',
          label: 'Replace Floor Plan',
          payload: {
            entityId: currentFloorId,
            changes: { planImageId: publicUrl, floorPlanState: 'active', planAlignment: nextAlignment },
          },
        })
        if (updateResult?.success === false) return
        setEditorAlignment(nextAlignment)
        if (existingUrl && existingUrl !== publicUrl) {
          const scope: FloorPlanStorageScope = {
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            mapId,
            buildingId,
            floorLevel: currentLevel,
          }
          // Shared-asset guard: only physically delete the old asset when no
          // other floor (per-floor planImageId, legacy floorPlanUrls fallback,
          // or persisted floorPlanVisuals) still resolves to it. The update
          // above already set this floor's binding to publicUrl, so the
          // override keeps the captured (pre-update) building from counting
          // this floor's stale reference to existingUrl.
          await deleteFloorPlanImage(existingUrl, scope, {
            referencedUrls: collectBuildingFloorPlanReferences(building, {
              level: currentLevel,
              planImageId: publicUrl,
            }),
          })
        }
        setUploadCardDismissed(true)
        setMode('setup')
        setLocked(false)
        setShowGotIt(true)
        setSetupCardHidden(false)
      }
    } catch (err) {
      console.error('Failed to upload floor plan:', err)
    } finally {
      setIsUploading(false)
    }
  }, [services, currentFloorId, building, buildingId, mapId, currentLevel])

  // T5: Remove Floor Plan Handler
  const handleRemoveFloorPlan = useCallback(async () => {
    if (!currentFloorId) return
    const existingUrl = planImageUrl
    const dispatcher = services.get('dispatcher') as any
    if (!dispatcher?.execute) return
    const updateResult = dispatcher?.execute({
      id: 'entity.update',
      label: 'Remove Floor Plan',
      payload: { entityId: currentFloorId, changes: { planImageId: null, floorPlanState: 'none', planAlignment: null } },
    })
    if (updateResult?.success === false) return
    setEditorAlignment(undefined)
    if (existingUrl) {
      const scope: FloorPlanStorageScope = {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        mapId,
        buildingId,
        floorLevel: currentLevel,
      }
      // Shared-asset guard: this floor's binding is now null (explicit
      // removal), so the override stops the captured pre-update building
      // from counting this floor's stale reference to existingUrl. Any
      // sibling still resolving it (planImageId or legacy fallback) keeps
      // the asset alive.
      await deleteFloorPlanImage(existingUrl, scope, {
        referencedUrls: collectBuildingFloorPlanReferences(building, {
          level: currentLevel,
          planImageId: null,
        }),
      })
    }
    setMode('mapping')
    setShowGotIt(false)
  }, [services, currentFloorId, building, planImageUrl, editorAlignment, mapId, buildingId, currentLevel])

  const handleCalibrationClick = useCallback((type: 'plan' | 'map', point: Point2D) => {
    setCalError(null)
    if (type === 'plan') {
      if (calibrationStep === 'plan-a') {
        setCalPlanA(point)
        setCalibrationStep('plan-b')
      } else if (calibrationStep === 'plan-b' && calPlanA) {
        const err = validateCalibrationPoints('plan-b', point, calPlanA, null, null, calImageWidth, calImageHeight, [])
        if (err) { setCalError(err); return }
        setCalPlanB(point)
        setCalibrationStep('map-a')
      }
    } else {
      if (calibrationStep === 'map-a') {
        setCalMapA(point)
        setCalibrationStep('map-b')
      } else if (calibrationStep === 'map-b' && calMapA) {
        const err = validateCalibrationPoints('map-b', point, null, null, calMapA, 0, 0, calibrationFootprintLocal)
        if (err) { setCalError(err); return }
        setCalMapB(point)
        setCalibrationStep('preview')
      }
    }
  }, [calibrationStep, calPlanA, calMapA, calImageWidth, calImageHeight, calibrationFootprintLocal])

  const handleCalibrationApply = useCallback((alignment: any) => {
    commitAlignment({ ...editorAlignment, ...alignment })
    setTwoPointCalibration(false)
    setCalibrationStep('plan-a')
    setCalPlanA(null)
    setCalPlanB(null)
    setCalMapA(null)
    setCalMapB(null)
    setCalError(null)
  }, [commitAlignment, editorAlignment])

  const handleCalibrationClose = useCallback(() => {
    setTwoPointCalibration(false)
    setCalibrationStep('plan-a')
    setCalPlanA(null)
    setCalPlanB(null)
    setCalMapA(null)
    setCalMapB(null)
    setCalError(null)
  }, [])

  const handleLock = useCallback(() => {
    if (currentFloorId) {
      const dispatcher = services.get('dispatcher') as any
      // This is the authored-floor editing lock, intentionally distinct from
      // the reference-layer planAlignment.locked Inspector control.
      dispatcher?.execute({ id: 'entity.update', payload: { entityId: currentFloorId, changes: { locked: true } } })
    }
    setLocked(true)
    setMode('mapping')
    setShowGotIt(false)
  }, [currentFloorId, services])

  const handleUnlock = useCallback(() => {
    const roomCount = floorComponents.filter((c) => c.type === 'room').length
    const hallwayCount = floorComponents.filter((c) => c.type === 'hallway').length
    if (roomCount > 0 || hallwayCount > 0) {
      setShowUnlockWarning(true)
    } else {
      if (currentFloorId) {
        const dispatcher = services.get('dispatcher') as any
        dispatcher?.execute({ id: 'entity.update', payload: { entityId: currentFloorId, changes: { locked: false } } })
      }
      setMode('setup')
      setLocked(false)
      setSetupCardHidden(false)
    }
  }, [floorComponents, currentFloorId, services])

  const confirmUnlock = useCallback(() => {
    setShowUnlockWarning(false)
    if (currentFloorId) {
      const dispatcher = services.get('dispatcher') as any
      dispatcher?.execute({ id: 'entity.update', payload: { entityId: currentFloorId, changes: { locked: false } } })
    }
    setMode('setup')
    setLocked(false)
    setSetupCardHidden(false)
  }, [currentFloorId, services])

  return (
    <InteractionProvider>
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!building ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navi-text-secondary)', fontSize: 13 }}>
          Building not found
        </div>
      ) : !floorExists ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navi-text-secondary)', fontSize: 13 }}>
          Floor not found
        </div>
      ) : (
        <>
      <ContextHeader
        mapId={mapId}
        buildingName={building?.name ?? ''}
        floorLabel={floorLabel}
        status={headerStatus}
        statusMessage={headerStatusMessage}
        selectedCount={selectedCount}
        onSave={handleManualSave}
        onResolveConflict={() => { void useGraphStore.getState().adoptServerSnapshot().catch(() => {}) }}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <FloorOutliner building={building} activeFloor={currentLevel} mapId={mapId} selectedId={selectedId} onSelect={(id) => id ? select(id) : clear()} activeFloorId={currentFloorId} />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <FloorEditorCanvas building={building} activeFloorId={currentFloorId} floor={currentLevel} tool={canvasTool} layers={layers} selectedId={selectedId} onSelect={(id) => id ? select(id) : clear()} planAlignment={editorAlignment} floorPlanUrl={planImageUrl} alignMode={mode === 'setup'} readOnly={viewMode === '2.5d'} locked={locked} overlayLocked={!!editorAlignment?.locked} aspectRatioLocked={aspectRatioLocked} onAspectRatioLockedChange={setAspectRatioLocked} onAlignmentChange={commitAlignment} calibrationMode={twoPointCalibration} calibrationStep={calibrationStep} onCalibrationClick={handleCalibrationClick} onCalibrationImageLoaded={(w, h) => { setCalImageWidth(w); setCalImageHeight(h) }} viewMode={viewMode} onCameraSnapshot={(snap) => { cameraSnapshotRef.current = snap }} cameraSnapshot={cameraSnapshotRef.current} snapMode={snapMode} onSnapModeChange={setSnapMode} pendingRouteAnchor={pendingRouteAnchor} onRouteStartRejected={handleRouteStartRejected} onRouteAccessAssigned={handleRouteAccessAssigned} onEntranceAccessRequired={handleEntranceAccessRequired} routeConnectPick={doorRoutePick} onRouteConnectResolved={handleRouteConnectResolved} onRouteConnectCancel={handleRouteConnectCancel} />
          {selectedEntranceForPicker && (
            <OutdoorRoutePicker
              open
              building={building}
              entrance={selectedEntranceForPicker}
              nodes={graphNodes}
              edges={graphEdges}
              campusBuildings={graphBuildings}
              campusRoads={editorDoc.roads}
              campusAreas={graphAreas}
              onCancel={pendingFinishAccess ? handleFinishAccessCancel : handleOutdoorRouteCancel}
              onConfirm={pendingFinishAccess ? handleFinishAccessConfirm : handleOutdoorRouteConfirm}
            />
          )}
          <StatusBar />
          {routeAuthoringMessage && (
            <div role="status" style={{ position: 'absolute', bottom: 42, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, maxWidth: 'min(520px, 80%)', padding: '7px 10px', borderRadius: 6, background: '#1E293B', border: '1px solid #334155', color: '#E2E8F0', fontSize: 11, lineHeight: 1.35, zIndex: 50, boxShadow: '0 2px 8px rgba(0,0,0,0.3)', pointerEvents: 'none' }}>
              <span style={{ color: '#67E8F9' }}>Route</span>
              <span style={{ flex: 1 }}>{routeAuthoringMessage}</span>
              <button type="button" aria-label="Dismiss route message" onClick={() => setRouteAuthoringMessage(null)} style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 14, lineHeight: 1, pointerEvents: 'auto' }}>×</button>
            </div>
          )}
          {!hasPlan && !uploadCardDismissed && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.6)', zIndex: 20 }}>
              <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '28px 32px', maxWidth: 360, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#F1F5F9', marginBottom: 6 }}>{floorLabel}</div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 16 }}>This floor has no floor plan.</div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 6, background: '#3B82F6', color: '#fff', fontSize: 12, fontWeight: 600, cursor: isUploading ? 'not-allowed' : 'pointer', marginBottom: 10, opacity: isUploading ? 0.7 : 1 }}>
                  {isUploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                  {isUploading ? 'Uploadingâ€¦' : 'Upload Floor Plan'}
                  <input type="file" accept={SUPPORTED_PLAN_ACCEPT} onChange={handleUpload} disabled={isUploading} style={{ display: 'none' }} />
                </label>
                <div>
                  <button onClick={() => { setUploadCardDismissed(true); setMode('mapping') }} style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                    Continue without floor plan
                  </button>
                </div>
              </div>
            </div>
          )}
          {showGotIt && (
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
              <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#E2E8F0' }}>Floor uploaded. Drag it until the walls match the map.</span>
                <button onClick={() => setShowGotIt(false)} style={{ padding: '4px 10px', borderRadius: 4, background: '#3B82F6', border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer' }}>Got it</button>
              </div>
            </div>
          )}
          {showCalibrate && (
            <ScaleCalibration
              currentScale={editorAlignment?.scaleX ?? editorAlignment?.scale ?? 1}
              onApplyScale={(newScale) => commitAlignment({ ...editorAlignment, scaleX: newScale, scaleY: newScale })}
              onClose={() => setShowCalibrate(false)}
            />
          )}
          {twoPointCalibration && (
            <TwoPointCalibration
              imageWidth={calImageWidth}
              imageHeight={calImageHeight}
              buildingFootprint={calibrationFootprintLocal}
              footprintFrame={calibrationFrame}
              onApply={handleCalibrationApply}
              onClose={handleCalibrationClose}
              planA={calPlanA}
              planB={calPlanB}
              mapA={calMapA}
              mapB={calMapB}
              error={calError}
            />
          )}
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'setup' ? (
              <div style={{ display: 'flex', background: 'var(--navi-card)', borderRadius: 6, border: '1px solid var(--navi-border)', padding: '3px 6px', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600, marginRight: 4 }}>Setup</span>
                <button onClick={() => setEditorMode('architecture')} style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: 'transparent', color: '#E2E8F0', fontSize: 11, cursor: 'pointer' }}>Move</button>
                <button onClick={() => setShowCalibrate((c) => !c)} style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'transparent', color: '#3B82F6', fontSize: 10, cursor: 'pointer' }}>Calibrate</button>
                <button onClick={() => { setTwoPointCalibration(true); setCalibrationStep('plan-a'); setCalPlanA(null); setCalPlanB(null); setCalMapA(null); setCalMapB(null); setCalError(null) }} style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'transparent', color: '#8B5CF6', fontSize: 10, cursor: 'pointer' }}>2-Point Cal</button>
                <button onClick={handleLock} style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Lock Floor Editing</button>
              </div>
            ) : (
              <ToolDock groups={dockToolGroups} activeTool={dockActiveTool} onActivateTool={handleToolActivate} />
            )}
            {mode === 'mapping' && canvasTool === 'wall' && (
              <div style={{
                display: 'flex', background: 'var(--navi-card)', borderRadius: 6, overflow: 'hidden',
                border: '1px solid var(--navi-border)',
              }}>
                <button onClick={() => setSnapMode('architectural')}
                  style={{
                    padding: '5px 8px', border: 'none', cursor: 'pointer', fontSize: 10,
                    background: snapMode === 'architectural' ? '#3B82F6' : 'transparent',
                    color: snapMode === 'architectural' ? '#fff' : 'var(--navi-text-secondary)',
                    fontWeight: snapMode === 'architectural' ? 600 : 400,
                  }}>
                  Arch
                </button>
                <button onClick={() => setSnapMode('trace')}
                  style={{
                    padding: '5px 8px', border: 'none', cursor: 'pointer', fontSize: 10,
                    background: snapMode === 'trace' ? '#10B981' : 'transparent',
                    color: snapMode === 'trace' ? '#fff' : 'var(--navi-text-secondary)',
                    fontWeight: snapMode === 'trace' ? 600 : 400,
                  }}>
                  Trace
                </button>
                <button onClick={() => setSnapMode('free')}
                  style={{
                    padding: '5px 8px', border: 'none', cursor: 'pointer', fontSize: 10,
                    background: snapMode === 'free' ? '#F59E0B' : 'transparent',
                    color: snapMode === 'free' ? '#fff' : 'var(--navi-text-secondary)',
                    fontWeight: snapMode === 'free' ? 600 : 400,
                  }}>
                  Free
                </button>
              </div>
            )}
            <div style={{
              display: 'flex', background: 'var(--navi-card)', borderRadius: 6, overflow: 'hidden',
              border: '1px solid var(--navi-border)',
            }}>
              <button onClick={() => { setEditorMode('architecture'); activateTool('select'); clear() }}
                style={{
                  padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 10,
                  background: editorMode === 'architecture' ? 'var(--navi-text)' : 'transparent',
                  color: editorMode === 'architecture' ? 'var(--navi-card)' : 'var(--navi-text-secondary)',
                  fontWeight: editorMode === 'architecture' ? 600 : 400,
                }}>
                Architecture
              </button>
              <button onClick={() => { setEditorMode('navigation'); activateTool('select'); clear() }}
                style={{
                  padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 10,
                  background: editorMode === 'navigation' ? '#8B5CF6' : 'transparent',
                  color: editorMode === 'navigation' ? '#fff' : 'var(--navi-text-secondary)',
                  fontWeight: editorMode === 'navigation' ? 600 : 400,
                }}>
                Navigation
              </button>
            </div>
            {editorMode === 'architecture' && (
              <div style={{
                display: 'flex', background: 'var(--navi-card)', borderRadius: 6, overflow: 'hidden',
                border: '1px solid var(--navi-border)',
              }}>
                <button onClick={() => setViewMode('2d')}
                  data-testid="viewmode-2d"
                  style={{
                    padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 10,
                    background: viewMode === '2d' ? '#3B82F6' : 'transparent',
                    color: viewMode === '2d' ? '#fff' : 'var(--navi-text-secondary)',
                    fontWeight: viewMode === '2d' ? 600 : 400,
                  }}>
                  2D
                </button>
                <button onClick={() => setViewMode('2.5d')}
                  data-testid="viewmode-2.5d"
                  style={{
                    padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 10,
                    background: viewMode === '2.5d' ? '#F59E0B' : 'transparent',
                    color: viewMode === '2.5d' ? '#fff' : 'var(--navi-text-secondary)',
                    fontWeight: viewMode === '2.5d' ? 600 : 400,
                  }}>
                  2.5D
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{
          width: 220, background: 'var(--navi-card)', borderLeft: '1px solid var(--navi-border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--navi-border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navi-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Floor Setup
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: hasPlan ? '#10B981' : '#64748B' }}>
                <span>{hasPlan ? '\u2713' : '\u25CB'}</span> Upload
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: mode === 'mapping' && locked ? '#10B981' : mode === 'setup' ? '#E2E8F0' : '#64748B' }}>
                <span>{mode === 'mapping' && locked ? '\u2713' : '\u25CB'}</span> Align
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: mode === 'mapping' && locked ? '#10B981' : '#64748B' }}>
                <span>{mode === 'mapping' && locked ? '\u2713' : '\u25CB'}</span> Lock
              </div>
            </div>
            {hasPlan && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <label style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 6px', borderRadius: 4, background: 'var(--navi-content)', border: '1px solid var(--navi-border)', color: 'var(--navi-text)', fontSize: 10, cursor: isUploading ? 'not-allowed' : 'pointer' }}>
                  <RefreshCw size={10} /> Replace
                  <input type="file" accept={SUPPORTED_PLAN_ACCEPT} onChange={handleUpload} disabled={isUploading} style={{ display: 'none' }} />
                </label>
                <button onClick={handleRemoveFloorPlan} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 6px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#EF4444', fontSize: 10, cursor: 'pointer' }}>
                  <Trash2 size={10} /> Remove
                </button>
              </div>
            )}
            {mode === 'mapping' && (
              <>
                <div style={{ borderTop: '1px solid #334155', margin: '8px 0' }} />
                <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Tracing</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: '#64748B' }}>
                  <div>Rooms</div>
                  <div>Hallways</div>
                  <div>Connections</div>
                </div>
              </>
            )}
            {mode === 'setup' && hasPlan && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#94A3B8', lineHeight: 1.4 }}>
                Drag the floor plan until walls match the map, then lock.
              </div>
            )}
            {!setupCardHidden && mode === 'mapping' && (
              <button onClick={() => setSetupCardHidden(true)} style={{ marginTop: 6, background: 'none', border: 'none', color: '#64748B', fontSize: 10, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                Hide
              </button>
            )}
            {setupCardHidden && mode === 'mapping' && (
              <button onClick={handleUnlock} style={{ marginTop: 6, background: 'none', border: 'none', color: '#94A3B8', fontSize: 10, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                Floor Plan Setup
              </button>
            )}
          </div>
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Layers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {ARCHITECTURE_LAYERS.map(({ key, label }) => {
                const active = layers[key]
                return (
                  <button key={key} onClick={() => toggleLayer(key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4,
                      border: 'none', cursor: 'pointer', background: 'transparent',
                      color: active ? 'var(--navi-text)' : 'var(--navi-text-secondary)',
                      fontSize: 10, textAlign: 'left', opacity: active ? 1 : 0.5,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {active ? <Eye size={11} /> : <EyeOff size={11} />}
                    {label}
                  </button>
                )
              })}
            </div>

            <div style={{ borderTop: '1px solid var(--navi-border)', margin: '8px 0' }} />
            <button onClick={() => setNavPreviewOpen((p) => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4,
                border: 'none', cursor: 'pointer', background: 'transparent', width: '100%',
                color: 'var(--navi-text-secondary)', fontSize: 10, textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ transform: navPreviewOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Navigation Preview
            </button>
            {navPreviewOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
                <button onClick={toggleGraph}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4,
                    border: 'none', cursor: 'pointer', background: 'transparent',
                    color: graphVisible ? 'var(--navi-text)' : 'var(--navi-text-secondary)',
                    fontSize: 10, textAlign: 'left', opacity: graphVisible ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {graphVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                  Graph
                </button>
                <button onClick={() => setValidationVisible((v) => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4,
                    border: 'none', cursor: 'pointer', background: 'transparent',
                    color: validationVisible ? 'var(--navi-text)' : 'var(--navi-text-secondary)',
                    fontSize: 10, textAlign: 'left', opacity: validationVisible ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {validationVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                  Validation
                </button>
              </div>
            )}
          </div>

          {mode === 'setup' && hasPlan && (
            <FloorPlanTransformInspector
              frame={calibrationFrame}
              alignment={editorAlignment}
              aspectRatioLocked={aspectRatioLocked}
              onAspectRatioLockedChange={setAspectRatioLocked}
              onCommit={commitAlignment}
            />
          )}
          {validationVisible && validationChecks.length > 0 && (
            <div style={{ borderTop: '1px solid var(--navi-border)', maxHeight: 240, overflowY: 'auto' }}>
              <DiagnosticsPanel
                diagnostics={validationChecks.map((c, i) => ({
                  id: c.id,
                  code: c.code as any,
                  category: c.layer === 'navigation' || c.layer === 'access' ? 'navigation' : 'document',
                  severity: c.severity,
                  title: c.layer ? `${c.layer[0].toUpperCase()}${c.layer.slice(1)} · ${c.title}` : c.title,
                  message: c.message,
                  provider: 'validation',
                  rule: c.ruleId,
                  target: c.entityId ? {
                    entityType: (c.entityType ?? 'component') as any,
                    entityId: c.entityId,
                    buildingId: c.buildingId,
                    floorId: c.floorId,
                    layer: c.layer,
                  } : undefined,
                }))}
              />
            </div>
          )}
          {selectedId && (
            <ComponentProperties key={selectedId} componentId={selectedId} onClose={() => clear()} validationChecks={validationChecks} onOpenOutdoorRoutePicker={handleOpenOutdoorRoutePicker} onStartRouteConnect={handleStartRouteConnect} onSelectComponent={(id) => select(id)} />
          )}
        </div>
      </div>
      {showUnlockWarning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 10, padding: '24px 28px', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', marginBottom: 8 }}>Unlock floor plan?</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>Unlocking may misalign traced geometry.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setShowUnlockWarning(false)} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#E2E8F0', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmUnlock} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 11, cursor: 'pointer' }}>Unlock</button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
    </InteractionProvider>
  )
}
