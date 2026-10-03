import type { PlanAlignment } from '@navi/core'
import { normalizePlanAlignmentForWrite } from './floor-plan-inspector'

export interface FloorPlanAlignmentDispatcher {
  execute: (command: {
    id: string
    label: string
    payload: { entityId: string; changes: { planAlignment: PlanAlignment } }
  }) => { success?: boolean } | void
}

/**
 * Dispatch one canonical alignment command. The returned alignment is ready
 * for the parent preview state immediately; history/autosave remain owned by
 * the existing dispatcher/document services.
 */
export function commitFloorPlanAlignment(
  dispatcher: FloorPlanAlignmentDispatcher,
  floorId: string,
  candidate: PlanAlignment,
): PlanAlignment | null {
  const next = normalizePlanAlignmentForWrite(candidate)
  const result = dispatcher.execute({
    id: 'entity.update',
    label: 'Update Floor Plan Alignment',
    payload: { entityId: floorId, changes: { planAlignment: next } },
  })
  if (result?.success === false) return null
  return next
}
