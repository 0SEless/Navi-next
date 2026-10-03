/**
 * P2A.1: Meter-space drawing state machine for the Canvas editor.
 *
 * Same state machine as the MapLibre drawReducer but operates in
 * building-local meters (LocalCoord[]) instead of LatLng[].
 *
 * States: idle → placing-polygon → idle (on confirm/cancel)
 */

import type { LocalCoord } from '@navi/core'

// ── Types ──

export type CanvasDrawMode = 'idle' | 'placing-polygon'

export interface CanvasDrawState {
  drawMode: CanvasDrawMode
  pendingPolygon: LocalCoord[]
}

export type CanvasDrawAction =
  | { type: 'RESET' }
  | { type: 'ADD_POLYGON_POINT'; point: LocalCoord }
  | { type: 'CLEAR_POLYGON' }
  | { type: 'REMOVE_LAST_POLYGON_POINT' }

// ── Initial state ──

export const INITIAL_CANVAS_DRAW_STATE: CanvasDrawState = {
  drawMode: 'idle',
  pendingPolygon: [],
}

// ── Reducer ──

export function canvasDrawReducer(state: CanvasDrawState, action: CanvasDrawAction): CanvasDrawState {
  switch (action.type) {
    case 'RESET':
      return { ...INITIAL_CANVAS_DRAW_STATE }

    case 'ADD_POLYGON_POINT':
      return {
        ...state,
        pendingPolygon: [...state.pendingPolygon, action.point],
        drawMode: 'placing-polygon',
      }

    case 'CLEAR_POLYGON':
      return {
        ...state,
        pendingPolygon: [],
        drawMode: 'idle',
      }

    case 'REMOVE_LAST_POLYGON_POINT': {
      const next = state.pendingPolygon.slice(0, -1)
      return {
        ...state,
        pendingPolygon: next,
        drawMode: next.length > 0 ? 'placing-polygon' : 'idle',
      }
    }
  }
}
