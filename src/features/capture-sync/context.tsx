'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CaptureSyncService } from './service'
import { CaptureCloudError } from './errors'
import type {
  CaptureCloudRepository,
  CaptureSyncAvailability,
  CaptureSyncErrorCode,
  CaptureSyncState,
  CaptureSyncStatus,
  RemoteCaptureSession,
  RemoteCaptureSummary,
} from './types'

export interface CaptureSyncContextValue {
  available: boolean
  availability: CaptureSyncAvailability
  states: Record<string, CaptureSyncState | undefined>
  loadState: (sessionId: string) => Promise<CaptureSyncState | null>
  syncSession: (sessionId: string) => Promise<CaptureSyncState | null>
  removeState: (sessionId: string) => Promise<void>
  listRemoteSessions: (options?: { campusId?: string | null }) => Promise<RemoteCaptureSummary[]>
  getRemoteSession: (sessionId: string) => Promise<RemoteCaptureSession | null>
}

const DEFAULT_CONTEXT: CaptureSyncContextValue = {
  available: false,
  availability: 'unavailable',
  states: {},
  loadState: async () => null,
  syncSession: async () => null,
  removeState: async () => {},
  listRemoteSessions: async () => {
    throw new CaptureCloudError('AUTH_REQUIRED')
  },
  getRemoteSession: async () => {
    throw new CaptureCloudError('AUTH_REQUIRED')
  },
}

export function captureSyncErrorMessage(code: CaptureSyncErrorCode): string {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'Sign in to sync this Capture session.'
    case 'NETWORK_ERROR':
      return 'The Capture session could not reach the sync service.'
    case 'REMOTE_CONFLICT':
      return 'A newer remote Capture session exists. Review it before trying again.'
    case 'REMOTE_ERROR':
      return 'The sync service returned an error.'
    case 'INVALID_PAYLOAD':
      return 'This Capture session payload is invalid.'
    case 'UNSUPPORTED_SCHEMA':
      return 'This Capture session format is not supported for sync.'
    case 'PAYLOAD_TOO_LARGE':
      return 'This Capture session is too large to sync.'
    case 'SESSION_NOT_FINISHED':
      return 'Finish the Capture session before syncing it.'
    case 'CAMPUS_REQUIRED':
      return 'Choose a campus before syncing.'
  }
}

export function captureSyncStatusLabel(status: CaptureSyncStatus | undefined): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'syncing':
      return 'Syncing'
    case 'synced':
      return 'Synced'
    case 'failed':
      return 'Retry'
    case 'conflict':
      return 'Conflict'
    case 'local':
    default:
      return 'Local'
  }
}

const CaptureSyncContext = createContext<CaptureSyncContextValue>(DEFAULT_CONTEXT)

export function CaptureSyncProvider({
  service,
  available = true,
  availability,
  cloudRepository = null,
  children,
}: {
  service: CaptureSyncService | null
  available?: boolean
  availability?: CaptureSyncAvailability
  cloudRepository?: CaptureCloudRepository | null
  children: ReactNode
}) {
  const [states, setStates] = useState<Record<string, CaptureSyncState | undefined>>({})

  const setState = useCallback((state: CaptureSyncState | null) => {
    if (!state) return
    setStates((current) => ({ ...current, [state.sessionId]: state }))
  }, [])

  const loadState = useCallback(
    async (sessionId: string) => {
      if (!service) return null
      try {
        const state = await service.getState(sessionId)
        setState(state)
        return state
      } catch {
        return null
      }
    },
    [service, setState],
  )

  const syncSession = useCallback(
    async (sessionId: string) => {
      if (!service || !available) return null
      try {
        const state = await service.syncSession(sessionId)
        setState(state)
        return state
      } catch {
        const state = await loadState(sessionId)
        return state
      }
    },
    [available, loadState, service, setState],
  )

  const removeState = useCallback(
    async (sessionId: string) => {
      if (service) await service.removeState(sessionId)
      setStates((current) => {
        const next = { ...current }
        delete next[sessionId]
        return next
      })
    },
    [service],
  )

  const listRemoteSessions = useCallback(
    async (options?: { campusId?: string | null }) => {
      if (!cloudRepository || !available) {
        throw new CaptureCloudError('AUTH_REQUIRED')
      }
      return cloudRepository.listSessions(options)
    },
    [available, cloudRepository],
  )

  const getRemoteSession = useCallback(
    async (sessionId: string) => {
      if (!cloudRepository || !available) {
        throw new CaptureCloudError('AUTH_REQUIRED')
      }
      return cloudRepository.getSession(sessionId)
    },
    [available, cloudRepository],
  )

  useEffect(() => {
    if (!service || !available) return undefined

    let active = true
    const handleOnline = () => {
      void service
        .syncQueuedSessions()
        .then((nextStates) => {
          if (!active) return
          nextStates.forEach(setState)
        })
        .catch(() => {
          // Individual sync failures are persisted by the service; the next foreground
          // event or an explicit Retry action can attempt them again.
        })
    }

    window.addEventListener('online', handleOnline)
    return () => {
      active = false
      window.removeEventListener('online', handleOnline)
    }
  }, [available, service, setState])

  const value = useMemo<CaptureSyncContextValue>(
    () => ({
      available: Boolean(service && available),
      availability: availability ?? (available ? 'available' : 'unavailable'),
      states,
      loadState,
      syncSession,
      removeState,
      listRemoteSessions,
      getRemoteSession,
    }),
    [
      availability,
      available,
      getRemoteSession,
      listRemoteSessions,
      loadState,
      removeState,
      service,
      states,
      syncSession,
    ],
  )

  return <CaptureSyncContext.Provider value={value}>{children}</CaptureSyncContext.Provider>
}

export function useCaptureSync(): CaptureSyncContextValue {
  return useContext(CaptureSyncContext)
}
