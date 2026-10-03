import { toExplorerNodes } from './explorer/adapter'
import type { CampusDocument } from '@navi/core'
import type { ExplorerNode } from './explorer/adapter'

/**
 * Public adapter that projects a CampusDocument into the Explorer tree.
 *
 * The indirection exists so ExplorerAdapter can later enrich nodes with:
 * - validation badges
 * - dirty state
 * - publish status
 * - permissions
 * - hidden entities
 * - warnings
 *
 * without changing ExplorerPanel.
 */
export function ExplorerAdapter(document: CampusDocument): ExplorerNode[] {
  return toExplorerNodes(document)
}
