import type { RoomAttributes, RoomAccess, Opening, RouteNetwork } from '@navi/core'
import type { FaceIdentity, IdentityMatchResult } from './face-identity'

/**
 * W6B/W6C: Semantic Room Metadata — Service Layer
 *
 * SemanticRoomStore is a SERVICE over Floor.roomAttributes[], not an independent store.
 * CampusDocument.Floor.roomAttributes[] is the canonical authoritative source.
 * This service provides matching, retrieval, and manipulation utilities.
 */

/**
 * Match existing RoomAttributes to new derived rooms via faceId.
 *
 * Rules:
 * - When face is matched with high confidence (>threshold): attach existing attributes
 * - When face is split: one half keeps original attributes, other gets "Unassigned"
 * - When face is merged with ambiguity: both candidates marked as "Needs Review"
 * - When face is new: "Unassigned"
 */
export function matchRoomAttributes(
  identityResult: IdentityMatchResult,
  previousAttributes: readonly RoomAttributes[],
  overlapThreshold = 0.7,
): Map<string, RoomAttributes> {
  const matched = new Map<string, RoomAttributes>()

  // Build lookup from previous attributes
  const attributeLookup = new Map<string, RoomAttributes>()
  for (const attr of previousAttributes) {
    attributeLookup.set(attr.faceId, attr)
  }

  for (let i = 0; i < identityResult.identities.length; i++) {
    const identity = identityResult.identities[i]
    const isAmbiguous = identityResult.ambiguousIndices.includes(i)

    if (isAmbiguous) {
      // Merge ambiguity: mark as "Needs Review"
      matched.set(identity.faceId, {
        faceId: identity.faceId,
        name: 'Needs Review',
        searchable: false,
      })
      continue
    }

    // Check if this identity matched an existing one
    if (identity.sourceFaceIds.length === 0) {
      // New face — check if direct match exists
      const existing = attributeLookup.get(identity.faceId)
      if (existing) {
        // Direct match — preserve attributes with new faceId
        matched.set(identity.faceId, { ...existing, faceId: identity.faceId })
      } else {
        // Truly new face — "Unassigned"
        matched.set(identity.faceId, {
          faceId: identity.faceId,
          name: 'Unassigned',
          searchable: false,
        })
      }
    } else if (identity.sourceFaceIds.length === 1) {
      // Single source — split or identity preserved
      const sourceFaceId = identity.sourceFaceIds[0]
      const existing = attributeLookup.get(sourceFaceId)

      if (existing) {
        // Identity preserved or split: keep attributes
        matched.set(identity.faceId, { ...existing, faceId: identity.faceId })
      } else {
        matched.set(identity.faceId, {
          faceId: identity.faceId,
          name: 'Unassigned',
          searchable: false,
        })
      }
    } else {
      // Multiple sources — merge happened
      let foundAttributes: RoomAttributes | undefined
      for (const sourceId of identity.sourceFaceIds) {
        const existing = attributeLookup.get(sourceId)
        if (existing) {
          foundAttributes = existing
          break
        }
      }

      if (foundAttributes) {
        matched.set(identity.faceId, { ...foundAttributes, faceId: identity.faceId })
      } else {
        matched.set(identity.faceId, {
          faceId: identity.faceId,
          name: 'Unassigned',
          searchable: false,
        })
      }
    }
  }

  return matched
}

/**
 * Apply matched room attributes to a Floor's roomAttributes array.
 * This is the canonical write path — always writes to Floor.roomAttributes[].
 */
export function applyRoomAttributes(
  existing: readonly RoomAttributes[],
  matches: Map<string, RoomAttributes>,
): RoomAttributes[] {
  // Start with existing, update/add from matches
  const result = new Map<string, RoomAttributes>()
  for (const attr of existing) {
    result.set(attr.faceId, attr)
  }
  for (const [faceId, attrs] of matches) {
    result.set(faceId, attrs)
  }
  return Array.from(result.values())
}

/**
 * Get room attributes for a face from the canonical Floor.roomAttributes[].
 */
export function getRoomByFaceId(
  roomAttributes: readonly RoomAttributes[],
  faceId: string,
): RoomAttributes | undefined {
  return roomAttributes.find(r => r.faceId === faceId)
}

/**
 * Get all searchable rooms from Floor.roomAttributes[].
 */
export function getSearchableRooms(
  roomAttributes: readonly RoomAttributes[],
): RoomAttributes[] {
  return roomAttributes.filter(r => r.searchable)
}

// ── W9: RoomAccess CRUD + validation + search resolution ──

export type RoomAccessValidationError =
  | 'OPENING_NOT_FOUND'
  | 'OPENING_NOT_DOOR'
  | 'ROUTE_NODE_NOT_FOUND'
  | 'DUPLICATE_OPENING'

/**
 * Validate a RoomAccess before adding it.
 * Returns null if valid, or the error code.
 */
export function validateRoomAccess(
  access: RoomAccess,
  openings: readonly Opening[],
  routeNetwork: RouteNetwork | undefined,
): RoomAccessValidationError | null {
  if (access.openingId !== undefined) {
    const opening = openings.find(o => o.id === access.openingId)
    if (!opening) return 'OPENING_NOT_FOUND'
    if (opening.type !== 'door') return 'OPENING_NOT_DOOR'
  }

  if (!routeNetwork) return 'ROUTE_NODE_NOT_FOUND'
  const nodeExists = routeNetwork.nodes.some(n => n.id === access.routeNodeId)
  if (!nodeExists) return 'ROUTE_NODE_NOT_FOUND'

  return null
}

/**
 * Add a RoomAccess to RoomAttributes.
 * Returns the updated accessPoints array (new immutable reference).
 * Returns null if validation fails.
 */
export function addRoomAccess(
  roomAttributes: RoomAttributes,
  access: RoomAccess,
  openings: readonly Opening[],
  routeNetwork: RouteNetwork | undefined,
): { accessPoints: RoomAccess[]; error: null } | { accessPoints: null; error: RoomAccessValidationError } {
  const existing = roomAttributes.accessPoints ?? []
  if (existing.some(a => a.openingId === access.openingId && a.routeNodeId === access.routeNodeId)) {
    return { accessPoints: null, error: 'DUPLICATE_OPENING' }
  }

  const validationError = validateRoomAccess(access, openings, routeNetwork)
  if (validationError) return { accessPoints: null, error: validationError }

  // If this is the first access point, or the author explicitly marks it as
  // primary, make it the only primary access point.
  const shouldBePrimary = existing.length === 0 || access.primary
  const updatedExisting = shouldBePrimary
    ? existing.map((candidate) => ({ ...candidate, primary: false }))
    : existing
  const newAccess = { ...access, primary: shouldBePrimary }

  return { accessPoints: [...updatedExisting, newAccess], error: null }
}

/**
 * Remove a RoomAccess by openingId.
 * Returns the updated accessPoints array.
 */
export function removeRoomAccess(
  roomAttributes: RoomAttributes,
  openingId: string,
): RoomAccess[] {
  const existing = roomAttributes.accessPoints ?? []
  return existing.filter(a => a.openingId !== openingId)
}

/**
 * Set the primary access point by openingId.
 * Clears primary on all others. Returns updated accessPoints.
 */
export function setPrimaryAccess(
  roomAttributes: RoomAttributes,
  openingId: string,
): RoomAccess[] | null {
  const existing = roomAttributes.accessPoints ?? []
  const target = existing.find(a => a.openingId === openingId)
  if (!target) return null

  return existing.map(a => ({
    ...a,
    primary: a.openingId === openingId,
  }))
}

/**
 * Get the primary access point, or the first if none marked primary.
 */
export function getPrimaryAccess(
  roomAttributes: RoomAttributes,
): RoomAccess | undefined {
  const existing = roomAttributes.accessPoints ?? []
  return existing.find(a => a.primary) ?? existing[0]
}

/**
 * Resolve room access to a route node ID.
 * Returns the primary access point's routeNodeId, or null if none.
 */
export function resolveRoomAccess(
  roomAttributes: RoomAttributes,
): string | undefined {
  const primary = getPrimaryAccess(roomAttributes)
  return primary?.routeNodeId
}

/**
 * Sanitize access points when an opening is deleted.
 * Removes any access point referencing the deleted opening.
 */
export function sanitizeAccessForOpeningDeletion(
  roomAttributes: RoomAttributes,
  openingId: string,
): RoomAccess[] | undefined {
  const existing = roomAttributes.accessPoints
  if (!existing) return undefined
  const filtered = existing.filter(a => a.openingId !== openingId)
  return filtered.length === existing.length ? undefined : filtered
}

/**
 * Sanitize access points when a route node is deleted.
 * Removes any access point referencing the deleted node.
 */
export function sanitizeAccessForNodeDeletion(
  roomAttributes: RoomAttributes,
  nodeId: string,
): RoomAccess[] | undefined {
  const existing = roomAttributes.accessPoints
  if (!existing) return undefined
  const filtered = existing.filter(a => a.routeNodeId !== nodeId)
  return filtered.length === existing.length ? undefined : filtered
}
