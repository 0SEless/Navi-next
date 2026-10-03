import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { ROAD_SNAP_RADIUS_METERS } from '../road-snap'

/** Resolve a package-relative source path under ANY vitest cwd (package dir
 *  or repo root). Deterministic across both run modes. */
function resolveSource(rel: string): string {
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), 'packages', 'editor', rel),
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

// P1-T8 (R8.3): thresholds are owned by the route network (core definitions
// module). The editor must read them from there — never re-declare literals.

describe('P1-T8: threshold centralization (R8.3) — editor side', () => {
  it('road snap radius reads from the single definitions module (import identity)', () => {
    expect(ROAD_SNAP_RADIUS_METERS).toBe(ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters)
  })

  it('no duplicated 5 m snap literal remains in road-snap.ts (unit symbol check)', () => {
    const src = readFileSync(resolveSource('src/commands/road-snap.ts'), 'utf8')
    expect(src).not.toMatch(/ROAD_SNAP_RADIUS_METERS\s*=\s*5\b/)
  })
})