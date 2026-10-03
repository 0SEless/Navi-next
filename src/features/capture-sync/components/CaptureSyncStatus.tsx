'use client'

import { RefreshCw, UploadCloud } from 'lucide-react'
import type { CaptureSession } from '@/features/capture/types'
import { getCaptureSyncPresentation } from '../presentation'
import type { CaptureSyncAvailability, CaptureSyncState } from '../types'

export interface CaptureSyncStatusProps {
  title: string
  sessionStatus: CaptureSession['status']
  available: CaptureSyncAvailability
  syncState?: CaptureSyncState
  errorMessage?: string | null
  isSyncing?: boolean
  onSync: () => void | Promise<void>
}

function toneColor(tone: ReturnType<typeof getCaptureSyncPresentation>['tone']): string {
  switch (tone) {
    case 'success':
      return 'var(--navi-success)'
    case 'error':
      return 'var(--navi-error)'
    case 'warning':
      return 'var(--navi-warning)'
    case 'info':
    case 'progress':
      return 'var(--navi-primary)'
    case 'neutral':
    default:
      return 'var(--navi-text)'
  }
}

export function CaptureSyncStatus({ title, sessionStatus, available, syncState, errorMessage, isSyncing = false, onSync }: CaptureSyncStatusProps) {
  const presentation = getCaptureSyncPresentation({
    status: syncState?.status ?? 'local',
    availability: available,
    sessionStatus,
    errorMessage,
  })
  const hasErrorDetail = Boolean(errorMessage && (syncState?.status === 'failed' || syncState?.status === 'conflict'))
  const actionLabel = presentation.action === 'retry' ? `Retry ${title}` : `Sync now for ${title}`

  return (
    <section aria-label="Capture sync status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: 12, border: '1px solid var(--navi-border)', borderRadius: 10, background: 'var(--navi-card)' }}>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--navi-text-secondary)', fontSize: 12 }}>
          {presentation.action === 'retry' ? <RefreshCw size={14} aria-hidden="true" /> : <UploadCloud size={14} aria-hidden="true" />}
          <span>Sync:</span>
          <strong style={{ color: toneColor(presentation.tone) }}>{presentation.label}</strong>
          {available === 'unavailable' && <span style={{ color: 'var(--navi-text-secondary)' }}>Local only</span>}
        </div>
        {hasErrorDetail ? (
          <p role="alert" style={{ margin: '5px 0 0', color: 'var(--navi-error)', fontSize: 12 }}>{presentation.detail}</p>
        ) : (
          <p style={{ margin: '5px 0 0', color: 'var(--navi-text-secondary)', fontSize: 12 }}>{presentation.detail}</p>
        )}
      </div>
      {presentation.action !== 'none' && (
        <button
          type="button"
          aria-label={actionLabel}
          disabled={isSyncing}
          onClick={() => { void onSync() }}
          style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid var(--navi-border)', borderRadius: 8, padding: '0 12px', color: 'var(--navi-text)', background: 'var(--navi-card)', fontWeight: 700, cursor: isSyncing ? 'wait' : 'pointer' }}
        >
          {isSyncing ? 'Syncing…' : presentation.action === 'retry' ? 'Retry' : 'Sync now'}
        </button>
      )}
    </section>
  )
}
