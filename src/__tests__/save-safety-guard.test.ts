// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { guardCrossScopeDestruction, type GuardCollections, type GuardScope } from '../lib/save-safety-guard'

const prev: GuardCollections = {
  buildings: [{ id: 'A' }, { id: 'B' }],
  components: [{ id: 'c-A', buildingId: 'A' }, { id: 'c-B', buildingId: 'B' }],
  nodes: [
    { id: 'A-f0-n1', buildingId: 'A', floor: 0 },
    { id: 'A-f0-n2', buildingId: 'A', floor: 0 },
    { id: 'B-f0-n1', buildingId: 'B', floor: 0 },
    { id: 'out-1', buildingId: '__outdoor__' },
    { id: 'out-2', buildingId: '__outdoor__' },
  ],
  edges: [
    { id: 'e-A-f0', from: 'A-f0-n1', to: 'A-f0-n2' },
    { id: 'e-B-f0', from: 'B-f0-n1', to: 'B-f0-n1' },
    { id: 'e-out', from: 'out-1', to: 'out-2' },
  ],
  traces: [{ id: 't-out' }],
  doors: [
    { id: 'd-A-f0-1', buildingId: 'A', floor: 0 },
    { id: 'd-B-f0-1', buildingId: 'B', floor: 0 },
  ],
}
const clone = (x: GuardCollections): GuardCollections => JSON.parse(JSON.stringify(x))
const drop = (x: GuardCollections, type: keyof GuardCollections, id: string) => {
  const c = clone(x)
  c[type] = (c[type] ?? []).filter((e) => e.id !== id)
  return c
}
const A_F0_DOOR: GuardScope = { kind: 'door', buildingId: 'A', floor: 0 }
const A_F0_ROUTE: GuardScope = { kind: 'route', buildingId: 'A', floor: 0 }
const OUTDOOR_SCOPE: GuardScope = { kind: 'outdoor' }
const VIEW: GuardScope = { kind: 'view' }

describe('P0.8 cross-scope destructive-save guard', () => {
  it('A: door edit in A/F0 with only intended delta is allowed', () => {
    const cand = clone(prev)
    cand.doors![0] = { ...cand.doors![0], id: 'd-A-f0-1' } // same id (updated content)
    expect(guardCrossScopeDestruction(prev, cand, A_F0_DOOR)).toEqual({ allowed: true })
  })
  it('B: explicit in-scope door DELETE is allowed', () => {
    expect(guardCrossScopeDestruction(prev, drop(prev, 'doors', 'd-A-f0-1'), A_F0_DOOR)).toEqual({ allowed: true })
  })
  it('C: door edit candidate missing a Building-B door is BLOCKED', () => {
    const r = guardCrossScopeDestruction(prev, drop(prev, 'doors', 'd-B-f0-1'), A_F0_DOOR)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toContain('d-B-f0-1')
  })
  it('D: route edit in A/F0 with in-scope route delta is allowed', () => {
    const cand = drop(prev, 'edges', 'e-A-f0')
    cand.nodes = cand.nodes!.filter((n) => n.id !== 'A-f0-n2')
    expect(guardCrossScopeDestruction(prev, cand, A_F0_ROUTE)).toEqual({ allowed: true })
  })
  it('E: route edit candidate missing the outdoor network is BLOCKED', () => {
    const r = guardCrossScopeDestruction(prev, drop(prev, 'edges', 'e-out'), A_F0_ROUTE)
    expect(r.allowed).toBe(false)
  })
  it('F: explicit in-scope route delete (whole A/F0 edge) is allowed', () => {
    expect(guardCrossScopeDestruction(prev, drop(prev, 'edges', 'e-A-f0'), A_F0_ROUTE)).toEqual({ allowed: true })
  })
  it('G: view-only candidate that changes the graph is BLOCKED (any removal)', () => {
    const r = guardCrossScopeDestruction(prev, drop(prev, 'nodes', 'out-1'), VIEW)
    expect(r.allowed).toBe(false)
  })
  it('H: identity-based, NOT count-only — same-count unrelated swap is BLOCKED', () => {
    const cand = drop(prev, 'doors', 'd-B-f0-1')
    cand.doors = [...(cand.doors ?? []), { id: 'd-C-f0-new', buildingId: 'A', floor: 0 }] // count restored!
    const r = guardCrossScopeDestruction(prev, cand, A_F0_DOOR)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toContain('d-B-f0-1')
  })
  it('outdoor-scope edit may remove outdoor entities but NOT indoor', () => {
    const okOutdoor = drop(prev, 'traces', 't-out')
    expect(guardCrossScopeDestruction(prev, okOutdoor, OUTDOOR_SCOPE)).toEqual({ allowed: true })
    const badIndoor = drop(prev, 'nodes', 'A-f0-n1')
    expect(guardCrossScopeDestruction(prev, badIndoor, OUTDOOR_SCOPE).allowed).toBe(false)
  })
  it('diagnostic reason includes mutation kind, scope and removed ids', () => {
    const r = guardCrossScopeDestruction(prev, drop(prev, 'buildings', 'B'), A_F0_DOOR)
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.reason).toContain('mutation=door')
      expect(r.reason).toContain('@A#f0')
      expect(r.reason).toContain('buildings[B]')
    }
  })

  it('notifies the evaluator once for each rejected entity without changing the guard result', () => {
    const manyDoors: GuardCollections = {
      doors: Array.from({ length: 12 }, (_, index) => ({
        id: `private-door-${index}`,
        buildingId: 'B',
        floor: 0,
      })),
    }
    const observedKinds: Array<keyof GuardCollections> = []

    const result = guardCrossScopeDestruction(
      manyDoors,
      { doors: [] },
      A_F0_DOOR,
      (kind) => observedKinds.push(kind),
    )

    expect(result.allowed).toBe(false)
    expect(result.allowed ? [] : result.removed[0]?.ids).toHaveLength(10)
    expect(observedKinds).toEqual(Array.from({ length: 12 }, () => 'doors'))
  })
})
