import { recordChange } from '@navi/core'
import type { CampusDocument, RoomAttributes, Wall } from '@navi/core'
import type { Command, CommandHandler, MutationResult } from './types'
import { genId } from '../id'
import { deriveRooms } from '../geometry/room-derivation'
import { wallsToSegments } from '../geometry/wall-to-segment'

type SemanticRoomChanges = Partial<Pick<RoomAttributes, 'name' | 'type' | 'code' | 'description' | 'number' | 'category' | 'searchable' | 'accessPoints'>>

function findFloor(document: CampusDocument, buildingId: string, floorId: string) {
  const building = document.buildings.find((candidate) => candidate.id === buildingId)
  if (!building) return null
  const floor = building.floors.find((candidate) => candidate.id === floorId)
  return floor ? { building, floor } : null
}

function hasDerivedFace(floor: { walls?: Wall[] }, faceId: string): boolean {
  if (!faceId || !floor.walls?.length) return false
  return deriveRooms(wallsToSegments(floor.walls), []).some((room) => room.faceId === faceId)
}

function findAttribute(floor: { roomAttributes?: RoomAttributes[] }, payload: Record<string, unknown>) {
  const roomId = payload.roomId as string | undefined
  const faceId = payload.faceId as string | undefined
  return floor.roomAttributes?.find((attribute) =>
    (roomId ? attribute.roomId === roomId : false) || (faceId ? attribute.faceId === faceId : false),
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function changesFromPayload(payload: Record<string, unknown>): SemanticRoomChanges {
  const raw = payload.changes
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const changes = raw as Record<string, unknown>
  const result: SemanticRoomChanges = {}
  if (typeof changes.name === 'string') result.name = changes.name
  if (typeof changes.type === 'string') result.type = changes.type
  if (typeof changes.code === 'string') result.code = changes.code
  if (typeof changes.description === 'string') result.description = changes.description
  if (typeof changes.number === 'string') result.number = changes.number
  if (typeof changes.category === 'string') result.category = changes.category
  if (typeof changes.searchable === 'boolean') result.searchable = changes.searchable
  if (Array.isArray(changes.accessPoints)) result.accessPoints = changes.accessPoints as RoomAttributes['accessPoints']
  return result
}

export const semanticRoomDeclareHandler: CommandHandler = {
  id: 'roomAttributes.declare',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }

    const supplied = (payload.attribute ?? payload.attributes) as Partial<RoomAttributes> | undefined
    const faceId = (supplied?.faceId ?? payload.faceId) as string | undefined
    if (!faceId) return { success: false, error: 'faceId is required' }
    if (!hasDerivedFace(ctx.floor, faceId)) return { success: false, error: `Derived face not found: ${faceId}` }

    const existing = ctx.floor.roomAttributes ?? []
    if (existing.some((attribute) => attribute.faceId === faceId)) {
      return { success: false, error: `Face already has semantic Room attributes: ${faceId}` }
    }

    const roomId = (supplied?.roomId ?? payload.roomId ?? genId('room')) as string
    if (existing.some((attribute) => attribute.roomId === roomId)) {
      return { success: false, error: `Semantic Room already exists: ${roomId}` }
    }

    const attribute: RoomAttributes = {
      faceId,
      roomId,
      name: (supplied?.name ?? payload.name ?? 'Room') as string,
      searchable: typeof (supplied?.searchable ?? payload.searchable) === 'boolean'
        ? (supplied?.searchable ?? payload.searchable) as boolean
        : true,
      ...(optionalString(supplied?.type ?? payload.type) ? { type: optionalString(supplied?.type ?? payload.type) } : {}),
      ...(optionalString(supplied?.code ?? payload.code) ? { code: optionalString(supplied?.code ?? payload.code) } : {}),
      ...(optionalString(supplied?.description ?? payload.description) ? { description: optionalString(supplied?.description ?? payload.description) } : {}),
      ...(optionalString(supplied?.number ?? payload.number) ? { number: optionalString(supplied?.number ?? payload.number) } : {}),
      ...(optionalString(supplied?.category ?? payload.category) ? { category: optionalString(supplied?.category ?? payload.category) } : {}),
      ...(Array.isArray(supplied?.accessPoints) ? { accessPoints: supplied.accessPoints } : {}),
    }

    ctx.floor.roomAttributes = [...existing, attribute]
    recordChange(document, { entityId: roomId, entityType: 'roomAttributes', operation: 'created' })
    return { success: true, entityId: roomId, data: { buildingId, floorId, attribute } }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const attribute = result.data?.attribute as RoomAttributes | undefined
    if (!attribute) return null
    return {
      id: 'roomAttributes.unassign',
      label: 'Undo Declare Room',
      payload: { buildingId: result.data?.buildingId, floorId: result.data?.floorId, roomId: attribute.roomId, faceId: attribute.faceId },
    }
  },
}

export const semanticRoomUpdateHandler: CommandHandler = {
  id: 'roomAttributes.update',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }
    const existing = findAttribute(ctx.floor, payload)
    if (!existing) return { success: false, error: 'Semantic Room attributes not found' }

    const changes = changesFromPayload(payload)
    if (Object.keys(changes).length === 0) return { success: false, error: 'No semantic Room changes provided' }
    const oldChanges: SemanticRoomChanges = {}
    for (const key of Object.keys(changes) as Array<keyof SemanticRoomChanges>) {
      oldChanges[key] = existing[key]
    }
    Object.assign(existing, changes)

    recordChange(document, { entityId: existing.roomId ?? existing.faceId, entityType: 'roomAttributes', operation: 'updated' })
    return { success: true, entityId: existing.roomId ?? existing.faceId, data: { buildingId, floorId, oldChanges, faceId: existing.faceId, roomId: existing.roomId } }
  },
  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    return {
      id: 'roomAttributes.update',
      label: 'Undo Room Metadata Edit',
      payload: {
        buildingId: result.data?.buildingId ?? payload.buildingId,
        floorId: result.data?.floorId ?? payload.floorId,
        roomId: result.data?.roomId ?? payload.roomId,
        faceId: result.data?.faceId ?? payload.faceId,
        changes: result.data?.oldChanges,
      },
    }
  },
}

export const semanticRoomUnassignHandler: CommandHandler = {
  id: 'roomAttributes.unassign',
  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const buildingId = payload.buildingId as string
    const floorId = payload.floorId as string
    const ctx = findFloor(document, buildingId, floorId)
    if (!ctx) return { success: false, error: `Building/floor not found: ${buildingId}/${floorId}` }
    const existing = ctx.floor.roomAttributes ?? []
    const attribute = findAttribute(ctx.floor, payload)
    if (!attribute) return { success: false, error: 'Semantic Room attributes not found' }

    ctx.floor.roomAttributes = existing.filter((candidate) => candidate !== attribute)
    recordChange(document, { entityId: attribute.roomId ?? attribute.faceId, entityType: 'roomAttributes', operation: 'deleted' })
    return { success: true, entityId: attribute.roomId ?? attribute.faceId, data: { buildingId, floorId, attribute } }
  },
  inverse(_payload: Record<string, unknown>, result: MutationResult): Command | null {
    const attribute = result.data?.attribute as RoomAttributes | undefined
    if (!attribute) return null
    return {
      id: 'roomAttributes.declare',
      label: 'Undo Unassign Room',
      payload: { buildingId: result.data?.buildingId, floorId: result.data?.floorId, attribute },
    }
  },
}
