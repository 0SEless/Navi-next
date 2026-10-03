export { genId } from './id'
export * from './context'
export * from './eventbus'
export * from './commands'
export { HistoryStack } from './history'
export type { HistoryEntry } from './history'
export * from './tools'
export { SelectionManager } from './selection'
export type { SelectionState } from './selection'
export { Viewport } from './viewport'
export type { ViewportCommand, ViewportState } from './viewport'
export { EditingContextService } from './editing-context'
export type { EditorMode } from './editing-context'
export * from './validation'
export * from './shell'
export * from './panels'
export * from './rendering'
export * from './projections'
export * from './services'
export { GraphAdapter } from './graph-adapter'
// P1-T11 (R11.4): exported so consumers use the package channel instead of
// relative paths into packages/editor internals.
export { resolveLevelGeometry } from './geometry/resolve-level-geometry'
// 12A.2: Export canonical InteractionController for event routing/tool delegation
export { InteractionController } from './interaction/interaction-controller'
export type { InteractionEvent, InteractionTarget, InteractionControllerOptions } from './interaction/interaction-controller'
export { FloorPlanUpload } from './ui/FloorPlanUpload'
export * from './ui/plan-upload'
// P2-T7: Canvas editor modules (behind ENABLE_CANVAS_EDITOR flag)
export { ENABLE_CANVAS_EDITOR } from './canvas/feature-flag'
export type { CameraState, CameraOverrides, Point2D, CanvasSize, AlignmentParams } from './canvas/viewport'
export { createCamera, worldToScreen, screenToWorld, applyCamera, resetCamera, drawFloorPlanImage } from './canvas/viewport'
export type { FloorRenderContext } from './canvas/floor-renderer'
export { renderFloor, renderRooms, renderHallways, renderStairsElevators, renderInteractionOverlays } from './canvas/floor-renderer'
export type { HitResult, HitEntityType } from './canvas/hit-test'
export { hitTestFloor, pointInPolygon, pointNearPolyline } from './canvas/hit-test'
export type { SelectionState as CanvasSelectionState } from './canvas/selection'
export { handleCanvasClick } from './canvas/selection'
export { handleKeyboard } from './canvas/keyboard-nav'
// P3-T1: Canvas viewport React component and hook
export { CanvasViewport } from './canvas/CanvasViewport'
export type { CanvasViewportProps, CanvasViewportHandle } from './canvas/CanvasViewport'
export { useCanvasViewport } from './canvas/use-canvas-viewport'
export type { CanvasViewportRef, UseCanvasViewportResult } from './canvas/use-canvas-viewport'
// P3-T2: Component → FloorGeometry converter
export { componentsToFloorGeometry } from './canvas/component-converter'
// P3-T3: Canvas pointer event handling
export { useCanvasEvents } from './canvas/use-canvas-events'
export type { CanvasEventHandlers, UseCanvasEventsOptions } from './canvas/use-canvas-events'
// P3-T4: Canvas selection hook
export { useCanvasSelection } from './canvas/use-canvas-selection'
export type { UseCanvasSelectionResult } from './canvas/use-canvas-selection'
// P3-T5: Canvas editing adapter (vertex/midpoint)
export { useCanvasEditingAdapter } from './canvas/use-canvas-editing'
// P4-T4: MapLibre → Canvas camera bridge
export { useMapCameraBridge } from './canvas/use-map-camera-bridge'
export { useMapLibreCamera } from './canvas/use-maplibre-camera'
export type { MapLibreCameraState, MapLike } from './canvas/use-maplibre-camera'
// P3-T6: Floor plan image loading
export { useFloorPlanImage } from './canvas/use-floor-plan-image'
// P3-T7: Building footprint rendering
export { renderFootprint } from './canvas/floor-renderer'
// P2A.1: Drawing foundation
export { canvasDrawReducer, INITIAL_CANVAS_DRAW_STATE } from './canvas/canvas-draw-reducer'
export type { CanvasDrawState, CanvasDrawAction, CanvasDrawMode } from './canvas/canvas-draw-reducer'
export { renderDrawingTrace, renderDrawingCursor, renderDrawingPolygon, renderDrawingVertices, renderDrawingPreview } from './canvas/drawing-preview-renderer'
export type { DrawingStyle } from './canvas/drawing-preview-renderer'
export { snapToNearest, findAllSnaps } from './canvas/snap-bridge'
export type { SnapBridgeResult, SnapBridgeOptions } from './canvas/snap-bridge'
export { snapPoint } from './geometry/snapping'
export type { Point2D as SnapPoint2D, SnapSegment2D, SnapConfig, SnapType, SnapResult } from './geometry/snapping'
// Geographic road authoring uses a distinct contract from the canvas snap
// helper above: (LatLng, Road[]) -> LatLng.
export { snapPoint as snapRoadPoint } from './commands/road-snap'
export {
  DEFAULT_WALL_JUNCTION_TOLERANCE,
  getWallJunctions,
  moveWallJunction,
  snapWallJunctionPosition,
  validateWallGeometry,
} from './geometry/wall-editing'
export type { WallEndpointName, WallEndpointRef, WallJunction } from './geometry/wall-editing'
// W6B: Semantic room metadata
export { matchRoomAttributes, applyRoomAttributes, getRoomByFaceId, getSearchableRooms } from './geometry/semantic-room-store'
// W9: RoomAccess CRUD, validation, and search resolution
export {
  validateRoomAccess,
  addRoomAccess,
  removeRoomAccess,
  setPrimaryAccess,
  getPrimaryAccess,
  resolveRoomAccess,
  sanitizeAccessForOpeningDeletion,
  sanitizeAccessForNodeDeletion,
} from './geometry/semantic-room-store'
export type { RoomAccessValidationError } from './geometry/semantic-room-store'
export { FaceIdentityTracker, matchDerivedRoomIdentities } from './geometry/face-identity'
export type { FaceIdentity, IdentityMatchResult } from './geometry/face-identity'
