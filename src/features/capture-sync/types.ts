import type { CaptureSession } from '../capture/types'

export type CaptureSyncStatus =
  | 'local'
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'failed'
  | 'conflict'

export type CaptureSyncAvailability = 'checking' | 'available' | 'unavailable'

export type CaptureSyncErrorCode =
  | 'AUTH_REQUIRED'
  | 'NETWORK_ERROR'
  | 'REMOTE_CONFLICT'
  | 'REMOTE_ERROR'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_SCHEMA'
  | 'PAYLOAD_TOO_LARGE'
  | 'SESSION_NOT_FINISHED'
  | 'CAMPUS_REQUIRED'

export interface CaptureSyncState {
  sessionId: string
  status: CaptureSyncStatus
  attemptCount: number
  lastSyncedHash: string | null
  lastSyncedAt: string | null
  lastAttemptAt: string | null
  nextRetryAt: string | null
  errorCode: CaptureSyncErrorCode | null
}

export interface RemoteCaptureSummary {
  sessionId: string
  campusId: string | null
  title: string
  status: CaptureSession['status']
  schemaVersion: number
  contentHash: string
  clientUpdatedAt: string
  createdAt: string
  updatedAt: string
  rawSampleCount: number
  candidateNodeCount: number
  candidateEdgeCount: number
  markerCount: number
}

export interface RemoteCaptureSession extends RemoteCaptureSummary {
  session: CaptureSession
}

export type UploadResult =
  | { kind: 'uploaded'; remote: RemoteCaptureSummary }
  | { kind: 'unchanged'; remote: RemoteCaptureSummary }
  | { kind: 'conflict'; remote: RemoteCaptureSummary }

export interface CaptureCloudRepository {
  getSession(sessionId: string): Promise<RemoteCaptureSession | null>
  listSessions(options?: { campusId?: string | null }): Promise<RemoteCaptureSummary[]>
  uploadSession(session: CaptureSession, expectedRemoteHash?: string | null): Promise<UploadResult>
}
