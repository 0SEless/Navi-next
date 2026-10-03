import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { normalizeConnectivity } from '../connectivity/normalizer'
import type { PrimitiveGraph, WaypointNode, SkeletonEdge } from '../types'

/** Resolve a package-relative source path under ANY vitest cwd (package dir
 *  or repo root). Deterministic across both run modes. */
function resolveSource(pkg: string, rel: string): string {
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), 'packages', pkg, rel),
  ]
  for (const c of candidates) {
    try {
      readFileSync(c)
      return c
    } catch {
      // try next candidate
    }
  }
  return candidates[0]
}

// P1-T8 (R8.3): compiler defaults must flow from the single definitions
// module. Behavior tests pin the DEFAULTS (no explicit config), symbol tests
// pin that no magic literals remain in the refactored files.

function makeWp(id: string, lat = 14.0, lng = 121.0, sourceEntityId = id): WaypointNode {
  return { id, kind: 'waypoint', position: { lat, lng }, floor: 0, buildingId: 'b1', source: { entityId: sourceEntityId, entityType: 'waypoint', generatorId: 'test' } }
}

function makeSk(id: string, from: string, to: string, distance = 10): SkeletonEdge {
  return { id, kind: 'skeleton', from, to, distance, source: { entityId: id, entityType: 'skeleton', generatorId: 'test' } }
}

function makeGraph(nodes: WaypointNode[], edges: SkeletonEdge[]): PrimitiveGraph {
  return {
    nodes,
    edges,
    metadata: { campusId: 'campus-1', buildingCount: 1, floorCount: 1, generatedAt: 0 },
    diagnostics: [],
  }
}

describe('P1-T8: threshold centralization (R8.3) — compiler side', () => {
  it('normalizer default dedupe threshold reads from definitions (0.5 m behavior)', () => {
    // Two waypoints ~0.2m apart → merged by the DEFAULT (no explicit threshold)
    // Shared authored provenance authorizes identity dedupe; distance decides
    // whether that authorized merge occurs.
    const wp1 = makeWp('wp1', 14.0, 121.0, 'route-a')
    const wp2 = makeWp('wp2', 14.0, 121.000002, 'route-a')
    const merged = normalizeConnectivity(makeGraph([wp1, wp2], [makeSk('sk1', 'wp1', 'wp2', 5)]))
    expect(merged.nodes.length).toBe(1)

    // Two waypoints ~0.9m apart → NOT merged by the same default
    const wp3 = makeWp('wp3', 14.0, 121.0, 'route-b')
    const wp4 = makeWp('wp4', 14.0, 121.00001, 'route-b')
    const kept = normalizeConnectivity(makeGraph([wp3, wp4], [makeSk('sk2', 'wp3', 'wp4', 5)]))
    expect(kept.nodes.length).toBe(2)
  })

  it('no duplicated threshold literals remain in compiler sources (unit symbol check)', () => {
    const campusCompiler = readFileSync(resolveSource('compiler', 'src/pipeline/campus-compiler.ts'), 'utf8')
    const normalizer = readFileSync(resolveSource('compiler', 'src/connectivity/normalizer.ts'), 'utf8')
    const artifactGenerator = readFileSync(resolveSource('compiler', 'src/artifacts/artifact-generator.ts'), 'utf8')

    // The five magic literals (risk R7) must no longer appear where the
    // thresholds are consumed:
    expect(campusCompiler).not.toMatch(/nodeInterval\s*\?\?\s*10\b/)
    expect(campusCompiler).not.toMatch(/mergeThreshold\s*\?\?\s*0\.5\b/)
    expect(campusCompiler).not.toMatch(/maxEntranceRoadDistance\s*\?\?\s*50\b/)
    expect(normalizer).not.toMatch(/mergeThreshold[^=]*=\s*0\.5\b/)
    expect(artifactGenerator).not.toMatch(/< 200\b/)
    expect(artifactGenerator).not.toMatch(/< 50\b/)
  })

  // P1-T17 (group-16 item 9): vertical edge distances come from the single
  // chosen source — the verticalEdgeDistance helper (authored elevation delta,
  // else ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters). No hardcoded
  // 3/4 m literals may remain in either compile path (risk R7).
  it('vertical edge distances flow from the single helper — no hardcoded literals (unit symbol check)', () => {
    const connector = readFileSync(resolveSource('compiler', 'src/primitives/connector.ts'), 'utf8')
    const buildEdgesStage = readFileSync(resolveSource('compiler', 'src/pipeline/stages/build-edges-stage.ts'), 'utf8')

    // Both call sites must delegate to the shared helper…
    expect(connector).toMatch(/verticalEdgeDistance\(/)
    expect(buildEdgesStage).toMatch(/verticalEdgeDistance\(/)
    // …and must not hardcode the old fixed 3/4 m distance/weight literals.
    expect(connector).not.toMatch(/distance:\s*[34]\b/)
    expect(buildEdgesStage).not.toMatch(/distance:\s*4\b/)
    expect(buildEdgesStage).not.toMatch(/weight:\s*4\b/)
  })

  it('definitions module carries the documented vertical fallback constant', () => {
    expect(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters).toBe(4)
  })

  it('definitions module is the same object the compiler defaults resolve to', () => {
    expect(ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters).toBe(0.5)
    expect(ROUTE_NETWORK_THRESHOLDS.nodeIntervalMeters).toBe(10)
    expect(ROUTE_NETWORK_THRESHOLDS.compilerFallbackMeters).toBe(50)
    expect(ROUTE_NETWORK_THRESHOLDS.entranceRoadLinkMeters).toBe(200)
  })
})
