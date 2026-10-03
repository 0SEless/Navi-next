'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { genId } from '@navi/editor'
import type { EditablePath } from '@/types/path-types'

export type SnapProvider = (
  position: { x: number; y: number },
  path: EditablePath,
) => { x: number; y: number } | null

export type ConstraintProvider = (
  position: { x: number; y: number },
  origin: { x: number; y: number },
  shiftHeld: boolean,
) => { x: number; y: number }

export interface UseEditablePathEditorOptions {
  path: EditablePath
  readOnly?: boolean
  onVertexMoved?: (vertexId: string, newPosition: { x: number; y: number }) => void
  onVertexInserted?: (segmentId: string, position: { x: number; y: number }) => void
  onVertexDeleted?: (vertexId: string) => void
  onSegmentTypeChanged?: (segmentId: string, type: 'straight' | 'arc') => void
  onCurvatureChanged?: (segmentId: string, curvature: number) => void
  onSelectionChanged?: (vertexIds: string[], segmentId: string | null) => void
  snapProvider?: SnapProvider
  constraintProvider?: ConstraintProvider
}

export interface EditablePathSession {
  hoveredVertexId: string | null
  hoveredSegmentId: string | null
  selectedVertexIds: string[]
  selectedSegmentId: string | null
  dragVertexId: string | null
  isDragging: boolean
  shiftHeld: boolean
}

export interface EditablePathEditorState {
  session: EditablePathSession

  onVertexPointerDown: (vertexId: string) => void
  onSegmentPointerDown: (segmentId: string) => void
  onPointerMove: (position: { x: number; y: number }) => void
  onPointerUp: () => void
  onCanvasClick: (position: { x: number; y: number }) => void

  setShiftHeld: (held: boolean) => void
  setHoveredVertex: (vertexId: string | null) => void
  setHoveredSegment: (segmentId: string | null) => void

  insertVertex: (segmentId: string, position?: { x: number; y: number }) => void
  deleteVertex: (vertexId: string) => void
  deleteSelected: () => void
  setSegmentType: (segmentId: string, type: 'straight' | 'arc') => void
  setCurvature: (segmentId: string, curvature: number) => void
}

const emptySession: EditablePathSession = {
  hoveredVertexId: null,
  hoveredSegmentId: null,
  selectedVertexIds: [],
  selectedSegmentId: null,
  dragVertexId: null,
  isDragging: false,
  shiftHeld: false,
}

export function useEditablePathEditor(options: UseEditablePathEditorOptions): EditablePathEditorState {
  const { readOnly } = options

  // Store everything in refs to stabilize callbacks
  const optsRef = useRef(options)
  optsRef.current = options

  const dragRef = useRef<{ vertexId: string; startPos: { x: number; y: number } } | null>(null)
  const pathIdRef = useRef(options.path.id)
  const [session, setSession] = useState<EditablePathSession>(emptySession)
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    if (options.path.id !== pathIdRef.current) {
      pathIdRef.current = options.path.id
      setSession(emptySession)
    }
  }, [options.path.id])

  const updateSession = useCallback((patch: Partial<EditablePathSession>) => {
    setSession((prev) => ({ ...prev, ...patch }))
  }, [])

  const onVertexPointerDown = useCallback((vertexId: string) => {
    const { readOnly: ro, path } = optsRef.current
    if (ro) return
    const vertex = path.vertices.find((v) => v.id === vertexId)
    if (!vertex) return
    dragRef.current = { vertexId, startPos: { x: vertex.x, y: vertex.y } }
    updateSession({ dragVertexId: vertexId, isDragging: true })
  }, [updateSession])

  const onSegmentPointerDown = useCallback((segmentId: string) => {
    const { readOnly: ro, onSelectionChanged } = optsRef.current
    if (ro) return
    updateSession({ selectedVertexIds: [] })
    setSession((prev) => {
      const next = prev.selectedSegmentId === segmentId ? null : segmentId
      const nextSession = { ...prev, selectedVertexIds: [], selectedSegmentId: next }
      onSelectionChanged?.(nextSession.selectedVertexIds, next)
      return nextSession
    })
  }, [updateSession])

  const onPointerMove = useCallback((position: { x: number; y: number }) => {
    const drag = dragRef.current
    if (!drag) return
    const { snapProvider, constraintProvider, onVertexMoved, path } = optsRef.current
    const shiftHeld = sessionRef.current.shiftHeld

    let target = { x: position.x, y: position.y }

    const snapped = snapProvider?.(target, path)
    if (snapped) target = snapped

    const constrained = constraintProvider?.(target, drag.startPos, shiftHeld)
    if (constrained) target = constrained

    onVertexMoved?.(drag.vertexId, target)
  }, [])

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    updateSession({ dragVertexId: null, isDragging: false })
  }, [updateSession])

  const onCanvasClick = useCallback((_position: { x: number; y: number }) => {
    const { readOnly: ro, onSelectionChanged } = optsRef.current
    if (ro) return
    if (sessionRef.current.isDragging) return
    updateSession({ selectedVertexIds: [], selectedSegmentId: null })
    onSelectionChanged?.([], null)
  }, [updateSession])

  const insertVertex = useCallback((segmentId: string, position?: { x: number; y: number }) => {
    const { readOnly: ro, path, onVertexInserted } = optsRef.current
    if (ro) return
    const segIdx = path.segments.findIndex((s) => s.id === segmentId)
    if (segIdx < 0) return
    const seg = path.segments[segIdx]
    const startV = path.vertices.find((v) => v.id === seg.startVertexId)
    const endV = path.vertices.find((v) => v.id === seg.endVertexId)
    if (!startV || !endV) return
    const pos = position ?? { x: (startV.x + endV.x) / 2, y: (startV.y + endV.y) / 2 }
    onVertexInserted?.(segmentId, pos)
  }, [])

  const deleteVertex = useCallback((vertexId: string) => {
    const { readOnly: ro, path, onVertexDeleted, onSelectionChanged } = optsRef.current
    if (ro) return
    const minPoints = path.closed ? 3 : 2
    if (path.vertices.length <= minPoints) return
    if (sessionRef.current.selectedVertexIds.includes(vertexId)) {
      updateSession({ selectedVertexIds: [] })
      onSelectionChanged?.([], sessionRef.current.selectedSegmentId)
    }
    onVertexDeleted?.(vertexId)
  }, [updateSession])

  const deleteSelected = useCallback(() => {
    const { readOnly: ro, onSelectionChanged } = optsRef.current
    if (ro) return
    for (const vid of sessionRef.current.selectedVertexIds) {
      deleteVertex(vid)
    }
    updateSession({ selectedVertexIds: [], selectedSegmentId: null })
    onSelectionChanged?.([], null)
  }, [deleteVertex, updateSession])

  const setSegmentType = useCallback((segmentId: string, type: 'straight' | 'arc') => {
    const { readOnly: ro, onSegmentTypeChanged } = optsRef.current
    if (ro) return
    onSegmentTypeChanged?.(segmentId, type)
  }, [])

  const setCurvature = useCallback((segmentId: string, curvature: number) => {
    const { readOnly: ro, onCurvatureChanged } = optsRef.current
    if (ro) return
    onCurvatureChanged?.(segmentId, curvature)
  }, [])

  return {
    session,

    onVertexPointerDown,
    onSegmentPointerDown,
    onPointerMove,
    onPointerUp,
    onCanvasClick,

    setShiftHeld: (held: boolean) => updateSession({ shiftHeld: held }),
    setHoveredVertex: (vertexId: string | null) => updateSession({ hoveredVertexId: vertexId }),
    setHoveredSegment: (segmentId: string | null) => updateSession({ hoveredSegmentId: segmentId }),

    insertVertex,
    deleteVertex,
    deleteSelected,
    setSegmentType,
    setCurvature,
  }
}
