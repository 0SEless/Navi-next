/**
 * Canonical campus import remapper (Phase 2F.1).
 *
 * Problem: projection tables (buildings / route_nodes / route_edges) use GLOBALLY
 * unique entity IDs with ON CONFLICT (id) DO NOTHING. Importing a campus whose
 * entities reuse IDs already projected by another campus silently skips rows,
 * leaving the imported campus with incomplete projections.
 *
 * Contract: `remapCampusForImport(source, destCampusId)` produces a structural,
 * reference-aware copy where every addressable entity ID is namespaced with the
 * destination campus (`<destCampusId>:<oldEntityId>`), and every reference to a
 * remapped entity is rewritten consistently:
 *   buildings[].id, nodes[].id, edges[].id, pois[].id, doors[].id,
 *   components[].id, traces[].id, top-level id,
 *   edges[].from / edges[].to,
 *   nodes[].buildingId, pois/doors buildingId/roomId where present,
 *   components[].nodeIds,
 *   plus an exact-match completion pass over unknown nested values.
 *
 * Safety properties:
 *  - deterministic (same source + destination => identical output)
 *  - idempotent (already-namespaced ids are never double-prefixed)
 *  - semantic fields (names, coordinates, geometry, distances, urls, floors,
 *    types) are never reinterpreted
 *  - legacy outdoor sentinel '__outdoor__' and empty string are preserved for the
 *    SQL boundary (migration 013 maps them to NULL); they are NOT namespaced
 *  - invalid/unknown references are NOT silently repaired (only exact matches
 *    of known remapped IDs are rewritten)
 *  - the input object is never mutated
 */

type AnyRecord = Record<string, unknown>

const isRecord = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v)

const OUTDOOR_SENTINEL = '__outdoor__'

/** Namespace one entity id for a destination campus; never double-prefixes. */
export function namespaceEntityId(destCampusId: string, id: string): string {
  if (typeof id !== 'string' || id === '') return id
  return id.startsWith(destCampusId + ':') ? id : destCampusId + ':' + id
}

export type RemapMaps = {
  buildingIds: Map<string, string>
  nodeIds: Map<string, string>
  edgeIds: Map<string, string>
  poiIds: Map<string, string>
  doorIds: Map<string, string>
  componentIds: Map<string, string>
  traceIds: Map<string, string>
}

const arr = (v: unknown): AnyRecord[] => (Array.isArray(v) ? (v.filter(isRecord) as AnyRecord[]) : [])

export function remapCampusForImport(
  source: AnyRecord,
  destCampusId: string,
): { graph: AnyRecord; maps: RemapMaps } {
  if (!destCampusId) throw new Error('remapCampusForImport requires a destination campus id')
  const graph = JSON.parse(JSON.stringify(source)) as AnyRecord

  const maps: RemapMaps = {
    buildingIds: new Map(), nodeIds: new Map(), edgeIds: new Map(),
    poiIds: new Map(), doorIds: new Map(), componentIds: new Map(), traceIds: new Map(),
  }
  const collect = (items: unknown, map: Map<string, string>) => {
    for (const item of arr(items)) {
      const id = item.id
      if (typeof id === 'string' && id !== '') map.set(id, namespaceEntityId(destCampusId, id))
    }
  }
  collect(graph.buildings, maps.buildingIds)
  collect(graph.nodes, maps.nodeIds)
  collect(graph.edges, maps.edgeIds)
  collect(graph.pois, maps.poiIds)
  collect(graph.doors, maps.doorIds)
  collect(graph.components, maps.componentIds)
  collect(graph.traces, maps.traceIds)

  const nsRef = (map: Map<string, string>, v: unknown): unknown =>
    typeof v === 'string' && map.has(v) ? map.get(v) : v

  const applyBuilding = (b: AnyRecord) => {
    if (maps.buildingIds.has(b.id as string)) b.id = maps.buildingIds.get(b.id as string)
  }
  const applyNode = (n: AnyRecord) => {
    if (maps.nodeIds.has(n.id as string)) n.id = maps.nodeIds.get(n.id as string)
    const bid = n.buildingId
    if (typeof bid === 'string' && bid !== '' && bid !== OUTDOOR_SENTINEL) {
      n.buildingId = nsRef(maps.buildingIds, bid)
    }
  }
  const applyEdge = (e: AnyRecord) => {
    if (maps.edgeIds.has(e.id as string)) e.id = maps.edgeIds.get(e.id as string)
    e.from = nsRef(maps.nodeIds, e.from)
    e.to = nsRef(maps.nodeIds, e.to)
  }
  const applyOwnerRefs = (o: AnyRecord) => {
    if (typeof o.buildingId === 'string') o.buildingId = nsRef(maps.buildingIds, o.buildingId)
    if (typeof o.roomId === 'string') o.roomId = nsRef(maps.nodeIds, o.roomId)
  }

  for (const b of arr(graph.buildings)) {
    applyBuilding(b)
    for (const f of arr(b.floors)) {
      // floors are primitive level values in supported payloads; object floors, if
      // ever present, carry no addressable entity ids covered by this contract.
      void f
    }
  }
  for (const n of arr(graph.nodes)) applyNode(n)
  for (const e of arr(graph.edges)) applyEdge(e)
  for (const p of arr(graph.pois)) {
    if (maps.poiIds.has(p.id as string)) p.id = maps.poiIds.get(p.id as string)
    applyOwnerRefs(p)
  }
  for (const d of arr(graph.doors)) {
    if (maps.doorIds.has(d.id as string)) d.id = maps.doorIds.get(d.id as string)
    applyOwnerRefs(d)
  }
  for (const c of arr(graph.components)) {
    if (maps.componentIds.has(c.id as string)) c.id = maps.componentIds.get(c.id as string)
    if (Array.isArray(c.nodeIds)) c.nodeIds = c.nodeIds.map((nid) => nsRef(maps.nodeIds, nid))
  }
  for (const t of arr(graph.traces)) {
    if (maps.traceIds.has(t.id as string)) t.id = maps.traceIds.get(t.id as string)
  }

  // Exact-match completion for unknown nested references: only values that EXACTLY
  // equal a known remapped id are rewritten (never substring replacement).
  const allMaps = [maps.buildingIds, maps.nodeIds, maps.edgeIds, maps.poiIds, maps.doorIds, maps.componentIds, maps.traceIds]
  const exact = (v: unknown): unknown => {
    if (typeof v === 'string') {
      for (const m of allMaps) if (m.has(v)) return m.get(v)
      return v
    }
    if (Array.isArray(v)) return v.map(exact)
    if (isRecord(v)) {
      for (const k of Object.keys(v)) v[k] = exact(v[k])
      return v
    }
    return v
  }
  for (const key of Object.keys(graph)) if (key !== 'campusId') graph[key] = exact(graph[key])

  // destination identity
  graph.campusId = destCampusId
  if (typeof graph.id === 'string' && graph.id !== '') graph.id = namespaceEntityId(destCampusId, graph.id)

  return { graph, maps }
}
