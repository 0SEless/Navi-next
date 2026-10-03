export { ServiceRegistry, BaseEditorService } from './service-registry'
export type {
  EditorService,
  EditorServiceContext,
  ServiceStatus,
  Capability,
  ServiceMap,
  ServiceAccessor,
} from './service-registry'
export { EditorProvider, useEditor, serviceNames } from './editor-context'
export type { EditorContext } from './editor-context'

export { asEntityId, SelectionOrigin } from './entity-id'
export { DocumentStore } from './document-store'
export { useDocumentVersion } from './use-document-version'
export type {
  EntityId,
  EntityType,
  EntitySelector,
  BuildingSelector,
  FloorSelector,
  RoomSelector,
  HallwaySelector,
  StaircaseSelector,
  ElevatorSelector,
  EntranceSelector,
  RoadSelector,
  PanoramaSelector,
  QRSelector,
  AreaSelector,
  PoiSelector,
  SelectionMode,
  SelectionState,
} from './entity-id'
export { useSelection } from './selection-store'
export { SelectionBridge } from './selection-bridge'
export type { LegacySyncState, BridgeSyncTarget } from './selection-bridge'
export { useWorkspace } from './workspace-context'
export { useEditingEngine } from './use-editing-engine'
export type { EditingEngineValue } from './use-editing-engine'
export { createEditorContext } from './create-editor-context'
export { createDocument } from './create-editor-context'
export type { WorkspaceMode, Workspace } from '../projections/workspace'

export {
  findBuilding,
  findFloorByLevel,
  findFloorById,
  getBuildingFloors,
  getBuildingFloorCount,
  getFloorEntities,
  findRoom,
  findEntity,
  findComponent,
} from './selectors'
export type { FloorEntities, EntityResult } from './selectors'
export {
  useDocumentSelector,
  useActiveBuilding,
  useBuilding,
  useFloorCount,
  useFloor,
  useBuildingFloors,
} from './use-document-selector'
