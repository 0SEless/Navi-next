import type { PlanAlignment } from '@navi/core'
import type { Building } from '@/types/nav-types'

export interface ResolvedPublicFloorPlan {
  imageUrl?: string
  alignment?: PlanAlignment
  floorData?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve by authored floor level; array position is never a floor identity. */
export function resolvePublicFloorPlan(building: Building | null | undefined, level: number): ResolvedPublicFloorPlan {
  if (!building || !Number.isFinite(level)) return {}
  const floorData = building.floorData?.find((floor) => floor.level === level)
  const visual = building.floorPlanVisuals?.[level]
  const explicitPlan = floorData && Object.prototype.hasOwnProperty.call(floorData, 'planImageId')
  const imageUrl = explicitPlan
    ? typeof floorData.planImageId === 'string' && floorData.planImageId.length > 0
      ? floorData.planImageId : undefined
    : building.floorPlanUrls?.[level] ?? visual?.imageUrl
  const alignment = isRecord(floorData?.planAlignment)
    ? floorData.planAlignment as PlanAlignment
    : visual?.alignment
  return { imageUrl, alignment, floorData }
}
