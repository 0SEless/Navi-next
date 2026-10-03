import { useMemo } from 'react'
import { useEditor, useDocumentVersion } from '.'
import { useWorkspace } from './workspace-context'
import { findBuilding, getBuildingFloorCount } from './selectors'
import type { CampusDocument, Building } from '@navi/core'

export function useDocumentSelector<T>(selector: (doc: CampusDocument) => T): T {
  const { document } = useEditor()
  const documentVersion = useDocumentVersion()
  // Commands mutate the editor-owned document in place and publish the
  // mutation through DocumentStore.version. Include that version in the
  // memo key so projections recompute after Save/undo/redo.
  return useMemo(() => selector(document), [document, selector, documentVersion])
}

function getActiveBuildingId(): string | null {
  const { services } = useEditor()
  const ws = useWorkspace()
  return ws.activeBuildingId ?? services.get('viewport')?.activeBuildingId ?? null
}

export function useActiveBuilding(): Building | undefined {
  const { document } = useEditor()
  useDocumentVersion()
  const buildingId = getActiveBuildingId()
  return useMemo(() => {
    if (!buildingId) return undefined
    return findBuilding(document, buildingId)
  }, [document, buildingId])
}

export function useBuilding(id: string | undefined): Building | undefined {
  const { document } = useEditor()
  useDocumentVersion()
  return useMemo(() => {
    if (!id) return undefined
    return findBuilding(document, id)
  }, [document, id])
}

export function useFloorCount(): number {
  const { document } = useEditor()
  useDocumentVersion()
  const buildingId = getActiveBuildingId()
  return useMemo(() => {
    if (!buildingId) return 0
    return getBuildingFloorCount(document, buildingId)
  }, [document, buildingId])
}


