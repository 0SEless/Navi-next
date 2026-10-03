// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphAdapter } from '../graph-adapter'

/**
 * P0.6 — reconciliation matrix, exercised in isolation from the legacy rebuild:
 * we drive the private reconcile step with a minimal fake graph so the merge
 * contract (scope detection, preservation, dedupe, idempotence) is deterministic.
 */

type Row = { id: string; [k: string]: unknown }
const makeFakeGraph = (init: {
  buildings?: Row[]; components?: Row[]; nodes?: Row[]; edges?: Row[]; traces?: Row[]
}) => {
  let buildings = init.buildings ?? []
  let components = init.components ?? []
  let nodes = init.nodes ?? []
  let edges = init.edges ?? []
  let traces = init.traces ?? []
  return {
    get buildings() { return buildings },
    get components() { return components },
    get nodes() { return nodes },
    get edges() { return edges },
    get traces() { return traces },
    setBuildings(v: Row[]) { buildings = v },
    setComponents(v: Row[]) { components = v },
    setNodes(v: Row[]) { nodes = v },
    setEdges(v: Row[]) { edges = v },
    setTraces(v: Row[]) { traces = v },
  }
}
const doc = (buildingIds: string[], floorsByBuilding: Record<string, number[]>, roads?: unknown) => ({
  buildings: buildingIds.map((id) => ({ id, floors: (floorsByBuilding[id] ?? []).map((level) => ({ level })) })),
  ...(roads !== undefined ? { roads } : {}),
})
const node = (id: string, buildingId?: string, floor?: number): Row => ({ id, buildingId, floor })
const edge = (id: string, from: string, to: string): Row => ({ id, from, to })
const counts = (g: ReturnType<typeof makeFakeGraph>) => ({
  b: g.buildings.length, c: g.components.length, n: g.nodes.length, e: g.edges.length, t: g.traces.length,
})
const dupes = (arr: Row[]) => arr.length - new Set(arr.map((x) => x.id)).size

describe('P0.6 graph-adapter reconciliation matrix (isolated)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('T1: repeated reconciliation (×5) is idempotent — no growth, no duplicates, IDs stable', () => {
    const g = makeFakeGraph({
      buildings: [{ id: 'A' }, { id: 'B' }],
      components: [{ id: 'C-A', buildingId: 'A' }, { id: 'C-B', buildingId: 'B' }],
      nodes: [node('A-f0-n1', 'A', 0), node('B-f0-n1', 'B', 0), node('out-1')],
      edges: [edge('e-A', 'A-f0-n1', 'A-f0-n1'), edge('e-B', 'B-f0-n1', 'B-f0-n1')],
      traces: [{ id: 't-out' }],
    })
    const adapter = new GraphAdapter(g as never, undefined)
    const scoped = doc(['A'], { A: [0] }) // no roads → outdoor not covered
    const recon = (a: GraphAdapter, d: unknown) => (a as unknown as { reconcileCanonicalCollections: (p: unknown, doc: unknown) => void }).reconcileCanonicalCollections({
      buildings: g.buildings.slice(), components: g.components.slice(), nodes: g.nodes.slice(), edges: g.edges.slice(), traces: g.traces.slice(),
    }, d)
    recon(adapter, scoped)
    const after1 = counts(g)
    for (let i = 0; i < 4; i++) recon(adapter, scoped)
    expect(counts(g)).toEqual(after1)
    expect(dupes(g.buildings) + dupes(g.components) + dupes(g.nodes) + dupes(g.edges) + dupes(g.traces)).toBe(0)
    expect(g.buildings.map((b) => b.id)).toEqual(['A', 'B'])
  })

  it('T2/T5: scoped document (no roads) preserves Building B and ALL outdoor entities verbatim', () => {
    const g = makeFakeGraph({
      buildings: [{ id: 'A' }, { id: 'B' }],
      components: [{ id: 'C-B', buildingId: 'B' }],
      nodes: [node('A-f0-n1', 'A', 0), node('A-f1-n1', 'A', 1), node('B-f0-n1', 'B', 0), node('out-1'), node('out-2')],
      edges: [edge('e-B', 'B-f0-n1', 'B-f0-n1'), edge('e-out', 'out-1', 'out-2')],
      traces: [{ id: 't-out' }],
    })
    const adapter = new GraphAdapter(g as never, undefined)
    const recon = (d: unknown) => (adapter as unknown as { reconcileCanonicalCollections: (p: unknown, doc: unknown) => void }).reconcileCanonicalCollections({
      buildings: g.buildings.slice(), components: g.components.slice(), nodes: g.nodes.slice(), edges: g.edges.slice(), traces: g.traces.slice(),
    }, d)
    recon(doc(['A'], { A: [0] }))
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['A-f0-n1', 'A-f1-n1', 'B-f0-n1', 'out-1', 'out-2'])
    expect(g.edges.map((e) => e.id).sort()).toEqual(['e-B', 'e-out'])
    expect(g.traces.map((t) => t.id)).toEqual(['t-out'])
    expect(g.buildings.map((b) => b.id)).toEqual(['A', 'B'])
  })

  it('T4: outdoor IS covered when document.roads is an Array — absent rebuilt outdoor not resurrected', () => {
    const g = makeFakeGraph({ nodes: [node('out-1')], edges: [], traces: [], buildings: [], components: [] })
    g.setNodes([]) // rebuild removed outdoor
    const adapter = new GraphAdapter(g as never, undefined)
    ;(adapter as unknown as { reconcileCanonicalCollections: (p: unknown, doc: unknown) => void }).reconcileCanonicalCollections({
      buildings: [], components: [], nodes: [node('out-1')], edges: [], traces: [],
    }, doc([], {}, []))
    expect(g.nodes.length).toBe(0) // covered ⇒ deletion stands
  })

  it('T6: explicit in-scope delete stands (absent from rebuild, scope covered => not re-added)', () => {
    const g = makeFakeGraph({ nodes: [], edges: [], buildings: [{ id: 'A' }], components: [], traces: [] })
    const adapter = new GraphAdapter(g as never, undefined)
    ;(adapter as unknown as { reconcileCanonicalCollections: (p: unknown, doc: unknown) => void }).reconcileCanonicalCollections({
      buildings: [{ id: 'A' }], components: [], nodes: [node('A-f0-gone', 'A', 0)], edges: [], traces: [],
    }, doc(['A'], { A: [0] }))
    expect(g.nodes.length).toBe(0)
  })

  it('T7: rebuilt entity with same canonical id is not duplicated', () => {
    const g = makeFakeGraph({ nodes: [node('A-f0-n1', 'A', 0)], edges: [], buildings: [{ id: 'A' }], components: [], traces: [] })
    const adapter = new GraphAdapter(g as never, undefined)
    ;(adapter as unknown as { reconcileCanonicalCollections: (p: unknown, doc: unknown) => void }).reconcileCanonicalCollections({
      buildings: [{ id: 'A' }], components: [], nodes: [node('A-f0-n1', 'A', 0)], edges: [], traces: [],
    }, doc(['A'], { A: [0] }))
    expect(g.nodes.filter((n) => n.id === 'A-f0-n1').length).toBe(1)
  })

  it('T10: dangling rebuilt edge emits an explicit diagnostic and is not silently duplicated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const g = makeFakeGraph({ nodes: [node('n1')], edges: [edge('e-bad', 'n1', 'missing')], buildings: [], components: [], traces: [] })
    const adapter = new GraphAdapter(g as never, undefined)
    ;(adapter as unknown as { reconcileCanonicalCollections: (p: unknown, doc: unknown) => void }).reconcileCanonicalCollections({
      buildings: [], components: [], nodes: [], edges: [], traces: [],
    }, doc([], {}, []))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dangling edge after reconciliation'))
  })
})
