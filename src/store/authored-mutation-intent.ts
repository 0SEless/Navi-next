/**
 * P0.10 — Authored mutation intent (the missing save-guard input).
 *
 * Captures WHAT persistent mutation is pending so the save entry can:
 *   - refuse to save when there is no authored intent (no-save-on-load/view), and
 *   - feed `guardCrossScopeDestruction` with a real `{kind, scope}` per scope.
 *
 * Pure module: no side effects, no store coupling. The store wires this in by
 * calling `recordIntent` from authored command boundaries, `clearIntents` only
 * after an authoritative save acknowledgment, and `intentsToGitGuardScopes`
 * before the network write.
 */
import {
  guardCrossScopeDestruction,
  type GuardCollections,
  type GuardRejectedRemovalObserver,
  type GuardScope,
} from '../lib/save-safety-guard'

export type AuthoredMutationKind = GuardScope['kind'] // view | door | route | poi | building | floor | outdoor

export type AuthoredMutationIntent = {
  kind: Exclude<AuthoredMutationKind, 'view'>
  buildingId?: string | null
  floor?: number | null
  /** Monotonic sequence for deterministic ordering/clearing. */
  seq: number
}

const OUTDOOR = '__outdoor__'

/** Outdoor scoped intents (no building / sentinel) collapse to a single 'outdoor' intent. */
export function normalizeIntent(input: {
  kind: AuthoredMutationIntent['kind']
  buildingId?: string | null
  floor?: number | null
}): { kind: AuthoredMutationIntent['kind']; buildingId?: string | null; floor?: number | null } {
  const isOutdoorRoute =
    input.kind === 'route' && (input.buildingId === OUTDOOR || input.buildingId === null || input.buildingId === undefined)
  if (input.kind === 'outdoor' || isOutdoorRoute) return { kind: 'outdoor' }
  if (input.buildingId === null || input.buildingId === undefined) {
    return { kind: input.kind, buildingId: null, floor: null }
  }
  return { kind: input.kind, buildingId: input.buildingId, floor: input.floor ?? null }
}

/** Append an intent, clamping redundant duplicates of the identical scope. */
export function appendIntent(
  pending: AuthoredMutationIntent[],
  input: { kind: AuthoredMutationIntent['kind']; buildingId?: string | null; floor?: number | null },
  seq: number,
): AuthoredMutationIntent[] {
  const n = normalizeIntent(input)
  const dup = pending.some(
    (p) => p.kind === n.kind && (p.buildingId ?? null) === (n.buildingId ?? null) && (p.floor ?? null) === (n.floor ?? null),
  )
  if (dup) return pending
  return [...pending, { ...n, seq }]
}

/**
 * Intents -> guard scopes. The guard is called once per distinct scope; a save
 * is only allowed when EVERY pending intent's scope approves the candidate.
 * (Multiple unsaved edits in different scopes stay represented — no "last wins".)
 */
export function intentsToGuardScopes(pending: AuthoredMutationIntent[]): GuardScope[] {
  const seen = new Set<string>()
  const scopes: GuardScope[] = []
  for (const p of pending) {
    const key = `${p.kind}|${p.buildingId ?? ''}|${p.floor ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    scopes.push({ kind: p.kind, buildingId: p.buildingId ?? null, floor: p.floor ?? null })
  }
  return scopes
}

/** Clears only the intents included in the acknowledged save snapshot. */
export function intentsIncludedInSave(
  pending: AuthoredMutationIntent[],
  savedUpToSeq: number,
): AuthoredMutationIntent[] {
  return pending.filter((p) => p.seq > savedUpToSeq)
}

export type AuthoredSaveEvaluation =
  | { allowed: true }
  | {
      allowed: false
      reason: string
      removed: Array<{ type: string; ids: string[] }>
      diagnostic: AuthoredSaveDiagnostic
    }

type GuardCollectionKind = keyof GuardCollections
type AuthoredScopeKind = AuthoredMutationIntent['kind']

export type AuthoredSaveDiagnostic = {
  reason: 'removed-entity-outside-pending-scope'
  removedEntityCount: number
  removedEntityKinds: Record<GuardCollectionKind, number>
  coveredRemovalCount: number
  coveredEntityKinds: Record<GuardCollectionKind, number>
  uncoveredRemovalCount: number
  uncoveredEntityKinds: Record<GuardCollectionKind, number>
  removedFromAcknowledgedBaselineCount: number
  pendingScopeCount: number
  pendingScopeKinds: Record<AuthoredScopeKind, number>
  allRemovalsCovered: boolean
}

const GUARD_COLLECTION_KINDS = ['buildings', 'components', 'nodes', 'edges', 'traces', 'doors'] as const satisfies readonly GuardCollectionKind[]
const AUTHORED_SCOPE_KINDS = ['building', 'floor', 'door', 'route', 'poi', 'outdoor'] as const satisfies readonly AuthoredScopeKind[]

function zeroCounts<K extends string>(kinds: readonly K[]): Record<K, number> {
  return Object.fromEntries(kinds.map((kind) => [kind, 0])) as Record<K, number>
}

function countRemovedByKind(previous: GuardCollections, candidate: GuardCollections): Record<GuardCollectionKind, number> {
  const counts = zeroCounts(GUARD_COLLECTION_KINDS)
  for (const type of GUARD_COLLECTION_KINDS) {
    const remaining = new Set((candidate[type] ?? []).map((entity) => entity.id))
    for (const entity of previous[type] ?? []) {
      if (!remaining.has(entity.id)) counts[type] += 1
    }
  }
  return counts
}

function countValues(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}

/**
 * Union-of-intents save-approval semantics (P0.10 §4/§7-D).
 *
 * A removal is acceptable iff AT LEAST ONE pending authored intent's scope
 * covers it. Implementation: run the proven single-scope guard once per
 * distinct pending intent; a removal flagged by EVERY intent (i.e. covered by
 * none) is a violation. Empty pending intent ⇒ refused (no-load/no-view save).
 *
 * This avoids two opposite failure modes:
 *  - "last intent only": earlier unsaved edits lose their protection;
 *  - "all scopes must approve": legitimate multi-scope edits false-block.
 */
export function evaluateAuthoredSave(
  previous: GuardCollections,
  candidate: GuardCollections,
  pending: AuthoredMutationIntent[],
): AuthoredSaveEvaluation {
  const scopes = intentsToGuardScopes(pending)
  if (scopes.length === 0) {
    return { allowed: false, reason: 'No authored mutation intent — save refused (load/view-only).', removed: [] }
  }
  const rejectedByScope: Array<Map<GuardCollectionKind, Set<string>>> = scopes.map(() => new Map())
  const results = scopes.map((scope, scopeIndex) => {
    const observeRejectedRemoval: GuardRejectedRemovalObserver = (type, id) => {
      let rejected = rejectedByScope[scopeIndex].get(type)
      if (!rejected) {
        rejected = new Set()
        rejectedByScope[scopeIndex].set(type, rejected)
      }
      rejected.add(id)
    }
    return guardCrossScopeDestruction(previous, candidate, scope, observeRejectedRemoval)
  })
  if (results.every((r) => r.allowed)) return { allowed: true }

  const flaggedPerScope = results.map((r) => {
    const m = new Map<string, Set<string>>()
    if (!r.allowed) for (const rem of r.removed) m.set(rem.type, new Set(rem.ids))
    return m
  })
  const allTypes = new Set<string>()
  for (const m of flaggedPerScope) for (const t of m.keys()) allTypes.add(t)

  const bad: Array<{ type: string; ids: string[] }> = []
  for (const t of allTypes) {
    const sets = flaggedPerScope.map((m) => m.get(t) ?? new Set<string>())
    const first = sets[0]
    if (!first) continue
    const common: string[] = []
    for (const id of first) if (sets.every((s) => s.has(id))) common.push(id)
    if (common.length > 0) bad.push({ type: t, ids: common })
  }
  if (bad.length === 0) return { allowed: true }

  const removedEntityKinds = countRemovedByKind(previous, candidate)
  const uncoveredEntityKinds = zeroCounts(GUARD_COLLECTION_KINDS)
  for (const type of GUARD_COLLECTION_KINDS) {
    const remaining = new Set((candidate[type] ?? []).map((entity) => entity.id))
    const rejectedByEveryScope = rejectedByScope.map((rejected) => rejected.get(type) ?? new Set<string>())
    for (const entity of previous[type] ?? []) {
      if (remaining.has(entity.id)) continue
      if (rejectedByEveryScope.every((rejected) => rejected.has(entity.id))) uncoveredEntityKinds[type] += 1
    }
  }
  const removedEntityCount = countValues(removedEntityKinds)
  const uncoveredRemovalCount = countValues(uncoveredEntityKinds)
  const coveredEntityKinds = zeroCounts(GUARD_COLLECTION_KINDS)
  for (const type of GUARD_COLLECTION_KINDS) {
    coveredEntityKinds[type] = removedEntityKinds[type] - uncoveredEntityKinds[type]
  }
  const pendingScopeKinds = zeroCounts(AUTHORED_SCOPE_KINDS)
  for (const scope of scopes) pendingScopeKinds[scope.kind as AuthoredScopeKind] += 1
  const summary = bad.map((r) => `${r.type}[${r.ids.join(',')}]`).join(' ')
  return {
    allowed: false,
    reason: `Cross-scope destructive save blocked: no pending authored intent covers ${summary}`,
    removed: bad,
    diagnostic: {
      reason: 'removed-entity-outside-pending-scope',
      removedEntityCount,
      removedEntityKinds,
      coveredRemovalCount: countValues(coveredEntityKinds),
      coveredEntityKinds,
      uncoveredRemovalCount,
      uncoveredEntityKinds,
      removedFromAcknowledgedBaselineCount: removedEntityCount,
      pendingScopeCount: scopes.length,
      pendingScopeKinds,
      allRemovalsCovered: uncoveredRemovalCount === 0,
    },
  }
}
