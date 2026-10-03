'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { CampusDocument } from '@navi/core'
import { PropertiesPanel, ProblemsPanel, useEditor, useSelection } from '@navi/editor'
import type { EntityId, EntitySelector, ValidationIssue } from '@navi/editor'
import { ExplorerPanel } from './ExplorerPanel'
import { StudioCanvas } from './StudioCanvas'
import { SaveStatus } from './SaveStatus'
import { BuildStatus } from './BuildStatus'
import { ToolDock } from './ToolDock'
import { ConfirmOverlay } from './ConfirmOverlay'
import { LegacyRecoveryPanel } from './LegacyRecoveryPanel'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'
import type { LatLng } from '@/types/nav-types'
import { resolveValidationFocus } from './validation-focus'
import { SyncIssueCard, deriveSyncIssue } from './SyncIssueCard'
import type { ValidationFocus } from '@/types/studio-types'

interface ValidationViewport {
  flyTo: (center: LatLng, options?: { zoom?: number; duration?: number }) => void
  fitBounds: (
    bounds: { sw: LatLng; ne: LatLng },
    options?: { padding?: number; duration?: number },
  ) => void
}

interface AuthoredScope {
  buildingId: string
  floorId: string
}

interface SelectionPreservation {
  finalId?: string
  allowedIds: Set<string>
}

function findAuthoredScope(document: CampusDocument, targetId: string): AuthoredScope | null {
  for (const building of document.buildings ?? []) {
    for (const floor of building.floors ?? []) {
      const matches = (floor.rooms ?? []).some((entity) => entity.id === targetId)
        || (floor.roomAttributes ?? []).some((entity) => entity.roomId === targetId || entity.faceId === targetId)
        || (floor.hallways ?? []).some((entity) => entity.id === targetId)
        || (floor.staircases ?? []).some((entity) => entity.id === targetId)
        || (floor.elevators ?? []).some((entity) => entity.id === targetId)
        || (floor.entrances ?? []).some((entity) => entity.id === targetId)
        || (floor.connectorStops ?? []).some((entity) => entity.id === targetId)
        || (floor.walls ?? []).some((entity) => entity.id === targetId)

      if (floor.id === targetId || matches) {
        return { buildingId: building.id, floorId: floor.id }
      }
    }
  }
  return null
}

function authoredSelectorForIssue(
  issue: ValidationIssue,
  focus: ValidationFocus,
  document: CampusDocument,
): EntitySelector | null {
  const target = issue.targets.find((candidate) => (
    candidate.entityId === focus.targetId && candidate.entityType === focus.targetType
  ))
  if (!target) return null

  let targetId = target.entityId
  if (target.entityType === 'room') {
    for (const building of document.buildings ?? []) {
      for (const floor of building.floors ?? []) {
        const attributes = (floor.roomAttributes ?? []).find((room) => room.faceId === target.entityId)
        if (attributes) targetId = attributes.roomId
      }
    }
  }

  const id = targetId as EntityId
  const scope = findAuthoredScope(document, target.entityId)
  const buildingId = (issue.buildingId ?? focus.buildingId ?? scope?.buildingId) as EntityId | undefined
  const floorId = (issue.floorId ?? scope?.floorId) as EntityId | undefined

  switch (target.entityType) {
    case 'building':
      return { type: 'building', id }
    case 'road':
      return { type: 'road', id }
    case 'panorama':
      return { type: 'panorama', id }
    case 'qr':
    case 'checkpoint':
      return { type: 'qr', id }
    case 'area':
      return { type: 'area', id }
    case 'floor':
      return buildingId && floorId ? { type: 'floor', id, buildingId } : null
    case 'room':
    case 'hallway':
    case 'staircase':
    case 'elevator':
    case 'entrance':
      return buildingId && floorId
        ? { type: target.entityType, id, buildingId, floorId } as EntitySelector
        : null
    default:
      return null
  }
}

function boundsForFocus(focus: ValidationFocus): { sw: LatLng; ne: LatLng } | null {
  const points = focus.geometry.kind === 'point'
    ? [focus.geometry.position]
    : focus.geometry.points
  if (points.length === 0 || points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) {
    return null
  }

  let minLat = points[0].lat
  let maxLat = points[0].lat
  let minLng = points[0].lng
  let maxLng = points[0].lng
  for (const point of points.slice(1)) {
    minLat = Math.min(minLat, point.lat)
    maxLat = Math.max(maxLat, point.lat)
    minLng = Math.min(minLng, point.lng)
    maxLng = Math.max(maxLng, point.lng)
  }
  return {
    sw: { lat: minLat, lng: minLng },
    ne: { lat: maxLat, lng: maxLng },
  }
}

interface StudioWorkspaceProps {
  mapId: string
  center?: { lat: number; lng: number }
}

export function StudioWorkspace({ center }: StudioWorkspaceProps) {
  const { services, document, transformer } = useEditor()
  const publishStore = services.get('publishStore')
  const publishService = services.get('publish')
  const validationEngine = services.get('validationEngine')

  const selection = useSelection()
  const hasSelection = selection.lastSelected?.id != null

  const [showProblemsPanel, setShowProblemsPanel] = useState(false)
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false)
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [showBypassDialog, setShowBypassDialog] = useState(false)
  const [publishSnap, setPublishSnap] = useState(() => publishStore?.getSnapshot())
  const [validationSnapshot, setValidationSnapshot] = useState(() => validationEngine?.getLastSnapshot())
  // Sync/conflict issue for the existing View Issues surface (counts alongside validation issues).
  const syncStatus = useGraphStore((state) => state.syncStatus)
  const syncError = useGraphStore((state) => state.syncError)
  const syncIssue = deriveSyncIssue(syncStatus, syncError)

  const prevStateRef = useRef<string | undefined>(undefined)
  const previousSelectionIdRef = useRef<string | null>(selection.lastSelected?.id ?? null)
  const preserveProblemsForSelectionRef = useRef<SelectionPreservation | null>(null)
  const selectedEntityId = selection.lastSelected?.id ?? null

  useEffect(() => {
    if (selectedEntityId === previousSelectionIdRef.current) return

    const preservation = preserveProblemsForSelectionRef.current
    const preserveReport = preservation != null
      && (selectedEntityId == null
        || selectedEntityId === preservation.finalId
        || preservation.allowedIds.has(selectedEntityId))
    if (preserveReport && selectedEntityId != null) {
      if (selectedEntityId === preservation.finalId || preservation.finalId == null) {
        preserveProblemsForSelectionRef.current = null
      } else {
        preservation.allowedIds.delete(selectedEntityId)
      }
    } else {
      preserveProblemsForSelectionRef.current = null
    }
    previousSelectionIdRef.current = selectedEntityId
    if (!preserveReport) setShowProblemsPanel(false)
  }, [selectedEntityId])

  useEffect(() => {
    if (!publishStore) return
    const unsub = publishStore.subscribe(() => {
      const snap = publishStore.getSnapshot()
      setPublishSnap(snap)
    })
    return unsub
  }, [publishStore])

  useEffect(() => {
    if (!publishSnap) return
    if (publishSnap.publishState === 'success' && prevStateRef.current !== 'success') {
      setShowSuccessDialog(true)
    }
    if (publishSnap.publishState === 'error' && publishSnap.publishError === 'Validation failed') {
      setShowBypassDialog(true)
      setShowProblemsPanel(true)
    } else {
      setShowBypassDialog(false)
    }
    prevStateRef.current = publishSnap.publishState
  }, [publishSnap])

  // Keep the report in sync with the engine and open it whenever a validation
  // run produces anything the author needs to inspect, including warnings.
  useEffect(() => {
    if (!validationEngine) return

    const update = (snapshot = validationEngine.getLastSnapshot()) => {
      setValidationSnapshot(snapshot)
      if (snapshot && snapshot.statistics.totalIssues > 0) {
        setShowProblemsPanel(true)
      }
    }
    update()
    const unsub = validationEngine.onValidationUpdated(update)
    return unsub
  }, [validationEngine])

  const resolveFocus = useCallback((issue: ValidationIssue) => {
    if (!transformer) return null
    return resolveValidationFocus(issue, document, useGraphStore.getState().graph, transformer)
  }, [document, transformer])

  const canIssueFocus = useCallback((issue: ValidationIssue) => Boolean(resolveFocus(issue)), [resolveFocus])

  const handleIssueFocus = useCallback((issue: ValidationIssue) => {
    const focus = resolveFocus(issue)
    if (!focus) return

    const selector = focus.targetType === 'route-node' || focus.targetType === 'route-edge'
      ? null
      : authoredSelectorForIssue(issue, focus, document)
    const allowedIds = new Set<string>()
    if (focus.buildingId && focus.buildingId !== selector?.id) allowedIds.add(focus.buildingId)
    if (selector?.id || allowedIds.size > 0) {
      preserveProblemsForSelectionRef.current = { finalId: selector?.id, allowedIds }
    }

    const studio = useStudioStore.getState()
    if (focus.buildingId) studio.setActiveBuilding(focus.buildingId)
    if (typeof focus.floor === 'number') studio.setActiveFloor(focus.floor)

    if (focus.targetType === 'route-node') {
      studio.setSelectedNodeId(focus.targetId)
    } else if (focus.targetType === 'route-edge') {
      studio.setSelectedTraceId(focus.targetId)
    } else {
      if (selector) {
        selection.select(selector)
      }
    }

    studio.setValidationFocus(focus)

    const viewport = services.get('viewport') as unknown as ValidationViewport | undefined
    if (!viewport) return
    if (focus.geometry.kind === 'point') {
      viewport.flyTo(focus.geometry.position, { zoom: 19, duration: 350 })
      return
    }

    const bounds = boundsForFocus(focus)
    if (bounds) viewport.fitBounds(bounds, { padding: 80, duration: 350 })
  }, [document, resolveFocus, selection, services])

  return (
    <div data-editor-ready="true" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: 32,
        background: 'var(--navi-card)', borderBottom: '1px solid var(--navi-border)',
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--navi-primary)', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }}>
          NAVI STUDIO
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <SaveStatus />
          <button
            onClick={() => setShowRecoveryPanel((visible) => !visible)}
            style={{
              padding: '3px 10px', borderRadius: 4, border: '1px solid var(--navi-border)',
              background: showRecoveryPanel ? 'var(--navi-primary)' : 'transparent',
              color: showRecoveryPanel ? 'white' : 'var(--navi-text-secondary)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Road Recovery
          </button>
          <BuildStatus
            onOpenProblems={() => setShowProblemsPanel((visible) => !visible)}
            problemCount={(validationSnapshot?.statistics.totalIssues ?? 0) + (syncIssue.active ? 1 : 0)}
          />
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 220, borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
          <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e5e7eb' }}>
            Explorer
          </div>
          <ExplorerPanel />
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <StudioCanvas center={center} onEmptyMapClick={() => setShowProblemsPanel(false)} />
          <ConfirmOverlay />
          <LegacyRecoveryPanel open={showRecoveryPanel} onClose={() => setShowRecoveryPanel(false)} />
        </div>
        {(hasSelection || showProblemsPanel) && (
          <div style={{ width: 280, background: 'var(--navi-card)', borderLeft: '1px solid var(--navi-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            {hasSelection && (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <PropertiesPanel />
              </div>
            )}
            {showProblemsPanel && (
              <div style={{ height: hasSelection ? '40%' : '100%', borderTop: hasSelection ? '1px solid var(--navi-border)' : undefined, overflow: 'auto', background: '#1e1e1e' }}>
                <SyncIssueCard />
                <ProblemsPanel onIssueFocus={handleIssueFocus} canIssueFocus={canIssueFocus} />
              </div>
            )}
          </div>
        )}
      </div>

      {showBypassDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: 'var(--navi-card)', border: '1px solid var(--navi-border)', padding: 24, borderRadius: 8, width: 360, color: 'var(--navi-text)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Validation Errors</h2>
            <p style={{ fontSize: 13, color: 'var(--navi-text-secondary)', marginBottom: 20 }}>
              The campus document has validation errors. Do you want to publish anyway?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowBypassDialog(false)
                  publishStore?.updatePublishState({ publishState: 'idle', publishError: null })
                }}
                style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--navi-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--navi-text-secondary)', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowBypassDialog(false)
                  await publishService?.publish(true)
                }}
                style={{ padding: '8px 16px', background: 'var(--navi-primary)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Publish Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessDialog && publishSnap?.publishResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: 'var(--navi-card)', border: '1px solid var(--navi-border)', padding: 24, borderRadius: 8, width: 360, color: 'var(--navi-text)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Publish Successful</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--navi-text-secondary)' }}>
              <div>Revision: {publishSnap.publishResult.revision}</div>
              <div>Nodes: {publishSnap.publishResult.nodeCount}</div>
              <div>Edges: {publishSnap.publishResult.edgeCount}</div>
              <div>Compile time: {((publishSnap.publishResult.finishedAt - publishSnap.publishResult.startedAt) / 1000).toFixed(2)}s</div>
              <div>Artifacts: {publishSnap.publishResult.artifactCount}</div>
              <div>Location: demo-output/</div>
            </div>
            <button
              onClick={() => {
                setShowSuccessDialog(false)
                publishStore?.updatePublishState({ publishState: 'idle', publishResult: null })
              }}
              style={{ marginTop: 24, width: '100%', padding: '8px 16px', background: 'var(--navi-primary)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      <ToolDock />
    </div>
  )
}
