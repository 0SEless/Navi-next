/**
 * P3-T2: Convert editor Component[] to FloorGeometryFloor for Canvas rendering.
 *
 * Takes the editor's Component array (world LatLng) and a PathProjection
 * (LatLng → building-local meters) and produces a FloorGeometryFloor
 * that the Canvas renderer can draw directly.
 */

import type { Component } from '@/types/nav-types'
import type { FloorGeometryFloor, FloorGeometryFeature } from '@navi/core'
import type { PathProjection } from '@/lib/path-projection'

/**
 * Convert editor components to a FloorGeometryFloor for Canvas rendering.
 *
 * All coordinates are converted from world LatLng to building-local meters
 * via the PathProjection's unproject function.
 */
export function componentsToFloorGeometry(
  components: Component[],
  floorIndex: number,
  proj: PathProjection,
): FloorGeometryFloor {
  const rooms = components
    .filter(c => c.type === 'room' && c.polygon && c.polygon.length >= 3)
    .map(c => ({
      id: c.id,
      name: c.name,
      number: c.metadata?.number as string ?? c.name,
      polygon: {
        points: c.polygon!.map(p => proj.unproject(p.lng, p.lat)),
      },
    }))

  const hallways = components
    .filter(c => c.type === 'hallway' && c.polygon && c.polygon.length >= 2)
    .map(c => ({
      id: c.id,
      name: c.name,
      polyline: {
        points: c.polygon!.map(p => proj.unproject(p.lng, p.lat)),
      },
    }))

  const staircases: FloorGeometryFeature[] = components
    .filter(c => c.type === 'stair')
    .map(c => ({
      id: c.id,
      name: c.name,
      position: proj.unproject(c.position.lng, c.position.lat),
      rotation: c.dimensions?.rotation ?? 0,
      polygon: c.polygon && c.polygon.length >= 3
        ? { points: c.polygon.map(p => proj.unproject(p.lng, p.lat)) }
        : undefined,
    }))

  const elevators: FloorGeometryFeature[] = components
    .filter(c => c.type === 'elevator')
    .map(c => ({
      id: c.id,
      name: c.name,
      position: proj.unproject(c.position.lng, c.position.lat),
      rotation: c.dimensions?.rotation ?? 0,
      polygon: c.polygon && c.polygon.length >= 3
        ? { points: c.polygon.map(p => proj.unproject(p.lng, p.lat)) }
        : undefined,
    }))

  return {
    level: floorIndex,
    label: `Floor ${floorIndex}`,
    elevation: 0,
    offset: { x: 0, y: 0 },
    rooms,
    hallways,
    staircases,
    elevators,
    doors: [],
    pois: [],
    qrCheckpoints: [],
  }
}
