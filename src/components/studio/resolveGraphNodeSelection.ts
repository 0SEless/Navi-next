import type { CampusDocument } from '@navi/core'
import { findEntityById, type EntitySelector } from '@navi/editor'
import type { Graph } from '@/engine/graph'

/**
 * Resolve a compiled graph-node selection to its source CampusDocument entity
 * via compiler provenance (NavNode.componentId).
 *
 * Returns an EntitySelector for the single SelectionManager / PropertiesPanel
 * when the node was generated from an authored entity, or `null` when the node
 * has no resolvable source entity (a derived corner / intersection, or a
 * studio-only component). In the `null` case the caller should highlight the
 * node only and leave the entity selection empty — never fabricate a "building"
 * selector, which is what produced the old `Entity not found: <nodeId>` error.
 */
export function resolveGraphNodeSelection(
  graph: Graph,
  document: CampusDocument,
  nodeId: string | null,
): EntitySelector | null {
  if (!nodeId) return null
  const node = graph.getNode(nodeId)
  const sourceId = node?.componentId
  if (!sourceId) return null
  const found = findEntityById(document, sourceId)
  return found ? ({ type: found.path, id: sourceId } as unknown as EntitySelector) : null
}
