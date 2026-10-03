import type { CaptureSession } from '../capture/types'
import type { CaptureSyncAvailability, CaptureSyncStatus } from './types'

export type CaptureSyncPresentationAction = 'none' | 'sync' | 'retry'
export type CaptureSyncPresentationTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'error'

export interface CaptureSyncPresentationOptions {
  status: CaptureSyncStatus
  availability: CaptureSyncAvailability
  sessionStatus: CaptureSession['status']
  errorMessage?: string | null
}

export interface CaptureSyncPresentation {
  label: 'Local' | 'Queued' | 'Syncing' | 'Synced' | 'Failed' | 'Conflict'
  detail: string
  tone: CaptureSyncPresentationTone
  action: CaptureSyncPresentationAction
}

function statusLabel(status: CaptureSyncStatus): CaptureSyncPresentation['label'] {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'syncing':
      return 'Syncing'
    case 'synced':
      return 'Synced'
    case 'failed':
      return 'Failed'
    case 'conflict':
      return 'Conflict'
    case 'local':
    default:
      return 'Local'
  }
}

function defaultDetail(status: CaptureSyncStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued for the next foreground sync.'
    case 'syncing':
      return 'Syncing in the foreground…'
    case 'synced':
      return 'Synced successfully.'
    case 'failed':
      return 'The last sync attempt failed. Retry when the sync service is available.'
    case 'conflict':
      return 'A remote version exists. Review it before trying again.'
    case 'local':
    default:
      return 'Saved on this device.'
  }
}

function defaultTone(status: CaptureSyncStatus): CaptureSyncPresentationTone {
  switch (status) {
    case 'syncing':
      return 'progress'
    case 'synced':
      return 'success'
    case 'failed':
      return 'error'
    case 'conflict':
      return 'warning'
    case 'queued':
      return 'info'
    case 'local':
    default:
      return 'neutral'
  }
}

export function getCaptureSyncPresentation({
  status,
  availability,
  sessionStatus,
  errorMessage,
}: CaptureSyncPresentationOptions): CaptureSyncPresentation {
  const label = statusLabel(status)

  if (sessionStatus !== 'finished' && status !== 'synced') {
    return {
      label,
      detail: 'Finish the Capture session before it can sync.',
      tone: 'neutral',
      action: 'none',
    }
  }

  if (availability === 'checking') {
    return {
      label,
      detail: 'Checking sync availability…',
      tone: 'info',
      action: 'none',
    }
  }

  if (availability !== 'available') {
    return {
      label,
      detail: errorMessage ?? (status === 'synced'
        ? 'Previously synced; remote access is currently unavailable.'
        : 'Saved on this device. Sync is currently unavailable.'),
      tone: status === 'conflict' ? 'warning' : status === 'failed' ? 'error' : 'neutral',
      action: 'none',
    }
  }

  if (status === 'local') {
    return { label, detail: 'Saved on this device. Ready to sync.', tone: 'info', action: 'sync' }
  }

  if (status === 'failed') {
    return { label, detail: errorMessage ?? defaultDetail(status), tone: 'error', action: 'retry' }
  }

  return {
    label,
    detail: errorMessage ?? defaultDetail(status),
    tone: defaultTone(status),
    action: 'none',
  }
}
