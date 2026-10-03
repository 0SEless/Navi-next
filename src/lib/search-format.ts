import type { Building, SearchEntry } from '@/types/nav-types'

/** Display label for a floor index (0 = ground floor, negatives = basement). */
export function floorLabel(floor: number): string {
  if (floor === 0) return 'GF'
  if (floor < 0) return `B${-floor}F`
  return `${floor}F`
}

export interface GroupedResults {
  buildingId: string
  buildingName: string
  buildingCode?: string
  /** Entries in search-rank order (input order is preserved). */
  entries: SearchEntry[]
}

interface GroupAcc extends GroupedResults {
  order: number
}

/**
 * Group search results under their buildings.
 * - Groups appear in `buildings` array order; keys with no matching building
 *   (fallback groups) come after, in first-appearance order.
 * - Buildings with no matching entries are omitted.
 * - Rooms without a buildingId fall back to an 'unknown' group named "Campus".
 * - Building-type entries without a buildingId group under their own id.
 */
export function groupResults(entries: SearchEntry[], buildings: Building[]): GroupedResults[] {
  const byId = new Map(buildings.map((b) => [b.id, b]))
  const indexOf = new Map(buildings.map((b, i) => [b.id, i]))
  const groups = new Map<string, GroupAcc>()
  let fallbackOrder = buildings.length

  for (const entry of entries) {
    const key = entry.buildingId ?? (entry.type === 'building' ? entry.id : 'unknown')
    let group = groups.get(key)
    if (!group) {
      const building = byId.get(key)
      const order = building ? (indexOf.get(key) ?? fallbackOrder) : fallbackOrder
      if (!building) fallbackOrder += 1
      group = {
        buildingId: key,
        buildingName: building?.name ?? (entry.type === 'building' ? entry.label : 'Campus'),
        buildingCode: building?.code,
        entries: [],
        order,
      }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }

  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...group }) => group)
}
