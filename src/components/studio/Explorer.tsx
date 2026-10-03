'use client'

import { useCallback } from 'react'
import { useExplorerView } from '@/hooks/useExplorerView'
import { ExplorerSearch } from './ExplorerSearch'
import { ExplorerTree } from './ExplorerTree'
import type { ExplorerNode, EntityId, EntitySelector, SelectionOrigin } from '@navi/editor'

interface ExplorerProps {
  nodes: ExplorerNode[]
  selectedId: EntityId | null
  onSelect: (selector: EntitySelector, origin: SelectionOrigin) => void
  onRename?: (id: EntityId, newName: string) => void
  onDelete?: (id: EntityId) => void
}

export function Explorer({ nodes, selectedId, onSelect, onRename, onDelete }: ExplorerProps) {
  const {
    expandedIds,
    searchQuery,
    filteredTree,
    matchCount,
    toggleExpanded,
    setSearchQuery,
  } = useExplorerView(nodes)

  const handleSelect = useCallback(
    (selector: EntitySelector, origin: SelectionOrigin) => onSelect(selector, origin),
    [onSelect],
  )

  // Empty states
  if (nodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
        No entities in document
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ExplorerSearch value={searchQuery} onChange={setSearchQuery} matchCount={matchCount} />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {searchQuery && matchCount === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            No results for &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          <ExplorerTree
            nodes={filteredTree}
            expandedIds={expandedIds}
            selectedId={selectedId}
            searchQuery={searchQuery}
            onSelect={handleSelect}
            onToggle={toggleExpanded}
            onRename={onRename}
            onDelete={onDelete}
          />
        )}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '4px 8px', borderTop: '1px solid #e5e7eb',
        fontSize: 11, color: '#9ca3af',
      }}>
        <span>{filteredTree.length} item{filteredTree.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}
