'use client'

import { useCallback, useReducer } from 'react'
import type { EditablePolygon } from '@/types/polygon-types'
import { PolygonEngine } from './PolygonEngine'

export type PolygonEditorMode = 'idle' | 'dragging' | 'inserting' | 'drawing'

export interface EditablePolygonSession {
  polygon: EditablePolygon
  selectedRing: string | null
  hoveredVertex: string | null
  hoveredEdge: string | null
  draggedVertex: string | null
  mode: PolygonEditorMode
  history: { past: EditablePolygon[]; future: EditablePolygon[] }
}

type SessionAction =
  | { type: 'SET_POLYGON'; polygon: EditablePolygon }
  | { type: 'SET_HOVERED_VERTEX'; vertexId: string | null }
  | { type: 'SET_HOVERED_EDGE'; edgeId: string | null }
  | { type: 'SET_DRAGGED_VERTEX'; vertexId: string | null }
  | { type: 'SET_MODE'; mode: PolygonEditorMode }
  | { type: 'UNDO' }
  | { type: 'REDO' }

function sessionReducer(state: EditablePolygonSession, action: SessionAction): EditablePolygonSession {
  switch (action.type) {
    case 'SET_POLYGON':
      return { ...state, polygon: action.polygon, history: { ...state.history, past: [...state.history.past, state.polygon], future: [] } }
    case 'SET_HOVERED_VERTEX':
      return { ...state, hoveredVertex: action.vertexId }
    case 'SET_HOVERED_EDGE':
      return { ...state, hoveredEdge: action.edgeId }
    case 'SET_DRAGGED_VERTEX':
      return { ...state, draggedVertex: action.vertexId }
    case 'SET_MODE':
      return { ...state, mode: action.mode }
    case 'UNDO': {
      if (state.history.past.length === 0) return state
      const previous = state.history.past[state.history.past.length - 1]
      return {
        ...state,
        polygon: previous,
        history: {
          past: state.history.past.slice(0, -1),
          future: [state.polygon, ...state.history.future],
        },
      }
    }
    case 'REDO': {
      if (state.history.future.length === 0) return state
      const next = state.history.future[0]
      return {
        ...state,
        polygon: next,
        history: {
          past: [...state.history.past, state.polygon],
          future: state.history.future.slice(1),
        },
      }
    }
    default:
      return state
  }
}

interface UseEditablePolygonEditorOptions {
  polygon: EditablePolygon
}

export function useEditablePolygonEditor(options: UseEditablePolygonEditorOptions) {
  const [state, dispatch] = useReducer(sessionReducer, {
    polygon: options.polygon,
    selectedRing: options.polygon.rings[0]?.id ?? null,
    hoveredVertex: null,
    hoveredEdge: null,
    draggedVertex: null,
    mode: 'idle' as PolygonEditorMode,
    history: { past: [], future: [] },
  })

  const setHoveredVertex = useCallback((vertexId: string | null) => {
    dispatch({ type: 'SET_HOVERED_VERTEX', vertexId })
  }, [])

  const setHoveredEdge = useCallback((edgeId: string | null) => {
    dispatch({ type: 'SET_HOVERED_EDGE', edgeId })
  }, [])

  const setDraggedVertex = useCallback((vertexId: string | null) => {
    dispatch({ type: 'SET_DRAGGED_VERTEX', vertexId })
  }, [])

  const setMode = useCallback((mode: PolygonEditorMode) => {
    dispatch({ type: 'SET_MODE', mode })
  }, [])

  const updatePolygon = useCallback((updated: EditablePolygon) => {
    dispatch({ type: 'SET_POLYGON', polygon: updated })
  }, [])

  const operations = {
    moveVertex: useCallback((vertexId: string, pos: { x: number; y: number }) => {
      updatePolygon(PolygonEngine.moveVertex(state.polygon, vertexId, pos))
    }, [state.polygon, updatePolygon]),

    insertVertex: useCallback((startVId: string, endVId: string, pos: { x: number; y: number }) => {
      updatePolygon(PolygonEngine.insertVertex(state.polygon, startVId, endVId, pos))
    }, [state.polygon, updatePolygon]),

    deleteVertex: useCallback((vertexId: string) => {
      updatePolygon(PolygonEngine.deleteVertex(state.polygon, vertexId))
    }, [state.polygon, updatePolygon]),

    closePolygon: useCallback(() => {
      updatePolygon(PolygonEngine.closePolygon(state.polygon))
    }, [state.polygon, updatePolygon]),

    undo: useCallback(() => {
      dispatch({ type: 'UNDO' })
    }, []),

    redo: useCallback(() => {
      dispatch({ type: 'REDO' })
    }, []),
  }

  const handlers = {
    onVertexPointerDown: useCallback((vertexId: string) => {
      dispatch({ type: 'SET_DRAGGED_VERTEX', vertexId })
      dispatch({ type: 'SET_MODE', mode: 'dragging' })
    }, []),

    onEdgePointerDown: useCallback(() => {
      dispatch({ type: 'SET_MODE', mode: 'inserting' })
    }, []),

    onPointerMove: useCallback((_pos: { x: number; y: number }) => {
      // handled by overlay; position is tracked via map events
    }, []),

    onPointerUp: useCallback(() => {
      dispatch({ type: 'SET_DRAGGED_VERTEX', vertexId: null })
      dispatch({ type: 'SET_MODE', mode: 'idle' })
    }, []),
  }

  return { state, handlers, operations, setHoveredVertex, setHoveredEdge }
}
