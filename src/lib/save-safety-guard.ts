/**
 * P0.8 — Cross-scope destructive-save guard (pure, identity+scope based).
 *
 * Reuses the SAME covered-scope semantics validated by the GraphAdapter
 * reconciliation (buildings / building+floor / outdoor). It rejects impossible
 * unrelated destruction while allowing explicit in-scope authored deletion.
 *
 * NOT count-based: removals are classified by entity identity + ownership
 * scope; a same-count swap (remove unrelated door, add unrelated door) is
 * still blocked.
 */

export type GuardScope = {
  kind: 'view' | 'door' | 'route' | 'poi' | 'building' | 'floor' | 'outdoor'
  /** Canonical building id when the mutation targets one building. */
  buildingId?: string | null
  /** Floor level when the mutation targets one floor. */
  floor?: number | null
}

export type GuardedEntity = {
  id: string
  buildingId?: string | null
  floor?: number | null
  from?: string
  to?: string
}

export type GuardCollections = {
  buildings?: GuardedEntity[]
  components?: GuardedEntity[]
  nodes?: GuardedEntity[]
  edges?: GuardedEntity[]
  traces?: GuardedEntity[]
  doors?: GuardedEntity[]
}

export type GuardResult =
  | { allowed: true }
  | { allowed: false; reason: string; removed: Array<{ type: string; ids: string[] }> }

const OUTDOOR = '__outdoor__'
const idsOf = (items?: GuardedEntity[]) => new Set((items ?? []).map((x) => x.id))

const entityScope = (e: GuardedEntity): { buildingId: string | null; floor: number | null } => ({
  buildingId: e.buildingId ?? null,
  floor: e.floor ?? null,
})

/** Is the entity's ownership scope inside the declared mutation scope? */
function inScope(scope: GuardScope, e: GuardedEntity, kind: 'door' | 'node' | 'trace' | 'building' | 'component'): boolean {
  if (scope.kind === 'view') return false
  const { buildingId, floor } = entityScope(e)
  const isOutdoor = !buildingId || buildingId === OUTDOOR

  if (scope.kind === 'outdoor') return kind === 'trace' || (kind === 'node' && isOutdoor)
  if (scope.kind === 'building' || scope.kind === 'floor') {
    if (kind === 'building') return e.id === scope.buildingId
    if (buildingId !== scope.buildingId) return false
    if (scope.kind === 'floor' && scope.floor !== undefined && scope.floor !== null) return floor === scope.floor
    return true
  }
  if (scope.kind === 'door') {
    return kind === 'door' && buildingId === scope.buildingId && (scope.floor === undefined || scope.floor === null || floor === scope.floor)
  }
  if (scope.kind === 'route') {
    return (kind === 'node' && buildingId === scope.buildingId && (scope.floor === undefined || scope.floor === null || floor === scope.floor))
  }
  if (scope.kind === 'poi') return false
  return false
}

export function guardCrossScopeDestruction(
  previous: GuardCollections,
  candidate: GuardCollections,
  scope: GuardScope,
): GuardResult {
  const removed: Array<{ type: string; ids: string[] }> = []

  const collect = (
    type: keyof GuardCollections,
    kind: 'door' | 'node' | 'trace' | 'building' | 'component',
    allowEdgeSideEffect = false,
  ) => {
    const cand = idsOf(candidate[type])
    const bad: string[] = []
    for (const e of previous[type] ?? []) {
      if (cand.has(e.id)) continue
      if (inScope(scope, e, kind)) continue
      if (allowEdgeSideEffect && scope.kind === 'route' && kind === 'node') continue
      bad.push(e.id)
    }
    if (bad.length > 0) removed.push({ type, ids: bad.slice(0, 10) })
  }

  collect('buildings', 'building')
  collect('components', 'component')
  collect('nodes', 'node', true)
  collect('traces', 'trace')
  collect('doors', 'door')

  // Edges: classify by the scope of their endpoints in the PREVIOUS graph when
  // available; otherwise treat as route-scoped (they can only disappear with
  // their owning route scope).
  const prevNodeScope = new Map<string, { buildingId: string | null; floor: number | null }>()
  for (const n of previous.nodes ?? []) prevNodeScope.set(n.id, entityScope(n))
  const candEdges = idsOf(candidate.edges)
  const badEdges: string[] = []
  for (const e of previous.edges ?? []) {
    if (candEdges.has(e.id)) continue
    const a = prevNodeScope.get(e.from ?? '')
    const b = prevNodeScope.get(e.to ?? '')
    const endpointInScope =
      (a ? inScope(scope, { id: e.from ?? '', ...a }, 'node') : false) &&
      (b ? inScope(scope, { id: e.to ?? '', ...b }, 'node') : false)
    const edgesRemovable = scope.kind === 'outdoor' || scope.kind === 'route' || scope.kind === 'building' || scope.kind === 'floor'
    if (endpointInScope && edgesRemovable) continue
    badEdges.push(e.id)
  }
  if (badEdges.length > 0) removed.push({ type: 'edges', ids: badEdges.slice(0, 10) })

  if (removed.length === 0) return { allowed: true }
  const summary = removed.map((r) => `${r.type}[${r.ids.join(',')}]`).join(' ')
  return {
    allowed: false,
    reason: `Cross-scope destructive save blocked: mutation=${scope.kind}${scope.buildingId ? '@' + scope.buildingId : ''}${scope.floor !== undefined && scope.floor !== null ? '#f' + scope.floor : ''} unexpected removals: ${summary}`,
    removed,
  }
}
