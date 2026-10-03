import type { Building, Component, NavNode } from '@/types/nav-types'

/** Structural subset shared by the legacy CampusData and the T2 CampusBundle. */
export interface SearchableCampus {
  buildings: Building[]
  nodes: NavNode[]
  components?: Component[]
}

export interface SearchResult {
  id: string
  kind: 'building' | 'room' | 'node'
  label: string
  sublabel: string
  floor?: number
  buildingId?: string
  nodeId?: string
}

interface RankedResult extends SearchResult {
  score: number
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Search across buildings + components (rooms) + graph nodes.
 * Rooms match by name/number/category; buildings by name/code/department;
 * nodes by label. Results ranked: exact prefix > substring > fuzzy.
 */
export function searchCampus(data: SearchableCampus, query: string, limit = 12): SearchResult[] {
  const q = normalize(query)
  if (!q) return []

  const buildingById = new Map(data.buildings.map((b) => [b.id, b]))

  // Bridge component ids -> routable graph node ids (nodes carry
  // componentId when linked; demo fallback stamps it in the API route).
  const nodeByComponent = new Map<string, string>()
  for (const n of data.nodes ?? []) {
    if (n.componentId) nodeByComponent.set(n.componentId, n.id)
  }
  // Best routable node for a building: entrance > staircase > any node.
  const buildingNodeId = (buildingId: string): string | undefined => {
    const inBldg = (data.nodes ?? []).filter((n) => n.buildingId === buildingId)
    return (
      inBldg.find((n) => n.type === 'entrance')?.id ??
      inBldg.find((n) => n.type === 'staircase')?.id ??
      inBldg[0]?.id
    )
  }

  const results: RankedResult[] = []
  const seen = new Set<string>()

  const push = (r: SearchResult, score: number) => {
    const key = `${r.kind}:${r.id}`
    if (seen.has(key)) return
    seen.add(key)
    results.push({ ...r, score })
  }

  // Rooms (components) — most precise, rank first
  for (const c of data.components ?? []) {
    const name = c.name ?? ''
    const meta = c.metadata as Record<string, unknown> | undefined
    const number = typeof meta?.number === 'string' ? meta.number : ''
    const haystack = normalize(`${name} ${number} ${c.id}`)
    if (!haystack.includes(q)) continue
    const bldg = c.buildingId ? buildingById.get(c.buildingId) : undefined
    const label = number ? `${number} — ${name}` : name
    let score = 10
    if (normalize(name).startsWith(q)) score = 0
    else if (normalize(name).includes(q)) score = 2
    else if (normalize(number).startsWith(q)) score = 1
    push({
      id: c.id,
      kind: 'room',
      label,
      sublabel: bldg?.name ?? c.buildingId ?? '',
      floor: c.floor,
      buildingId: c.buildingId,
      nodeId: nodeByComponent.get(c.id),
    }, score)
  }

  // Buildings
  for (const b of data.buildings ?? []) {
    const haystack = normalize(`${b.name} ${b.code ?? ''} ${b.department ?? ''} ${b.description ?? ''}`)
    if (!haystack.includes(q)) continue
    let score = 20
    if (normalize(b.name).startsWith(q)) score = 11
    else if (normalize(b.name).includes(q)) score = 13
    push({
      id: b.id,
      kind: 'building',
      label: b.name,
      sublabel: [b.code, b.department].filter(Boolean).join(' · ') || 'Building',
      nodeId: buildingNodeId(b.id),
    }, score)
  }

  // Graph nodes not already covered (entrances, corridors, roads)
  const roomIds = new Set((data.components ?? []).map((c) => c.id))
  for (const n of data.nodes ?? []) {
    if (n.componentId && roomIds.has(n.componentId)) continue
    const haystack = normalize(`${n.label ?? ''} ${n.name ?? ''} ${n.id}`)
    if (!haystack.includes(q)) continue
    let score = 30
    if (normalize(n.label ?? '').startsWith(q)) score = 21
    push({
      id: n.id,
      kind: 'node',
      label: n.label ?? n.id,
      sublabel: n.buildingId ? buildingById.get(n.buildingId)?.name ?? n.buildingId : 'Campus',
      floor: n.floor,
      buildingId: n.buildingId,
      nodeId: n.id,
    }, score)
  }

  return results.sort((a, b) => a.score - b.score).slice(0, limit).map(({ score: _s, ...r }) => r)
}
