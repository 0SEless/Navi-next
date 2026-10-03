import type { CampusDocument, LatLng } from '@navi/core'
import { extractConnectivitySemantics, normalizeRoadRouting } from '@navi/core'
import type {
  NormalizedDocument,
  NormalizedBuilding,
  NormalizedFloor,
  NormalizedRoom,
  NormalizedRoomDoor,
  NormalizedHallway,
  NormalizedConnectorStop,
  NormalizedEntrance,
  NormalizedAnchor,
  NormalizedRoad,
  CompilerDiagnostic,
} from '../types'

/** 1-meter-in-degrees approximation near equator (matches legacy parse-stage). */
const METER_PER_DEG = 111320

function localToLatLng(
  x: number,
  y: number,
  originLat: number,
  originLng: number,
): { lat: number; lng: number } {
  return {
    lat: originLat + y / METER_PER_DEG,
    lng: originLng + x / (METER_PER_DEG * Math.cos((originLat * Math.PI) / 180)),
  }
}

function footprintCentroid(
  footprint: { points: Array<{ lat: number; lng: number }> },
): { lat: number; lng: number } | null {
  const pts = footprint?.points
  if (!pts || pts.length === 0) return null
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  }
}

function polygonCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  }
}

export interface NormalizeResult {
  document: NormalizedDocument
  diagnostics: CompilerDiagnostic[]
}

/**
 * Stage 1: Normalize.
 *
 * Converts a CampusDocument (M5 domain model, building-local coordinates)
 * into a NormalizedDocument (world coordinates, nested structure).
 *
 * This is where local→world coordinate transformation happens exactly once.
 * All downstream stages operate on world coordinates only.
 */
export function normalizeDocument(document: CampusDocument): NormalizeResult {
  const diagnostics: CompilerDiagnostic[] = []
  const buildings: NormalizedBuilding[] = []

  for (const bld of document.buildings) {
    const origin = footprintCentroid(bld.footprint)
    if (!origin) {
      diagnostics.push({
        severity: 'error',
        sourceEntityId: bld.id,
        phase: 'normalize',
        code: 'BUILDING_NO_FOOTPRINT',
        message: `Building ${bld.id} has no footprint — cannot compute origin`,
      })
      continue
    }

    // Map connector type by connector for each stop
    const connectorTypeById = new Map<string, 'staircase' | 'elevator'>()
    const connectorAccessibleById = new Map<string, boolean>()
    const stopToConnector = new Map<string, string>()
    for (const conn of bld.verticalConnectors || []) {
      connectorTypeById.set(conn.id, conn.type)
      connectorAccessibleById.set(conn.id, conn.accessible)
      for (const stopId of conn.stopIds) {
        stopToConnector.set(stopId, conn.id)
      }
    }

    const floors: NormalizedFloor[] = []

    for (const floor of bld.floors) {
      const floorId = `${bld.id}-${floor.level}`

      const rooms: NormalizedRoom[] = floor.rooms.map(room => {
        const pts = room.polygon.points
        const worldPoly = pts.map(p => localToLatLng(p.x, p.y, origin.lat, origin.lng))
        const localCenter = polygonCentroid(pts)
        const centroid = localToLatLng(localCenter.x, localCenter.y, origin.lat, origin.lng)

        const doors: NormalizedRoomDoor[] = (room.roomDoors || []).map(door => ({
          id: door.id,
          roomId: room.id,
          position: localToLatLng(door.position.x, door.position.y, origin.lat, origin.lng),
          width: door.width,
          properties: { ...door.metadata, doorType: door.doorType, connectedToId: door.connectedToId, connectedToType: door.connectedToType },
        }))

        return {
          id: room.id,
          name: room.name,
          number: room.number,
          category: room.category,
          polygon: worldPoly,
          centroid,
          floorId,
          floorLevel: floor.level,
          buildingId: bld.id,
          doors,
        }
      })

      const hallways: NormalizedHallway[] = floor.hallways.map(hw => ({
        id: hw.id,
        name: hw.name,
        polyline: hw.polyline.points.map(p => localToLatLng(p.x, p.y, origin.lat, origin.lng)),
        width: hw.width,
        floorId,
        floorLevel: floor.level,
        buildingId: bld.id,
      }))

      const connectorStops: NormalizedConnectorStop[] = []
      const anchors: NormalizedAnchor[] = []

      for (const stop of floor.connectorStops || []) {
        const worldPos = localToLatLng(stop.position.x, stop.position.y, origin.lat, origin.lng)
        const connectorId = stop.connectorId || stopToConnector.get(stop.id) || ''
        const connType = connectorTypeById.get(connectorId)
        const behavior = connType === 'elevator' ? 'elevator' : 'stairs'

        connectorStops.push({
          id: stop.id,
          connectorId,
          position: worldPos,
          floor: floor.level,
          buildingId: bld.id,
          behavior,
          accessible: stop.accessible,
          baseCost: connType === 'elevator' ? 20 : 15,
        })

        // Anchors attached to this stop
        for (const anchor of stop.anchors || []) {
          const isQR = 'code' in anchor
          anchors.push({
            id: anchor.id,
            type: isQR ? 'qr_marker' : 'panorama',
            position: localToLatLng(anchor.position.x, anchor.position.y, origin.lat, origin.lng),
            floor: floor.level,
            buildingId: bld.id,
            label: anchor.label,
            properties: isQR
              ? { code: (anchor as { code: string }).code }
              : { imageAssetId: (anchor as { imageAssetId: string }).imageAssetId },
          })
        }
      }

      const entrances: NormalizedEntrance[] = floor.entrances.map(ent => {
        // P1-T4 (D9): entrance positions are building-local — derive world here
        // (same localToLatLng convention as rooms/hallways). Legacy world-stored
        // records pass through verbatim so they normalize identically.
        const isWorld = (ent.position as unknown as { lat?: number }).lat !== undefined
        const worldPos = isWorld
          ? (ent.position as unknown as LatLng)
          : localToLatLng(ent.position.x, ent.position.y, origin.lat, origin.lng)
        // Compute indoorPosition offset ~2m inward from outdoorPosition toward building centroid.
        // This creates a meaningful portal edge (instead of overlapping nodes at the same spot).
        const INDOOR_OFFSET_METERS = 2
        const dLat = (origin.lat - worldPos.lat)
        const dLng = (origin.lng - worldPos.lng)
        const distToOrigin = Math.sqrt(dLat * dLat + dLng * dLng)
        let indoorPosition = worldPos
        if (distToOrigin > 0) {
          // Normalize direction and scale to ~2m offset
          // At ASU latitude (~33.42): 1° lat ≈ 111,000m, 1° lng ≈ 93,000m
          const latPerMeter = 1 / 111000
          const lngPerMeter = 1 / 93000
          const offsetLat = (dLat / distToOrigin) * INDOOR_OFFSET_METERS * latPerMeter
          const offsetLng = (dLng / distToOrigin) * INDOOR_OFFSET_METERS * lngPerMeter
          indoorPosition = {
            lat: worldPos.lat + offsetLat,
            lng: worldPos.lng + offsetLng,
          }
        }
        return {
          id: ent.id,
          label: ent.label,
          outdoorPosition: worldPos,
          indoorPosition,
          level: ent.level,
          buildingId: bld.id,
          accessible: true,
          connectorRoadId: (ent as { connectorRoadId?: string }).connectorRoadId,
        }
      })

      floors.push({
        id: floorId,
        level: floor.level,
        label: floor.label,
        elevation: floor.elevation,
        buildingId: bld.id,
        rooms,
        hallways,
        connectorStops,
        entrances,
        anchors,
        // W15B: pass-through canonical navigation data — no coordinate transformation
        routeNetwork: floor.routeNetwork,
        roomAttributes: floor.roomAttributes,
        entranceAccess: floor.entranceAccess,
      })
    }

    buildings.push({
      id: bld.id,
      name: bld.name,
      code: bld.code,
      category: bld.category,
      position: origin,
      baseElevation: bld.baseElevation,
      height: bld.height,
      floors,
      // P1-T9 (R2.6/D19): carry levels-based features (access floors only,
      // world positions). Absent = legacy connector-stop path.
      ...((bld.staircases && bld.staircases.length > 0)
        ? { staircases: bld.staircases.map(st => ({
            id: st.id,
            name: st.name,
            accessible: st.accessible,
            fromLevel: st.fromLevel,
            toLevel: st.toLevel,
            levels: Object.fromEntries(
              Object.entries(st.levels ?? {}).map(([k, geom]) => [
                Number(k),
                { position: localToLatLng(geom.position.x, geom.position.y, origin.lat, origin.lng) },
              ]),
            ),
          })) }
        : {}),
      ...((bld.elevators && bld.elevators.length > 0)
        ? { elevators: bld.elevators.map(el => ({
            id: el.id,
            name: el.name,
            accessible: el.accessible,
            fromLevel: el.fromLevel,
            toLevel: el.toLevel,
            levels: Object.fromEntries(
              Object.entries(el.levels ?? {}).map(([k, geom]) => [
                Number(k),
                { position: localToLatLng(geom.position.x, geom.position.y, origin.lat, origin.lng) },
              ]),
            ),
          })) }
        : {}),
      // W15B: pass-through vertical transitions — no transformation
      verticalTransitions: bld.verticalTransitions,
    })
  }

  const roads: NormalizedRoad[] = (document.roads || []).map(r => {
    const routing = normalizeRoadRouting(r.routing)
    return {
      id: r.id,
      name: r.name,
      polyline: r.polyline.points,
      width: r.width,
      surface: r.surface,
      type: r.type,
      connectorEntranceId: (r as { connectorEntranceId?: string }).connectorEntranceId,
      ...(routing ? { routing } : {}),
    }
  })

  return {
    document: {
      buildings,
      roads,
      connectivitySemantics: extractConnectivitySemantics(document),
      connectivitySemanticsVersion: document.connectivitySemanticsVersion,
    },
    diagnostics,
  }
}
