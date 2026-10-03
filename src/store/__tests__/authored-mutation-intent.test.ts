// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  appendIntent,
  evaluateAuthoredSave,
  intentsIncludedInSave,
  intentsToGuardScopes,
  normalizeIntent,
  type AuthoredMutationIntent,
} from '../authored-mutation-intent'
import type { GuardCollections } from '../../lib/save-safety-guard'

const base: GuardCollections = {
  buildings: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  components: [{ id: 'comp-A0-1', buildingId: 'A', floor: 0 }],
  nodes: [
    { id: 'A-f0-n1', buildingId: 'A', floor: 0 },
    { id: 'B-f0-n1', buildingId: 'B', floor: 0 },
    { id: 'out-1', buildingId: '__outdoor__' },
  ],
  edges: [{ id: 'e-out', from: 'out-1', to: 'out-1' }],
  traces: [{ id: 't-out' }],
  doors: [
    { id: 'd-A-f0-1', buildingId: 'A', floor: 0 },
    { id: 'd-B-f0-1', buildingId: 'B', floor: 0 },
  ],
}

const clone = (): GuardCollections => JSON.parse(JSON.stringify(base)) as GuardCollections
const drop = <T extends { id: string }>(list: T[] | undefined, id: string): T[] =>
  (list ?? []).filter((x) => x.id !== id)

describe('P0.10 authored mutation intent — normalization & accumulation', () => {
  it('outdoor and unowned route intents collapse to outdoor scope; owned scopes keep id+floor', () => {
    expect(normalizeIntent({ kind: 'route', buildingId: '__outdoor__', floor: 0 })).toEqual({ kind: 'outdoor' })
    expect(normalizeIntent({ kind: 'route', buildingId: null })).toEqual({ kind: 'outdoor' })
    expect(normalizeIntent({ kind: 'door', buildingId: 'A', floor: 0 })).toEqual({ kind: 'door', buildingId: 'A', floor: 0 })
  })

  it('duplicate identical scopes are clamped; distinct scopes preserved (no last-wins)', () => {
    let pending: AuthoredMutationIntent[] = []
    pending = appendIntent(pending, { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    pending = appendIntent(pending, { kind: 'door', buildingId: 'A', floor: 0 }, 2)
    pending = appendIntent(pending, { kind: 'route', buildingId: 'A', floor: 0 }, 3)
    pending = appendIntent(pending, { kind: 'building', buildingId: 'B' }, 4)
    expect(pending.map((p) => p.seq)).toEqual([1, 3, 4])
    expect(intentsToGuardScopes(pending)).toEqual([
      { kind: 'door', buildingId: 'A', floor: 0 },
      { kind: 'route', buildingId: 'A', floor: 0 },
      { kind: 'building', buildingId: 'B', floor: null },
    ])
  })

  it('intent retention: intents survive until ack; only acknowledged seqs are cleared', () => {
    let pending: AuthoredMutationIntent[] = []
    pending = appendIntent(pending, { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    pending = appendIntent(pending, { kind: 'route', buildingId: 'A', floor: 0 }, 2)
    // network error / CAS conflict / guard block: caller does not clear
    expect(pending).toHaveLength(2)
    // success that included seq<=1 only: seq-2 intent remains pending
    expect(intentsIncludedInSave(pending, 1).map((p) => p.seq)).toEqual([2])
  })
})

describe('P0.10 save-approval semantics (guard wired via intent scopes)', () => {
  it('TEST A/B: no authored intent ⇒ save refused with zero removals reported (no-load/no-view input)', () => {
    const r = evaluateAuthoredSave(base, clone(), [])
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.removed).toEqual([])
  })

  it('TEST C/D: in-scope authored door delete is allowed', () => {
    const pending = appendIntent([], { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    const candidate = clone()
    candidate.doors = drop(candidate.doors, 'd-A-f0-1')
    expect(evaluateAuthoredSave(base, candidate, pending)).toEqual({ allowed: true })
  })

  it('unrelated Building B door removal is blocked (same-count, wrong scope)', () => {
    const pending = appendIntent([], { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    const candidate = clone()
    candidate.doors = drop(candidate.doors, 'd-B-f0-1')
    const r = evaluateAuthoredSave(base, candidate, pending)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.removed).toEqual([{ type: 'doors', ids: ['d-B-f0-1'] }])
  })

  it('TEST E: indoor route intent allows removing an A/Floor0 route node', () => {
    const pending = appendIntent([], { kind: 'route', buildingId: 'A', floor: 0 }, 1)
    const candidate = clone()
    candidate.nodes = drop(candidate.nodes, 'A-f0-n1')
    expect(evaluateAuthoredSave(base, candidate, pending)).toEqual({ allowed: true })
  })

  it('TEST F: outdoor intent allows removing outdoor node/trace/edge', () => {
    const pending = appendIntent([], { kind: 'outdoor', buildingId: '__outdoor__' }, 1)
    const candidate = clone()
    candidate.nodes = drop(candidate.nodes, 'out-1')
    candidate.traces = drop(candidate.traces, 't-out')
    candidate.edges = drop(candidate.edges, 'e-out')
    expect(evaluateAuthoredSave(base, candidate, pending)).toEqual({ allowed: true })
  })

  it('TEST G: two pending mutations before save — each removal covered by SOME intent (union, no loss)', () => {
    let pending: AuthoredMutationIntent[] = []
    pending = appendIntent(pending, { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    pending = appendIntent(pending, { kind: 'route', buildingId: 'A', floor: 0 }, 2)
    const candidate = clone()
    candidate.doors = drop(candidate.doors, 'd-A-f0-1') // covered by door intent
    candidate.nodes = drop(candidate.nodes, 'A-f0-n1') // covered by route intent
    expect(evaluateAuthoredSave(base, candidate, pending)).toEqual({ allowed: true })
  })

  it('TEST H1: cross-scope pending — deleting Building C (its own intent) is NOT false-blocked by the door intent', () => {
    let pending: AuthoredMutationIntent[] = []
    pending = appendIntent(pending, { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    pending = appendIntent(pending, { kind: 'building', buildingId: 'C' }, 2)
    const candidate = clone()
    candidate.buildings = drop(candidate.buildings, 'C')
    expect(evaluateAuthoredSave(base, candidate, pending)).toEqual({ allowed: true })
  })

  it('TEST H2: cross-scope pending — deleting Building B (no covering intent) is blocked (no broad permission)', () => {
    let pending: AuthoredMutationIntent[] = []
    pending = appendIntent(pending, { kind: 'door', buildingId: 'A', floor: 0 }, 1)
    pending = appendIntent(pending, { kind: 'building', buildingId: 'C' }, 2)
    const candidate = clone()
    candidate.buildings = drop(candidate.buildings, 'B')
    const r = evaluateAuthoredSave(base, candidate, pending)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.removed).toEqual([{ type: 'buildings', ids: ['B'] }])
  })
})
