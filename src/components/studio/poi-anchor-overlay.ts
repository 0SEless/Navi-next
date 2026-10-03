import {
  projectLocalPoiAnchor,
  projectWorldPoiAnchor,
  type LatLng,
  type LocalCoord,
  type PointOfInterestGeometry,
  type PointOfInterestNavigation,
  type WorldPOIGeometry,
} from '@navi/core'

export interface ApproachAnchorInput {
  scope: 'indoor' | 'outdoor'
  geometry: PointOfInterestGeometry | WorldPOIGeometry
  navigation?: PointOfInterestNavigation
  /** Floor-local to world adapter (indoor only). */
  localToWorld?: (local: LocalCoord) => LatLng | null
}

/**
 * Resolve the selected POI's preferred approach anchor into a world position
 * for the Studio overlay marker.
 *
 * The anchor is stored geometry-relative (`circle-angle` / `rectangle-edge` /
 * `polygon-edge`), so moving/rotating/resizing the POI keeps it attached.
 * Returns null for automatic approach, missing/invalid anchors, point POIs,
 * and indoor anchors without a transform.
 */
export function resolveApproachAnchorWorld(input: ApproachAnchorInput): LatLng | null {
  const navigation = input.navigation
  if (!navigation || navigation.approachMode === 'automatic' || !navigation.anchor) return null

  if (input.scope === 'outdoor') {
    return projectWorldPoiAnchor(input.geometry as WorldPOIGeometry, navigation.anchor)
  }

  if (!input.localToWorld) return null
  const local = projectLocalPoiAnchor(input.geometry as PointOfInterestGeometry, navigation.anchor)
  return local ? input.localToWorld(local) : null
}
