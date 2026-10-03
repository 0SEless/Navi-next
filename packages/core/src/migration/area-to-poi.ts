import type { Area, OutdoorPointOfInterest } from '../types'
import { validateWorldPointOfInterestGeometry } from '../validation/poi-geometry'

/**
 * Controlled Area → outdoor 2D Polygon POI migration.
 *
 * Design rules:
 *  - compact Area use cases become 2D polygon POIs (geometry unchanged except
 *    removal of a duplicated closing vertex, which GeoJSON/POI rings express
 *    implicitly);
 *  - the Area id is preserved when it does not collide with an existing POI;
 *    on collision the migrated id becomes `${id}-migrated-N` with the smallest
 *    N ≥ 1 that is free (deterministic);
 *  - invalid Area records are never dropped: they are returned as
 *    `unmigrated` so callers can keep them as compatibility data;
 *  - provenance is recorded in POI metadata (never in geometry/identity).
 */

export interface AreaMigrationReportEntry {
  areaId: string
  poiId: string | null
  status: 'migrated' | 'renamed' | 'skipped'
  reason?: string
}

export interface AreaMigrationResult {
  pois: OutdoorPointOfInterest[]
  unmigrated: Area[]
  report: AreaMigrationReportEntry[]
}

function sameLatLng(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return a.lat === b.lat && a.lng === b.lng
}

/** Open ring: drop a duplicated closing vertex and consecutive duplicates. */
function openRing(points: Area['points']): Area['points'] {
  const deduped: Area['points'] = []
  for (const point of points) {
    if (deduped.length === 0 || !sameLatLng(deduped[deduped.length - 1], point)) deduped.push(point)
  }
  if (deduped.length > 1 && sameLatLng(deduped[0], deduped[deduped.length - 1])) deduped.pop()
  return deduped
}

export function migrateAreasToPois(
  areas: readonly Area[] | undefined,
  existingPoiIds: ReadonlySet<string>,
): AreaMigrationResult {
  const usedIds = new Set(existingPoiIds)
  const pois: OutdoorPointOfInterest[] = []
  const unmigrated: Area[] = []
  const report: AreaMigrationReportEntry[] = []

  for (const area of areas ?? []) {
    const points = openRing(area.points ?? [])

    if (points.length < 3) {
      unmigrated.push(area)
      report.push({ areaId: area.id, poiId: null, status: 'skipped', reason: 'area has fewer than 3 points' })
      continue
    }

    const geometry = { type: 'polygon' as const, points: points.map((point) => ({ lat: point.lat, lng: point.lng })) }
    const validation = validateWorldPointOfInterestGeometry(geometry)
    if (!validation.valid) {
      unmigrated.push(area)
      report.push({ areaId: area.id, poiId: null, status: 'skipped', reason: validation.error })
      continue
    }

    let id = area.id
    let renamed = false
    if (usedIds.has(id)) {
      renamed = true
      let suffix = 1
      while (usedIds.has(`${area.id}-migrated-${suffix}`)) suffix += 1
      id = `${area.id}-migrated-${suffix}`
    }
    usedIds.add(id)

    pois.push({
      id,
      name: area.name ?? '',
      category: 'other',
      scope: 'outdoor',
      geometry,
      appearance: { mode: '2d', color: area.color },
      metadata: { migratedFrom: 'area', ...(renamed ? { migratedFromAreaId: area.id } : {}) },
    })
    report.push({ areaId: area.id, poiId: id, status: renamed ? 'renamed' : 'migrated' })
  }

  return { pois, unmigrated, report }
}
