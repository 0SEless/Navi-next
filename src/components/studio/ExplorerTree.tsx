'use client'

import React from 'react'
import type { ExplorerNode, EntityId, EntitySelector, SelectionOrigin } from '@navi/editor'
import type { ContextMenuAction } from './ExplorerContextMenu'
import { ExplorerItem } from './ExplorerItem'

interface ExplorerTreeProps {
  nodes: ExplorerNode[]
  expandedIds: Set<EntityId>
  selectedId: EntityId | null
  searchQuery?: string
  depth?: number
  onSelect: (selector: EntitySelector, origin: SelectionOrigin) => void
  onToggle: (id: EntityId) => void
  onRename?: (id: EntityId, newName: string) => void
  onDelete?: (id: EntityId) => void
  contextMenuActions?: ContextMenuAction[]
}

function ExplorerTreeImpl({
  nodes,
  expandedIds,
  selectedId,
  searchQuery = '',
  depth = 0,
  onSelect,
  onToggle,
  onRename,
  onDelete,
  contextMenuActions,
}: ExplorerTreeProps) {
  const tree = (
    <>
      {nodes.map((node) => {
        const isExpanded = expandedIds.has(node.id)
        const isSelected = selectedId === node.id
        return (
          <div key={node.id}>
            <ExplorerItem
              node={node}
              depth={depth}
              expanded={isExpanded}
              selected={isSelected}
              searchQuery={searchQuery}
              onToggle={onToggle}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              contextMenuActions={contextMenuActions}
            />
            {isExpanded && node.children && node.children.length > 0 && (
              <ExplorerTree
                nodes={node.children}
                expandedIds={expandedIds}
                selectedId={selectedId}
                searchQuery={searchQuery}
                depth={depth + 1}
                onSelect={onSelect}
                onToggle={onToggle}
                onRename={onRename}
                onDelete={onDelete}
                contextMenuActions={contextMenuActions}
              />
            )}
          </div>
        )
      })}
    </>
  )

  if (depth === 0) {
    return <div role="tree">{tree}</div>
  }
  return tree
}

export const ExplorerTree = React.memo(ExplorerTreeImpl)
