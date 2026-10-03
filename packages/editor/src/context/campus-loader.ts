import { Graph } from '@/engine/graph'
import { GraphAdapter } from '../graph-adapter'
import { CoordinateTransformer, serializeDocument, deserializeDocument, type CampusDocument } from '@navi/core'
import { createDocument } from './create-editor-context'

/**
 * Load a persisted campus from raw storage JSON and return both the
 * CampusDocument (source of truth) and a regenerated Navigation Graph
 * (runtime projection). Implements the ADR 006 backward-compatible loader:
 *
 *   load()
 *     if CampusDocument  → deserialize
 *     else if LegacyGraph → convert via createDocument, then re-save as document
 *     → regenerate graph via GraphAdapter
 *
 * This is the single place that decides whether stored data is a document or a
 * legacy graph, keeping the persistence inversion in one module.
 */
export function loadStoredCampus(raw: string): {
  document: CampusDocument
  graph: Graph
  wasLegacy: boolean
} {
  const parsed = JSON.parse(raw)
  const isDocument =
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.schemaVersion === 'number' &&
    Array.isArray(parsed.buildings) &&
    !('nodes' in parsed)

  let document: CampusDocument
  let wasLegacy = false

  if (isDocument) {
    document = deserializeDocument(raw)
  } else {
    // Legacy graph snapshot: convert to the document and flag for migration.
    const graph = Graph.fromJSON(parsed)
    document = createDocument(graph)
    wasLegacy = true
  }

  const transformer = new CoordinateTransformer()
  for (const b of document.buildings) {
    const fp = b.footprint?.points ?? []
    const origin = fp.length > 0
      ? { lat: fp.reduce((s, p) => s + p.lat, 0) / fp.length, lng: fp.reduce((s, p) => s + p.lng, 0) / fp.length }
      : { lat: 0, lng: 0 }
    transformer.registerBuilding({
      buildingId: b.id,
      origin,
      rotation: 0,
    })
  }

  const graph = new Graph()
  new GraphAdapter(graph, transformer).sync(document)
  return { document, graph, wasLegacy }
}
