import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { validateNavigationArtifacts, type ArtifactValidationResult } from '@navi/compiler'

// Keep these sequential campus reads in the same Vercel region as Supabase.
export const preferredRegion = 'hnd1'

/**
 * GET /api/public-campus?campus_id=X
 *
 * Public read endpoint for the NAVI runtime.
 *
 * Resolution: ONE authoritative source per request.
 *
 *   1. published_maps (compiler output) — the canonical runtime package.
 *      If it exists, the response is produced exclusively from it.
 *      No other sources are consulted.
 *
 *   2. graph_snapshots (editor save) — fallback when compiler hasn't run.
 *      Transformed to PublishedCampus shape. Not merged with anything.
 *
 *   3. Empty response.
 *
 * INVARIANT: A runtime request resolves to exactly one authoritative source.
 * No merging. No combining. No partial fill from multiple sources.
 *
 * @see ADR-001-domain-boundaries.md
 * @see ADR-002-published-runtime-contract.md
 */

async function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

// ── Source 1: published_maps (exclusive) ──

interface PublishedArtifacts {
  campusName?: unknown
  name?: unknown
  metadata?: {
    campusName?: unknown
    name?: unknown
    campusId?: string | null
    connectivitySemanticsVersion?: string | null
    compilerVersion?: string | null
    revision?: string | number | null
    sourceDocumentVersion?: string | number | null
    compiledAt?: string | null
  }
  graph?: {
    campusId?: string | null
    nodes?: unknown[]
    edges?: unknown[]
    traces?: unknown[]
    pois?: unknown[]
    metadata?: { boundingBox?: unknown }
  }
  buildingIndex?: { buildings?: unknown[] }
  searchIndex?: { entries?: unknown[] }
  poiIndex?: { points?: unknown[] }
  spatialIndex?: unknown
  panoramaIndex?: unknown
  floorGeometry?: unknown
  qrIndex?: unknown
  components?: unknown[]
  doors?: unknown[]
  traces?: unknown[]
}

type PublishedLookupResult =
  | { status: 'found'; artifacts: unknown }
  | { status: 'not_found' }
  | { status: 'error' }

type SnapshotLookupResult =
  | { status: 'found'; snapshot: GraphSnapshotData }
  | { status: 'not_found' }
  | { status: 'error' }

async function readPublishedMaps(campusId: string): Promise<PublishedLookupResult> {
  try {
    const supabase = await getClient()
    const result = await supabase
      .from('published_maps')
      .select('artifacts')
      .eq('campus_id', campusId)
      .maybeSingle() as unknown as { data: { artifacts?: unknown } | null; error: unknown | null }

    if (result.error) {
      console.warn('[public-campus] published_maps read failed')
      return { status: 'error' }
    }

    if (result.data === null) {
      return { status: 'not_found' }
    }

    // Row existence is distinct from artifact validity. A present row with a
    // missing or malformed payload must fail closed, not become a snapshot hit.
    return { status: 'found', artifacts: result.data?.artifacts }
  } catch {
    console.warn('[public-campus] published_maps read failed')
    return { status: 'error' }
  }
}

// ── Source 2: graph_snapshots (fallback only) ──

interface GraphSnapshotData {
  campusName?: unknown
  name?: unknown
  buildings?: unknown[]
  nodes?: unknown[]
  edges?: unknown[]
  traces?: unknown[]
  pois?: unknown[]
  components?: unknown[]
  doors?: unknown[]
  boundary?: unknown
}

async function readGraphSnapshot(campusId: string): Promise<SnapshotLookupResult> {
  try {
    const supabase = await getClient()
    const result = await supabase
      .from('graph_snapshots')
      .select('data')
      .eq('campus_id', campusId)
      .maybeSingle() as unknown as { data: { data?: GraphSnapshotData } | null; error: unknown | null }

    if (result.error) {
      console.warn('[public-campus] graph_snapshots read failed')
      return { status: 'error' }
    }

    if (result.data === null) {
      return { status: 'not_found' }
    }

    const snap = result.data?.data
    if (snap && Array.isArray(snap.buildings) && snap.buildings.length > 0) {
      return { status: 'found', snapshot: snap }
    }

    return { status: 'not_found' }
  } catch {
    console.warn('[public-campus] graph_snapshots read failed')
    return { status: 'error' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function resolveCampusDisplayName(campusId: string, ...values: unknown[]): string | null {
  for (const value of values) {
    if (!isNonEmptyString(value)) continue
    const name = value.trim()
    if (name !== campusId) return name
  }
  return null
}

function validatePublishedArtifactsForRead(
  campusId: string,
  artifacts: unknown,
): ArtifactValidationResult {
  const validation = validateNavigationArtifacts(artifacts, {
    // Reads must accept legacy artifacts that predate Phase 7/8 provenance,
    // while still enforcing the graph and reference invariants they expose.
    requireProvenance: false,
    requireGraphCampusId: false,
  })

  if (!isRecord(artifacts)) return validation

  const errors = [...validation.errors]
  const graph = isRecord(artifacts.graph) ? artifacts.graph : null
  const metadata = isRecord(artifacts.metadata) ? artifacts.metadata : null

  for (const [record, path] of [
    [graph, 'graph.campusId'],
    [metadata, 'metadata.campusId'],
  ] as const) {
    if (!record || !Object.prototype.hasOwnProperty.call(record, 'campusId')) continue
    if (!isNonEmptyString(record.campusId) || record.campusId !== campusId) {
      errors.push({
        code: 'ARTIFACT_CAMPUS_ID_MISMATCH',
        message: 'Published artifact campusId must match the requested campus',
        path,
      })
    }
  }

  return { ...validation, valid: errors.length === 0, errors }
}

type RequestTimings = Record<string, number>

function timedJsonResponse(
  body: unknown,
  status: number,
  requestStartedAt: number,
  timings: RequestTimings,
) {
  const serializationStartedAt = performance.now()
  const serializedBody = JSON.stringify(body)
  timings.serialize = performance.now() - serializationStartedAt

  const response = new NextResponse(serializedBody, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

  // Stage names and durations are safe diagnostics. Keep them out of production
  // responses unless a future rollout explicitly needs them there.
  if (process.env.NODE_ENV !== 'production') {
    const metrics = Object.entries(timings)
      .map(([name, duration]) => `${name};dur=${Math.max(0, duration).toFixed(1)}`)
    metrics.push(`handler;dur=${Math.max(0, performance.now() - requestStartedAt).toFixed(1)}`)
    response.headers.set('Server-Timing', metrics.join(', '))
  }

  return response
}

function publicReadError(
  code: 'PUBLIC_CAMPUS_READ_FAILED' | 'PUBLIC_CAMPUS_ARTIFACT_INVALID',
) {
  return {
    error: code,
    message: code === 'PUBLIC_CAMPUS_READ_FAILED'
      ? 'Public campus data is temporarily unavailable.'
      : 'Published navigation artifacts are invalid.',
  }
}

// ── Response builder ──

function buildResponseBody(campusId: string, source: string, data: {
  campusName?: string | null
  buildings: unknown[]
  nodes: unknown[]
  edges: unknown[]
  traces?: unknown[]
  pois?: unknown[]
  boundary: unknown
  components?: unknown[]
  doors?: unknown[]
  artifacts?: PublishedArtifacts
  revision?: string | number | null
}) {
  return {
    campusId,
    campusName: data.campusName ?? null,
    source,
    revision: data.revision ?? null,
    buildings: data.buildings,
    components: data.components ?? [],
    doors: data.doors ?? [],
    nodes: data.nodes,
    edges: data.edges,
    traces: data.traces ?? [],
    pois: data.pois ?? [],
    boundary: data.boundary,
    artifacts: data.artifacts ?? null,
  }
}

// ── Main handler ──

export async function GET(request: NextRequest) {
  const requestStartedAt = performance.now()
  const timings: RequestTimings = {}
  const { searchParams } = new URL(request.url)
  const campusId = searchParams.get('campus_id')

  if (!campusId) {
    return timedJsonResponse({ error: 'campus_id is required' }, 400, requestStartedAt, timings)
  }

  // ── Source 1: published_maps (exclusive) ──
  // If a published map exists, the response is produced exclusively from it.
  // No other sources are consulted. No merging.
  const publishedStartedAt = performance.now()
  const published = await readPublishedMaps(campusId)
  timings.published = performance.now() - publishedStartedAt
  if (published.status === 'error') {
    return timedJsonResponse(publicReadError('PUBLIC_CAMPUS_READ_FAILED'), 503, requestStartedAt, timings)
  }

  if (published.status === 'found') {
    const validationStartedAt = performance.now()
    const validation = validatePublishedArtifactsForRead(campusId, published.artifacts)
    timings.validation = performance.now() - validationStartedAt
    if (!validation.valid) {
      console.warn('[public-campus] published artifact rejected')
      return timedJsonResponse(publicReadError('PUBLIC_CAMPUS_ARTIFACT_INVALID'), 500, requestStartedAt, timings)
    }

    const transformationStartedAt = performance.now()
    const artifacts = published.artifacts as PublishedArtifacts
    const graph = artifacts.graph ?? {}
    const buildings = artifacts.buildingIndex?.buildings ?? []

    const body = buildResponseBody(campusId, 'published_maps', {
      campusName: resolveCampusDisplayName(
        campusId,
        artifacts.campusName,
        artifacts.name,
        artifacts.metadata?.campusName,
        artifacts.metadata?.name,
      ),
      buildings,
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      traces: artifacts.traces ?? graph.traces ?? [],
      pois: artifacts.poiIndex?.points ?? graph.pois ?? [],
      boundary: graph.metadata?.boundingBox ?? null,
      // Components and doors are additive compiler projections. Older published
      // maps may not have them — default to [] without rejecting the artifact.
      components: artifacts.components ?? [],
      doors: artifacts.doors ?? [],
      artifacts,
      revision: artifacts.metadata?.revision ?? null,
    })
    timings.transform = performance.now() - transformationStartedAt
    return timedJsonResponse(body, 200, requestStartedAt, timings)
  }

  // ── Source 2: graph_snapshots (fallback only) ──
  // Used only when the compiler hasn't run. Transformed to PublishedCampus
  // shape. Not merged with anything.
  const snapshotStartedAt = performance.now()
  const snapshot = await readGraphSnapshot(campusId)
  timings.snapshot = performance.now() - snapshotStartedAt
  if (snapshot.status === 'error') {
    return timedJsonResponse(publicReadError('PUBLIC_CAMPUS_READ_FAILED'), 503, requestStartedAt, timings)
  }

  if (snapshot.status === 'found') {
    const transformationStartedAt = performance.now()
    const data = snapshot.snapshot
    const body = buildResponseBody(campusId, 'graph_snapshots', {
      campusName: resolveCampusDisplayName(campusId, data.campusName, data.name),
      buildings: data.buildings ?? [],
      nodes: data.nodes ?? [],
      edges: data.edges ?? [],
      traces: data.traces,
      pois: data.pois,
      boundary: data.boundary ?? null,
      components: data.components,
      doors: data.doors,
      revision: null,
    })
    timings.transform = performance.now() - transformationStartedAt
    return timedJsonResponse(body, 200, requestStartedAt, timings)
  }

  // ── Empty ──
  return timedJsonResponse(
    { campusId, campusName: null, source: 'empty', revision: null, buildings: [], components: [], nodes: [], edges: [], boundary: null },
    200,
    requestStartedAt,
    timings,
  )
}
