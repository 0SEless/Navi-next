export const CAPTURE_SCHEMA_VERSION = 1 as const
export const CAPTURE_FILE_FORMAT = 'navi-capture' as const

export type CaptureSessionStatus = 'preparing' | 'recording' | 'paused' | 'finished'
export type CaptureMarkerType = 'poi' | 'panorama' | 'entrance' | 'hazard'

export interface CaptureCoordinate {
  latitude: number
  longitude: number
}

export interface RawGpsSample extends CaptureCoordinate {
  sequence: number
  timestamp: string
  accuracy: number | null
  altitude: number | null
  altitudeAccuracy: number | null
  heading: number | null
  speed: number | null
}

export interface CandidateRoute {
  points: CaptureCoordinate[]
  sourceSampleIndices: number[]
  edgeCount: number
  derivedFromSampleCount: number
  derivedAt: string
  algorithmVersion: string
}

export interface CaptureMarker {
  id: string
  type: CaptureMarkerType
  position: CaptureCoordinate
  label?: string
  note?: string
  accuracy?: number | null
  createdAt: string
}

export type CaptureMarkerDraft = Pick<CaptureMarker, 'type'> & {
  label?: string
  note?: string
}

export interface CaptureSession {
  schemaVersion: typeof CAPTURE_SCHEMA_VERSION
  id: string
  title: string
  /** Optional survey association; imports require an explicit context even when legacy sessions omit it. */
  campusId?: string
  status: CaptureSessionStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  /** Accumulated time spent paused, used only to derive active recording time. */
  pausedDurationMs?: number
  /** Timestamp of the current pause while a session is paused. */
  pauseStartedAt?: string
  rawSamples: RawGpsSample[]
  candidateRoute?: CandidateRoute | null
  markers: CaptureMarker[]
  lastPosition?: RawGpsSample | null
  lastError?: string | null
}

export interface CaptureFileEnvelope {
  format: typeof CAPTURE_FILE_FORMAT
  schemaVersion: typeof CAPTURE_SCHEMA_VERSION
  exportedAt: string
  session: CaptureSession
}
