import { create } from 'zustand'
import type { StudioTool, EditorMode, LayerVisibility, BaseStyleKey, PositionEditTarget, ValidationFocus } from '../types/studio-types'
import { DEFAULT_LAYER_VISIBILITY } from '../types/studio-types'
import type { LatLng } from '../types/nav-types'
import type { RoadConnectionRequest } from '@navi/editor'
import { DEFAULT_BASE_STYLE } from '../components/studio/rendering/styles'


type PendingType = 'building' | 'boundary' | 'route' | 'area' | 'import-osm' | 'set-boundary' | null

interface PendingConfirm {
  type: NonNullable<PendingType>
  points: { lat: number; lng: number }[]
  /** Fix 1: explicit Connect / Keep Separate decisions applied atomically by road.create. */
  connections?: RoadConnectionRequest[]
}

interface StudioState {
  tool: StudioTool
  editorMode: EditorMode
  activeBuildingId: string | null
  activeFloor: number
  layers: LayerVisibility
  baseStyle: BaseStyleKey

  setTool: (tool: StudioTool) => void
  setEditorMode: (mode: EditorMode) => void
  setActiveBuilding: (id: string | null) => void
  setActiveFloor: (floor: number) => void
  toggleLayer: (layer: keyof LayerVisibility) => void
  setLayers: (layers: Partial<LayerVisibility>) => void
  setBaseStyle: (style: BaseStyleKey) => void

  tracePoints: { lat: number; lng: number }[]
  addTracePoint: (point: { lat: number; lng: number }) => void
  setTracePoints: (points: { lat: number; lng: number }[]) => void
  clearTracePoints: () => void
  undoLastTracePoint: () => void

  pendingConfirm: PendingConfirm | null
  setPendingConfirm: (type: PendingType, points: { lat: number; lng: number }[], connections?: RoadConnectionRequest[]) => void
  clearPendingConfirm: () => void

  selectedTraceId: string | null
  setSelectedTraceId: (id: string | null) => void

  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void

  drawPoints: LatLng[]
  setDrawPoints: (points: LatLng[]) => void
  clearDrawPoints: () => void

  routeWidth: number
  setRouteWidth: (width: number) => void

  isVertexEditing: boolean
  editTargetType: 'trace' | 'building' | 'boundary' | 'room' | null
  editTargetId: string | null
  setVertexEditing: (targetType: StudioState['editTargetType'], targetId: string | null) => void

  positionEditTarget: PositionEditTarget | null
  setPositionEditTarget: (target: PositionEditTarget | null) => void

  /** Temporary validation highlight; never serialized with the campus document. */
  validationFocus: ValidationFocus | null
  setValidationFocus: (focus: ValidationFocus | null) => void
}

const defaultLayers: LayerVisibility = DEFAULT_LAYER_VISIBILITY

export const useStudioStore = create<StudioState>((set) => ({
  tool: 'select',
  editorMode: 'campus',
  activeBuildingId: null,
  activeFloor: 0,
  layers: { ...defaultLayers },
  baseStyle: DEFAULT_BASE_STYLE,
  tracePoints: [],
  drawPoints: [],
  routeWidth: 8,

  setTool: (tool) => set({ tool }),
  setEditorMode: (mode) => set({ editorMode: mode }),
  setActiveBuilding: (id) => set((s) => ({ activeBuildingId: id, activeFloor: id === s.activeBuildingId ? s.activeFloor : 0 })),
  setActiveFloor: (floor) => set({ activeFloor: floor }),
  toggleLayer: (layer) => set((s) => ({
    layers: { ...s.layers, [layer]: !s.layers[layer] },
  })),
  setLayers: (layers) => set((s) => ({
    layers: { ...s.layers, ...layers },
  })),
  setBaseStyle: (style) => set({ baseStyle: style }),

  addTracePoint: (point) => set((s) => ({
    tracePoints: [...s.tracePoints, point],
  })),
  setTracePoints: (points) => set({ tracePoints: points }),
  clearTracePoints: () => set({ tracePoints: [] }),
  undoLastTracePoint: () => set((s) => ({
    tracePoints: s.tracePoints.slice(0, -1),
  })),

  pendingConfirm: null,
  setPendingConfirm: (type, points, connections) => set({ pendingConfirm: type ? { type, points, connections } : null }),
  clearPendingConfirm: () => set({ pendingConfirm: null }),

  selectedTraceId: null,
  setSelectedTraceId: (id) => set({ selectedTraceId: id, selectedNodeId: null }),

  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id, selectedTraceId: null }),

  isVertexEditing: false,
  editTargetType: null,
  editTargetId: null,
  setVertexEditing: (targetType, targetId) => set({
    isVertexEditing: targetType !== null,
    editTargetType: targetType,
    editTargetId: targetId,
    tool: targetType !== null ? 'vertex' : 'select',
  }),

  positionEditTarget: null,
  setPositionEditTarget: (target) => set({ positionEditTarget: target }),

  validationFocus: null,
  setValidationFocus: (focus) => set({ validationFocus: focus }),

  setRouteWidth: (width) => set({ routeWidth: Math.max(2, Math.min(24, width)) }),

  setDrawPoints: (points) => set({ drawPoints: points }),
  clearDrawPoints: () => set({ drawPoints: [] }),
}))
