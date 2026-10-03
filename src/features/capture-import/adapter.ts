import type { Road, RoadSurface } from '@navi/core'
import type { CaptureSession, CandidateRoute } from '@/features/capture/types'
import type { CaptureReviewSelection } from '@/features/capture-review/types'
import {
  appendCaptureImportEntries,
  createCaptureImportManifestStore,
  type CaptureImportManifestEntry,
  type CaptureImportManifestStore,
  hasImportedCaptureSegment,
} from './manifest'

/**
 * The canonical Road type documents width in meters, while the existing
 * editor handler historically clamps the same numeric range used by the
 * RoadStyle pixel controls. Capture deliberately passes an explicit value
 * through unchanged and rejects values outside that shared range. It does
 * not silently convert GPS or UI pixels.
 */
export const DEFAULT_CAPTURE_ROAD_WIDTH_METERS = 3
export const CAPTURE_ROAD_WIDTH_MIN_METERS = 2
export const CAPTURE_ROAD_WIDTH_MAX_METERS = 20
const ROAD_SURFACES = new Set<RoadSurface>(['paved', 'concrete', 'brick', 'gravel', 'grass', 'unpaved'])

export interface CaptureImportContext {
  authoritativeCampusId: string
  captureCampusId: string | null
  studioCampusId: string | null
  roadWidthMeters: number
  roadName?: string
  roadSurface?: RoadSurface
}

/** Studio supplies this boundary; the standalone Reviewer leaves it absent. */
export interface CaptureReviewerImportHost {
  adapter: CaptureImportAdapter
  existingRoads: Road[]
  getContext: (selectedCampusId: string, session: CaptureSession) => CaptureImportContext
}

export interface CaptureImportCommand {
  id: string
  label: string
  payload: Record<string, unknown>
}

export interface CaptureImportMutationResult {
  success: boolean
  entityId?: string
  data?: Record<string, unknown>
  error?: string
}

export interface CaptureImportBatchResult {
  success: boolean
  results: CaptureImportMutationResult[]
  error?: string
  failedCommandIndex?: number
}

export interface CaptureImportCommandExecutor {
  executeBatch(commands: CaptureImportCommand[]): CaptureImportBatchResult
}

export interface CaptureRoadCommandPlan {
  command: CaptureImportCommand
  sourceSegmentIds: string[]
  sourceSampleIndices: number[]
}

export interface CaptureImportPlan {
  status: 'ready' | 'blocked'
  captureRouteId: string | null
  selectedSegmentIds: string[]
  duplicateSegmentIds: string[]
  commands: CaptureRoadCommandPlan[]
  errors: string[]
  warnings: string[]
}

export interface CaptureImportResult {
  status: 'imported' | 'blocked' | 'duplicate' | 'failed'
  plan: CaptureImportPlan
  importBatchId?: string
  canonicalRoadIds: string[]
  manifestEntries: CaptureImportManifestEntry[]
  error?: string
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function createImportBatchId(): string {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `capture-import-${randomUuid}`
}

export function getCaptureRouteId(session: CaptureSession): string | null {
  const algorithmVersion = session.candidateRoute?.algorithmVersion
  return session.candidateRoute
    ? `candidate-route:${session.id}:${algorithmVersion ?? 'unknown'}`
    : null
}

function toLatLng(point: { latitude: number; longitude: number }) {
  return { lat: point.latitude, lng: point.longitude }
}

function emptyPlan(): CaptureImportPlan {
  return {
    status: 'blocked',
    captureRouteId: null,
    selectedSegmentIds: [],
    duplicateSegmentIds: [],
    commands: [],
    errors: [],
    warnings: [],
  }
}

function validateCampusContext(session: CaptureSession, context: CaptureImportContext, plan: CaptureImportPlan) {
  const authoritative = context.authoritativeCampusId?.trim()
  const captureCampus = context.captureCampusId?.trim()
  const studioCampus = context.studioCampusId?.trim()

  if (!authoritative || !captureCampus || !studioCampus) {
    plan.errors.push('An authoritative Capture, Studio, and campus context ID are required')
    return
  }

  if (authoritative !== captureCampus || authoritative !== studioCampus) {
    plan.errors.push(`Campus mismatch: Capture, Studio, and authoritative campus IDs must match (${authoritative})`)
  }

  const sessionCampusId = typeof session.campusId === 'string' ? session.campusId.trim() : null
  if (session.campusId !== undefined && !sessionCampusId) {
    plan.errors.push('Capture session campus ID must be a non-empty string when provided')
  } else if (sessionCampusId && sessionCampusId !== authoritative) {
    plan.errors.push(`Capture session campus mismatch: ${sessionCampusId} does not match ${authoritative}`)
  }
}

function validateWidth(context: CaptureImportContext, plan: CaptureImportPlan) {
  if (!Number.isFinite(context.roadWidthMeters)) {
    plan.errors.push('Road width must be a finite explicit value in meters')
    return
  }
  if (context.roadWidthMeters < CAPTURE_ROAD_WIDTH_MIN_METERS || context.roadWidthMeters > CAPTURE_ROAD_WIDTH_MAX_METERS) {
    plan.errors.push(`Road width must be between ${CAPTURE_ROAD_WIDTH_MIN_METERS} and ${CAPTURE_ROAD_WIDTH_MAX_METERS} meters`)
  }
}

function validateSurface(context: CaptureImportContext, plan: CaptureImportPlan) {
  if (context.roadSurface !== undefined && !ROAD_SURFACES.has(context.roadSurface)) {
    plan.errors.push(`Unsupported outdoor pathway surface: ${String(context.roadSurface)}`)
  }
}

function validateCandidate(session: CaptureSession, plan: CaptureImportPlan): CandidateRoute | null {
  const candidate = session.candidateRoute
  if (!candidate) {
    plan.errors.push('Capture session has no candidate outdoor route')
    return null
  }
  plan.captureRouteId = getCaptureRouteId(session)

  if (candidate.points.length < 2) plan.errors.push('Candidate route must contain at least two points')
  if (candidate.sourceSampleIndices.length !== candidate.points.length) {
    plan.errors.push('Candidate route source indices must match candidate point count')
  }
  if (candidate.edgeCount !== candidate.points.length - 1) {
    plan.errors.push('Candidate route edge count does not match its points')
  }
  if (candidate.derivedFromSampleCount !== session.rawSamples.length) {
    plan.errors.push('Candidate route sample count does not match the raw Capture samples')
  }

  for (let index = 0; index < candidate.points.length; index += 1) {
    const point = candidate.points[index]
    if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) {
      plan.errors.push(`Candidate point ${index} has an invalid latitude`)
    }
    if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
      plan.errors.push(`Candidate point ${index} has an invalid longitude`)
    }

    const sourceIndex = candidate.sourceSampleIndices[index]
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= session.rawSamples.length) {
      plan.errors.push(`Candidate source sample index ${index} is outside the raw Capture samples`)
    }

    if (index > 0) {
      const previousIndex = candidate.sourceSampleIndices[index - 1]
      if (Number.isInteger(previousIndex) && sourceIndex <= previousIndex) {
        plan.errors.push('Candidate source sample indices must be strictly increasing')
      }
      const previous = candidate.points[index - 1]
      if (previous.latitude === point.latitude && previous.longitude === point.longitude) {
        plan.errors.push(`Candidate route segment ${index - 1} has zero length`)
      }
    }
  }

  return candidate
}

function selectedSegmentIndexes(
  candidate: CandidateRoute,
  selection: CaptureReviewSelection | undefined,
  plan: CaptureImportPlan,
): number[] {
  const decisions = selection?.routeSegments ?? {}
  const maxIndex = candidate.points.length - 2
  for (const [segmentId, decision] of Object.entries(decisions)) {
    const match = /^segment-(\d+)$/.exec(segmentId)
    const index = match ? Number(match[1]) : -1
    if (index < 0 || index > maxIndex || (decision !== 'included' && decision !== 'excluded')) {
      plan.errors.push(`Unknown candidate route segment decision: ${segmentId}`)
    }
  }

  const indexes: number[] = []
  for (let index = 0; index <= maxIndex; index += 1) {
    const segmentId = `segment-${index}`
    if (decisions[segmentId] !== 'excluded') indexes.push(index)
  }
  return indexes
}

function contiguousRuns(indexes: number[]): number[][] {
  const runs: number[][] = []
  for (const index of indexes) {
    const current = runs[runs.length - 1]
    if (current && index === current[current.length - 1] + 1) current.push(index)
    else runs.push([index])
  }
  return runs
}

function baseRoadName(session: CaptureSession, context: CaptureImportContext): string {
  return (context.roadName ?? session.title).trim()
}

export class CaptureImportAdapter {
  private readonly executor: CaptureImportCommandExecutor
  private readonly manifestStore: CaptureImportManifestStore

  constructor(options: {
    executor: CaptureImportCommandExecutor
    manifestStore?: CaptureImportManifestStore
  }) {
    this.executor = options.executor
    this.manifestStore = options.manifestStore ?? createCaptureImportManifestStore()
  }

  planOutdoorRoute(
    session: CaptureSession,
    selection: CaptureReviewSelection | undefined,
    context: CaptureImportContext,
  ): CaptureImportPlan {
    const plan = emptyPlan()
    const candidate = validateCandidate(session, plan)
    validateCampusContext(session, context, plan)
    validateWidth(context, plan)
    validateSurface(context, plan)

    const name = baseRoadName(session, context)
    if (!name) plan.errors.push('An outdoor pathway name is required')

    if (!candidate || plan.errors.length > 0) return plan

    const indexes = selectedSegmentIndexes(candidate, selection, plan)
    plan.selectedSegmentIds = indexes.map((index) => `segment-${index}`)
    if (plan.errors.length > 0) return plan
    if (indexes.length === 0) {
      plan.errors.push('At least one candidate route segment must be selected')
      return plan
    }

    const routeId = plan.captureRouteId!
    const manifest = this.manifestStore.read()
    plan.duplicateSegmentIds = plan.selectedSegmentIds.filter((segmentId) => hasImportedCaptureSegment(manifest, {
      captureSessionId: session.id,
      captureRouteId: routeId,
      captureSegmentId: segmentId,
    }))
    if (plan.duplicateSegmentIds.length > 0) {
      plan.warnings.push(`Capture segment(s) already imported: ${plan.duplicateSegmentIds.join(', ')}`)
      return plan
    }

    const runs = contiguousRuns(indexes)
    const surface = context.roadSurface ?? 'paved'
    for (const [runIndex, run] of runs.entries()) {
      const start = run[0]
      const end = run[run.length - 1]
      const points = candidate.points.slice(start, end + 2).map(toLatLng)
      const sourceSampleIndices = candidate.sourceSampleIndices.slice(start, end + 2)
      const sourceSegmentIds = run.map((index) => `segment-${index}`)
      const roadName = runs.length === 1 ? name : `${name} · section ${runIndex + 1}`

      plan.commands.push({
        sourceSegmentIds,
        sourceSampleIndices,
        command: {
          id: 'road.create',
          label: `Import outdoor pathway${runs.length === 1 ? '' : ` section ${runIndex + 1}`}`,
          payload: {
            name: roadName,
            points,
            type: 'pedestrian',
            width: context.roadWidthMeters,
            surface,
            displayMode: 'visible',
          },
        },
      })
    }

    plan.status = 'ready'
    return plan
  }

  importOutdoorRoute(
    session: CaptureSession,
    selection: CaptureReviewSelection | undefined,
    context: CaptureImportContext,
  ): CaptureImportResult {
    const plan = this.planOutdoorRoute(session, selection, context)
    if (plan.status !== 'ready') {
      return {
        status: plan.duplicateSegmentIds.length > 0 ? 'duplicate' : 'blocked',
        plan,
        canonicalRoadIds: [],
        manifestEntries: [],
      }
    }

    const importBatchId = createImportBatchId()
    const execution = this.executor.executeBatch(plan.commands.map((item) => item.command))
    if (!execution.success) {
      return {
        status: 'failed',
        plan,
        importBatchId,
        canonicalRoadIds: [],
        manifestEntries: [],
        error: execution.error ?? 'The outdoor pathway import command batch failed',
      }
    }

    if (execution.results.length !== plan.commands.length) {
      return {
        status: 'failed',
        plan,
        importBatchId,
        canonicalRoadIds: [],
        manifestEntries: [],
        error: 'The import command batch did not return one canonical Road ID per command',
      }
    }
    const canonicalRoadIds: string[] = []
    for (const result of execution.results) {
      const roadId = result.entityId ?? (result.data?.id as string | undefined)
      if (!roadId) {
        return {
          status: 'failed',
          plan,
          importBatchId,
          canonicalRoadIds: [],
          manifestEntries: [],
          error: 'The import command batch did not return a canonical Road ID',
        }
      }
      canonicalRoadIds.push(roadId)
    }
    const importedAt = new Date().toISOString()
    const entries: CaptureImportManifestEntry[] = []
    for (const [commandIndex, commandPlan] of plan.commands.entries()) {
      for (const captureSegmentId of commandPlan.sourceSegmentIds) {
        entries.push({
          captureSessionId: session.id,
          captureRouteId: plan.captureRouteId!,
          captureSegmentId,
          importBatchId,
          canonicalRoadId: canonicalRoadIds[commandIndex],
          campusId: context.authoritativeCampusId,
          importedAt,
        })
      }
    }

    try {
      this.manifestStore.write(appendCaptureImportEntries(this.manifestStore.read(), entries))
    } catch (error) {
      plan.warnings.push(error instanceof Error ? `Roads imported but provenance could not be saved: ${error.message}` : 'Roads imported but provenance could not be saved')
    }

    return {
      status: 'imported',
      plan,
      importBatchId,
      canonicalRoadIds,
      manifestEntries: clone(entries),
    }
  }
}
