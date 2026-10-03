import type { CampusBundle } from '@/types/nav-types'

export type PublicCampusSource = 'published' | 'graph_snapshot'

export interface PublicCampusResult {
  campusId: string
  revision: string | null
  source: PublicCampusSource
  bundle: CampusBundle
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasId(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
}

function hasEdgeShape(value: unknown): boolean {
  return hasId(value)
    && typeof value.from === 'string'
    && value.from.length > 0
    && typeof value.to === 'string'
    && value.to.length > 0
}

function hasNamedShape(value: unknown): boolean {
  return hasId(value) && typeof value.name === 'string' && value.name.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normalizePublicCampusSource(value: unknown): PublicCampusSource | null {
  if (value === 'published' || value === 'published_maps') return 'published'
  if (value === 'graph_snapshot' || value === 'graph_snapshots') return 'graph_snapshot'
  return null
}

export function normalizeRevision(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Structural guard used before a payload can become the active public bundle. */
export function isUsablePublicCampusBundle(value: unknown): value is CampusBundle {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.nodes)) return false
  if (!Array.isArray(value.edges)) return false
  if (!Array.isArray(value.searchEntries)) return false
  if (!Array.isArray(value.buildings)) return false
  if (!Array.isArray(value.poi)) return false
  if (!value.nodes.every(hasId)) return false
  if (!value.edges.every(hasEdgeShape)) return false
  if (!value.searchEntries.every(hasId)) return false
  if (!value.buildings.every(hasNamedShape)) return false
  if (value.boundingBox !== null) {
    if (!isRecord(value.boundingBox)) return false
    if (!isFiniteNumber(value.boundingBox.minLat)
      || !isFiniteNumber(value.boundingBox.maxLat)
      || !isFiniteNumber(value.boundingBox.minLng)
      || !isFiniteNumber(value.boundingBox.maxLng)) return false
  }
  if (value.components !== undefined && !Array.isArray(value.components)) return false
  if (value.doors !== undefined && !Array.isArray(value.doors)) return false
  return value.nodes.length > 0 || value.buildings.length > 0
}

export function normalizePublicCampusResult(
  value: unknown,
  requestedCampusId: string,
): PublicCampusResult | null {
  if (!isRecord(value)) return null
  if (typeof value.campusId !== 'string' || value.campusId !== requestedCampusId) return null

  const source = normalizePublicCampusSource(value.source)
  if (!source || !isUsablePublicCampusBundle(value.bundle)) return null

  return {
    campusId: value.campusId,
    revision: normalizeRevision(value.revision),
    source,
    bundle: value.bundle,
  }
}
