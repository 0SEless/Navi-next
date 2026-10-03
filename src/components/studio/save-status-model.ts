export type StudioSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'dirty' | 'dirty-while-saving'
export type StudioGraphSyncStatus = 'idle' | 'syncing' | 'checking' | 'synced' | 'error' | 'conflict'

export interface SaveStatusModelInput {
  saveState: StudioSaveState
  syncStatus: StudioGraphSyncStatus
  syncError?: string | null
  saveError?: string | null
}

export interface SaveStatusModel {
  label: string
  color: string
  detail: string | null
  showRecoveryActions: boolean
  /**
   * Raw producer text (syncError/saveError). Never shown in the main banner;
   * rendered only inside the advanced recovery disclosure.
   */
  diagnostic: string | null
}

const COLORS = {
  success: '#16a34a',
  progress: '#2563eb',
  warning: '#d97706',
  error: '#dc2626',
  neutral: '#64748b',
} as const

const CONFLICT_DETAIL =
  'This device contains changes that could not be synchronized because the server version changed. Your local work is preserved.'
const OFFLINE_DETAIL =
  'You appear to be offline. Your work is saved on this device and will sync automatically.'
const FAILURE_DETAIL =
  'Saving failed. Your local changes are preserved; retry when the server is reachable.'

export function getSaveStatusModel({
  saveState,
  syncStatus,
  syncError = null,
  saveError = null,
}: SaveStatusModelInput): SaveStatusModel {
  const diagnostic = syncError ?? saveError ?? null

  if (syncStatus === 'conflict') {
    return {
      label: 'Changes not synced',
      color: COLORS.error,
      detail: CONFLICT_DETAIL,
      showRecoveryActions: true,
      diagnostic,
    }
  }

  if (syncStatus === 'error') {
    if (syncError?.startsWith('Offline')) {
      return {
        label: 'Saved on this device',
        color: COLORS.warning,
        detail: OFFLINE_DETAIL,
        showRecoveryActions: false,
        diagnostic,
      }
    }

    return {
      label: 'Save failed — changes preserved',
      color: COLORS.error,
      detail: FAILURE_DETAIL,
      showRecoveryActions: true,
      diagnostic,
    }
  }

  if (syncStatus === 'checking') {
    return {
      label: 'Checking server…',
      color: COLORS.neutral,
      detail: null,
      showRecoveryActions: false,
      diagnostic: null,
    }
  }

  if (syncStatus === 'syncing' && syncError === 'Save failed — retrying automatically') {
    return {
      label: 'Save failed — retrying automatically',
      color: COLORS.warning,
      detail: 'Your local changes are preserved while NAVI retries the temporary failure.',
      showRecoveryActions: false,
      diagnostic: syncError,
    }
  }

  if (syncStatus === 'syncing' || saveState === 'saving' || saveState === 'dirty-while-saving') {
    return {
      label: 'Saving...',
      color: COLORS.progress,
      detail: null,
      showRecoveryActions: false,
      diagnostic: null,
    }
  }

  if (saveState === 'error') {
    return {
      label: 'Save failed — changes preserved',
      color: COLORS.error,
      detail: FAILURE_DETAIL,
      showRecoveryActions: false,
      diagnostic,
    }
  }

  if (saveState === 'dirty') {
    return {
      label: 'Unsaved changes',
      color: COLORS.warning,
      detail: null,
      showRecoveryActions: false,
      diagnostic: null,
    }
  }

  if (syncStatus === 'idle') {
    return {
      label: 'Sync pending...',
      color: COLORS.neutral,
      detail: null,
      showRecoveryActions: false,
      diagnostic: null,
    }
  }

  return {
    label: 'All changes saved',
    color: COLORS.success,
    detail: null,
    showRecoveryActions: false,
    diagnostic: null,
  }
}
