/**
 * RelationshipService — manages explicit relationships between domain entities.
 *
 * This is a pure domain service. It has no dependency on React, MapLibre, or UI.
 * It operates directly on the CampusDocument (source of truth).
 *
 * Responsibilities:
 *   connect()       — create a relationship atomically
 *   disconnect()    — remove a relationship atomically
 *   getRelationship() — query the current relationship
 *   getState()      — compute the relationship state
 *
 * Non-responsibilities (see relationship-system.md):
 *   ✗ rendering, ✗ commands, ✗ persistence, ✗ compiler, ✗ UI, ✗ spatial queries
 */

import type { CampusDocument, Entrance, Road } from '@navi/core'

// ── Relationship Types ──────────────────────────────────────────────────────

export type RelationshipType = 'entrance-road'

export interface Relationship {
  readonly ownerId: string
  readonly ownerType: string
  readonly targetId: string | null
  readonly targetType: string
  readonly relationshipType: RelationshipType
}

// ── Relationship States ─────────────────────────────────────────────────────

export type RelationshipState =
  | 'connected'    // Explicit link exists, both sides synchronized
  | 'suggested'    // System proposed a link, user hasn't accepted
  | 'invalid'      // Reference exists but target is missing
  | 'broken'       // Reference was valid but target was deleted
  | 'unresolved'   // No reference exists

// ── Result Types ────────────────────────────────────────────────────────────

export type ConnectResult =
  | { ok: true; relationship: Relationship }
  | { ok: false; error: ConnectError }

export type ConnectError =
  | { kind: 'already-connected'; currentTargetId: string }
  | { kind: 'invalid-target'; targetId: string; reason: string }
  | { kind: 'owner-not-found'; ownerId: string }
  | { kind: 'target-not-found'; targetId: string }

export type DisconnectResult =
  | { ok: true; previousTargetId: string | null }
  | { ok: false; error: DisconnectError }

export type DisconnectError =
  | { kind: 'owner-not-found'; ownerId: string }

// ── Entity Finders ──────────────────────────────────────────────────────────

interface EntityFinder {
  findEntrance(id: string): Entrance | null
  findRoad(id: string): Road | null
  findEntranceByRoad(roadId: string): Entrance | null
  setEntranceConnectorRoad(entranceId: string, roadId: string | null): void
  setRoadConnectorEntrance(roadId: string, entranceId: string | null): void
}

function createEntityFinder(document: CampusDocument): EntityFinder {
  return {
    findEntrance(id: string): Entrance | null {
      for (const bld of document.buildings) {
        for (const floor of bld.floors) {
          for (const ent of floor.entrances) {
            if (ent.id === id) return ent
          }
        }
      }
      return null
    },

    findRoad(id: string): Road | null {
      return document.roads.find(r => r.id === id) ?? null
    },

    findEntranceByRoad(roadId: string): Entrance | null {
      for (const bld of document.buildings) {
        for (const floor of bld.floors) {
          for (const ent of floor.entrances) {
            if (ent.connectorRoadId === roadId) return ent
          }
        }
      }
      return null
    },

    setEntranceConnectorRoad(entranceId: string, roadId: string | null): void {
      for (const bld of document.buildings) {
        for (const floor of bld.floors) {
          for (const ent of floor.entrances) {
            if (ent.id === entranceId) {
              ent.connectorRoadId = roadId ?? undefined
              return
            }
          }
        }
      }
    },

    setRoadConnectorEntrance(roadId: string, entranceId: string | null): void {
      const road = document.roads.find(r => r.id === roadId)
      if (road) {
        road.connectorEntranceId = entranceId ?? undefined
      }
    },
  }
}

// ── RelationshipService ─────────────────────────────────────────────────────

export class RelationshipService {
  private finder: EntityFinder

  constructor(private document: CampusDocument) {
    this.finder = createEntityFinder(document)
  }

  /**
   * Create a relationship between two entities atomically.
   *
   * Atomicity guarantee: either both sides are updated, or neither is.
   * There is no observable state where only one side is updated.
   *
   * @returns ConnectResult with the relationship or an error
   */
  connect(ownerId: string, targetId: string, relationshipType: RelationshipType): ConnectResult {
    // 1. Validate owner exists
    const owner = this.resolveOwner(ownerId, relationshipType)
    if (!owner) {
      return { ok: false, error: { kind: 'owner-not-found', ownerId } }
    }

    // 2. Validate target exists
    const target = this.resolveTarget(targetId, relationshipType)
    if (!target) {
      return { ok: false, error: { kind: 'invalid-target', targetId, reason: 'Target entity not found' } }
    }

    // 3. Check if already connected to this target
    if (owner.connectorRoadId === targetId) {
      return {
        ok: false,
        error: { kind: 'already-connected', currentTargetId: targetId },
      }
    }

    // 4. Check if already connected to a different target
    if (owner.connectorRoadId) {
      return {
        ok: false,
        error: { kind: 'already-connected', currentTargetId: owner.connectorRoadId },
      }
    }

    // 5. Validate no other owner claims this target
    const existingOwner = this.finder.findEntranceByRoad(targetId)
    if (existingOwner && existingOwner.id !== ownerId) {
      return {
        ok: false,
        error: { kind: 'invalid-target', targetId, reason: `Road is already connected to entrance "${existingOwner.label}"` },
      }
    }

    // 6. Atomic update — both sides simultaneously
    this.finder.setEntranceConnectorRoad(ownerId, targetId)
    this.finder.setRoadConnectorEntrance(targetId, ownerId)

    // 7. Return success
    const relationship: Relationship = {
      ownerId,
      ownerType: 'entrance',
      targetId,
      targetType: 'road',
      relationshipType,
    }

    return { ok: true, relationship }
  }

  /**
   * Remove a relationship atomically.
   *
   * Atomicity guarantee: both sides are cleared simultaneously.
   *
   * @returns DisconnectResult with the previous target ID or an error
   */
  disconnect(ownerId: string, relationshipType: RelationshipType): DisconnectResult {
    // 1. Validate owner exists
    const owner = this.resolveOwner(ownerId, relationshipType)
    if (!owner) {
      return { ok: false, error: { kind: 'owner-not-found', ownerId } }
    }

    // 2. Get current target before clearing
    const previousTargetId = owner.connectorRoadId ?? null

    // 3. Atomic clear — both sides simultaneously
    this.finder.setEntranceConnectorRoad(ownerId, null)
    if (previousTargetId) {
      this.finder.setRoadConnectorEntrance(previousTargetId, null)
    }

    return { ok: true, previousTargetId }
  }

  /**
   * Query the current relationship for an owner.
   *
   * @returns The relationship, or null if no relationship exists
   */
  getRelationship(ownerId: string, relationshipType: RelationshipType): Relationship | null {
    const owner = this.resolveOwner(ownerId, relationshipType)
    if (!owner) return null

    const targetId = owner.connectorRoadId ?? null
    if (!targetId) return null

    return {
      ownerId,
      ownerType: 'entrance',
      targetId,
      targetType: 'road',
      relationshipType,
    }
  }

  /**
   * Compute the current relationship state.
   *
   * State is derived from the document, not stored explicitly.
   */
  getState(ownerId: string, relationshipType: RelationshipType): RelationshipState {
    const owner = this.resolveOwner(ownerId, relationshipType)
    if (!owner) return 'unresolved'

    const targetId = owner.connectorRoadId
    if (!targetId) return 'unresolved'

    // Reference exists — check if target is valid
    const target = this.resolveTarget(targetId, relationshipType)
    if (!target) return 'invalid'

    // Both sides exist — check synchronization
    const backRef = this.getBackReference(targetId, relationshipType)
    if (backRef !== ownerId) return 'broken'

    return 'connected'
  }

  // ── Public Finders (read-only) ─────────────────────────────────────────────

  findEntrance(id: string): Entrance | null {
    return this.finder.findEntrance(id)
  }

  findRoad(id: string): Road | null {
    return this.finder.findRoad(id)
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private resolveOwner(ownerId: string, relationshipType: RelationshipType): Entrance | null {
    if (relationshipType === 'entrance-road') {
      return this.finder.findEntrance(ownerId)
    }
    return null
  }

  private resolveTarget(targetId: string, relationshipType: RelationshipType): Road | null {
    if (relationshipType === 'entrance-road') {
      return this.finder.findRoad(targetId)
    }
    return null
  }

  private getBackReference(targetId: string, relationshipType: RelationshipType): string | null {
    if (relationshipType === 'entrance-road') {
      const road = this.finder.findRoad(targetId)
      return road?.connectorEntranceId ?? null
    }
    return null
  }
}
