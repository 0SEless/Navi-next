'use client'

import { useEffect, useRef, useState } from 'react'
import { FileUp, MapPinned, Plus, Trash2, Upload } from 'lucide-react'
import { parseCaptureFile } from '../format'
import type { CaptureSession } from '../types'
import { captureSyncErrorMessage, useCaptureSync } from '@/features/capture-sync/context'
import { CaptureSyncStatus } from '@/features/capture-sync/components/CaptureSyncStatus'

export interface CaptureHomeProps {
  sessions: CaptureSession[]
  error: string | null
  isSaving: boolean
  campusId?: string | null
  campusLabel?: string | null
  campusOptions?: CaptureCampusOption[]
  onCampusChange?: (campusId: string | null) => void
  onNew: (title: string) => void | Promise<void>
  onReview: (id: string) => void
  onDelete: (id: string) => void | Promise<void>
  onImport: (session: CaptureSession) => void | Promise<void>
}

export interface CaptureCampusOption {
  id: string
  label: string
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(status: CaptureSession['status']) {
  return status === 'finished' ? 'Finished' : status === 'paused' ? 'Paused' : status === 'preparing' ? 'Preparing' : 'Recording'
}

export function CaptureHome({
  sessions,
  error,
  isSaving,
  campusId = null,
  campusLabel = null,
  campusOptions = [],
  onCampusChange = () => {},
  onNew,
  onReview,
  onDelete,
  onImport,
}: CaptureHomeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null)
  const { availability, states, loadState, syncSession } = useCaptureSync()

  useEffect(() => {
    for (const session of sessions) {
      void loadState(session.id)
    }
  }, [loadState, sessions])

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = parseCaptureFile(await file.text())
      setFileError(null)
      await onImport(imported)
    } catch (importError) {
      setFileError(importError instanceof Error ? importError.message : 'Unable to read Capture file')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSync = async (sessionId: string) => {
    setSyncingSessionId(sessionId)
    try {
      await syncSession(sessionId)
    } finally {
      setSyncingSessionId(null)
    }
  }

  return (
    <div style={{ minHeight: '100%', overflowY: 'auto', background: 'var(--navi-content)', padding: 'clamp(16px, 4vw, 32px)' }}>
      <div style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--navi-primary)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              <MapPinned size={18} aria-hidden="true" />
              NAVI Capture
            </div>
            <h1 style={{ margin: '8px 0 4px', color: 'var(--navi-text)', fontSize: 'clamp(24px, 6vw, 34px)', lineHeight: 1.15 }}>Capture Home</h1>
            <p style={{ margin: 0, color: 'var(--navi-text-secondary)', maxWidth: 560 }}>
              Record campus paths and observations locally before deciding what belongs in a NAVI map.
            </p>
          </div>
          <span style={{ border: '1px solid var(--navi-border)', borderRadius: 999, padding: '6px 10px', color: 'var(--navi-text-secondary)', background: 'var(--navi-card)', fontSize: 12 }}>
            Local device storage
          </span>
        </header>

        <section aria-labelledby="new-capture-heading" style={{ background: 'var(--navi-card)', border: '1px solid var(--navi-border)', borderRadius: 12, padding: 'clamp(16px, 4vw, 24px)', boxShadow: 'var(--navi-shadow-sm)', marginBottom: 24 }}>
          <h2 id="new-capture-heading" style={{ margin: 0, color: 'var(--navi-text)', fontSize: 18 }}>Start a new capture</h2>
          <p style={{ margin: '6px 0 16px', color: 'var(--navi-text-secondary)', fontSize: 14 }}>
            Keep the device awake and allow foreground location while you walk.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gap: 6, maxWidth: 520 }}>
              <label htmlFor="capture-campus" style={{ color: 'var(--navi-text)', fontSize: 13, fontWeight: 700 }}>
                Capture campus
              </label>
              <select
                id="capture-campus"
                aria-label="Capture campus"
                value={campusId ?? ''}
                onChange={(event) => onCampusChange(event.target.value || null)}
                style={{ minHeight: 44, border: '1px solid var(--navi-border)', borderRadius: 8, padding: '0 12px', color: 'var(--navi-text)', background: 'var(--navi-card)', fontSize: 14 }}
              >
                <option value="">Choose a campus before syncing</option>
                {campusOptions.map((campus) => <option key={campus.id} value={campus.id}>{campus.label}</option>)}
              </select>
              <span style={{ color: 'var(--navi-text-secondary)', fontSize: 12 }}>
                {campusId
                  ? `New captures will be associated with ${campusLabel ?? campusId}.`
                  : 'Choose a campus before syncing. Local recording remains available.'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label htmlFor="capture-name" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
              Capture name
            </label>
            <input
              id="capture-name"
              aria-label="Capture name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. North gate to library"
              style={{ flex: '1 1 220px', minHeight: 44, border: '1px solid var(--navi-border)', borderRadius: 8, padding: '0 12px', color: 'var(--navi-text)', background: 'var(--navi-card)', fontSize: 14 }}
            />
            <button
              type="button"
              onClick={() => onNew(title)}
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 0, borderRadius: 8, padding: '0 16px', color: '#fff', background: 'var(--navi-primary)', fontWeight: 700, cursor: 'pointer' }}
            >
              <Plus size={17} aria-hidden="true" />
              New capture
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".navicapture.json,application/json"
              aria-label="Import NAVI Capture file"
              onChange={(event) => void handleImport(event.target.files?.[0])}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid var(--navi-border)', borderRadius: 8, padding: '0 14px', color: 'var(--navi-text)', background: 'var(--navi-card)', fontWeight: 600, cursor: 'pointer' }}
            >
              <FileUp size={17} aria-hidden="true" />
              Review file
            </button>
            </div>
          </div>
          {(error || fileError) && (
            <p role="alert" style={{ margin: '14px 0 0', color: 'var(--navi-error)', fontSize: 13 }}>{fileError ?? error}</p>
          )}
          {isSaving && <p style={{ margin: '14px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>Saving locally…</p>}
        </section>

        <section aria-labelledby="saved-captures-heading">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
            <h2 id="saved-captures-heading" style={{ margin: 0, color: 'var(--navi-text)', fontSize: 18 }}>Saved captures</h2>
            <span style={{ color: 'var(--navi-text-secondary)', fontSize: 12 }}>{sessions.length} local {sessions.length === 1 ? 'session' : 'sessions'}</span>
          </div>
          {sessions.length === 0 ? (
            <div style={{ border: '1px dashed var(--navi-border)', borderRadius: 12, padding: '32px 20px', color: 'var(--navi-text-secondary)', background: 'var(--navi-card)', textAlign: 'center' }}>
              <Upload size={24} style={{ marginBottom: 8, color: 'var(--navi-primary)' }} aria-hidden="true" />
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--navi-text)' }}>No captures yet</p>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>Your first route will appear here and survive a refresh.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
              {sessions.map((session) => (
                (() => {
                  const syncState = states[session.id]
                  const isSyncing = syncingSessionId === session.id || syncState?.status === 'syncing'

                  return <article key={session.id} style={{ background: 'var(--navi-card)', border: '1px solid var(--navi-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--navi-shadow-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div>
                      <h3 style={{ margin: 0, color: 'var(--navi-text)', fontSize: 16, overflowWrap: 'anywhere' }}>{session.title}</h3>
                      <p style={{ margin: '4px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>{formatDate(session.updatedAt)}</p>
                    </div>
                    <span style={{ borderRadius: 999, padding: '4px 8px', color: session.status === 'finished' ? 'var(--navi-success)' : 'var(--navi-warning)', background: session.status === 'finished' ? 'var(--navi-tint-blue)' : 'var(--navi-tint-amber)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {statusLabel(session.status)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 14, margin: '16px 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>
                    <span>{session.rawSamples.length} samples</span>
                    <span>{session.markers.length} markers</span>
                    <span>{session.candidateRoute?.points.length ?? 0} candidate nodes</span>
                  </div>
                  <CaptureSyncStatus
                    title={session.title}
                    sessionStatus={session.status}
                    available={availability}
                    syncState={syncState}
                    errorMessage={syncState?.errorCode ? captureSyncErrorMessage(syncState.errorCode) : null}
                    isSyncing={isSyncing}
                    onSync={() => handleSync(session.id)}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" aria-label={`Review ${session.title}`} onClick={() => onReview(session.id)} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 8, color: '#fff', background: 'var(--navi-primary)', fontWeight: 700, cursor: 'pointer' }}>Review</button>
                    <button type="button" aria-label={`Delete ${session.title}`} onClick={() => onDelete(session.id)} style={{ width: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--navi-border)', borderRadius: 8, color: 'var(--navi-error)', background: 'var(--navi-card)', cursor: 'pointer' }}>
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                  </article>
                })()
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
