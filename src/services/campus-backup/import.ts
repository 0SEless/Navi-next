import type { CampusDocument } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { Graph } from '@/engine/graph'
import type { GraphSnapshot } from '@/types/nav-types'
import { createDocument } from '@navi/editor'
import { validateCampusBackup } from './validate'
import type { CampusBackupIssue, CampusMapData } from './types'

export class CampusBackupImportError extends Error {
  readonly errors: CampusBackupIssue[]

  constructor(errors: CampusBackupIssue[]) {
    super(`Campus backup rejected: ${errors.length} validation error(s)`)
    this.name = 'CampusBackupImportError'
    this.errors = errors
  }
}

export interface CampusBackupImportResult {
  graph: Graph
  document: CampusDocument
  campusMap?: CampusMapData
  sourceRevision: string | null
  /** Transformer registered from the imported graph, ready for the editor bridge. */
  transformer: CoordinateTransformer
  warnings: CampusBackupIssue[]
}

function computeCentroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  let lat = 0
  let lng = 0
  for (const point of points) {
    lat += point.lat
    lng += point.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

/**
 * Register buildings exactly like createEditorContext does (footprint centroid
 * origin + building rotation) so world↔building-local conversions performed by
 * `createDocument` invert the ones GraphAdapter applied when projecting.
 */
function createGraphTransformer(snapshot: GraphSnapshot): CoordinateTransformer {
  const transformer = new CoordinateTransformer()
  for (const building of snapshot.buildings ?? []) {
    const footprint = Array.isArray(building.footprint) ? building.footprint : []
    const origin = footprint.length > 0 ? computeCentroid(footprint) : { lat: 0, lng: 0 }
    transformer.registerBuilding({
      buildingId: building.id,
      origin,
      rotation: building.rotation ?? 0,
    })
    for (const level of building.floors ?? []) {
      transformer.registerFloor(building.id, level, { offset: { x: 0, y: 0 }, rotation: 0 })
    }
  }
  return transformer
}

/**
 * Validate a backup envelope and rebuild the domain objects through the
 * existing mapping (`Graph.fromJSON` → `createDocument`).
 *
 * Pure/local: never writes to Supabase, localStorage or the network. The
 * returned graph/document are new objects; the input envelope is untouched.
 * Invalid payloads throw `CampusBackupImportError` carrying the validation
 * errors; valid payloads surface semantic warnings instead.
 */
export function importCampusBackup(input: unknown): CampusBackupImportResult {
  const validation = validateCampusBackup(input)
  if (!validation.valid || !validation.backup) {
    throw new CampusBackupImportError(validation.errors)
  }

  const backup = validation.backup
  const snapshot = structuredClone(backup.graph)
  const graph = Graph.fromJSON(snapshot)
  const transformer = createGraphTransformer(snapshot)
  const document = createDocument(graph, transformer)

  // Campus display name is not part of GraphSnapshot; it is carried by the
  // campus_maps row. Restore it when the envelope includes that row so authored
  // campus metadata survives the backup round trip.
  if (backup.campusMap && typeof backup.campusMap.name === 'string' && backup.campusMap.name.trim() !== '') {
    document.metadata.name = backup.campusMap.name
  }

  return {
    graph,
    document,
    campusMap: backup.campusMap ? structuredClone(backup.campusMap) : undefined,
    sourceRevision: backup.sourceRevision ?? null,
    transformer,
    warnings: validation.warnings,
  }
}
