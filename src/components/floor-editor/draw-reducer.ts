import type { LatLng } from '@/types/nav-types'

export type DrawMode = 'idle' | 'placing-points' | 'placing-polygon'

export interface DrawState {
  drawMode: DrawMode
  pendingPoints: LatLng[]
  pendingPolygon: LatLng[]
}

export type DrawAction =
  | { type: 'RESET' }
  | { type: 'ADD_POINT'; point: LatLng }
  | { type: 'ADD_POLYGON_POINT'; point: LatLng }
  | { type: 'CLEAR_POINTS' }
  | { type: 'CLEAR_POLYGON' }
  | { type: 'REMOVE_LAST_POLYGON_POINT' }

export function drawReducer(state: DrawState, action: DrawAction): DrawState {
  switch (action.type) {
    case 'RESET': return { drawMode: 'idle', pendingPoints: [], pendingPolygon: [] }
    case 'ADD_POINT': return { ...state, pendingPoints: [...state.pendingPoints, action.point], drawMode: 'placing-points' }
    case 'ADD_POLYGON_POINT': return { ...state, pendingPolygon: [...state.pendingPolygon, action.point], drawMode: 'placing-polygon' }
    case 'CLEAR_POINTS': return { ...state, pendingPoints: [], drawMode: 'idle' }
    case 'CLEAR_POLYGON': return { ...state, pendingPolygon: [], drawMode: 'idle' }
    case 'REMOVE_LAST_POLYGON_POINT': return { ...state, pendingPolygon: state.pendingPolygon.slice(0, -1) }
  }
}
