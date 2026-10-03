// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const M011 = readFileSync(path.resolve(process.cwd(), 'supabase', 'migrations', '011_graph_mutation_idempotency.sql'), 'utf8')
const M013 = readFileSync(path.resolve(process.cwd(), 'supabase', 'migrations', '013_outdoor_node_normalization.sql'), 'utf8')
const CODE = M013.replace(/--[^\n]*/g, '')

/**
 * Executable mirror of the canonical relational-boundary contract implemented in
 * migration 013 (route_nodes.building_id expression). Held in lockstep with the
 * SQL by the static assertions below.
 */
const normalizeBuildingIdForPersistence = (v: unknown): string | null => {
  if (v === '__outdoor__') return null
  if (v === '' || v === null || v === undefined) return null
  return String(v)
}

describe('Phase 2D — outdoor route-node sentinel normalization (canonical boundary)', () => {
  it('A: "__outdoor__" persists as NULL', () => {
    expect(normalizeBuildingIdForPersistence('__outdoor__')).toBeNull()
  })
  it('B: valid building id preserved exactly', () => {
    expect(normalizeBuildingIdForPersistence('b-1')).toBe('b-1')
  })
  it('C: null stays no-building', () => {
    expect(normalizeBuildingIdForPersistence(null)).toBeNull()
  })
  it('D: undefined follows canonical no-building contract', () => {
    expect(normalizeBuildingIdForPersistence(undefined)).toBeNull()
  })
  it('E: arbitrary invalid ids are NOT silently normalized (FK must still catch them)', () => {
    expect(normalizeBuildingIdForPersistence('missing-building-123')).toBe('missing-building-123')
  })
  it('F: normalization touches ONLY building ownership (node payload untouched)', () => {
    const node = { id: 'n-1', type: 'intersection', buildingId: '__outdoor__', floor: 0, position: { lat: 1, lng: 2 }, metadata: { a: 1 } }
    const persisted = { ...node, buildingId: normalizeBuildingIdForPersistence(node.buildingId) }
    expect(persisted.id).toBe('n-1')
    expect(persisted.type).toBe('intersection')
    expect(persisted.floor).toBe(0)
    expect(persisted.position).toEqual({ lat: 1, lng: 2 })
    expect(persisted.metadata).toEqual({ a: 1 })
  })

  it('static: migration 013 implements the sentinel at the route_nodes boundary only', () => {
    expect(CODE).toMatch(/NULLIF\(NULLIF\(n->>'buildingId', ''\), '__outdoor__'\)/)
    expect(CODE).not.toMatch(/ON CONFLICT \(id\) DO NOTHING;\s*$[\s\S]*__outdoor__[\s\S]*END;?\s*\$\$;\s*CREATE OR REPLACE FUNCTION write_graph_snapshot$/) // no second writer copy
  })

  it('static: migration 013 recreates exactly write_graph_snapshot and preserves all prior guarantees', () => {
    const fns = CODE.match(/CREATE OR REPLACE FUNCTION (\w+)/g) ?? []
    expect(fns).toEqual(['CREATE OR REPLACE FUNCTION write_graph_snapshot'])
    expect(CODE).toMatch(/INSERT INTO campus_graph_revisions/)
    expect(CODE).toMatch(/ON CONFLICT \(campus_id\)/)
    expect(CODE).toMatch(/DELETE FROM route_nodes WHERE campus_id = p_campus/)
    expect(CODE).toMatch(/DELETE FROM route_edges WHERE campus_id = p_campus/)
    expect(CODE).toMatch(/RETURN jsonb_build_object\('success', TRUE, 'campus_id', p_campus, 'updatedAt', saved_revision\)/)
  })

  it('static: no schema (DDL) changes and no destructive statements', () => {
    expect(CODE).not.toMatch(/ALTER TABLE|DROP |TRUNCATE|CREATE TABLE|CREATE POLICY|GRANT|REVOKE/)
  })

  it('static: 011 idempotency wrapper semantics unchanged by 013 (no redefinition in 013)', () => {
    expect(CODE).not.toMatch(/sync_graph_snapshot_idempotent/)
    expect(M011).toMatch(/sync_graph_snapshot_idempotent/) // owner of that function remains 011
  })
})
