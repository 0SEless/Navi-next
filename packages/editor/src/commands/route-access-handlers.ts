import {
  addEntranceAccess,
  explicitEntranceAccessNodeId,
  recordChange,
  removeEntranceAccess,
  validateEntranceAccess,
} from '@navi/core'
import type { CampusDocument, EntranceAccess, RoomAccess, RoomAttributes } from '@navi/core'
import type { Command, CommandHandler, MutationResult } from './types'
import { addRoomAccess } from '../geometry/semantic-room-store'

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find((candidate) => candidate.id === buildingId)
  if (!building) return { error: `Building not found: ${buildingId}` }
  const floor = building.floors.find((candidate) => candidate.id === floorId)
  if (!floor) return { error: `Floor not found: ${floorId}` }
  return { building, floor }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function findRoomAttributes(floor: CampusDocument['buildings'][number]['floors'][number], faceId: string): RoomAttributes | undefined {
  return floor.roomAttributes?.find((candidate) => candidate.faceId === faceId)
}

function restoreAccessPointsPresent(payload: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(payload, 'restoreAccessPoints')
}

function restoreEntranceAccessPresent(payload: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(payload, 'restoreEntranceAccess')
}

function roomAccessError(error: string): string {
  const messages: Record<string, string> = {
    OPENING_NOT_FOUND: 'The selected opening does not exist on this floor',
    OPENING_NOT_DOOR: 'Room access can reference only a door opening in legacy/detail mode',
    ROUTE_NODE_NOT_FOUND: 'The selected route node does not exist on this floor',
    DUPLICATE_OPENING: 'This Room access point is already assigned',
  }
  return messages[error] ?? `Room access is invalid: ${error}`
}

export const roomAccessAssignHandler: CommandHandler = {
  id: 'room.access.assign',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const faceId = payload.faceId as string
    const routeNodeId = payload.routeNodeId as string
    if (!buildingId || !floorId || !faceId || !routeNodeId) {
      return { success: false, error: 'buildingId, floorId, faceId, and routeNodeId are required' }
    }
    if (payload.primary !== undefined && typeof payload.primary !== 'boolean') {
      return { success: false, error: 'primary must be a boolean when provided' }
    }

    const loc = findFloor(document, buildingId, floorId)
    if ('error' in loc) return { success: false, error: loc.error }
    const attributes = findRoomAttributes(loc.floor, faceId)
    if (!attributes) return { success: false, error: `Semantic Room attributes not found for face: ${faceId}` }

    const openingId = payload.openingId
    if (openingId !== undefined && typeof openingId !== 'string') {
      return { success: false, error: 'openingId must be a string when provided' }
    }

    const access: RoomAccess = {
      routeNodeId,
      primary: payload.primary === true,
      ...(openingId !== undefined ? { openingId } : {}),
    }
    const previousAccessPoints = attributes.accessPoints === undefined ? undefined : clone(attributes.accessPoints)
    const result = addRoomAccess(attributes, access, loc.floor.openings ?? [], loc.floor.routeNetwork)
    if (result.error) return { success: false, error: roomAccessError(result.error) }

    attributes.accessPoints = result.accessPoints
    recordChange(document, { entityId: attributes.roomId ?? faceId, entityType: 'roomAccess', operation: 'updated' })
    return {
      success: true,
      entityId: attributes.roomId ?? faceId,
      data: { buildingId, floorId, faceId, routeNodeId, previousAccessPoints },
    }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.data) return null
    return {
      id: 'room.access.unassign',
      label: 'Undo Assign Room Access',
      payload: {
        buildingId: result.data.buildingId,
        floorId: result.data.floorId,
        faceId: result.data.faceId,
        routeNodeId: result.data.routeNodeId,
        restoreAccessPoints: result.data.previousAccessPoints,
      },
    }
  },
}

export const roomAccessUnassignHandler: CommandHandler = {
  id: 'room.access.unassign',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const faceId = payload.faceId as string
    const routeNodeId = payload.routeNodeId as string
    if (!buildingId || !floorId || !faceId) {
      return { success: false, error: 'buildingId, floorId, and faceId are required' }
    }

    const loc = findFloor(document, buildingId, floorId)
    if ('error' in loc) return { success: false, error: loc.error }
    const attributes = findRoomAttributes(loc.floor, faceId)
    if (!attributes) return { success: false, error: `Semantic Room attributes not found for face: ${faceId}` }

    if (restoreAccessPointsPresent(payload)) {
      const restored = payload.restoreAccessPoints
      if (restored !== undefined && !Array.isArray(restored)) {
        return { success: false, error: 'restoreAccessPoints must be an array when provided' }
      }
      attributes.accessPoints = restored === undefined ? undefined : clone(restored as RoomAccess[])
      recordChange(document, { entityId: attributes.roomId ?? faceId, entityType: 'roomAccess', operation: 'restored' })
      return { success: true, entityId: attributes.roomId ?? faceId, data: { buildingId, floorId, faceId } }
    }

    if (!routeNodeId) return { success: false, error: 'routeNodeId is required' }
    const previousAccessPoints = attributes.accessPoints === undefined ? undefined : clone(attributes.accessPoints)
    const openingId = payload.openingId as string | undefined
    const remaining = (attributes.accessPoints ?? []).filter((access) =>
      !(access.routeNodeId === routeNodeId && (openingId === undefined || access.openingId === openingId)),
    )
    if (remaining.length === (attributes.accessPoints ?? []).length) {
      return { success: false, error: 'Room access point not found' }
    }

    attributes.accessPoints = remaining.length > 0 ? remaining : undefined
    recordChange(document, { entityId: attributes.roomId ?? faceId, entityType: 'roomAccess', operation: 'deleted' })
    return {
      success: true,
      entityId: attributes.roomId ?? faceId,
      data: { buildingId, floorId, faceId, routeNodeId, previousAccessPoints },
    }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.data) return null
    return {
      id: 'room.access.unassign',
      label: 'Undo Unassign Room Access',
      payload: {
        buildingId: result.data.buildingId,
        floorId: result.data.floorId,
        faceId: result.data.faceId,
        routeNodeId: result.data.routeNodeId,
        restoreAccessPoints: result.data.previousAccessPoints,
      },
    }
  },
}

export const entranceAccessAssignHandler: CommandHandler = {
  id: 'entrance.access.assign',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const entranceId = payload.entranceId as string
    const requestedOutdoorNodeId = payload.outdoorNodeId as string
    const indoorRouteNodeId = payload.indoorRouteNodeId as string
    const outdoorRouteId = payload.outdoorRouteId
    const outdoorPosition = payload.outdoorPosition as { lat?: unknown; lng?: unknown } | undefined
    if (!buildingId || !floorId || !entranceId || !requestedOutdoorNodeId || !indoorRouteNodeId) {
      return { success: false, error: 'buildingId, floorId, entranceId, outdoorNodeId, and indoorRouteNodeId are required' }
    }
    if (outdoorRouteId !== undefined && typeof outdoorRouteId !== 'string') {
      return { success: false, error: 'outdoorRouteId must be a string when provided' }
    }
    if (outdoorPosition !== undefined && (
      typeof outdoorPosition.lat !== 'number' || typeof outdoorPosition.lng !== 'number'
    )) {
      return { success: false, error: 'outdoorPosition must contain numeric lat and lng when provided' }
    }
    if ((outdoorRouteId === undefined) !== (outdoorPosition === undefined)) {
      return { success: false, error: 'outdoorRouteId and outdoorPosition must be provided together' }
    }

    const loc = findFloor(document, buildingId, floorId)
    if ('error' in loc) return { success: false, error: loc.error }
    const access: EntranceAccess = {
      entranceId,
      outdoorNodeId: outdoorRouteId !== undefined ? explicitEntranceAccessNodeId(entranceId) : requestedOutdoorNodeId,
      indoorRouteNodeId,
      ...(outdoorRouteId !== undefined ? { outdoorRouteId } : {}),
      ...(outdoorPosition !== undefined ? { outdoorPosition: { lat: outdoorPosition.lat as number, lng: outdoorPosition.lng as number } } : {}),
    }
    const validation = validateEntranceAccess(loc.floor, access)
    if (!validation.success) return { success: false, error: validation.error }

    const previousEntranceAccess = loc.floor.entranceAccess === undefined ? undefined : clone(loc.floor.entranceAccess)
    const result = addEntranceAccess(loc.floor, access)
    if (!result.success) return { success: false, error: result.error }

    recordChange(document, { entityId: entranceId, entityType: 'entranceAccess', operation: 'updated' })
    return {
      success: true,
      entityId: entranceId,
      data: { buildingId, floorId, entranceId, previousEntranceAccess },
    }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.data) return null
    return {
      id: 'entrance.access.unassign',
      label: 'Undo Assign Entrance Access',
      payload: {
        buildingId: result.data.buildingId,
        floorId: result.data.floorId,
        entranceId: result.data.entranceId,
        restoreEntranceAccess: result.data.previousEntranceAccess,
      },
    }
  },
}

export const entranceAccessUnassignHandler: CommandHandler = {
  id: 'entrance.access.unassign',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const entranceId = payload.entranceId as string
    if (!buildingId || !floorId || !entranceId) {
      return { success: false, error: 'buildingId, floorId, and entranceId are required' }
    }

    const loc = findFloor(document, buildingId, floorId)
    if ('error' in loc) return { success: false, error: loc.error }

    if (restoreEntranceAccessPresent(payload)) {
      const restored = payload.restoreEntranceAccess
      if (restored !== undefined && !Array.isArray(restored)) {
        return { success: false, error: 'restoreEntranceAccess must be an array when provided' }
      }
      loc.floor.entranceAccess = restored === undefined ? undefined : clone(restored as EntranceAccess[])
      recordChange(document, { entityId: entranceId, entityType: 'entranceAccess', operation: 'restored' })
      return { success: true, entityId: entranceId, data: { buildingId, floorId, entranceId } }
    }

    const previousEntranceAccess = loc.floor.entranceAccess === undefined ? undefined : clone(loc.floor.entranceAccess)
    const result = removeEntranceAccess(loc.floor, entranceId)
    if (!result.removed) return { success: false, error: `Entrance access not found: ${entranceId}` }

    recordChange(document, { entityId: entranceId, entityType: 'entranceAccess', operation: 'deleted' })
    return { success: true, entityId: entranceId, data: { buildingId, floorId, entranceId, previousEntranceAccess } }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.data) return null
    return {
      id: 'entrance.access.unassign',
      label: 'Undo Unassign Entrance Access',
      payload: {
        buildingId: result.data.buildingId,
        floorId: result.data.floorId,
        entranceId: result.data.entranceId,
        restoreEntranceAccess: result.data.previousEntranceAccess,
      },
    }
  },
}
