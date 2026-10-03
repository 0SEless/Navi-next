import type { ExplorerNode } from '@navi/editor'
import type { ContextMenuAction } from './ExplorerContextMenu'

/**
 * Returns the available context menu actions for a given node.
 * Simple function — no registry, no registration API.
 * Convert to a plugin registry later when >2 actions exist.
 *
 * Only includes an action if its handler is defined, so a missing
 * `onDelete` (for example) simply omits the Delete entry rather than
 * crashing.
 */
export function getExplorerActions(
  node: ExplorerNode,
  handlers: {
    onRename?: (id: string) => void
    onDelete?: (id: string) => void
  },
): ContextMenuAction[] {
  const actions: ContextMenuAction[] = []

  if (handlers.onRename) {
    actions.push({
      id: 'rename',
      label: 'Rename',
      action: () => handlers.onRename!(node.id),
    })
  }

  if (handlers.onDelete) {
    actions.push({
      id: 'delete',
      label: 'Delete',
      action: () => handlers.onDelete!(node.id),
    })
  }

  return actions
}
