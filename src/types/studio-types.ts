import type { LatLng } from './nav-types'

// ---- Studio UI Types ----

export type BaseStyleKey = 'osm' | 'satellite' | 'positron' | 'dark' | 'streets'

export interface PositionEditTarget {
  type: 'building' | 'entrance' | 'panorama' | 'qr'
  id: string
}

export type StudioTool =
  | 'select'
  | 'move'
  | 'room'
  | 'space'
  | 'asset'
  | 'qr'
  | 'pano'
  | 'route'
  | 'boundary'
  | 'building'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'vertex'
  | 'entrance'
  | 'elevator'
  | 'hallway'
  | 'route-node'
  | 'route-edge'

export type EditorMode = 'campus' | 'building' | 'floor' | '360-tour'

export type LayerType =
  | 'floor_plan'
  | 'buildings'
  | 'rooms'
  | 'hallways'
  | 'assets'
  | 'nodes'
  | 'edges'
  | 'labels'

export type RoomPreset = 'rectangle' | 'lshape' | 'freeform'

export interface StudioViewState {
  center: { lat: number; lng: number }
  zoom: number
  activeFloor: number
  activeBuildingId: string | null
}

export type ValidationFocusGeometry =
  | { kind: 'point'; position: LatLng }
  | { kind: 'line'; points: LatLng[] }
  | { kind: 'polygon'; points: LatLng[] }

/** Temporary, non-persisted map focus for one validation issue target. */
export interface ValidationFocus {
  issueId: string
  targetId: string
  targetType: string
  buildingId?: string
  floor?: number
  layer?: string
  geometry: ValidationFocusGeometry
}

export interface LayerVisibility {
  floor_plan: boolean
  buildings: boolean
  rooms: boolean
  hallways: boolean
  assets: boolean
  nodes: boolean
  edges: boolean
  labels: boolean
  walls3d: boolean
  /** Studio-only diagnostic visibility for persisted navigation-only routes. */
  navigation_only_routes?: boolean
  /** Studio-only reveal for POIs authored with showOnMap=false. */
  hidden_pois?: boolean
}

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  floor_plan: false,
  buildings: true,
  rooms: true,
  hallways: true,
  assets: true,
  nodes: false,
  edges: false,
  labels: true,
  walls3d: true,
  navigation_only_routes: false,
  hidden_pois: false,
}
