import {
  CAPTURE_FILE_FORMAT,
  CAPTURE_SCHEMA_VERSION,
  type CaptureCoordinate,
  type CaptureFileEnvelope,
  type CaptureMarker,
  type CaptureSession,
  type RawGpsSample,
} from './types'

const MARKER_TYPES = new Set(['poi', 'panorama', 'entrance', 'hazard'])
const SESSION_STATUSES = new Set(['preparing', 'recording', 'paused', 'finished'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid NAVI Capture file: ${message}`)
}

function assertCoordinate(value: unknown, fieldName: string): asserts value is CaptureCoordinate {
  assert(isRecord(value), `${fieldName} must be an object`)
  const record = value as Record<string, unknown>
  assert(typeof record.latitude === 'number' && Number.isFinite(record.latitude), `${fieldName}.latitude must be finite`)
  assert(typeof record.longitude === 'number' && Number.isFinite(record.longitude), `${fieldName}.longitude must be finite`)
  assert(record.latitude >= -90 && record.latitude <= 90, `${fieldName}.latitude is out of range`)
  assert(record.longitude >= -180 && record.longitude <= 180, `${fieldName}.longitude is out of range`)
}

function assertNullableFinite(value: unknown, fieldName: string): void {
  assert(value === null || Number.isFinite(value), `${fieldName} must be finite or null`)
}

function assertRawSample(value: unknown, index: number): asserts value is RawGpsSample {
  const field = `session.rawSamples[${index}]`
  assert(isRecord(value), `${field} must be an object`)
  const record = value as Record<string, unknown>
  assert(typeof record.sequence === 'number' && Number.isInteger(record.sequence) && record.sequence >= 0, `${field}.sequence must be a non-negative integer`)
  assert(typeof record.timestamp === 'string', `${field}.timestamp must be a string`)
  assertCoordinate(record, field)
  assertNullableFinite(record.accuracy, `${field}.accuracy`)
  assertNullableFinite(record.altitude, `${field}.altitude`)
  assertNullableFinite(record.altitudeAccuracy, `${field}.altitudeAccuracy`)
  assertNullableFinite(record.heading, `${field}.heading`)
  assertNullableFinite(record.speed, `${field}.speed`)
}

function assertMarker(value: unknown, index: number): asserts value is CaptureMarker {
  const field = `session.markers[${index}]`
  assert(isRecord(value), `${field} must be an object`)
  assert(typeof value.id === 'string' && value.id.length > 0, `${field}.id must be a non-empty string`)
  assert(typeof value.type === 'string' && MARKER_TYPES.has(value.type), `${field}.type is unsupported`)
  assertCoordinate(value.position, `${field}.position`)
  assert(value.label === undefined || typeof value.label === 'string', `${field}.label must be a string`)
  assert(value.note === undefined || typeof value.note === 'string', `${field}.note must be a string`)
  assert(value.accuracy === undefined || value.accuracy === null || Number.isFinite(value.accuracy), `${field}.accuracy must be finite or null`)
  assert(typeof value.createdAt === 'string', `${field}.createdAt must be a string`)
}

function assertSession(value: unknown): asserts value is CaptureSession {
  assert(isRecord(value), 'session must be an object')
  assert(value.schemaVersion === CAPTURE_SCHEMA_VERSION, 'session schemaVersion is unsupported')
  assert(typeof value.id === 'string' && value.id.length > 0, 'session.id must be a non-empty string')
  assert(typeof value.title === 'string', 'session.title must be a string')
  assert(value.campusId === undefined || (typeof value.campusId === 'string' && value.campusId.length > 0), 'session.campusId must be a non-empty string when provided')
  assert(typeof value.status === 'string' && SESSION_STATUSES.has(value.status), 'session.status is unsupported')
  assert(typeof value.createdAt === 'string', 'session.createdAt must be a string')
  assert(typeof value.updatedAt === 'string', 'session.updatedAt must be a string')
  assert(value.pausedDurationMs === undefined || (typeof value.pausedDurationMs === 'number' && Number.isFinite(value.pausedDurationMs) && value.pausedDurationMs >= 0), 'session.pausedDurationMs must be a finite non-negative number when provided')
  assert(value.pauseStartedAt === undefined || typeof value.pauseStartedAt === 'string', 'session.pauseStartedAt must be a string when provided')
  assert(Array.isArray(value.rawSamples), 'session.rawSamples must be an array')
  value.rawSamples.forEach(assertRawSample)
  assert(Array.isArray(value.markers), 'session.markers must be an array')
  value.markers.forEach(assertMarker)
  assert(value.lastPosition === undefined || value.lastPosition === null || isRecord(value.lastPosition), 'session.lastPosition must be a sample or null')

  if (value.candidateRoute !== undefined && value.candidateRoute !== null) {
    const route = value.candidateRoute
    assert(isRecord(route), 'session.candidateRoute must be an object')
    assert(Array.isArray(route.points), 'session.candidateRoute.points must be an array')
    route.points.forEach((point, index) => assertCoordinate(point, `session.candidateRoute.points[${index}]`))
    assert(Array.isArray(route.sourceSampleIndices), 'session.candidateRoute.sourceSampleIndices must be an array')
    assert(route.sourceSampleIndices.every((index) => typeof index === 'number' && Number.isInteger(index) && index >= 0), 'session.candidateRoute.sourceSampleIndices must contain indices')
    assert(typeof route.edgeCount === 'number' && Number.isInteger(route.edgeCount) && route.edgeCount >= 0, 'session.candidateRoute.edgeCount must be a non-negative integer')
    assert(typeof route.derivedFromSampleCount === 'number' && Number.isInteger(route.derivedFromSampleCount) && route.derivedFromSampleCount >= 0, 'session.candidateRoute.derivedFromSampleCount must be a non-negative integer')
    assert(typeof route.derivedAt === 'string', 'session.candidateRoute.derivedAt must be a string')
    assert(typeof route.algorithmVersion === 'string', 'session.candidateRoute.algorithmVersion must be a string')
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

export function serializeCaptureSession(session: CaptureSession, exportedAt = new Date().toISOString()): string {
  assertSession(session)
  const envelope: CaptureFileEnvelope = {
    format: CAPTURE_FILE_FORMAT,
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    exportedAt,
    session: clone(session),
  }
  return JSON.stringify(envelope, null, 2)
}

export function parseCaptureFile(text: string): CaptureSession {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid NAVI Capture file: JSON could not be parsed')
  }

  assert(isRecord(parsed), 'root must be an object')
  assert(parsed.format === CAPTURE_FILE_FORMAT, 'format is unsupported')
  assert(parsed.schemaVersion === CAPTURE_SCHEMA_VERSION, 'schemaVersion is unsupported')
  assert(typeof parsed.exportedAt === 'string', 'exportedAt must be a string')
  assertSession(parsed.session)
  return clone(parsed.session)
}
