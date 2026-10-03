'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, ExternalLink, RefreshCw } from 'lucide-react'

import { createCaptureImportManifestStore } from '@/features/capture-import/manifest'
import { useCaptureSync } from '@/features/capture-sync/context'
import type { RemoteCaptureSummary } from '@/features/capture-sync/types'
import { validateRemoteCaptureSessionForCampus, RemoteCaptureOpenError } from '@/features/capture-review/remote-session'
import type { CaptureImportManifestStore } from '@/features/capture-import/manifest'
import { captureLibraryErrorMessage } from '../errors'
import { hasImportedCaptureSessionHere } from '../provenance'

interface LibraryListState {
  campusId: string
  status: 'ready' | 'error'
  summaries: RemoteCaptureSummary[]
  message?: string
}

interface LibraryOpenError {
  campusId: string
  message: string
}

export interface StudioCaptureLibraryProps {
  campusId: string
  campusLabel: string
  manifestStore?: CaptureImportManifestStore
}

function formatDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleString()
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function StudioCaptureLibrary({ campusId, campusLabel, manifestStore }: StudioCaptureLibraryProps) {
  const router = useRouter()
  const {
    available,
    availability,
    listRemoteSessions,
    getRemoteSession,
  } = useCaptureSync()
  const [listState, setListState] = useState<LibraryListState | null>(null)
  const [openError, setOpenError] = useState<LibraryOpenError | null>(null)
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null)
  const openRequestRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const manifest = useMemo(() => {
    try {
      return (manifestStore ?? createCaptureImportManifestStore()).read()
    } catch {
      return { schemaVersion: 1 as const, imports: [] }
    }
  }, [manifestStore])

  useEffect(() => {
    if (availability !== 'available' || !available) return undefined
    let active = true
    void listRemoteSessions({ campusId })
      .then((summaries) => {
        if (!active) return
        setListState({
          campusId,
          status: 'ready',
          summaries: summaries.filter((summary) => summary.campusId === campusId),
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setListState({ campusId, status: 'error', summaries: [], message: captureLibraryErrorMessage(error) })
      })
    return () => {
      active = false
    }
  }, [availability, available, campusId, listRemoteSessions])

  const visibleSummaries = listState?.campusId === campusId && listState.status === 'ready'
    ? listState.summaries
    : []
  const listError = listState?.campusId === campusId && listState.status === 'error'
    ? listState.message
    : null
  const isLoading = availability === 'available' && available && listState?.campusId !== campusId
  const visibleOpenError = openError?.campusId === campusId ? openError.message : null

  const handleOpen = async (summary: RemoteCaptureSummary) => {
    const requestId = openRequestRef.current + 1
    openRequestRef.current = requestId
    setOpeningSessionId(summary.sessionId)
    setOpenError(null)

    try {
      const remote = await getRemoteSession(summary.sessionId)
      if (!remote) throw new RemoteCaptureOpenError('NOT_FOUND')
      validateRemoteCaptureSessionForCampus(remote, campusId)
      if (!mountedRef.current || requestId !== openRequestRef.current) return
      router.push(`/studio/${encodeURIComponent(campusId)}/edit/capture-review?sessionId=${encodeURIComponent(summary.sessionId)}`)
    } catch (error) {
      if (!mountedRef.current || requestId !== openRequestRef.current) return
      setOpenError({ campusId, message: captureLibraryErrorMessage(error) })
    } finally {
      if (mountedRef.current && requestId === openRequestRef.current) setOpeningSessionId(null)
    }
  }

  return (
    <div style={{ minHeight: '100%', overflow: 'auto', padding: 20, color: 'var(--navi-text)', background: 'var(--navi-content)' }}>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <button type="button" aria-label="Back to Studio" onClick={() => router.push('/studio')} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid var(--navi-border)', borderRadius: 8, background: 'transparent', color: 'var(--navi-text-secondary)', cursor: 'pointer', fontSize: 12 }}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Studio
        </button>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 760 }}>Capture Library</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>Synced field captures for {campusLabel}</p>
        </div>
        {availability === 'available' && available && <button type="button" aria-label="Refresh Capture Library" onClick={() => window.location.reload()} style={{ minHeight: 44, minWidth: 44, display: 'inline-grid', placeItems: 'center', border: '1px solid var(--navi-border)', borderRadius: 8, background: 'var(--navi-card)', color: 'var(--navi-text-secondary)', cursor: 'pointer' }}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>}
      </header>

      {availability === 'checking' && <div role="status" style={{ padding: 18, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)', color: 'var(--navi-text-secondary)', fontSize: 12 }}>Checking Capture Library access…</div>}
      {availability === 'unavailable' || !available && availability !== 'checking' ? <div role="alert" style={{ padding: 18, border: '1px solid #f59e0b', borderRadius: 10, background: '#451a03', color: '#fde68a', fontSize: 12 }}>Sign in to view remote Capture sessions.</div> : null}
      {listError && <div role="alert" style={{ marginTop: 12, padding: 14, border: '1px solid #ef4444', borderRadius: 10, background: '#450a0a', color: '#fecaca', fontSize: 12 }}>{listError}</div>}
      {visibleOpenError && <div role="alert" style={{ marginTop: 12, padding: 14, border: '1px solid #ef4444', borderRadius: 10, background: '#450a0a', color: '#fecaca', fontSize: 12 }}>{visibleOpenError}</div>}

      {isLoading && <section role="status" style={{ padding: 18, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)', color: 'var(--navi-text-secondary)', fontSize: 12 }}>Loading Capture sessions…</section>}
      {!isLoading && availability === 'available' && available && !listError && visibleSummaries.length === 0 && <section style={{ padding: 28, border: '1px dashed var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)', color: 'var(--navi-text-secondary)', textAlign: 'center', fontSize: 12 }}>No synced Capture sessions for this campus yet.</section>}

      {visibleSummaries.length > 0 && <section aria-label="Synced Capture sessions" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 12 }}>
        {visibleSummaries.map((summary) => {
          const importedHere = hasImportedCaptureSessionHere(manifest, { captureSessionId: summary.sessionId, campusId })
          const isOpening = openingSessionId === summary.sessionId
          return (
            <article key={summary.sessionId} style={{ padding: 16, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15 }}>{summary.title}</h2>
                  <div style={{ marginTop: 4, color: 'var(--navi-text-secondary)', fontSize: 11 }}>{formatDate(summary.updatedAt)} · {summary.status}</div>
                </div>
                {importedHere && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '4px 7px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: '#86efac', fontSize: 10 }}><Check size={12} aria-hidden="true" /> Imported here</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, color: 'var(--navi-text-secondary)', fontSize: 11 }}>
                <span>{countLabel(summary.rawSampleCount, 'raw sample')}</span>
                <span>·</span>
                <span>{countLabel(summary.candidateNodeCount, 'candidate node')}</span>
                <span>·</span>
                <span>{countLabel(summary.candidateEdgeCount, 'candidate edge')}</span>
                <span>·</span>
                <span>{countLabel(summary.markerCount, 'marker')}</span>
              </div>
              <button type="button" aria-label={`Open ${summary.title}`} disabled={isOpening} onClick={() => void handleOpen(summary)} style={{ width: '100%', minHeight: 44, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 16, padding: '8px 12px', border: '1px solid var(--navi-primary)', borderRadius: 8, background: 'var(--navi-primary)', color: '#fff', cursor: isOpening ? 'wait' : 'pointer', fontSize: 12, fontWeight: 650, opacity: isOpening ? 0.7 : 1 }}>
                <ExternalLink size={14} aria-hidden="true" />
                {isOpening ? 'Opening…' : 'Open in Reviewer'}
              </button>
            </article>
          )
        })}
      </section>}
    </div>
  )
}
