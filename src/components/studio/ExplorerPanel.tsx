'use client'

import { useMemo, useCallback } from 'react'
import {
  ExplorerAdapter,
  findNodeById,
  useSelection,
  useEditor,
  useDocumentVersion,
  useEditingEngine,
} from '@navi/editor'
import type { EntityId, EntitySelector } from '@navi/editor'
import { Explorer } from './Explorer'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'

/**
 * Thin container.
 *
 * Responsibilities:
 * - Read state from EditorContext
 * - Project CampusDocument → ExplorerNode[] via ExplorerAdapter
 * - Bridge UI intents to editor services
 * - Pass props into the render-only Explorer
 *
 * It never owns business logic.
 */
export function ExplorerPanel() {
  const { document, services } = useEditor()
  const selection = useSelection()
  const version = useDocumentVersion()
  const editEngine = useEditingEngine()
  const editorMode = useStudioStore((s) => s.editorMode)

  const allNodes = useMemo(() => ExplorerAdapter(document), [document, version])

  // Filter nodes based on editor mode
  const nodes = useMemo(() => {
    if (editorMode === '360-tour') {
      // In 360 Tour mode, show only panoramas and top-level structure
      return allNodes.filter(node => 
        node.type === 'panorama' || 
        node.type === 'campus'
      )
    }
    return allNodes
  }, [allNodes, editorMode])

  const selectedId: EntityId | null = selection.lastSelected?.id ?? null

  const handleRename = useCallback(
    (id: EntityId, newName: string) => {
      const dispatcher = services.get('dispatcher')
      editEngine.begin({ kind: 'rename', entityId: id, name: newName })
      editEngine.doCommit()
      dispatcher?.execute({
        id: 'entity.update',
        label: 'Rename',
        payload: { entityId: id, changes: { name: newName } },
      })
    },
    [services, editEngine],
  )

  const handleDelete = useCallback(
    (id: EntityId) => {
      const dispatcher = services.get('dispatcher')
      const node = findNodeById(nodes, id)
      // No delete command exists for the campus root node.
      if (!node || node.type === 'campus') return
      // Go through Editing Engine first.
      editEngine.begin({ kind: 'delete', entityIds: [id] })
      editEngine.doCommit()
      // Each entity type has its own delete command with a type-specific
      // payload key (`<type>Id`), e.g. building.delete → { buildingId }.
      dispatcher?.execute({
        id: `${node.type}.delete`,
        label: 'Delete',
        payload: { [`${node.type}Id`]: id },
      })
      // Clean up graph nodes when deleting a road — road.delete only removes
      // from document.roads but leaves trace-derived nodes in the graph.
      if (node.type === 'road') {
        useGraphStore.getState().removeTrace(id)
      }
    },
    [services, nodes, editEngine],
  )

  return (
    <Explorer
      nodes={nodes}
      selectedId={selectedId}
      onSelect={selection.select}
      onRename={handleRename}
      onDelete={handleDelete}
    />
  )
}
