import { expect } from 'vitest'
import { Graph } from '@/engine/graph'
import type { GraphSnapshot } from '@/types/nav-types'

/**
 * Deterministic deep-normalization for semantic comparison:
 * - object keys sorted, `undefined` entries dropped
 * - numbers rounded to 7 decimal places (absorbs double-precision transform
 *   noise: ~1e-7 m distances / ~1e-7 deg coordinates, both sub-centimeter)
 */
export function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(7)) : value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const entry = record[key]
      if (entry !== undefined) out[key] = canonicalize(entry)
    }
    return out
  }
  return value
}

/** Canonical snapshot of a graph/snapshot with the volatile `updatedAt` removed. */
export function canonicalGraphSnapshot(graphOrSnapshot: Graph | GraphSnapshot): unknown {
  const snapshot = (
    graphOrSnapshot instanceof Graph
      ? graphOrSnapshot.toJSON()
      : Graph.fromJSON(graphOrSnapshot).toJSON()
  ) as unknown as Record<string, unknown>
  delete snapshot.updatedAt
  return canonicalize(snapshot)
}

const GENERATED_ID = /^[NE]\d+$/

/**
 * Replaces volatile `genId()` node/edge ids with content-order placeholders so
 * two independent GraphAdapter sync passes can be compared semantically.
 */
export function normalizeGeneratedGraphIds(graph: Graph): unknown {
  const generatedNodeIds = graph.nodes.map((node) => node.id).filter((id) => GENERATED_ID.test(id)).sort()
  const generatedEdgeIds = graph.edges.map((edge) => edge.id).filter((id) => GENERATED_ID.test(id)).sort()
  const nodeMap = new Map(generatedNodeIds.map((id, index) => [id, `N#${index}`]))
  const edgeMap = new Map(generatedEdgeIds.map((id, index) => [id, `E#${index}`]))
  const mapNodeId = (id: string): string => nodeMap.get(id) ?? id

  const nodes = graph.nodes
    .map((node) => ({ ...node, id: mapNodeId(node.id) }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const edges = graph.edges
    .map((edge) => ({
      ...edge,
      id: edgeMap.get(edge.id) ?? edge.id,
      from: mapNodeId(edge.from),
      to: mapNodeId(edge.to),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return canonicalize({ nodes, edges })
}

export function expectPointsClose(
  actual: Array<{ [key: string]: unknown }>,
  expected: Array<{ [key: string]: unknown }>,
  precision = 6,
): void {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    for (const [key, value] of Object.entries(expected[index])) {
      if (typeof value === 'number') {
        expect(actual[index][key] as number).toBeCloseTo(value, precision)
      } else {
        expect(actual[index][key]).toEqual(value)
      }
    }
  }
}
