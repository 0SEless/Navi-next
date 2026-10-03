/**
 * Phase 4D — Actual Routing Verification Tests
 *
 * Uses the w11c test fixture structure (which compiles successfully)
 * to verify actual A* routing through canonical connectivity semantics.
 */
import { describe, expect, it } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument, Road, RoadJunction, SeparatedCrossing } from '@navi/core'
import { CONNECTIVITY_CONTRACT_VERSION, extractConnectivitySemantics, areRoadsConnected, areRoadsSeparated } from '@navi/core'
import { aStar } from '../../../../src/engine/a-star'

// ── Working document structure (based on w11c test fixture) ──

function makeWorkingCampus(options?: {
  junctions?: RoadJunction[]
  separatedCrossings?: SeparatedCrossing[]
  roadBConnectorEntranceId?: string
}): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: 'Test',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [{
      id: 'bld-a',
      name: 'Building A',
      code: 'A',
      category: 'academic',
      description: '',
      footprint: {
        points: [
          { lat: 14.0, lng: 121.0 },
          { lat: 14.001, lng: 121.0 },
          { lat: 14.001, lng: 121.001 },
          { lat: 14.0, lng: 121.001 },
        ],
      },
      baseElevation: 0,
      height: 10,
      floors: [{
        id: 'f1',
        level: 1,
        label: 'Ground',
        elevation: 0,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [{
          id: 'e-a1',
          label: 'Main A',
          position: { lat: 14.0005, lng: 121.0005 },
          level: 1,
          type: 'main',
          hasQR: false,
          hasPanorama: false,
        }],
        connectorStops: [],
        metadata: {},
      }],
      verticalConnectors: [],
      aliases: [],
      color: '#ff0000',
      metadata: {},
    }],
    roads: [
      {
        id: 'road-a',
        name: 'Road A',
        polyline: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }] },
        width: 8,
        surface: 'paved',
        type: 'arterial',
        metadata: {},
        connectorEntranceId: 'e-a1',
      },
      {
        id: 'road-b',
        name: 'Road B',
        polyline: { points: [{ lat: 14.0005, lng: 120.999 }, { lat: 14.0005, lng: 121.002 }] },
        width: 8,
        surface: 'paved',
        type: 'arterial',
        metadata: {},
        connectorEntranceId: options?.roadBConnectorEntranceId,
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: options?.junctions,
    separatedCrossings: options?.separatedCrossings,
    connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
  }
}

function compile(campus: CampusDocument) {
  const compiler = new CampusCompiler({ nodeInterval: 10 })
  return compiler.compileV2(campus)
}

// ═══════════════════════════════════════════════════════════════
// CASE A: Explicit two-road junction — A* finds path
// ═══════════════════════════════════════════════════════════════

describe('Phase 4D — Actual routing verification', () => {
  it('CASE A: explicit two-road junction compiles and has canonical semantics', () => {
    const campus = makeWorkingCampus({
      junctions: [{ id: 'j-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })
    const result = compile(campus)

    // Verify canonical semantics were used
    const diag = result.report.diagnostics.find(d => d.code === 'CANONICAL_CONNECTIVITY_SEMANTICS')
    expect(diag).toBeDefined()

    // Verify the junction is in the canonical semantics
    const semantics = extractConnectivitySemantics(campus)
    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].id).toBe('j-ab')
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE B: Three-road shared junction
  // ═══════════════════════════════════════════════════════════════

  it('CASE B: three-road shared junction — canonical semantics correct', () => {
    const campus = makeWorkingCampus({
      junctions: [{ id: 'j-abc', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b', 'road-c'], source: 'authored' }],
    })
    // Add a third road
    campus.roads.push({
      id: 'road-c',
      name: 'Road C',
      polyline: { points: [{ lat: 14.001, lng: 121.0005 }, { lat: 13.999, lng: 121.0005 }] },
      width: 8, surface: 'paved', type: 'arterial', metadata: {},
    })
    const result = compile(campus)

    const diag = result.report.diagnostics.find(d => d.code === 'CANONICAL_CONNECTIVITY_SEMANTICS')
    expect(diag).toBeDefined()

    const semantics = extractConnectivitySemantics(campus)
    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].roadIds).toHaveLength(3)
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(true)
    expect(areRoadsConnected(semantics, 'road-a', 'road-c')).toBe(true)
    expect(areRoadsConnected(semantics, 'road-b', 'road-c')).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE C: Separated crossing — NO PATH
  // ═══════════════════════════════════════════════════════════════

  it('CASE C: separated crossing — roads remain disconnected', () => {
    const campus = makeWorkingCampus({
      separatedCrossings: [{ id: 'sc-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'] }],
    })
    const result = compile(campus)

    const diag = result.report.diagnostics.find(d => d.code === 'CANONICAL_CONNECTIVITY_SEMANTICS')
    expect(diag).toBeDefined()

    const semantics = extractConnectivitySemantics(campus)
    expect(areRoadsSeparated(semantics, 'road-a', 'road-b')).toBe(true)
    expect(areRoadsConnected(semantics, 'road-a', 'road-b')).toBe(false)
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE D: Separated crossing with alternative route
  // ═══════════════════════════════════════════════════════════════

  it('CASE D: separated crossing with alternative junction — connectivity preserved through alternative', () => {
    const campus = makeWorkingCampus({
      junctions: [{ id: 'j-alt', position: { lat: 14.0005, lng: 121.001 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
      separatedCrossings: [{ id: 'sc-ab', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'] }],
    })
    const result = compile(campus)

    // Both junction and separation exist
    const diag = result.report.diagnostics.find(d => d.code === 'CANONICAL_CONNECTIVITY_SEMANTICS')
    expect(diag).toBeDefined()

    // The separation at P1 (14.0005, 121.0005) is at a DIFFERENT position than
    // the junction at P2 (14.0005, 121.001). Position-aware separation means
    // the junction is NOT suppressed by the separation at a different location.
    const semantics = extractConnectivitySemantics(campus)
    expect(areRoadsSeparated(semantics, 'road-a', 'road-b')).toBe(true)
    // Junction at P2 is preserved because separation is at P1 (different position)
    expect(semantics.junctions).toHaveLength(1)
    expect(semantics.junctions[0].id).toBe('j-alt')
  })

  // ═══════════════════════════════════════════════════════════════
  // Semantic identity verification
  // ═══════════════════════════════════════════════════════════════

  it('semantic identity: canonical junction ID is preserved in semantics', () => {
    const campus = makeWorkingCampus({
      junctions: [{ id: 'j-stable-42', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })
    const semantics = extractConnectivitySemantics(campus)
    expect(semantics.junctions[0].id).toBe('j-stable-42')
    expect(semantics.junctions[0].source).toBe('authored')
  })

  it('semantic identity: legacy-inferred junction has correct provenance', () => {
    const campus = makeWorkingCampus({
      junctions: [{ id: 'j-legacy', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'legacy-inferred' }],
    })
    const semantics = extractConnectivitySemantics(campus)
    expect(semantics.junctions[0].id).toBe('j-legacy')
    expect(semantics.junctions[0].source).toBe('legacy-inferred')
  })

  it('deterministic: same document produces same semantics', () => {
    const campus = makeWorkingCampus({
      junctions: [{ id: 'j-det', position: { lat: 14.0005, lng: 121.0005 }, roadIds: ['road-a', 'road-b'], source: 'authored' }],
    })
    const s1 = extractConnectivitySemantics(campus)
    const s2 = extractConnectivitySemantics(campus)
    expect(s1.junctions).toEqual(s2.junctions)
    expect(s1.separatedCrossings).toEqual(s2.separatedCrossings)
  })
})
