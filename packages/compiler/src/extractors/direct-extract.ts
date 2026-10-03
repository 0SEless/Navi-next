import type { CampusDocument, RoadType } from '@navi/core'
import type { CorridorType, ExtractionResult, NavigationSpace, TransitionPoint, WalkableCorridor } from '../types'

/** Convert local (x,y) meters to lat/lng using building footprint as origin reference.
 *  1 meter ≈ 1/111320 degrees near equator. */
function localToLatLng(x: number, y: number, originLat: number, originLng: number): { lat: number; lng: number } {
  const METER_PER_DEG = 111320
  return {
    lat: originLat + y / METER_PER_DEG,
    lng: originLng + x / (METER_PER_DEG * Math.cos(originLat * Math.PI / 180)),
  }
}

function footprintCentroid(footprint: { points: Array<{ lat: number; lng: number }> }): { lat: number; lng: number } | null {
  const pts = footprint.points
  if (!pts || pts.length === 0) return null
  const n = pts.length
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / n,
    lng: pts.reduce((s, p) => s + p.lng, 0) / n,
  }
}

export function directExtract(campus: CampusDocument): ExtractionResult {
  const spaces: NavigationSpace[] = []
  const transitions: TransitionPoint[] = []
  const corridors: WalkableCorridor[] = []

  for (const building of campus.buildings) {
    const origin = footprintCentroid(building.footprint) ?? { lat: 0, lng: 0 }

    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const localPoly = (room as any).polygon?.points
        if (localPoly && localPoly.length >= 3) {
          const centroidX = localPoly.reduce((s: number, p: { x: number; y: number }) => s + p.x, 0) / localPoly.length
          const centroidY = localPoly.reduce((s: number, p: { x: number; y: number }) => s + p.y, 0) / localPoly.length
          const position = localToLatLng(centroidX, centroidY, origin.lat, origin.lng)
          spaces.push({
            id: room.id,
            label: room.name,
            type: 'room',
            position,
            floor: floor.level,
            buildingId: building.id,
            properties: { number: room.number, category: room.category },
          })
        }
      }

      for (const entrance of floor.entrances) {
        const entrancePos = 'lat' in entrance.position
          ? entrance.position
          : localToLatLng((entrance.position as any).x ?? 0, (entrance.position as any).y ?? 0, origin.lat, origin.lng)
        transitions.push({
          id: entrance.id,
          label: entrance.label,
          type: 'entrance',
          position: entrancePos,
          floor: floor.level,
          buildingId: building.id,
          // Preserve the legacy explicit connector for the deprecated
          // artifact path. Unassigned entrances must not be connected by
          // proximity during graph construction.
          properties: {
            entityId: entrance.id,
            ...(entrance.connectorRoadId ? { connectorRoadId: entrance.connectorRoadId } : {}),
          },
          connectsTo: building.id,
        })
      }
    }
  }

  // Map RoadType to CorridorType
  const corridorTypeMap: Record<RoadType, CorridorType> = {
    arterial: 'road',
    connector: 'walkway',
    service: 'walkway',
    pedestrian: 'walkway',
  }

  for (const road of campus.roads) {
    const points = (road as any).polyline?.points
    if (points && points.length >= 2) {
      corridors.push({
        id: road.id,
        name: road.name || `Road ${road.id}`,
        type: corridorTypeMap[road.type] ?? 'walkway',
        polyline: points,
        surface: road.surface ?? 'paved',
        width: road.width ?? 2,
        // Preserve the reverse legacy connector as extraction metadata so
        // buildGraph can honor it without selecting a road by distance.
        properties: {
          roadId: road.id,
          ...(road.connectorEntranceId ? { connectorEntranceId: road.connectorEntranceId } : {}),
        },
        buildingId: '',
        floor: 0,
      })
    }
  }

  return { spaces, transitions, corridors, duration: 0 }
}
