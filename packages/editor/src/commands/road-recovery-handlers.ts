import { recordChange } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CommandHandler } from './types'
import { applyAuthoredConnection } from './road-connectivity'
import { buildRecoveryConnectionRequest, type LegacyConnectionCandidate } from '../connectivity/legacy-recovery'

/**
 * Fix 2 — apply admin-approved legacy recovery candidates.
 *
 * Creates the same canonical authored RoadJunction records as new-road
 * authoring. No geometric inference, no silent mutation: only the candidates
 * the admin explicitly approved are applied.
 */
export const roadRecoveryApplyHandler: CommandHandler = {
  id: 'road.recovery.apply',
  execute(document: CampusDocument, payload: Record<string, unknown>) {
    const candidates = payload.candidates
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { success: false, error: 'No recovery candidates provided' }
    }

    let applied = 0
    const junctionIds: string[] = []

    for (const candidate of candidates as LegacyConnectionCandidate[]) {
      if (!candidate || !Array.isArray(candidate.roadIds) || candidate.roadIds.length < 2) continue
      const request = buildRecoveryConnectionRequest(candidate)
      const junction = applyAuthoredConnection(document, candidate.roadIds[0], request)
      if (!junction) continue
      applied++
      if (!junctionIds.includes(junction.id)) junctionIds.push(junction.id)
      recordChange(document, { entityId: candidate.roadIds[0], entityType: 'road', operation: 'updated' })
    }

    if (applied === 0) {
      return { success: false, error: 'No recovery candidates could be applied' }
    }

    return { success: true, data: { applied, junctionIds } }
  },
  inverse(): null {
    return null
  },
}
