'use client'

import { useEffect, useMemo, useState } from 'react'
import { CaptureHome, type CaptureCampusOption } from './CaptureHome'
import { CaptureReview } from './CaptureReview'
import { RecordingMap } from './RecordingMap'
import { serializeCaptureSession } from '../format'
import { useCaptureStore, type CaptureStore } from '../store'
import type { CaptureMarkerDraft, CaptureSession } from '../types'
import { useCaptureSync } from '@/features/capture-sync/context'

type CaptureView = 'home' | 'recording' | 'review'

function createId(prefix: string) {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${randomUuid}`
}

function downloadSession(session: CaptureSession) {
  const blob = new Blob([serializeCaptureSession(session)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${session.title.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'capture'}.navicapture.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export interface CaptureShellProps {
  store?: CaptureStore
  campusId?: string | null
  campusLabel?: string | null
  campusOptions?: CaptureCampusOption[]
  onCampusChange?: (campusId: string | null) => void
}

export function CaptureShell({
  store = useCaptureStore,
  campusId = null,
  campusLabel = null,
  campusOptions = [],
  onCampusChange,
}: CaptureShellProps) {
  const sessions = store((state) => state.sessions)
  const selectedSessionId = store((state) => state.selectedSessionId)
  const hydrated = store((state) => state.hydrated)
  const isSaving = store((state) => state.isSaving)
  const error = store((state) => state.error)
  const hydrate = store((state) => state.hydrate)
  const { removeState } = useCaptureSync()
  const [view, setView] = useState<CaptureView>('home')

  useEffect(() => {
    if (!hydrated) void hydrate()
  }, [hydrate, hydrated])

  const activeSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) ?? null, [selectedSessionId, sessions])

  if (!hydrated) {
    return <div role="status" style={{ minHeight: '100%', display: 'grid', placeItems: 'center', color: 'var(--navi-text-secondary)', background: 'var(--navi-content)' }}>Restoring local captures…</div>
  }

  const handleNew = async (title: string) => {
    await store.getState().createSession(title, campusId ?? undefined)
    setView('recording')
  }

  const openSession = (id: string, preferredView?: CaptureView) => {
    store.getState().selectSession(id)
    const session = store.getState().sessions.find((item) => item.id === id)
    setView(preferredView ?? (session?.status === 'finished' ? 'review' : 'recording'))
  }

  const handleMarker = async (draft: CaptureMarkerDraft) => {
    if (!activeSession?.lastPosition) return
    await store.getState().addMarker(activeSession.id, {
      id: createId('marker'),
      type: draft.type,
      label: draft.label,
      note: draft.note,
      position: { latitude: activeSession.lastPosition.latitude, longitude: activeSession.lastPosition.longitude },
      accuracy: activeSession.lastPosition.accuracy,
      createdAt: new Date().toISOString(),
    })
  }

  const handleExport = () => {
    if (activeSession) downloadSession(activeSession)
  }

  const handleDelete = async (id: string) => {
    await store.getState().deleteSession(id)
    await removeState(id)
    if (id === selectedSessionId) setView('home')
  }

  if (view === 'recording' && activeSession) {
    return <RecordingMap
      session={activeSession}
      onBack={() => setView('home')}
      onStart={() => store.getState().setSessionStatus(activeSession.id, 'recording')}
      onPause={() => store.getState().setSessionStatus(activeSession.id, 'paused')}
      onResume={() => store.getState().setSessionStatus(activeSession.id, 'recording')}
      onFinish={async () => { await store.getState().finishSession(activeSession.id); setView('review') }}
      onAddMarker={handleMarker}
      onPosition={(sample) => store.getState().updateLastPosition(activeSession.id, sample)}
      onSample={(sample) => store.getState().appendRawSample(activeSession.id, sample)}
      onGpsError={(message) => store.getState().setSessionError(activeSession.id, message)}
    />
  }

  if (view === 'review' && activeSession) {
    return <CaptureReview session={activeSession} onBack={() => setView('home')} onExport={handleExport} onDelete={() => handleDelete(activeSession.id)} />
  }

  return <CaptureHome
    sessions={sessions}
    error={error}
    isSaving={isSaving}
    onNew={handleNew}
    onReview={(id) => openSession(id)}
    onDelete={handleDelete}
    onImport={async (session) => { await store.getState().importSession(session); setView('review') }}
    campusId={campusId}
    campusLabel={campusLabel}
    campusOptions={campusOptions}
    onCampusChange={onCampusChange}
  />
}
