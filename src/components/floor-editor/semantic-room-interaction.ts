import type { Component } from '@/types/nav-types'

export const DERIVED_ROOM_LAYER_IDS = [
  'floor-derived-rooms-fill',
  'floor-derived-rooms-outline',
] as const

export interface DerivedRoomHit {
  faceId: string
  roomId?: string
}

export interface SemanticRoomIdentity {
  buildingId: string
  floorId: string
  roomId: string
  faceId: string
}

/** Read only the semantic identity fields emitted by the derived-face layer. */
export function readDerivedRoomHit(properties: Record<string, unknown>): DerivedRoomHit | null {
  if (typeof properties.faceId !== 'string' || properties.faceId.length === 0) return null
  return {
    faceId: properties.faceId,
    roomId: typeof properties.roomId === 'string' && properties.roomId.length > 0 ? properties.roomId : undefined,
  }
}

/** Return the canonical command identity for a projected semantic Room. */
export function getSemanticRoomIdentity(component: Component | null | undefined): SemanticRoomIdentity | null {
  if (component?.type !== 'room') return null
  if (component.metadata?.source !== 'derived-face' || component.metadata?.semanticRoom !== true) return null
  const floorId = component.metadata.floorId
  const faceId = component.metadata.faceId
  if (typeof floorId !== 'string' || floorId.length === 0) return null
  if (typeof faceId !== 'string' || faceId.length === 0) return null
  return { buildingId: component.buildingId, floorId, roomId: component.id, faceId }
}

/** Multi-click path drawing is reserved for the Route/Hallway tool. */
export function isPolygonAuthoringTool(tool: string): boolean {
  return tool === 'hallway'
}
