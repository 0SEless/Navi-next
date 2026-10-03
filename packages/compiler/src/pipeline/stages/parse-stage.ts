import type { CampusDocument, LatLng } from '@navi/core'
import type {
  CompilerStagePlugin,
  CompilerStageInput,
  CompilerStageOutput,
  ParsedDocument,
  ParsedBuilding,
  ParsedRoom,
  ParsedHallway,
  ParsedEntrance,
  ParsedStair,
  ParsedElevator,
  ParsedRoad,
} from '../../types'

/** 1-meter-in-degrees approximation near equator */
const METER_PER_DEG = 111320

function localToLatLng(
  x: number, y: number,
  originLat: number, originLng: number,
): { lat: number; lng: number } {
  return {
    lat: originLat + y / METER_PER_DEG,
    lng: originLng + x / (METER_PER_DEG * Math.cos(originLat * Math.PI / 180)),
  }
}

function footprintCentroid(footprint: { points: Array<{ lat: number; lng: number }> }): { lat: number; lng: number } | null {
  const pts = footprint.points
  if (!pts || pts.length === 0) return null
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  }
}

function polygonCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return { x: cx, y: cy }
}

/**
 * Stage 1: Parse — Validates document structure and extracts all entities
 * into a normalized `ParsedDocument` that subsequent stages consume.
 */
export class ParseStage implements CompilerStagePlugin {
  id = 'compiler-parse-stage'
  targetStage = 'parse' as const
  mode = 'replace' as const
  meta = {
    name: 'Parse Stage',
    version: '1.0.0',
    description: 'Validates document structure and extracts entities',
  }

  execute(input: CompilerStageInput, _next: (input: CompilerStageInput) => CompilerStageOutput): CompilerStageOutput {
    const doc = input.document
    const parsed = parseDocument(doc)
    return { context: { parsed } }
  }
}

export function parseDocument(document: CampusDocument): ParsedDocument {
  const buildings: ParsedBuilding[] = []
  const rooms: ParsedRoom[] = []
  const hallways: ParsedHallway[] = []
  const entrances: ParsedEntrance[] = []
  const stairs: ParsedStair[] = []
  const elevators: ParsedElevator[] = []

  for (const bld of document.buildings) {
    const origin = footprintCentroid(bld.footprint) ?? { lat: 0, lng: 0 }

    buildings.push({
      id: bld.id,
      name: bld.name,
      code: bld.code,
      category: bld.category,
      position: origin,
      baseElevation: bld.baseElevation,
      height: bld.height,
      floors: bld.floors.map(f => f.level),
      color: bld.color,
      // P1-T17: authored elevations by level for vertical-edge distances
      floorElevations: Object.fromEntries(bld.floors.map(f => [f.level, f.elevation])),
    })

    for (const floor of bld.floors) {
      const floorId = `${bld.id}-${floor.level}`

      for (const room of floor.rooms) {
        const pts = room.polygon.points
        const localCenter = polygonCentroid(pts)
        const center = localToLatLng(localCenter.x, localCenter.y, origin.lat, origin.lng)
        const worldPoly = pts.map(p => localToLatLng(p.x, p.y, origin.lat, origin.lng))

        rooms.push({
          id: room.id,
          name: room.name,
          number: room.number,
          category: room.category,
          polygon: worldPoly,
          centroid: center,
          floorId,
          floorLevel: floor.level,
          buildingId: bld.id,
        })
      }

      for (const hw of floor.hallways) {
        const worldPts = hw.polyline.points.map(p => localToLatLng(p.x, p.y, origin.lat, origin.lng))
        hallways.push({
          id: hw.id,
          name: hw.name,
          polyline: worldPts,
          width: hw.width,
          floorId,
          floorLevel: floor.level,
          buildingId: bld.id,
        })
      }

      // Legacy per-floor stair records (fallback — the feature path below runs
      // once per BUILDING, after the floor loop; R2.6/D19 prefers levels).
      for (const st of floor.staircases) {
        const worldPos = localToLatLng(st.position.x, st.position.y, origin.lat, origin.lng)
        stairs.push({
          id: st.id,
          name: st.name,
          position: worldPos,
          buildingId: bld.id,
          isAccessible: true,
          fromLevel: st.fromLevel ?? floor.level,
          toLevel: st.toLevel ?? Math.max(st.fromLevel ?? floor.level + 1, floor.level + 1),
        })
      }

      for (const el of floor.elevators) {
        const worldPos = localToLatLng(el.position.x, el.position.y, origin.lat, origin.lng)
        elevators.push({
          id: el.id,
          name: el.name,
          position: worldPos,
          buildingId: bld.id,
          isAccessible: true,
          fromLevel: el.fromLevel ?? floor.level,
          toLevel: el.toLevel ?? Math.max(el.fromLevel ?? floor.level + 1, floor.level + 1),
        })
      }

      for (const ent of floor.entrances) {
        // P1-T4 (D9): entrance positions are building-local — derive world the
        // same way as stairs/elevators. Legacy world-stored records (pre-migration
        // docs) pass through verbatim so they compile identically.
        const isWorld = (ent.position as unknown as { lat?: number }).lat !== undefined
        const worldPos = isWorld
          ? (ent.position as unknown as LatLng)
          : localToLatLng(ent.position.x, ent.position.y, origin.lat, origin.lng)
        entrances.push({
          id: ent.id,
          name: ent.label,
          position: worldPos,
          level: ent.level,
          buildingId: bld.id,
          isAccessible: true,
          hasQR: ent.hasQR,
          hasPanorama: ent.hasPanorama,
          connectorRoadId: ent.connectorRoadId,
        })
      }
    }

    // P1-T9 (R2.6/D19): levels-based feature entities win when present —
    // ONE ParsedStair/ParsedElevator per physical feature with per-ACCESS-floor
    // placements (absent floors simply absent, never zero-filled). Runs once
    // per BUILDING (outside the floor loop). Legacy records fall back to the
    // per-floor path above.
    const featureStairs = bld.staircases ?? []
    if (featureStairs.length > 0) {
      for (const st of featureStairs) {
        const levels: Record<number, { position: LatLng }> = {}
        for (const [levelKey, geom] of Object.entries(st.levels ?? {})) {
          const level = Number(levelKey)
          if (Number.isInteger(level)) {
            levels[level] = { position: localToLatLng(geom.position.x, geom.position.y, origin.lat, origin.lng) }
          }
        }
        const firstPos = levels[st.fromLevel] ?? Object.values(levels)[0]
        stairs.push({
          id: st.id,
          name: st.name,
          position: firstPos?.position ?? localToLatLng(0, 0, origin.lat, origin.lng),
          buildingId: bld.id,
          isAccessible: st.accessible,
          fromLevel: st.fromLevel,
          toLevel: st.toLevel,
          levels: Object.keys(levels).length > 0 ? levels : undefined,
        })
      }
    }

    const featureElevators = bld.elevators ?? []
    if (featureElevators.length > 0) {
      for (const el of featureElevators) {
        const levels: Record<number, { position: LatLng }> = {}
        for (const [levelKey, geom] of Object.entries(el.levels ?? {})) {
          const level = Number(levelKey)
          if (Number.isInteger(level)) {
            levels[level] = { position: localToLatLng(geom.position.x, geom.position.y, origin.lat, origin.lng) }
          }
        }
        const firstPos = levels[el.fromLevel] ?? Object.values(levels)[0]
        elevators.push({
          id: el.id,
          name: el.name,
          position: firstPos?.position ?? localToLatLng(0, 0, origin.lat, origin.lng),
          buildingId: bld.id,
          isAccessible: el.accessible,
          fromLevel: el.fromLevel,
          toLevel: el.toLevel,
          levels: Object.keys(levels).length > 0 ? levels : undefined,
        })
      }
    }
  }

  const roads: ParsedRoad[] = document.roads.map(r => ({
    id: r.id,
    name: r.name,
    polyline: r.polyline.points,
    width: r.width,
    surface: r.surface,
    type: r.type,
    connectorEntranceId: r.connectorEntranceId,
  }))

  return { buildings, rooms, hallways, entrances, stairs, elevators, roads }
}
