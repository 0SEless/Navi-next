/**
 * P2A.1: Snap bridge for the Canvas editor.
 *
 * Converts building-local meters → LatLng → SnapEngine.findSnap() → LatLng → building-local meters.
 * This bridges the Canvas editor's meter-space coordinate system with the
 * existing SnapEngine which operates in LatLng (WGS84) world coordinates.
 */

import type { LocalCoord, LatLng } from '@navi/core'
import { SnapEngine, DEFAULT_SNAP_CONFIG, type SnapConfig, type SnapTarget } from '@navi/core'

// ── Types ──

export interface SnapBridgeResult {
  /** Snapped position in building-local meters. */
  position: LocalCoord
  /** Original snap target from SnapEngine (in LatLng). */
  target: SnapTarget
}

export interface SnapBridgeOptions {
  /** Building ID for coordinate conversion. */
  buildingId: string
  /** Coordinate transformer for LatLng ↔ building-local conversion. */
  transformer: {
    buildingLocalToWorld(local: LocalCoord, buildingId: string): LatLng | null
    worldToBuildingLocal(latlng: LatLng, buildingId: string): LocalCoord | null
  }
  /** Optional snap config override. */
  snapConfig?: SnapConfig
}

// ── Snap bridge ──

/**
 * Find the nearest snap target for a building-local point.
 *
 * Conversion chain:
 *   1. Building-local meters → LatLng (via transformer)
 *   2. LatLng → SnapEngine.findSnap() → SnapTarget (LatLng)
 *   3. SnapTarget LatLng → building-local meters (via transformer)
 *
 * @param point - The cursor position in building-local meters
 * @param snapEngine - The populated SnapEngine instance
 * @param options - Building ID, transformer, and optional snap config
 * @returns The snapped position in building-local meters, or null if no snap found
 */
export function snapToNearest(
  point: LocalCoord,
  snapEngine: SnapEngine,
  options: SnapBridgeOptions,
): SnapBridgeResult | null {
  const { buildingId, transformer, snapConfig } = options

  // Step 1: Convert building-local meters to LatLng
  const worldLatLng = transformer.buildingLocalToWorld(point, buildingId)
  if (!worldLatLng) return null

  // Step 2: Find snap target in LatLng space
  const target = snapEngine.findSnap(worldLatLng, snapConfig ?? DEFAULT_SNAP_CONFIG)
  if (!target) return null

  // Step 3: Convert snapped LatLng back to building-local meters
  const snappedLocal = transformer.worldToBuildingLocal(target.position, buildingId)
  if (!snappedLocal) return null

  return {
    position: snappedLocal,
    target,
  }
}

/**
 * Find all snap targets within radius for a building-local point.
 * Useful for multi-snap indicators (showing all nearby snap targets).
 */
export function findAllSnaps(
  point: LocalCoord,
  snapEngine: SnapEngine,
  options: SnapBridgeOptions,
): Array<SnapBridgeResult> {
  const { buildingId, transformer, snapConfig } = options

  const worldLatLng = transformer.buildingLocalToWorld(point, buildingId)
  if (!worldLatLng) return []

  const targets = snapEngine.findAllSnaps(worldLatLng, snapConfig ?? DEFAULT_SNAP_CONFIG)
  const results: SnapBridgeResult[] = []

  for (const target of targets) {
    const snappedLocal = transformer.worldToBuildingLocal(target.position, buildingId)
    if (snappedLocal) {
      results.push({ position: snappedLocal, target })
    }
  }

  return results
}
