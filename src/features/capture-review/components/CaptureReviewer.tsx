'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Eye, EyeOff, FileJson, MapPinned, RotateCcw } from 'lucide-react'
import { useCampusMapStore } from '@/store/campus-map-store'
import { cloneCaptureSession, listCaptureSessions } from '@/features/capture/db'
import { parseCaptureFile } from '@/features/capture/format'
import { DEFAULT_CAPTURE_ROUTE_DETAIL, deriveCandidateRoute, type CaptureRouteDetail } from '@/features/capture/geometry'
import type { CandidateRoute, CaptureCoordinate, CaptureSession } from '@/features/capture/types'
import type { RemoteCaptureSession } from '@/features/capture-sync/types'
import type { CampusMap } from '@/types/campus-map'
import { CaptureReviewMap } from './CaptureReviewMap'
import { getCaptureReviewMetrics } from '../metrics'
import type { CaptureReviewerImportHost } from '@/features/capture-import/adapter'
import { RemoteCaptureOpenError, validateRemoteCaptureSessionForCampus } from '../remote-session'
import {
  addReviewedCandidatePoint,
  applyEndpointSnap,
  cloneCandidateRoute,
  findEndpointSnapTargets,
  moveReviewedCandidatePoint,
  removeReviewedCandidatePoint,
  resetReviewedCandidateRoute,
  type EndpointSnapTarget,
} from '../route-editing'
import {
  getDefaultCaptureReviewSelection,
  useCaptureReviewStore,
  type CaptureReviewStore,
} from '../review-store'
import type { CaptureReviewItem, ReviewLayerKey } from '../types'

const LAYER_LABELS: Array<{ key: ReviewLayerKey; label: string; color: string }> = [
  { key: 'rawGps', label: 'Raw GPS', color: '#38bdf8' },
  { key: 'candidateRoute', label: 'Candidate Route', color: '#22c55e' },
  { key: 'candidateNodes', label: 'Candidate Nodes', color: '#16a34a' },
  { key: 'markers', label: 'Markers', color: '#a855f7' },
  { key: 'gpsWarnings', label: 'GPS Warnings', color: '#f59e0b' },
]

const ROUTE_DETAIL_ORDER: CaptureRouteDetail[] = ['simpler', 'balanced', 'detailed']
const ROUTE_DETAIL_LABELS: Record<CaptureRouteDetail, string> = {
  simpler: 'Simpler',
  balanced: 'Balanced',
  detailed: 'Detailed',
}

type ReviewerEditMode = 'move' | 'add' | 'remove' | null

interface ReviewedRouteState {
  key: string
  candidate: CandidateRoute | null
}

function snapTargetKey(target: EndpointSnapTarget): string {
  return `${target.endpoint}:${target.roadId}:${target.segmentIndex}:${target.coordinate.latitude}:${target.coordinate.longitude}`
}

function reviewItem(session: CaptureSession, source: CaptureReviewItem['source'], campusLabel: string): CaptureReviewItem {
  return {
    id: `${source}:${session.id}`,
    sessionId: session.id,
    session,
    source,
    campusLabel,
  }
}

function campusLabel(campus: CampusMap | undefined) {
  if (!campus) return 'Unassigned campus'
  return campus.campusName ? `${campus.name} · ${campus.campusName}` : campus.name
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds === 0 ? `${minutes} min` : `${minutes}m ${remainingSeconds}s`
}

function formatDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleString()
}

function statusLabel(status: CaptureSession['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export interface CaptureReviewerProps {
  listSessions?: () => Promise<CaptureSession[]>
  remoteSessionId?: string | null
  remoteCampusId?: string
  getRemoteSession?: (sessionId: string) => Promise<RemoteCaptureSession | null>
  backLabel?: string
  reviewStore?: CaptureReviewStore
  campusMaps?: CampusMap[]
  importHost?: CaptureReviewerImportHost
  onBack?: () => void
}

export function CaptureReviewer({
  listSessions = listCaptureSessions,
  remoteSessionId,
  remoteCampusId,
  getRemoteSession,
  backLabel,
  reviewStore,
  campusMaps,
  importHost,
  onBack,
}: CaptureReviewerProps) {
  const router = useRouter()
  const reviewHook = reviewStore ?? useCaptureReviewStore
  const reviewHydrated = reviewHook((state) => state.hydrated)
  const selectedItemId = reviewHook((state) => state.selectedItemId)
  const layers = reviewHook((state) => state.layers)
  const selectionsBySessionId = reviewHook((state) => state.selectionsBySessionId)
  const mapsFromStore = useCampusMapStore((state) => state.maps)
  const maps = campusMaps ?? mapsFromStore
  const requestedRemoteSessionId = remoteSessionId?.trim() || null
  const remoteMode = Boolean(requestedRemoteSessionId)
  const requestKey = requestedRemoteSessionId
    ? `remote:${requestedRemoteSessionId}:${remoteCampusId ?? ''}`
    : 'local'

  const [items, setItems] = useState<CaptureReviewItem[]>([])
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null)
  const [selectedCampusId, setSelectedCampusId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ requestKey: string; message: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importPlanRevision, setImportPlanRevision] = useState(0)
  const [routeDetailBySessionId, setRouteDetailBySessionId] = useState<Record<string, CaptureRouteDetail>>({})
  const [reviewedRoute, setReviewedRoute] = useState<ReviewedRouteState>({ key: '', candidate: null })
  const [editMode, setEditMode] = useState<ReviewerEditMode>(null)
  const [ignoredSnapKeys, setIgnoredSnapKeys] = useState<Set<string>>(() => new Set())
  const [editMessage, setEditMessage] = useState<string | null>(null)

  const loadReviewItems = useCallback(async () => {
    setIsLoading(true)
    setLoadError((current) => current?.requestKey === requestKey ? null : current)
    if (requestedRemoteSessionId) {
      if (!getRemoteSession || !remoteCampusId) {
        throw new RemoteCaptureOpenError('INVALID')
      }
      const remote = await getRemoteSession(requestedRemoteSessionId)
      if (!remote) throw new RemoteCaptureOpenError('NOT_FOUND')
      const session = validateRemoteCaptureSessionForCampus(remote, remoteCampusId)
      const remoteCampus = maps.find((campus) => campus.id === remoteCampusId)
      return [reviewItem(session, 'remote-session', campusLabel(remoteCampus))]
    }
    const sessions = await listSessions()
    return sessions.map((session) => reviewItem(session, 'local-session', 'Unassigned campus'))
  }, [getRemoteSession, listSessions, maps, remoteCampusId, requestKey, requestedRemoteSessionId])

  useEffect(() => {
    void reviewHook.getState().hydrate()
    let cancelled = false
    void loadReviewItems()
      .then((nextItems) => {
        if (!cancelled) {
          setItems(nextItems)
          setLoadedRequestKey(requestKey)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setItems([])
          setLoadedRequestKey(requestKey)
          setLoadError({
            requestKey,
            message: loadError instanceof Error ? loadError.message : 'Unable to load Capture sessions',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadReviewItems, requestKey, reviewHook])

  const visibleItems = loadedRequestKey === requestKey ? items : []
  const visibleLoadError = loadError?.requestKey === requestKey ? loadError.message : null
  const requestLoading = isLoading || loadedRequestKey !== requestKey

  useEffect(() => {
    if (!reviewHydrated || visibleItems.length === 0) return
    if (!visibleItems.some((item) => item.id === selectedItemId)) {
      reviewHook.getState().setSelectedItem(visibleItems[0].id)
    }
  }, [reviewHydrated, reviewHook, selectedItemId, visibleItems])

  const selectedItem = visibleItems.find((item) => item.id === selectedItemId) ?? visibleItems[0] ?? null
  const effectiveSelectedCampusId = selectedCampusId ?? maps[0]?.id ?? ''
  const selectedCampus = maps.find((campus) => campus.id === effectiveSelectedCampusId) ?? null
  const routeDetail = selectedItem
    ? routeDetailBySessionId[selectedItem.sessionId] ?? DEFAULT_CAPTURE_ROUTE_DETAIL
    : DEFAULT_CAPTURE_ROUTE_DETAIL
  const reviewKey = selectedItem ? `${selectedItem.id}:${routeDetail}` : ''
  const generatedCandidate = useMemo(() => {
    if (!selectedItem) return null
    if (selectedItem.session.rawSamples.length > 0) {
      const derived = deriveCandidateRoute(selectedItem.session.rawSamples, {
        detail: routeDetail,
        derivedAt: selectedItem.session.candidateRoute?.derivedAt ?? selectedItem.session.updatedAt,
      })
      if (derived) return derived
    }
    return selectedItem.session.candidateRoute
      ? cloneCandidateRoute(selectedItem.session.candidateRoute)
      : null
  }, [routeDetail, selectedItem])
  const activeCandidate = reviewedRoute.key === reviewKey ? reviewedRoute.candidate : generatedCandidate
  const reviewSession = useMemo(() => {
    if (!selectedItem) return null
    const cloned = cloneCaptureSession(selectedItem.session)
    cloned.candidateRoute = activeCandidate ? cloneCandidateRoute(activeCandidate) : null
    return cloned
  }, [activeCandidate, selectedItem])
  const selection = selectedItem
    ? selectionsBySessionId[selectedItem.sessionId] ?? getDefaultCaptureReviewSelection()
    : getDefaultCaptureReviewSelection()
  const importContext = useMemo(() => {
    if (!importHost || !selectedItem || !reviewSession) return null
    try {
      return importHost.getContext(effectiveSelectedCampusId, reviewSession)
    } catch {
      return null
    }
  }, [effectiveSelectedCampusId, importHost, reviewSession, selectedItem])
  const snapTargets = useMemo(() => {
    if (!importHost || !importContext || !reviewSession?.candidateRoute) return []
    return findEndpointSnapTargets(reviewSession.candidateRoute, importHost.existingRoads)
  }, [importContext, importHost, reviewSession])
  const visibleSnapTargets = snapTargets.filter((target) => (
    target.distanceMeters > 0.1 && !ignoredSnapKeys.has(snapTargetKey(target))
  ))

  const handleMovePoint = useCallback((index: number, coordinate: CaptureCoordinate) => {
    const reviewed = activeCandidate ? moveReviewedCandidatePoint(activeCandidate, index, coordinate) : null
    if (!reviewed) {
      setEditMessage('Choose a valid candidate point to move.')
      return
    }
    setReviewedRoute({ key: reviewKey, candidate: reviewed })
    setEditMessage('Candidate point moved. Raw GPS remains unchanged.')
  }, [activeCandidate, reviewKey])

  const handleAddPoint = useCallback((coordinate: CaptureCoordinate) => {
    const reviewed = activeCandidate && selectedItem
      ? addReviewedCandidatePoint(activeCandidate, selectedItem.session.rawSamples, coordinate)
      : null
    if (!reviewed) {
      setEditMessage('Add point unavailable: choose a location on the preserved raw GPS trace between candidate points.')
      return
    }
    setReviewedRoute({ key: reviewKey, candidate: reviewed })
    setEditMessage('Raw-trace point added. Raw GPS remains unchanged.')
  }, [activeCandidate, reviewKey, selectedItem])

  const handleRemovePoint = useCallback((index: number) => {
    const reviewed = activeCandidate ? removeReviewedCandidatePoint(activeCandidate, index) : null
    if (!reviewed) {
      setEditMessage('A candidate route must keep at least two points.')
      return
    }
    setReviewedRoute({ key: reviewKey, candidate: reviewed })
    setEditMessage('Candidate point removed. Raw GPS remains unchanged.')
  }, [activeCandidate, reviewKey])

  const handleResetRoute = useCallback(() => {
    setReviewedRoute({ key: reviewKey, candidate: resetReviewedCandidateRoute(generatedCandidate) })
    setEditMode(null)
    setEditMessage('Candidate route reset to the selected Route Detail profile.')
  }, [generatedCandidate, reviewKey])

  const handleApplyEndpointSnap = useCallback((target: EndpointSnapTarget) => {
    const reviewed = activeCandidate ? applyEndpointSnap(activeCandidate, target) : null
    if (!reviewed) {
      setEditMessage('The endpoint snap could not be applied.')
      return
    }
    setReviewedRoute({ key: reviewKey, candidate: reviewed })
    setIgnoredSnapKeys((current) => new Set(current).add(snapTargetKey(target)))
    setEditMode(null)
    setEditMessage(`${target.endpoint === 'start' ? 'Start' : 'End'} snapped to ${target.roadName}.`)
  }, [activeCandidate, reviewKey])

  const handleIgnoreEndpointSnap = useCallback((target: EndpointSnapTarget) => {
    setIgnoredSnapKeys((current) => new Set(current).add(snapTargetKey(target)))
    setEditMessage(`${target.endpoint === 'start' ? 'Start' : 'End'} snap ignored; candidate geometry was not changed.`)
  }, [])

  const importPlan = useMemo(() => {
    if (!importHost || !selectedItem || !reviewSession || !importContext) return null
    return importHost.adapter.planOutdoorRoute(reviewSession, selection, importContext)
    // The revision is intentionally a dependency even though it is only used to invalidate this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importContext, importHost, importPlanRevision, reviewSession, selectedItem, selection])
  const metrics = useMemo(
    () => reviewSession ? getCaptureReviewMetrics(reviewSession) : null,
    [reviewSession],
  )

  const handleRouteDetailChange = (nextDetail: CaptureRouteDetail) => {
    if (!selectedItem) return
    setRouteDetailBySessionId((current) => ({ ...current, [selectedItem.sessionId]: nextDetail }))
    setReviewedRoute({ key: '', candidate: null })
    setIgnoredSnapKeys(new Set())
    setEditMode(null)
    setEditMessage(null)
  }

  const handleSelectItem = (itemId: string) => {
    reviewHook.getState().setSelectedItem(itemId)
    setReviewedRoute({ key: '', candidate: null })
    setIgnoredSnapKeys(new Set())
    setEditMode(null)
    setEditMessage(null)
    setIsImportPreviewOpen(false)
    setImportMessage(null)
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileError(null)
    try {
      const session = parseCaptureFile(await file.text())
      const item = reviewItem(session, 'local-file', campusLabel(selectedCampus ?? undefined))
      setItems((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)])
      handleSelectItem(item.id)
    } catch (fileLoadError) {
      setFileError(fileLoadError instanceof Error ? fileLoadError.message : 'Invalid NAVI Capture file')
    }
  }

  const displayBackLabel = backLabel ?? 'Back to Studio'
  const handleBack = onBack ?? (() => router.push(remoteMode && remoteCampusId
    ? `/studio/${remoteCampusId}/edit/capture-library`
    : '/studio'))

  const handleOpenImportPreview = () => {
    setImportMessage(null)
    setIsImportPreviewOpen(true)
  }

  const handleImportSelected = () => {
    if (!importHost || !selectedItem || !reviewSession || !importContext) return
    const result = importHost.adapter.importOutdoorRoute(reviewSession, selection, importContext)
    if (result.status === 'imported') {
      setIsImportPreviewOpen(false)
      setImportPlanRevision((revision) => revision + 1)
      setImportMessage(`Imported ${result.canonicalRoadIds.length} outdoor pathway Road${result.canonicalRoadIds.length === 1 ? '' : 's'}.`)
      return
    }
    setImportMessage(result.error ?? (result.plan.errors.join(' ') || result.plan.warnings.join(' ') || 'Outdoor pathway import was not applied'))
  }

  const handleRefresh = () => {
    void loadReviewItems()
      .then((nextItems) => {
        setItems(nextItems)
        setLoadedRequestKey(requestKey)
      })
      .catch((loadError: unknown) => {
        setItems([])
        setLoadedRequestKey(requestKey)
        setLoadError({
          requestKey,
          message: loadError instanceof Error ? loadError.message : 'Unable to load Capture sessions',
        })
      })
      .finally(() => setIsLoading(false))
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', color: 'var(--navi-text)', background: 'var(--navi-content)' }}>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--navi-border)', background: 'var(--navi-card)' }}>
        <button
          type="button"
          onClick={handleBack}
          aria-label={displayBackLabel}
          style={{ minHeight: 44, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--navi-border)', borderRadius: 8, background: 'transparent', color: 'var(--navi-text-secondary)', cursor: 'pointer', fontSize: 12 }}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {displayBackLabel}
        </button>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 750 }}>Capture Reviewer</h1>
          <p style={{ margin: '3px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>{importHost ? 'Review and import selected outdoor pathways into the current Studio draft.' : 'Inspect Capture data without changing the Studio draft.'}</p>
        </div>
        {!remoteMode && <label style={{ minHeight: 44, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--navi-border)', borderRadius: 8, background: 'var(--navi-card)', color: 'var(--navi-text)', cursor: 'pointer', fontSize: 12 }}>
            <FileJson size={16} aria-hidden="true" />
            Open .navicapture.json
            <input aria-label="Open .navicapture.json" type="file" accept=".navicapture.json,application/json,.json" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>}
        {importHost ? (
          <button type="button" aria-label="Review import" disabled={!selectedItem} onClick={handleOpenImportPreview} title="Review the selected outdoor pathway before importing" style={{ minHeight: 44, padding: '8px 12px', border: '1px solid var(--navi-primary)', borderRadius: 8, background: 'var(--navi-primary)', color: '#fff', cursor: selectedItem ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 650, opacity: selectedItem ? 1 : 0.65 }}>
            Review import
          </button>
        ) : (
          <button type="button" aria-label="Import available after review" disabled title="Import available after review" style={{ minHeight: 44, padding: '8px 12px', border: '1px solid var(--navi-border)', borderRadius: 8, background: 'var(--navi-content)', color: 'var(--navi-text-secondary)', cursor: 'not-allowed', fontSize: 12, opacity: 0.65 }}>
            Import available after review
          </button>
        )}
      </header>

      {visibleLoadError && <div role="alert" style={{ margin: 16, padding: 12, border: '1px solid #f59e0b', borderRadius: 8, background: '#451a03', color: '#fde68a', fontSize: 12 }}>{visibleLoadError}</div>}
      {fileError && <div role="alert" style={{ margin: 16, padding: 12, border: '1px solid #ef4444', borderRadius: 8, background: '#450a0a', color: '#fecaca', fontSize: 12 }}>{fileError}</div>}
      {importMessage && <div role="status" style={{ margin: 16, padding: 12, border: '1px solid #22c55e', borderRadius: 8, background: '#052e16', color: '#bbf7d0', fontSize: 12 }}>{importMessage}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 16, alignItems: 'stretch' }}>
        <aside aria-label="Capture sessions" style={{ flex: '1 1 260px', minWidth: 'min(260px, 100%)', maxWidth: 340, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--navi-border)' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Capture sessions</div>
              <div style={{ marginTop: 3, color: 'var(--navi-text-secondary)', fontSize: 11 }}>{visibleItems.length} available {remoteMode ? 'remotely' : 'locally'}</div>
            </div>
            <button type="button" aria-label="Refresh Capture sessions" onClick={handleRefresh} style={{ minWidth: 44, minHeight: 44, display: 'inline-grid', placeItems: 'center', border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--navi-text-secondary)', cursor: 'pointer' }}>
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {requestLoading && <div style={{ padding: 16, color: 'var(--navi-text-secondary)', fontSize: 12 }}>{remoteMode ? 'Loading remote Capture session…' : 'Loading sessions…'}</div>}
            {!requestLoading && visibleItems.length === 0 && <div style={{ padding: 16, color: 'var(--navi-text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{remoteMode ? 'No remote Capture session is available for review.' : 'No local captures yet. Open a `.navicapture.json` file to begin review.'}</div>}
            {visibleItems.map((item) => {
              const itemMetrics = getCaptureReviewMetrics(item.session)
              const selected = item.id === selectedItem?.id
              return (
                <button key={item.id} type="button" aria-label={`Review ${item.session.title}`} onClick={() => handleSelectItem(item.id)} style={{ width: '100%', padding: '11px 10px', textAlign: 'left', border: `1px solid ${selected ? 'var(--navi-primary)' : 'var(--navi-border)'}`, borderRadius: 8, background: selected ? 'rgba(37,99,235,0.12)' : 'transparent', color: 'var(--navi-text)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{item.session.title}</strong>
                    <span style={{ flexShrink: 0, color: 'var(--navi-text-secondary)', fontSize: 10 }}>{statusLabel(item.session.status)}</span>
                  </div>
                  <div style={{ marginTop: 5, color: 'var(--navi-text-secondary)', fontSize: 10 }}>{item.campusLabel} · {item.source === 'local-file' ? 'Local file' : item.source === 'remote-session' ? 'Remote session' : 'Local session'}</div>
                  <div style={{ marginTop: 5, color: 'var(--navi-text-secondary)', fontSize: 10 }}>{formatDate(item.session.updatedAt)} · {formatDuration(itemMetrics.durationSeconds)} · {formatDistance(itemMetrics.distanceMeters)}</div>
                  <div style={{ marginTop: 4, color: 'var(--navi-text-secondary)', fontSize: 10 }}>{itemMetrics.markerCount} marker{itemMetrics.markerCount === 1 ? '' : 's'} · {itemMetrics.warningSegmentCount} GPS warning{itemMetrics.warningSegmentCount === 1 ? '' : 's'}</div>
                </button>
              )
            })}
          </div>
        </aside>

        <main aria-label="Capture review workspace" style={{ flex: '3 1 620px', minWidth: 'min(280px, 100%)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!selectedItem || !reviewSession ? (
            <section style={{ minHeight: 360, display: 'grid', placeItems: 'center', padding: 24, border: '1px dashed var(--navi-border)', borderRadius: 10, color: 'var(--navi-text-secondary)', textAlign: 'center' }}>
              <div>
                <MapPinned size={28} aria-hidden="true" style={{ marginBottom: 10, color: 'var(--navi-primary)' }} />
                <h2 style={{ margin: 0, color: 'var(--navi-text)', fontSize: 15 }}>Choose a Capture session</h2>
                <p style={{ maxWidth: 320, margin: '7px auto 0', fontSize: 12, lineHeight: 1.5 }}>The Reviewer is read-only. Your Studio draft will not be changed.</p>
              </div>
            </section>
          ) : (
            <>
              <section style={{ minHeight: 420, height: 520, overflow: 'hidden', border: '1px solid var(--navi-border)', borderRadius: 10, background: '#0f172a' }}>
                <CaptureReviewMap
                  session={reviewSession}
                  campusMap={selectedCampus}
                  existingRoads={importHost?.existingRoads}
                  layers={layers}
                  selection={selection}
                  editMode={editMode}
                  onMovePoint={handleMovePoint}
                  onAddPoint={handleAddPoint}
                  onRemovePoint={handleRemovePoint}
                  snapTargets={visibleSnapTargets}
                />
              </section>

              {importHost && <div aria-label="Import preview legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '8px 12px', border: '1px solid var(--navi-border)', borderRadius: 8, background: 'var(--navi-card)', color: 'var(--navi-text-secondary)', fontSize: 11 }}>
                <span><i style={{ display: 'inline-block', width: 18, borderTop: '3px dashed #f97316', marginRight: 6, verticalAlign: 'middle' }} />Existing pathways</span>
                <span><i style={{ display: 'inline-block', width: 18, borderTop: '4px solid #22c55e', marginRight: 6, verticalAlign: 'middle' }} />Proposed captured pathway</span>
              </div>}

              <section style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '2 1 360px', minWidth: 'min(280px, 100%)', padding: 14, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 14 }}>{selectedItem.session.title}</h2>
                      <div style={{ marginTop: 4, color: 'var(--navi-text-secondary)', fontSize: 11 }}>{selectedItem.source === 'local-file' ? 'Local file' : selectedItem.source === 'remote-session' ? 'Remote session' : 'Local session'} · {statusLabel(selectedItem.session.status)}</div>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: '#86efac', fontSize: 10 }}><Check size={13} aria-hidden="true" /> {importHost ? 'Studio import' : 'Read-only'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginTop: 14 }}>
                    <Metric label="Date" value={formatDate(selectedItem.session.updatedAt)} />
                    <Metric label="Duration" value={formatDuration(metrics?.durationSeconds ?? 0)} />
                    <Metric label="Distance" value={formatDistance(metrics?.distanceMeters ?? 0)} />
                    <Metric label="Raw samples" value={`${selectedItem.session.rawSamples.length}`} />
                    <Metric label="Candidate nodes" value={`${metrics?.candidateNodeCount ?? 0}`} />
                    <Metric label="Markers" value={`${metrics?.markerCount ?? 0}`} />
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 14, color: 'var(--navi-text-secondary)', fontSize: 11 }}>
                    Campus context
                    <select aria-label="Campus context" value={effectiveSelectedCampusId} onChange={(event) => setSelectedCampusId(event.target.value)} style={{ minHeight: 44, padding: '8px 10px', border: '1px solid var(--navi-border)', borderRadius: 7, background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 12 }}>
                      <option value="">No campus context</option>
                      {maps.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
                    </select>
                  </label>
                  {!importHost && effectiveSelectedCampusId && <button type="button" aria-label="Open Studio import workspace" onClick={() => router.push(`/studio/${effectiveSelectedCampusId}/edit/capture-review`)} style={{ width: '100%', minHeight: 44, marginTop: 10, padding: '8px 10px', border: '1px solid var(--navi-primary)', borderRadius: 7, background: 'transparent', color: 'var(--navi-primary)', cursor: 'pointer', fontSize: 11, fontWeight: 650 }}>Open Studio import workspace</button>}
                </div>

                <aside aria-label="Capture review panel" style={{ flex: '1 1 280px', minWidth: 'min(280px, 100%)', padding: 14, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)' }}>
                   <h2 style={{ margin: 0, fontSize: 14 }}>Review controls</h2>
                   <p style={{ margin: '5px 0 12px', color: 'var(--navi-text-secondary)', fontSize: 11, lineHeight: 1.45 }}>{importHost ? 'Existing pathways are orange; the selected candidate is the proposed green pathway. Review before changing the Studio draft.' : 'Toggle evidence layers and mark items for future import. Nothing is added to Studio yet.'}</p>
                   <div style={{ marginBottom: 14, padding: '10px 0 12px', borderBottom: '1px solid var(--navi-border)' }}>
                     <label htmlFor="capture-route-detail" style={{ display: 'block', color: 'var(--navi-text)', fontSize: 12, fontWeight: 650 }}>Route detail</label>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                       <span style={{ color: 'var(--navi-text-secondary)', fontSize: 10 }}>Simpler</span>
                       <input
                         id="capture-route-detail"
                         aria-label="Route detail"
                         type="range"
                         min={0}
                         max={ROUTE_DETAIL_ORDER.length - 1}
                         step={1}
                         value={ROUTE_DETAIL_ORDER.indexOf(routeDetail)}
                         aria-valuetext={ROUTE_DETAIL_LABELS[routeDetail]}
                         onChange={(event) => {
                           const nextDetail = ROUTE_DETAIL_ORDER[Number(event.target.value)] ?? DEFAULT_CAPTURE_ROUTE_DETAIL
                           handleRouteDetailChange(nextDetail)
                         }}
                         style={{ flex: 1, accentColor: 'var(--navi-primary)' }}
                       />
                       <span style={{ color: 'var(--navi-text-secondary)', fontSize: 10 }}>Detailed</span>
                     </div>
                     <div style={{ marginTop: 5, color: 'var(--navi-primary)', fontSize: 11 }}>{ROUTE_DETAIL_LABELS[routeDetail]} · derived from preserved raw GPS</div>
                   </div>
                   <div aria-label="Candidate editing controls" style={{ marginBottom: 14, padding: '10px 0 12px', borderBottom: '1px solid var(--navi-border)' }}>
                     <h3 style={{ margin: 0, fontSize: 12 }}>Reviewed candidate</h3>
                     <div style={{ marginTop: 6, color: 'var(--navi-text-secondary)', fontSize: 11, lineHeight: 1.45 }}>Edits are isolated from raw GPS and stay local until explicit import.</div>
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 8 }}>
                       {(['move', 'add', 'remove'] as const).map((mode) => (
                         <button
                           key={mode}
                           type="button"
                           aria-label={`${mode.charAt(0).toUpperCase()}${mode.slice(1)} point`}
                           aria-pressed={editMode === mode}
                           disabled={!reviewSession.candidateRoute}
                           onClick={() => {
                             setEditMode((current) => current === mode ? null : mode)
                             setEditMessage(null)
                           }}
                           style={{ minHeight: 40, padding: '7px 6px', border: `1px solid ${editMode === mode ? 'var(--navi-primary)' : 'var(--navi-border)'}`, borderRadius: 7, background: editMode === mode ? 'rgba(37,99,235,0.14)' : 'transparent', color: editMode === mode ? 'var(--navi-primary)' : 'var(--navi-text-secondary)', cursor: reviewSession.candidateRoute ? 'pointer' : 'not-allowed', fontSize: 11, opacity: reviewSession.candidateRoute ? 1 : 0.55 }}
                         >
                           {mode === 'move' ? 'Move point' : mode === 'add' ? 'Add point' : 'Remove point'}
                         </button>
                       ))}
                     </div>
                     <button
                       type="button"
                       aria-label="Reset route"
                       disabled={!reviewSession.candidateRoute && !generatedCandidate}
                       onClick={handleResetRoute}
                       style={{ width: '100%', minHeight: 40, marginTop: 6, padding: '7px 8px', border: '1px solid var(--navi-border)', borderRadius: 7, background: 'transparent', color: 'var(--navi-text-secondary)', cursor: reviewSession.candidateRoute || generatedCandidate ? 'pointer' : 'not-allowed', fontSize: 11, opacity: reviewSession.candidateRoute || generatedCandidate ? 1 : 0.55 }}
                     >
                       Reset route
                     </button>
                     {editMode && <div style={{ marginTop: 6, color: 'var(--navi-primary)', fontSize: 10 }}>{editMode === 'move' ? 'Drag a candidate node to move it.' : editMode === 'add' ? 'Click the preserved raw trace to add its nearest sample.' : 'Click a candidate node to remove it.'}</div>}
                     {editMessage && <div role="status" style={{ marginTop: 7, color: 'var(--navi-text-secondary)', fontSize: 10, lineHeight: 1.4 }}>{editMessage}</div>}
                   </div>
                   {importHost && <div aria-label="Endpoint snap controls" style={{ marginBottom: 14, padding: '10px 0 12px', borderBottom: '1px solid var(--navi-border)' }}>
                     <h3 style={{ margin: 0, fontSize: 12 }}>Endpoint alignment</h3>
                     <div style={{ marginTop: 6, color: 'var(--navi-text-secondary)', fontSize: 11, lineHeight: 1.45 }}>Nearby Studio pathways are suggestions only. Apply a snap explicitly; existing Roads stay unchanged.</div>
                     {visibleSnapTargets.length > 0 ? visibleSnapTargets.map((target) => {
                       const endpointLabel = target.endpoint === 'start' ? 'start' : 'end'
                       return <div key={snapTargetKey(target)} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
                         <button type="button" aria-label={`Snap ${endpointLabel} to ${target.roadName}`} onClick={() => handleApplyEndpointSnap(target)} style={{ minHeight: 40, flex: '1 1 170px', padding: '7px 8px', border: '1px solid #facc15', borderRadius: 7, background: 'rgba(250,204,21,0.12)', color: '#fef08a', cursor: 'pointer', fontSize: 11, fontWeight: 650 }}>Snap {endpointLabel} to {target.roadName}</button>
                         <button type="button" aria-label={`Ignore ${endpointLabel} snap`} onClick={() => handleIgnoreEndpointSnap(target)} style={{ minHeight: 40, padding: '7px 8px', border: '1px solid var(--navi-border)', borderRadius: 7, background: 'transparent', color: 'var(--navi-text-secondary)', cursor: 'pointer', fontSize: 10 }}>Ignore</button>
                       </div>
                     }) : <div style={{ marginTop: 6, color: 'var(--navi-text-secondary)', fontSize: 11 }}>No nearby endpoint alignment suggestion.</div>}
                   </div>}
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {LAYER_LABELS.map(({ key, label, color }) => <LayerToggle key={key} label={label} color={color} visible={layers[key]} onChange={(visible) => reviewHook.getState().setLayerVisible(key, visible)} />)}
                  </div>
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--navi-border)' }}>
                    <h3 style={{ margin: 0, fontSize: 12 }}>Candidate route sections</h3>
                     {reviewSession.candidateRoute && reviewSession.candidateRoute.points.length > 1 ? reviewSession.candidateRoute.points.slice(1).map((_, index) => {
                      const segmentId = `segment-${index}`
                      const included = selection.routeSegments[segmentId] !== 'excluded'
                      return <DecisionToggle key={segmentId} label={`Candidate section ${index + 1}`} checked={included} onChange={(checked) => reviewHook.getState().setRouteSegmentDecision(selectedItem.sessionId, segmentId, checked ? 'included' : 'excluded')} />
                    }) : <div style={{ marginTop: 6, color: 'var(--navi-text-secondary)', fontSize: 11 }}>No candidate route sections.</div>}
                  </div>
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--navi-border)' }}>
                    <h3 style={{ margin: 0, fontSize: 12 }}>Markers</h3>
                    {selectedItem.session.markers.length > 0 ? selectedItem.session.markers.map((marker) => {
                      const included = selection.markers[marker.id] !== 'excluded'
                      return <DecisionToggle key={marker.id} label={`Marker: ${marker.label ?? marker.type}`} checked={included} onChange={(checked) => reviewHook.getState().setMarkerDecision(selectedItem.sessionId, marker.id, checked ? 'included' : 'excluded')} />
                    }) : <div style={{ marginTop: 6, color: 'var(--navi-text-secondary)', fontSize: 11 }}>No markers.</div>}
                  </div>
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--navi-border)' }}>
                    <h3 style={{ margin: 0, fontSize: 12 }}>GPS warnings</h3>
                    <div style={{ marginTop: 6, color: metrics?.warningSegmentCount ? '#fbbf24' : 'var(--navi-text-secondary)', fontSize: 11 }}>{metrics?.warningSegmentCount ?? 0} warning segment{metrics?.warningSegmentCount === 1 ? '' : 's'} · {metrics?.warningSampleCount ?? 0} affected sample{metrics?.warningSampleCount === 1 ? '' : 's'}</div>
                  </div>
                </aside>
              </section>
            </>
          )}
        </main>
      </div>

      {isImportPreviewOpen && importHost && selectedItem && importPlan && <div role="dialog" aria-modal="true" aria-labelledby="capture-import-title" style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(2,6,23,0.72)' }}>
        <section style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', padding: 18, border: '1px solid var(--navi-border)', borderRadius: 12, background: 'var(--navi-card)', color: 'var(--navi-text)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
          <h2 id="capture-import-title" style={{ margin: 0, fontSize: 16 }}>Review outdoor pathway import</h2>
          <p style={{ margin: '7px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12, lineHeight: 1.5 }}>Existing pathways are shown with the dashed orange line. The proposed captured pathway is the solid green line. Cancel leaves the Studio document unchanged.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 14 }}>
            <Metric label="Proposed Roads" value={`${importPlan.commands.length}`} />
            <Metric label="Selected segments" value={`${importPlan.selectedSegmentIds.length}`} />
            <Metric label="Campus" value={importContext?.authoritativeCampusId ?? 'Missing'} />
          </div>
          {importPlan.errors.length > 0 && <div role="alert" style={{ marginTop: 14, padding: 10, border: '1px solid #ef4444', borderRadius: 8, background: '#450a0a', color: '#fecaca', fontSize: 11 }}>{importPlan.errors.join(' ')}</div>}
          {importPlan.warnings.length > 0 && <div role="alert" style={{ marginTop: 14, padding: 10, border: '1px solid #f59e0b', borderRadius: 8, background: '#451a03', color: '#fde68a', fontSize: 11 }}>{importPlan.warnings.join(' ')}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            <button type="button" aria-label="Cancel import" onClick={() => setIsImportPreviewOpen(false)} style={{ minHeight: 44, padding: '8px 12px', border: '1px solid var(--navi-border)', borderRadius: 8, background: 'transparent', color: 'var(--navi-text-secondary)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button type="button" aria-label="Import selected" disabled={importPlan.status !== 'ready'} onClick={handleImportSelected} style={{ minHeight: 44, padding: '8px 12px', border: '1px solid var(--navi-primary)', borderRadius: 8, background: 'var(--navi-primary)', color: '#fff', cursor: importPlan.status === 'ready' ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 650, opacity: importPlan.status === 'ready' ? 1 : 0.55 }}>Import selected</button>
          </div>
        </section>
      </div>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: '8px 9px', borderRadius: 7, background: 'var(--navi-content)' }}><div style={{ color: 'var(--navi-text-secondary)', fontSize: 10 }}>{label}</div><div style={{ marginTop: 3, color: 'var(--navi-text)', fontSize: 12, fontWeight: 650, overflowWrap: 'anywhere' }}>{value}</div></div>
}

function LayerToggle({ label, color, visible, onChange }: { label: string; color: string; visible: boolean; onChange: (visible: boolean) => void }) {
  return <label style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--navi-text)', cursor: 'pointer', fontSize: 12 }}><input type="checkbox" aria-label={label} checked={visible} onChange={(event) => onChange(event.target.checked)} style={{ width: 17, height: 17, accentColor: color }} /> <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} aria-hidden="true" /><span style={{ flex: 1 }}>{label}</span>{visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}</label>
}

function DecisionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, color: checked ? 'var(--navi-text)' : 'var(--navi-text-secondary)', cursor: 'pointer', fontSize: 11 }}><input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--navi-primary)' }} /><span>{checked ? 'Include' : 'Exclude'} · {label}</span></label>
}
