'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Download, Trash2 } from 'lucide-react'
import NavigationMap from '@/components/map/NavigationMap'
import { captureSyncErrorMessage, useCaptureSync } from '@/features/capture-sync/context'
import { CaptureSyncStatus } from '@/features/capture-sync/components/CaptureSyncStatus'
import { getCaptureBounds } from '../geometry'
import { calculateCaptureDistanceMeters, formatCaptureDistance, formatCaptureDuration, getActiveCaptureDurationMs } from '../metrics'
import type { CaptureSession } from '../types'
import { CaptureMapLayers } from './RecordingMap'

function formatDate(value: string | undefined) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

const markerLabels = { poi: 'POI', panorama: 'Panorama', entrance: 'Entrance', hazard: 'Hazard' } as const

export interface CaptureReviewProps {
  session: CaptureSession
  onBack: () => void
  onExport: () => void
  onDelete: () => void
}

export function CaptureReview({ session, onBack, onExport, onDelete }: CaptureReviewProps) {
  const lastPosition = session.lastPosition ?? session.rawSamples.at(-1) ?? null
  const center: [number, number] | undefined = lastPosition ? [lastPosition.longitude, lastPosition.latitude] : undefined
  const bounds = getCaptureBounds(session)
  const distance = calculateCaptureDistanceMeters(session.rawSamples)
  const activeDuration = getActiveCaptureDurationMs(session)
  const [isSyncing, setIsSyncing] = useState(false)
  const { availability, states, loadState, syncSession } = useCaptureSync()
  const syncState = states[session.id]
  const syncStatus = syncState?.status ?? 'local'

  useEffect(() => {
    void loadState(session.id)
  }, [loadState, session.id])

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      await syncSession(session.id)
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflowY: 'auto', background: 'var(--navi-content)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '0 12px', borderBottom: '1px solid var(--navi-border)', background: 'var(--navi-card)' }}>
        <button type="button" aria-label="Back to Capture Home" onClick={onBack} style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--navi-border)', borderRadius: 8, color: 'var(--navi-text)', background: 'var(--navi-card)', cursor: 'pointer' }}><ArrowLeft size={18} aria-hidden="true" /></button>
        <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: 'var(--navi-text)', fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</div><div style={{ color: 'var(--navi-text-secondary)', fontSize: 11 }}>Capture Review</div></div>
        <button type="button" aria-label="Export NAVI Capture JSON" onClick={onExport} style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 8, color: '#fff', background: 'var(--navi-primary)', cursor: 'pointer' }}><Download size={18} aria-hidden="true" /></button>
      </header>
      <section style={{ padding: '16px 12px 24px', width: '100%', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
          {[['Raw samples', session.rawSamples.length], ['Candidate nodes', session.candidateRoute?.points.length ?? 0], ['Candidate edges', session.candidateRoute?.edgeCount ?? 0], ['Markers', session.markers.length], ['Distance', formatCaptureDistance(distance)], ['Active time', formatCaptureDuration(activeDuration)]].map(([label, value]) => (
            <div key={String(label)} style={{ padding: 12, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)' }}><div style={{ color: 'var(--navi-text-secondary)', fontSize: 11 }}>{label}</div><strong style={{ display: 'block', marginTop: 4, color: 'var(--navi-text)', fontSize: 22 }}>{value}</strong></div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14, color: 'var(--navi-text-secondary)', fontSize: 12 }}>
          <span>Status: <strong style={{ color: 'var(--navi-text)' }}>{session.status}</strong></span>
          <span>Finished: <strong style={{ color: 'var(--navi-text)' }}>{formatDate(session.finishedAt)}</strong></span>
        </div>
        <div style={{ marginBottom: 14 }}>
          <CaptureSyncStatus
            title={session.title}
            sessionStatus={session.status}
            available={availability}
            syncState={syncState}
            errorMessage={syncState?.errorCode ? captureSyncErrorMessage(syncState.errorCode) : null}
            isSyncing={isSyncing}
            onSync={handleSync}
          />
        </div>
        <div style={{ height: 'min(52vh, 420px)', minHeight: 280, overflow: 'hidden', border: '1px solid var(--navi-border)', borderRadius: 12, background: 'var(--navi-card)', marginBottom: 14 }}>
          <NavigationMap center={center} zoom={18} bounds={bounds} style={{ minHeight: '100%' }}><CaptureMapLayers session={session} /></NavigationMap>
        </div>
        <section aria-labelledby="review-markers-heading" style={{ border: '1px solid var(--navi-border)', borderRadius: 12, background: 'var(--navi-card)', padding: 14 }}>
          <h2 id="review-markers-heading" style={{ margin: 0, color: 'var(--navi-text)', fontSize: 16 }}>Markers</h2>
          {session.markers.length === 0 ? <p style={{ margin: '8px 0 0', color: 'var(--navi-text-secondary)', fontSize: 13 }}>No manual markers were added.</p> : (
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {session.markers.map((marker) => <div key={marker.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 8, background: 'var(--navi-content)' }}><div style={{ flex: 1, minWidth: 0 }}><strong style={{ color: 'var(--navi-text)', fontSize: 13 }}>{marker.label || markerLabels[marker.type]}</strong><div style={{ color: 'var(--navi-text-secondary)', fontSize: 11 }}>{markerLabels[marker.type]} · {marker.position.latitude.toFixed(6)}, {marker.position.longitude.toFixed(6)}</div>{marker.note && <div style={{ marginTop: 3, color: 'var(--navi-text-secondary)', fontSize: 12 }}>{marker.note}</div>}</div></div>)}
            </div>
          )}
        </section>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onExport} style={{ flex: 1, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 0, borderRadius: 8, color: '#fff', background: 'var(--navi-primary)', fontWeight: 700, cursor: 'pointer' }}><Download size={16} aria-hidden="true" />Export .navicapture.json</button>
          <button type="button" aria-label={`Delete ${session.title}`} onClick={onDelete} style={{ width: 48, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--navi-border)', borderRadius: 8, color: 'var(--navi-error)', background: 'var(--navi-card)', cursor: 'pointer' }}><Trash2 size={17} aria-hidden="true" /></button>
        </div>
      </section>
    </div>
  )
}
