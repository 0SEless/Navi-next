'use client'

import React from 'react'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { SelectionOrigin } from '@navi/editor'
import type { ExplorerNode, EntityId, EntitySelector } from '@navi/editor'
import { ExplorerContextMenu } from './ExplorerContextMenu'
import type { ContextMenuAction } from './ExplorerContextMenu'
import { getExplorerActions } from './getExplorerActions'

interface ExplorerItemProps {
  node: ExplorerNode
  depth: number
  expanded: boolean
  selected: boolean
  searchQuery: string
  onToggle: (id: EntityId) => void
  onSelect: (selector: EntitySelector, origin: SelectionOrigin) => void
  onRename?: (id: EntityId, newName: string) => void
  onDelete?: (id: EntityId) => void
  contextMenuActions?: ContextMenuAction[]
}

const typeLabels: Record<string, string> = {
  campus: '📋',
  building: '🏛',
  floor: '📄',
  room: '▢',
  hallway: '⇔',
  staircase: '↑↓',
  elevator: '⊞',
  entrance: '→',
  road: '↔',
  panorama: '◉',
  qr: '◆',
  area: '▨',
}

function ExplorerItemImpl({
  node,
  depth,
  expanded,
  selected,
  searchQuery,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  contextMenuActions,
}: ExplorerItemProps) {
  const hasChildren = node.children && node.children.length > 0

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(node.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleDoubleClick = useCallback(() => {
    if (!onRename) return
    setEditing(true)
    setEditValue(node.label)
  }, [node.label, onRename])

  const submitRename = useCallback(() => {
    setEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== node.label && onRename) {
      onRename(node.id, trimmed)
    }
  }, [editValue, node.label, node.id, onRename])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submitRename()
    if (e.key === 'Escape') setEditing(false)
  }, [submitRename])

  const menuActions = useMemo(
    () =>
      contextMenuActions ??
      getExplorerActions(node, {
        onRename: () => handleDoubleClick(),
        onDelete:
          node.type === 'campus'
            ? undefined
            : (id) => onDelete?.(id as EntityId),
      }),
    [contextMenuActions, node, onRename, onDelete, handleDoubleClick],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (menuActions.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }, [menuActions])

  const renderLabel = () => {
    if (!searchQuery) return node.label
    const idx = node.label.toLowerCase().indexOf(searchQuery.toLowerCase())
    if (idx === -1) return node.label
    return (
      <>
        {node.label.slice(0, idx)}
        <mark style={{ background: '#fef08a', borderRadius: 2, padding: '0 1px' }}>
          {node.label.slice(idx, idx + searchQuery.length)}
        </mark>
        {node.label.slice(idx + searchQuery.length)}
      </>
    )
  }

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      data-selected={selected ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        paddingLeft: depth * 16 + 4,
        paddingRight: 4,
        height: 28,
        cursor: 'pointer',
        background: selected ? '#e0f2fe' : 'transparent',
        fontSize: 13,
        userSelect: 'none',
        borderBottom: '1px solid #f3f4f6',
      }}
      onClick={() => onSelect(node.entitySelector, SelectionOrigin.Explorer)}
      onContextMenu={handleContextMenu}
    >
      {hasChildren ? (
        <span
          onClick={(e) => { e.stopPropagation(); onToggle(node.id) }}
          style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      ) : (
        <span style={{ display: 'inline-flex', width: 16, flexShrink: 0 }} />
      )}
      <span style={{ marginRight: 4, fontSize: 12, flexShrink: 0 }}>
        {typeLabels[node.type] ?? '•'}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={submitRename}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1, border: '1px solid #60a5fa', borderRadius: 2,
            padding: '0 4px', fontSize: 13, outline: 'none',
          }}
        />
      ) : (
        <span
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
          onDoubleClick={handleDoubleClick}
        >
          {renderLabel()}
          {node.type === 'floor' && (node.meta as any)?.hasPlan && (
            <span title="Floor plan uploaded" style={{ fontSize: 10, opacity: 0.8 }}>🖼</span>
          )}
        </span>
      )}
    </div>
    {contextMenu && (
      <ExplorerContextMenu
        actions={menuActions}
        position={contextMenu}
        onClose={() => setContextMenu(null)}
      />
    )}
    </>
  )
}

export const ExplorerItem = React.memo(ExplorerItemImpl)
