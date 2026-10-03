export { CommandRegistry } from './registry'
export { CommandDispatcher } from './dispatcher'
export type { ExecuteOptions } from './dispatcher'
export type { Command, CommandHandler, MutationResult, PreHook, PostHook } from './types'
export { buildingCreateHandler, buildingRenameHandler, buildingDeleteHandler } from './building-handlers'
export { roomCreateHandler, roomRenameHandler, roomDeleteHandler } from './room-handlers'
export { semanticRoomDeclareHandler, semanticRoomUpdateHandler, semanticRoomUnassignHandler } from './semantic-room-handlers'
export { hallwayCreateHandler, hallwayRenameHandler, hallwayDeleteHandler } from './hallway-handlers'
export { staircaseCreateHandler, staircaseDeleteHandler } from './staircase-handlers'
export { elevatorCreateHandler, elevatorDeleteHandler } from './elevator-handlers'
export { entranceCreateHandler, entranceDeleteHandler } from './entrance-handlers'
export { connectEntranceHandler, disconnectEntranceHandler } from './relationship-handlers'
export { roadCreateHandler, roadRenameHandler, roadDeleteHandler } from './road-handlers'
export { snapRoadEndpoints, snapPoint, nearestPointOnPolyline, ROAD_SNAP_RADIUS_METERS } from './road-snap'
export { findConnectivityCandidates, EDITOR_SNAP_RADIUS_METERS, AMBIGUITY_THRESHOLD_METERS } from './road-connectivity'
export {
  toRoadConnectionRequest,
  applyAuthoredConnection,
  applyKeepSeparate,
  findAuthoredJunction,
  type RoadConnectionRequest,
  type RoadConnectionAction,
} from './road-connectivity'
export { roadRecoveryApplyHandler } from './road-recovery-handlers'
export {
  detectLegacyConnections,
  buildRecoveryConnectionRequest,
  type LegacyConnectionCandidate,
  type LegacyConnectionKind,
  type LegacyConnectionConfidence,
} from '../connectivity/legacy-recovery'
export type { ConnectivityCandidate, ConnectivityResult, ConnectivityOptions } from './road-connectivity'
export type { SnapResult } from './road-snap'
export { panoramaCreateHandler, panoramaDeleteHandler } from './panorama-handlers'
export { qrCreateHandler, qrDeleteHandler } from './qr-handlers'
export { qrUpdateHandler } from './qr-handlers'
export { floorCreateHandler, floorRenameHandler, floorDeleteHandler, floorDuplicateHandler, floorReorderHandler } from './floor-handlers'
export { entityUpdateHandler } from './entity-update-handler'
export { buildRoadJunctionMovePlan } from './road-junction-geometry'
export type { RoadJunctionMoveGeometry, RoadJunctionMovePlan, RoadJunctionMoveRequest } from './road-junction-geometry'
export { floorManageHandler, buildingAdjustPositionHandler } from './ui-action-handlers'
export { boundarySetHandler, boundaryClearHandler } from './boundary-handlers'
export { areaCreateHandler, areaDeleteHandler } from './area-handlers'
export { parametricCreateHandler, parametricDeleteHandler, parametricUpdateHandler } from './parametric-handlers'
export { featureCreateHandler, featureUpdateHandler, featureModeTransitionHandler, featureDeleteHandler, featureReplaceHandler } from './feature-handlers'
export { poiCreateHandler, poiUpdateHandler, poiDeleteHandler } from './feature-handlers'
export { doorCreateHandler, doorUpdateHandler, doorDeleteHandler, doorDuplicateHandler } from './feature-handlers'
export { buildDuplicatedDoor } from './duplicate-helpers'
export { doorOwnershipReconcileHandler, needsDoorOwnershipReconcile } from './door-ownership'
export type { DoorOwnershipChange, DoorOwnershipSnapshot } from './door-ownership'
export { windowCreateHandler, windowUpdateHandler, windowDeleteHandler } from './feature-handlers'
export { routePathCreateHandler, routeNodeCreateHandler, routeNodeUpdateHandler, routeNodeDeleteHandler, routeEdgeCreateHandler, routeEdgeDeleteHandler } from './route-network-handlers'
export { roomAccessAssignHandler, roomAccessUnassignHandler, entranceAccessAssignHandler, entranceAccessUnassignHandler } from './route-access-handlers'
export { featureLevelUpdateHandler, featureLevelCopyHandler } from './levels-handlers'
export { wallCreateHandler, wallUpdateHandler, wallDeleteHandler } from './wall-handlers'
export { wallJunctionUpdateHandler } from './wall-junction-handlers'
export { wallSplitHandler, wallSplitUndoHandler, wallCrossingSplitHandler, wallCrossingSplitUndoHandler, wallTJunctionSplitHandler, wallMergeHandler, wallMergeUndoHandler } from './wall-topology-handlers'
