import type { Panorama } from '../types/entities'
import type { CampusDocument } from '../types/document'

export interface PanoramaValidationIssue {
  panoramaId: string
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface HotspotValidationIssue {
  panoramaId: string
  hotspotIndex: number
  severity: 'error' | 'warning'
  code: string
  message: string
}

/**
 * Validate panorama coordinate semantics (D9 invariant).
 *
 * Rules:
 * 1. Building-associated panoramas (buildingId present) must use LocalCoord
 * 2. Outdoor panoramas (buildingId absent) must use LatLng
 * 3. Legacy panoramas with LatLng and buildingId are detected and passed through
 *
 * Returns array of validation issues (empty = valid).
 */
export function validatePanoramaCoordinates(panorama: Panorama): PanoramaValidationIssue[] {
  const issues: PanoramaValidationIssue[] = []
  const isLatLng = (panorama.position as unknown as { lat?: number }).lat !== undefined
  const isLocalCoord = !isLatLng && 'x' in panorama.position && 'y' in panorama.position

  if (panorama.buildingId && isLatLng) {
    // Case: Building-associated panorama stored as LatLng (legacy)
    // This is allowed for backward compatibility but should be diagnosed
    issues.push({
      panoramaId: panorama.id,
      severity: 'warning',
      code: 'PANORAMA_LEGACY_COORDINATES',
      message: `Panorama "${panorama.label}" (${panorama.id}) has buildingId "${panorama.buildingId}" but position is LatLng. This is valid for legacy documents but new panoramas should use LocalCoord (building-local meters).`,
    })
  } else if (panorama.buildingId && isLocalCoord) {
    // Case: Building-associated panorama stored as LocalCoord (correct)
    // No issues
  } else if (!panorama.buildingId && isLatLng) {
    // Case: Outdoor panorama stored as LatLng (correct)
    // No issues
  } else if (!panorama.buildingId && isLocalCoord) {
    // Case: Outdoor panorama stored as LocalCoord (ERROR)
    // This will produce (0,0) in the compiler — must be rejected
    issues.push({
      panoramaId: panorama.id,
      severity: 'error',
      code: 'PANORAMA_OUTDOOR_REQUIRES_LATLNG',
      message: `Panorama "${panorama.label}" (${panorama.id}) is outdoor (no buildingId) but position is LocalCoord (building-local meters). Outdoor panoramas must use LatLng (world coordinates). Position will default to (0,0) if not corrected.`,
    })
  } else {
    // Case: Unknown coordinate format
    issues.push({
      panoramaId: panorama.id,
      severity: 'error',
      code: 'PANORAMA_INVALID_POSITION',
      message: `Panorama "${panorama.label}" (${panorama.id}) has an unrecognized position format. Expected LocalCoord (x, y) or LatLng (lat, lng).`,
    })
  }

  return issues
}

/**
 * Validate all panoramas in a document.
 * Returns all issues found across all panoramas.
 */
export function validatePanoramas(document: CampusDocument): PanoramaValidationIssue[] {
  const issues: PanoramaValidationIssue[] = []
  for (const panorama of document.panoramas) {
    issues.push(...validatePanoramaCoordinates(panorama))
  }
  return issues
}

/**
 * Check if a panorama is outdoor (campus-wide, no building association).
 */
export function isOutdoorPanorama(panorama: Panorama): boolean {
  return !panorama.buildingId
}

/**
 * Check if a panorama is building-associated.
 */
export function isBuildingPanorama(panorama: Panorama): boolean {
  return !!panorama.buildingId
}

/**
 * Get the coordinate system of a panorama's position.
 */
export function getCoordinateSystem(panorama: Panorama): 'local' | 'world' | 'unknown' {
  const isLatLng = (panorama.position as unknown as { lat?: number }).lat !== undefined
  if (isLatLng) return 'world'
  if ('x' in panorama.position && 'y' in panorama.position) return 'local'
  return 'unknown'
}

/**
 * Validate a single hotspot.
 *
 * Rules:
 * 1. Navigation hotspots must have a target panorama
 * 2. Information hotspots should have content
 * 3. Hotspot position must be within valid ranges
 */
export function validateHotspot(
  panoramaId: string,
  hotspotIndex: number,
  hotspot: import('../types/entities').PanoramaHotspot,
  allPanoramaIds: string[],
): HotspotValidationIssue[] {
  const issues: HotspotValidationIssue[] = []

  // Skip validation if position is missing (legacy hotspot format)
  if (!hotspot.position) {
    return issues
  }

  // Validate position ranges
  if (hotspot.position.yaw < 0 || hotspot.position.yaw > 360) {
    issues.push({
      panoramaId,
      hotspotIndex,
      severity: 'error',
      code: 'HOTSPOT_INVALID_YAW',
      message: `Hotspot yaw must be between 0 and 360 degrees, got ${hotspot.position.yaw}`,
    })
  }
  if (hotspot.position.pitch < -90 || hotspot.position.pitch > 90) {
    issues.push({
      panoramaId,
      hotspotIndex,
      severity: 'error',
      code: 'HOTSPOT_INVALID_PITCH',
      message: `Hotspot pitch must be between -90 and 90 degrees, got ${hotspot.position.pitch}`,
    })
  }

  // Validate navigation hotspots
  if (hotspot.hotspotType === 'navigation') {
    if (!hotspot.target.targetId) {
      issues.push({
        panoramaId,
        hotspotIndex,
        severity: 'warning',
        code: 'HOTSPOT_MISSING_TARGET',
        message: `Navigation hotspot ${hotspotIndex + 1} has no target panorama selected`,
      })
    } else if (!allPanoramaIds.includes(hotspot.target.targetId)) {
      issues.push({
        panoramaId,
        hotspotIndex,
        severity: 'error',
        code: 'HOTSPOT_INVALID_TARGET',
        message: `Navigation hotspot ${hotspotIndex + 1} targets non-existent panorama: ${hotspot.target.targetId}`,
      })
    }
  }

  // Validate information hotspots
  if (hotspot.hotspotType === 'information') {
    if (!hotspot.content?.title && !hotspot.content?.description) {
      issues.push({
        panoramaId,
        hotspotIndex,
        severity: 'warning',
        code: 'HOTSPOT_EMPTY_CONTENT',
        message: `Information hotspot ${hotspotIndex + 1} has no title or description`,
      })
    }
  }

  return issues
}

/**
 * Validate all hotspots in a panorama.
 */
export function validatePanoramaHotspots(
  panorama: Panorama,
  allPanoramaIds: string[],
): HotspotValidationIssue[] {
  const issues: HotspotValidationIssue[] = []
  for (let i = 0; i < panorama.hotspots.length; i++) {
    issues.push(...validateHotspot(panorama.id, i, panorama.hotspots[i], allPanoramaIds))
  }
  return issues
}
