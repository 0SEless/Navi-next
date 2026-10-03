/**
 * Phase 5 — Campus ID Contract
 *
 * Proves that CampusDocument.metadata.campusId is the authoritative campus
 * identity through Compiler V2 and its generated navigation artifacts.
 *
 * metadata.campusId = identity
 * metadata.name = display
 *
 * They must not be interchangeable.
 */
import { describe, expect, it } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import type { CampusDocument, RoadJunction } from '@navi/core'
import { CONNECTIVITY_CONTRACT_VERSION } from '@navi/core'

// ── Helper ──

function makeCampus(opts: {
  campusId: string
  name: string
  junctions?: RoadJunction[]
}): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: opts.campusId,
      name: opts.name,
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
          label: 'Main',
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
    roads: [{
      id: 'road-a',
      name: 'Road A',
      polyline: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.001 }] },
      width: 8,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    }],
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: opts.junctions,
    separatedCrossings: [],
    connectivitySemanticsVersion: CONNECTIVITY_CONTRACT_VERSION,
  }
}

function compile(campus: CampusDocument) {
  const compiler = new CampusCompiler({ nodeInterval: 10 })
  return compiler.compileV2(campus)
}

// ═══════════════════════════════════════════════════════════════
// CASE 1: Campus ID Preservation
// ═══════════════════════════════════════════════════════════════

describe('Phase 5 — Campus ID contract', () => {
  it('CASE 1: campus ID preserved through compilation', () => {
    const campus = makeCampus({ campusId: 'campus-123', name: 'Test Campus' })
    const result = compile(campus)
    expect(result.graph).not.toBeNull()

    // Navigation graph must carry campusId, not name
    expect(result.graph!.campusId).toBe('campus-123')
    expect(result.graph!.campusId).not.toBe('Test Campus')
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE 2: Name is not identity
  // ═══════════════════════════════════════════════════════════════

  it('CASE 2: name change preserves campus identity', () => {
    const campus1 = makeCampus({ campusId: 'campus-123', name: 'Original Name' })
    const campus2 = makeCampus({ campusId: 'campus-123', name: 'Renamed Campus' })

    const result1 = compile(campus1)
    const result2 = compile(campus2)

    expect(result1.graph).not.toBeNull()
    expect(result2.graph).not.toBeNull()

    // Both must have the same campus identity
    expect(result1.graph!.campusId).toBe('campus-123')
    expect(result2.graph!.campusId).toBe('campus-123')
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE 3: Different IDs, same name
  // ═══════════════════════════════════════════════════════════════

  it('CASE 3: different IDs with same name remain distinct', () => {
    const campusA = makeCampus({ campusId: 'campus-a', name: 'Campus' })
    const campusB = makeCampus({ campusId: 'campus-b', name: 'Campus' })

    const resultA = compile(campusA)
    const resultB = compile(campusB)

    expect(resultA.graph).not.toBeNull()
    expect(resultB.graph).not.toBeNull()

    // Identity must be distinct
    expect(resultA.graph!.campusId).toBe('campus-a')
    expect(resultB.graph!.campusId).toBe('campus-b')
    expect(resultA.graph!.campusId).not.toBe(resultB.graph!.campusId)
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE 4: Realistic NAVI ID
  // ═══════════════════════════════════════════════════════════════

  it('CASE 4: realistic NAVI ID survives compilation', () => {
    const realisticId = 'map-map-1-k6bv'
    const campus = makeCampus({ campusId: realisticId, name: 'ASU Ibajay Campus' })
    const result = compile(campus)

    expect(result.graph).not.toBeNull()
    expect(result.graph!.campusId).toBe(realisticId)
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE 5: Compiler artifact consistency
  // ═══════════════════════════════════════════════════════════════

  it('CASE 5: all artifact campus identity fields agree', () => {
    const campus = makeCampus({ campusId: 'campus-xyz', name: 'Display Name' })
    const result = compile(campus)

    expect(result.graph).not.toBeNull()
    expect(result.artifacts).not.toBeNull()

    // Graph campusId
    expect(result.graph!.campusId).toBe('campus-xyz')

    // Floor geometry campusId (reads document.metadata.campusId directly)
    const fg = result.artifacts!.floorGeometry
    expect(fg).toBeDefined()
    expect(fg!.campusId).toBe('campus-xyz')

    // QR index campusId (reads document.metadata.campusId directly)
    const qr = result.artifacts!.qrIndex
    if (qr) {
      expect(qr.campusId).toBe('campus-xyz')
    }

    // All must agree
    expect(result.graph!.campusId).toBe(fg!.campusId)
  })

  // ═══════════════════════════════════════════════════════════════
  // CASE 6: Repeated compilation is deterministic
  // ═══════════════════════════════════════════════════════════════

  it('CASE 6: repeated compilation is deterministic', () => {
    const campus = makeCampus({ campusId: 'campus-det', name: 'Deterministic' })

    const results = Array.from({ length: 3 }, () => compile(campus))

    for (const r of results) {
      expect(r.graph).not.toBeNull()
      expect(r.graph!.campusId).toBe('campus-det')
    }
  })
})
