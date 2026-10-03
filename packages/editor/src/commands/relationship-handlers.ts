/**
 * Relationship command handlers — thin orchestration over RelationshipService.
 *
 * These commands contain NO relationship logic. They:
 * 1. Delegate to RelationshipService
 * 2. Record changes for the event bus
 * 3. Provide inverse commands for undo/redo
 *
 * All relationship invariants are maintained by RelationshipService.
 */

import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler, Command, MutationResult } from './types'
import { RelationshipService } from '../services/RelationshipService'

// ── Connect Entrance to Road ────────────────────────────────────────────────

export const connectEntranceHandler: CommandHandler = {
  id: 'entrance.connectRoad',

  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const entranceId = payload.entranceId as string
    const roadId = payload.roadId as string

    if (!entranceId || !roadId) {
      return { success: false, error: 'entranceId and roadId are required' }
    }

    // Delegate to service — all logic lives here
    const svc = new RelationshipService(document)
    const result = svc.connect(entranceId, roadId, 'entrance-road')

    if (!result.ok) {
      return { success: false, error: `${result.error.kind}: ${JSON.stringify(result.error)}` }
    }

    // Record change for event bus
    recordChange(document, {
      entityId: entranceId,
      entityType: 'entrance',
      operation: 'updated',
    })

    return {
      success: true,
      entityId: entranceId,
      data: {
        roadId,
        previousRoadId: null,
      },
    }
  },

  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.success) return null
    return {
      id: 'entrance.disconnectRoad',
      label: 'Undo Connect Entrance',
      payload: { entranceId: result.entityId },
    }
  },
}

// ── Disconnect Entrance from Road ───────────────────────────────────────────

export const disconnectEntranceHandler: CommandHandler = {
  id: 'entrance.disconnectRoad',

  execute(document: CampusDocument, payload: Record<string, unknown>): MutationResult {
    const entranceId = payload.entranceId as string

    if (!entranceId) {
      return { success: false, error: 'entranceId is required' }
    }

    // Delegate to service — all logic lives here
    const svc = new RelationshipService(document)
    const result = svc.disconnect(entranceId, 'entrance-road')

    if (!result.ok) {
      return { success: false, error: `${result.error.kind}: ${JSON.stringify(result.error)}` }
    }

    // Record change for event bus
    recordChange(document, {
      entityId: entranceId,
      entityType: 'entrance',
      operation: 'updated',
    })

    return {
      success: true,
      entityId: entranceId,
      data: {
        previousRoadId: result.previousTargetId,
      },
    }
  },

  inverse(payload: Record<string, unknown>, result: MutationResult): Command | null {
    if (!result.success) return null
    const previousRoadId = result.data?.previousRoadId as string | undefined
    if (!previousRoadId) return null
    return {
      id: 'entrance.connectRoad',
      label: 'Undo Disconnect Entrance',
      payload: { entranceId: result.entityId, roadId: previousRoadId },
    }
  },
}
