import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedMutationAuth } from '@/lib/api-guard'

/**
 * POST /api/compile
 *
 * Server-side compilation endpoint.
 * Receives a CampusDocument and delegates to @navi/compiler (which
 * depends on Node built-ins like `crypto` that are unavailable in
 * browser contexts).
 *
 * Uses compileV2 pipeline: normalize → generatePrimitives → connectivity → emit → artifacts
 * This produces a proper navigation graph with road waypoints, hallway skeletons,
 * entrance portals, and door connections.
 *
 * Request body: { document: CampusDocument }
 * Response: { status: 'success' | 'error', artifacts?, stats?, message?, timestamp }
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireVerifiedMutationAuth(request)
  if (unauthorized) return unauthorized
  try {
    const body = await request.json()
    const document = body.document

    if (!document || !document.buildings || !document.metadata) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid document payload', timestamp: Date.now() },
        { status: 400 },
      )
    }

    // Dynamic import — @navi/compiler uses Node crypto/fs, only safe on server
    const { CampusCompiler } = await import('@navi/compiler')
    const compiler = new CampusCompiler()

    // Use compileV2 — the new primitives-based pipeline that produces a navigable graph
    const result = compiler.compileV2(document)

    if (!result.success || !result.graph) {
      return NextResponse.json(
        {
          status: 'error',
          message: result.errors[0]?.message ?? 'Compilation failed',
          errors: result.errors,
          timestamp: Date.now(),
        },
        { status: 500 },
      )
    }

    // compileV2 already builds artifacts internally (searchIndex, buildingIndex, poiIndex, etc.)
    const compiledArtifacts = result.artifacts ?? {}
    return NextResponse.json({
      status: 'success',
      artifacts: {
        ...compiledArtifacts,
        navigationGraph: result.graph,
        searchIndex: result.artifacts?.searchIndex ?? null,
        poiData: result.artifacts?.poiIndex ?? null,
        buildingIndex: result.artifacts?.buildingIndex ?? null,
        spatialIndex: result.artifacts?.spatialIndex ?? null,
        panoramaIndex: result.artifacts?.panoramaIndex ?? null,
        floorGeometry: result.artifacts?.floorGeometry ?? null,
        qrIndex: result.artifacts?.qrIndex ?? null,
        components: result.artifacts?.components ?? [],
        doors: result.artifacts?.doors ?? [],
        metadata: result.artifacts?.metadata ?? null,
      },
      stats: result.stats,
      report: result.report,
      warnings: result.warnings,
      timestamp: Date.now(),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'Internal compilation error',
        timestamp: Date.now(),
      },
      { status: 500 },
    )
  }
}
