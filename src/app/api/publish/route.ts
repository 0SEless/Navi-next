import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { createServerClient } from '@supabase/ssr'
import { MANIFEST_SCHEMA_VERSION, MANIFEST_FORMAT_VERSION } from '@navi/core'
import { validateNavigationArtifacts } from '@navi/compiler'
import { writePublishedMap, type PublishedMapRow } from '@/services/published-map-writer'
import { assertCampusMutationAllowed, requireVerifiedMutationAuth } from '@/lib/api-guard'

const DEMO_DIR = join(process.cwd(), 'demo-output')

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

async function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRevision(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value)
  return null
}

function graphHasNodesOrEdges(value: unknown): boolean {
  if (!isRecord(value)) return false
  const graph = isRecord(value.graph)
    ? value.graph
    : isRecord(value.navigationGraph)
      ? value.navigationGraph
      : null
  if (!graph) return false
  return (
    (Array.isArray(graph.nodes) && graph.nodes.length > 0) ||
    (Array.isArray(graph.edges) && graph.edges.length > 0)
  )
}

function graphIsEmpty(value: unknown): boolean {
  if (!isRecord(value)) return false
  const graph = isRecord(value.navigationGraph) ? value.navigationGraph : null
  if (!graph) return false
  return (
    Array.isArray(graph.nodes) &&
    Array.isArray(graph.edges) &&
    graph.nodes.length === 0 &&
    graph.edges.length === 0
  )
}

interface PublishArtifactsPayload {
  navigationGraph?: Record<string, unknown>
  searchIndex?: unknown
  poiData?: unknown
  buildingIndex?: unknown
  spatialIndex?: unknown
  panoramaIndex?: unknown
  floorGeometry?: unknown
  qrIndex?: unknown
  components?: unknown
  doors?: unknown
  metadata?: unknown
  [key: string]: unknown
}

interface PublishRequestBody {
  artifacts?: PublishArtifactsPayload
  campusId?: unknown
  revision?: unknown
  validationIssues?: unknown
  diagnostics?: unknown
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireVerifiedMutationAuth(request)
    if (unauthorized) return unauthorized

    const { artifacts, campusId, revision, validationIssues, diagnostics } =
      await request.json() as PublishRequestBody
    if (!artifacts || !artifacts.navigationGraph) {
      return NextResponse.json({ success: false, message: 'Missing artifacts' }, { status: 400 })
    }

    if (!campusId) {
      return NextResponse.json({ success: false, message: 'Missing campusId' }, { status: 400 })
    }

    // Validate campusId format (non-empty string)
    if (typeof campusId !== 'string' || campusId.trim() === '') {
      return NextResponse.json({ success: false, message: 'Invalid campusId: must be a non-empty string' }, { status: 400 })
    }

    const blocked = assertCampusMutationAllowed(campusId)
    if (blocked) return blocked

    // ── Atomic Publish Gate: reject if blocking validation issues exist ──
    const issues = validationIssues || diagnostics
    if (issues && Array.isArray(issues)) {
      const blocking = issues
        .filter(isRecord)
        .filter(issue => issue.severity === 'error')
      if (blocking.length > 0) {
        return NextResponse.json({
          success: false,
          status: 422,
          message: `Publish blocked: ${blocking.length} validation error(s) detected`,
          diagnostics: blocking,
        }, { status: 422 })
      }
    }


    const artifactMetadata = isRecord(artifacts.metadata) ? artifacts.metadata : {}
    const sourceRevisionRaw = artifactMetadata.sourceDocumentVersion ?? artifactMetadata.revision
    const sourceRevision = sourceRevisionRaw === undefined ? null : parseRevision(sourceRevisionRaw)
    if (sourceRevisionRaw !== undefined && sourceRevision === null) {
      return NextResponse.json({
        success: false,
        message: 'Invalid artifact source revision',
      }, { status: 400 })
    }

    const requestRevision = revision === undefined || revision === null
      ? sourceRevision ?? 1
      : parseRevision(revision)
    if (requestRevision === null) {
      return NextResponse.json({
        success: false,
        message: 'Invalid revision: must be a non-negative integer',
      }, { status: 400 })
    }
    if (sourceRevision !== null && requestRevision !== sourceRevision) {
      return NextResponse.json({
        success: false,
        message: 'Revision does not match compiler source provenance',
        sourceDocumentVersion: String(sourceRevision),
        revision: requestRevision,
      }, { status: 400 })
    }
    if (typeof artifactMetadata.campusId === 'string' && artifactMetadata.campusId !== campusId) {
      return NextResponse.json({
        success: false,
        message: 'Campus identity does not match compiler source provenance',
      }, { status: 400 })
    }

    // ── Phase 8B: validate the newly generated artifact before any write ──
    const artifactValidation = validateNavigationArtifacts({
      graph: artifacts.navigationGraph,
      buildingIndex: artifacts.buildingIndex,
      metadata: artifacts.metadata,
      components: artifacts.components,
      doors: artifacts.doors,
      floorGeometry: artifacts.floorGeometry,
      panoramaIndex: artifacts.panoramaIndex,
      qrIndex: artifacts.qrIndex,
    })
    if (!artifactValidation.valid) {
      return NextResponse.json({
        success: false,
        message: 'Publish blocked: ' + artifactValidation.errors.length + ' artifact validation error(s) detected',
        diagnostics: artifactValidation.errors,
        warnings: artifactValidation.warnings,
      }, { status: 422 })
    }

    const compilerVersion = typeof artifactMetadata.compilerVersion === 'string' && artifactMetadata.compilerVersion.length > 0
      ? artifactMetadata.compilerVersion
      : typeof artifacts.navigationGraph?.version === 'string'
        ? artifacts.navigationGraph.version
        : '1.0.0'
    const compiledAt = typeof artifactMetadata.compiledAt === 'string' && artifactMetadata.compiledAt.length > 0
      ? artifactMetadata.compiledAt
      : typeof artifacts.navigationGraph?.createdAt === 'string'
        ? artifacts.navigationGraph.createdAt
        : new Date().toISOString()
    const artifactsBlob = {
      graph: artifacts.navigationGraph,
      searchIndex: artifacts.searchIndex ?? { version: '1.0.0', entries: [] },
      buildingIndex: artifacts.buildingIndex ?? { version: '1.0.0', buildings: [] },
      poiIndex: artifacts.poiData ?? { version: '1.0.0', points: [] },
      spatialIndex: artifacts.spatialIndex ?? null,
      panoramaIndex: artifacts.panoramaIndex ?? null,
      floorGeometry: artifacts.floorGeometry ?? null,
      qrIndex: artifacts.qrIndex ?? null,
      components: Array.isArray(artifacts.components) ? artifacts.components : [],
      doors: Array.isArray(artifacts.doors) ? artifacts.doors : [],
      metadata: {
        ...artifactMetadata,
        campusId,
        ...(typeof artifactMetadata.connectivitySemanticsVersion === 'string'
          ? { connectivitySemanticsVersion: artifactMetadata.connectivitySemanticsVersion }
          : {}),
        compilerVersion,
        revision: String(requestRevision),
        sourceDocumentVersion: String(sourceRevision ?? requestRevision),
        compiledAt,
      },
    }

    // ── 1. Write to Supabase published_maps (primary store) ──
    let supabaseSuccess = false
    let supabaseError: string | null = null
    try {
      const supabase = await getSupabaseClient()
      if (supabase) {
        if (graphIsEmpty(artifacts)) {
          const currentResult = await supabase
            .from('published_maps')
            .select('revision,artifacts')
            .eq('campus_id', campusId)
            .maybeSingle() as unknown as {
              data: { artifacts?: unknown } | null
              error: { message: string } | null
            }
          if (currentResult.error) {
            return NextResponse.json({
              success: false,
              message: 'Unable to verify the current publication before empty replacement',
            }, { status: 503 })
          }
          if (graphHasNodesOrEdges(currentResult.data?.artifacts)) {
            return NextResponse.json({
              success: false,
              message: 'Publish blocked: an empty artifact cannot replace a non-empty publication',
              diagnostics: [{
                code: 'ARTIFACT_EMPTY_GRAPH_REPLACEMENT',
                message: 'Normal Publish cannot clear an existing non-empty campus publication',
              }],
            }, { status: 422 })
          }
        }
        const row: PublishedMapRow = {
          campus_id: campusId,
          revision: requestRevision,
          compiler_version: compilerVersion,
          artifacts: artifactsBlob,
          published_at: new Date().toISOString(),
        }
        const result = await writePublishedMap(supabase, row)
        if (result.status === 'rejected') {
          return NextResponse.json({
            success: false,
            message: 'Publish rejected: revision ' + requestRevision + ' is older than current revision ' + result.currentRevision,
            revision: requestRevision,
            currentRevision: result.currentRevision,
          }, { status: 409 })
        }
        if (result.status === 'error') {
          supabaseError = result.message
          console.error('[publish] Supabase write failed:', result.message)
        } else {
          supabaseSuccess = true
          console.log('[publish] Published to Supabase: campus=' + campusId + ', revision=' + requestRevision)
        }
      } else {
        supabaseError = 'Supabase credentials not configured'
        console.warn('[publish] Supabase credentials not configured, skipping Supabase write')
      }
    } catch (e) {
      supabaseError = (e as Error).message
      console.error('[publish] Supabase write error:', e)
    }

    // ── 2. Write to local disk (backup for dev/demo) ──
    if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true })

    const files: Record<string, string> = {
      'navigation.graph.json': JSON.stringify(artifacts.navigationGraph, null, 2),
      'search.index.json': JSON.stringify(artifacts.searchIndex ?? null, null, 2),
      'poi.json': JSON.stringify(artifacts.poiData ?? null, null, 2),
      'building-index.json': JSON.stringify(artifacts.buildingIndex ?? null, null, 2),
      'spatial-index.json': JSON.stringify(artifacts.spatialIndex ?? null, null, 2),
      'panorama-index.json': JSON.stringify(artifacts.panoramaIndex ?? null, null, 2),
      'floor-geometry.json': JSON.stringify(artifacts.floorGeometry ?? null, null, 2),
      'qr-index.json': JSON.stringify(artifacts.qrIndex ?? null, null, 2),
      'components.json': JSON.stringify(artifacts.components ?? [], null, 2),
      'doors.json': JSON.stringify(artifacts.doors ?? [], null, 2),
    }

    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(join(DEMO_DIR, filename), content)
    }

    // Checksums computed from the exact bytes written to disk (see ERRORS.md 2026-07-08).
    const publishedGraph = artifacts.navigationGraph ?? {}
    const publishedNodeCount = Array.isArray(publishedGraph.nodes) ? publishedGraph.nodes.length : 0
    const publishedEdgeCount = Array.isArray(publishedGraph.edges) ? publishedGraph.edges.length : 0
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      formatVersion: MANIFEST_FORMAT_VERSION,
      campusId: campusId,
      campusName: campusId,
      publishedAt: new Date().toISOString(),
      compilerVersion: compilerVersion,
      revision: String(requestRevision),
      artifacts: {
        graph: { path: 'navigation.graph.json', checksum: sha256(files['navigation.graph.json']), size: Buffer.byteLength(files['navigation.graph.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        search: { path: 'search.index.json', checksum: sha256(files['search.index.json']), size: Buffer.byteLength(files['search.index.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        poi: { path: 'poi.json', checksum: sha256(files['poi.json']), size: Buffer.byteLength(files['poi.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        buildings: { path: 'building-index.json', checksum: sha256(files['building-index.json']), size: Buffer.byteLength(files['building-index.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        spatial: { path: 'spatial-index.json', checksum: sha256(files['spatial-index.json']), size: Buffer.byteLength(files['spatial-index.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        panorama: { path: 'panorama-index.json', checksum: sha256(files['panorama-index.json']), size: Buffer.byteLength(files['panorama-index.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        floorGeometry: { path: 'floor-geometry.json', checksum: sha256(files['floor-geometry.json']), size: Buffer.byteLength(files['floor-geometry.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
        qrIndex: { path: 'qr-index.json', checksum: sha256(files['qr-index.json']), size: Buffer.byteLength(files['qr-index.json'], 'utf-8'), schemaVersion: '1.0.0', formatVersion: '0' },
      },
      metadata: {
        nodeCount: publishedNodeCount,
        edgeCount: publishedEdgeCount,
        buildingCount: 0,
        floorCount: 0,
        boundingBox: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 },
        routeable: true,
      },
    }

    writeFileSync(join(DEMO_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

    return NextResponse.json({
      success: true,
      supabase: supabaseSuccess ? 'written' : 'skipped',
      supabaseError,
      manifest,
      counts: {
        nodes: publishedNodeCount,
        edges: publishedEdgeCount,
      },
    })
  } catch (err) {
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 })
  }
}
