import type { PlanAlignment } from '@navi/core'
import { resetFloorPlanAlignment } from '@/lib/floor-plan-inspector'
import { resolvePlanAlignment } from '@/lib/floor-plan-transform'

export interface FloorPlanSourceDimensions {
  width: number
  height: number
}

export interface FloorPlanStorageScope {
  supabaseUrl: string
  mapId: string
  buildingId: string
  floorLevel: number
}

export interface FloorPlanReference {
  planImageId?: string | null
}

export const FLOOR_PLAN_ASPECT_TOLERANCE = 0.01

/**
 * Resolve the active source while respecting an explicit null in floorData.
 * Legacy floorPlanUrls are consulted only when the newer field is absent.
 */
export function resolveFloorPlanUrl(
  legacyUrl?: string | null,
  floorData?: FloorPlanReference | null,
  fallbackUrl?: string | null,
): string | undefined {
  if (floorData && Object.prototype.hasOwnProperty.call(floorData, 'planImageId')) {
    // `undefined` is the legacy/absent shape; only an explicit null means
    // that a previously published or legacy URL was intentionally removed.
    if (floorData.planImageId !== undefined) return floorData.planImageId ?? undefined
  }
  return legacyUrl ?? fallbackUrl ?? undefined
}

/**
 * A floor-plan asset may only be physically deleted when no authoritative
 * floor-plan reference resolves to it (shared-asset deletion guard).
 *
 * Returns every URL that the read path (`resolveFloorPlanUrl`) would still
 * display for this building, given:
 *  - per-floor `planImageId` (primary binding), keyed by LEVEL (never index)
 *  - `floorPlanUrls[level]` legacy fallback — read-only, never mutated
 *  - `floorPlanVisuals[level].imageUrl` persisted published visuals (live
 *    reader: PublicMap selectedBuilding.floorPlanVisuals)
 *
 * `updatedFloor` carries the post-update binding of the floor that triggered
 * the deletion (replace → new URL, remove → null). Call sites run in the same
 * callback as a successful `entity.update`, so the captured building still
 * holds that floor's PRE-update value; the override makes the edited floor's
 * stale value impossible to count while preserving its post-update shadowing
 * semantics (defined planImageId or explicit null both suppress the legacy
 * fallback for that floor).
 *
 * Deliberately EXCLUDED: `building.floorPlanUrl` (singular) — grep-verified
 * zero readers across src/, packages/, apps/ (only db row mapping + snapshot
 * roundtrip). It is inert persisted data; counting it would block cleanup of
 * replaced assets on every legacy building that carries it. Extend this
 * collector if a reader ever appears.
 *
 * Pure: no mutation of any input, no storage/document side effects.
 */
export function collectBuildingFloorPlanReferences(
  building: {
    floors?: number[]
    floorData?: Array<Record<string, unknown>>
    floorPlanUrls?: Record<number, string | null | undefined> | null
    floorPlanVisuals?: Record<number, { imageUrl?: string } | null | undefined> | null
  },
  updatedFloor?: { level: number; planImageId: string | null } | null,
): string[] {
  const levels = new Set<number>()
  const planImageIdByLevel = new Map<number, string | null | undefined>()

  for (const level of building.floors ?? []) {
    if (typeof level === 'number' && Number.isFinite(level)) levels.add(level)
  }
  for (const entry of building.floorData ?? []) {
    const level = Number(entry?.level)
    if (!Number.isFinite(level)) continue
    levels.add(level)
    planImageIdByLevel.set(level, entry.planImageId as string | null | undefined)
  }
  // Post-update override for the floor that performed the replace/remove.
  if (updatedFloor && Number.isFinite(updatedFloor.level)) {
    levels.add(updatedFloor.level)
    planImageIdByLevel.set(updatedFloor.level, updatedFloor.planImageId)
  }

  const references = new Set<string>()
  for (const level of levels) {
    // Always pass planImageId as an object KEY so the resolver's
    // hasOwnProperty semantics match the read path exactly:
    // undefined → legacy fallback, null → explicit removal (no fallback).
    const resolved = resolveFloorPlanUrl(building.floorPlanUrls?.[level], {
      planImageId: planImageIdByLevel.get(level),
    })
    if (resolved) references.add(resolved)
  }
  for (const visual of Object.values(building.floorPlanVisuals ?? {})) {
    const imageUrl = visual?.imageUrl
    if (imageUrl) references.add(imageUrl)
  }
  return [...references]
}

function validDimensions(dimensions?: FloorPlanSourceDimensions): dimensions is FloorPlanSourceDimensions {
  return Boolean(
    dimensions &&
    Number.isFinite(dimensions.width) && dimensions.width > 0 &&
    Number.isFinite(dimensions.height) && dimensions.height > 0,
  )
}

/**
 * A replacement is compatible only when both raster sources expose finite,
 * non-zero dimensions and their aspect ratios differ by at most one percent.
 */
export function areFloorPlanSourcesCompatible(
  previous?: FloorPlanSourceDimensions,
  replacement?: FloorPlanSourceDimensions,
): boolean {
  if (!validDimensions(previous) || !validDimensions(replacement)) return false
  const previousRatio = previous.width / previous.height
  const replacementRatio = replacement.width / replacement.height
  return Math.abs(previousRatio - replacementRatio) / Math.max(previousRatio, replacementRatio) <= FLOOR_PLAN_ASPECT_TOLERANCE
}

/** Preserve visual fields while applying the deterministic replacement policy. */
export function buildFloorPlanReplaceAlignment(
  existing: PlanAlignment | null | undefined,
  previous?: FloorPlanSourceDimensions,
  replacement?: FloorPlanSourceDimensions,
): PlanAlignment {
  if (areFloorPlanSourcesCompatible(previous, replacement)) {
    const resolved = resolvePlanAlignment(existing)
    return {
      offset: { ...resolved.offset },
      scaleX: resolved.scaleX,
      scaleY: resolved.scaleY,
      rotation: resolved.rotation,
      opacity: resolved.opacity,
      locked: resolved.locked,
    }
  }
  return resetFloorPlanAlignment(existing)
}

/** Read raster dimensions without making a storage or document mutation. */
export function readFloorPlanImageDimensions(url: string | null | undefined): Promise<FloorPlanSourceDimensions | undefined> {
  if (!url || typeof Image === 'undefined') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      resolve(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : undefined)
    }
    image.onerror = () => resolve(undefined)
    image.src = url
  })
}

/**
 * Return true only for a URL created by this floor's managed storage prefix.
 * Data URLs, external URLs, and another floor's path are never owned here.
 */
export function isOwnedFloorPlanUrl(url: string | null | undefined, scope: FloorPlanStorageScope): boolean {
  if (!url || url.startsWith('data:')) return false
  try {
    const parsed = new URL(url)
    const expectedOrigin = new URL(scope.supabaseUrl).origin
    const prefix = `/storage/v1/object/public/floor-plans/${encodeURIComponent(scope.mapId)}/${encodeURIComponent(scope.buildingId)}/floor-${scope.floorLevel}-`
    return parsed.origin === expectedOrigin && parsed.pathname.startsWith(prefix)
  } catch {
    return false
  }
}
