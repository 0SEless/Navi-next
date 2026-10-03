import type { CampusDocument, LatLng } from '@navi/core'
import type {
  CompilerStagePlugin,
  CompilerStageInput,
  CompilerStageOutput,
  NavNode,
  ParsedDocument,
} from '../../types'

/** 1-meter-in-degrees approximation near equator (matches parse-stage/normalize). */
const METER_PER_DEG = 111320

function localToLatLng(
  x: number,
  y: number,
  originLat: number,
  originLng: number,
): LatLng {
  return {
    lat: originLat + y / METER_PER_DEG,
    lng: originLng + x / (METER_PER_DEG * Math.cos((originLat * Math.PI) / 180)),
  }
}

function footprintCentroid(footprint: { points: Array<{ lat: number; lng: number }> }): { lat: number; lng: number } | null {
  const pts = footprint?.points ?? []
  if (pts.length === 0) return null
  let lat = 0, lng = 0
  for (const p of pts) { lat += p.lat; lng += p.lng }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

// P1-T4 (D9): world-origin lookup for panorama/QR conversion (they carry only a
// buildingId, not a footprint — resolve via the parsed building records).
function buildingOrigin(parsed: ParsedDocument, buildingId: string): { lat: number; lng: number } | null {
  const bld = parsed.buildings.find(b => b.id === buildingId)
  if (!bld?.footprint) return null
  return footprintCentroid(bld.footprint)
}

/**
 * Stage 2: Build Nodes — Creates graph nodes from rooms, hallways,
 * entrances, stairs, elevators, roads, panoramas, and QR checkpoints.
 */
export class BuildNodesStage implements CompilerStagePlugin {
  id = 'compiler-build-nodes-stage'
  targetStage = 'build-nodes' as const
  mode = 'replace' as const
  meta = {
    name: 'Build Nodes Stage',
    version: '1.0.0',
    description: 'Creates graph nodes from parsed entities',
  }

  execute(input: CompilerStageInput, _next: (input: CompilerStageInput) => CompilerStageOutput): CompilerStageOutput {
    const doc = input.document
    const parsed = input.context?.parsed as ParsedDocument | undefined
    if (!parsed) {
      return { errors: [{ code: 'NO_PARSED_DOC', message: 'BuildNodesStage requires parsed document in context' }] }
    }

    const nodes = buildNodes(doc, parsed)
    return { nodes }
  }
}

function makeId(type: string, idx: number): string {
  return `${type}-${idx}`
}

export function buildNodes(document: CampusDocument, parsed: ParsedDocument): NavNode[] {
  const nodes: NavNode[] = []
  let idx = 0

  // Rooms → nodes (one per room, positioned at centroid)
  for (const room of parsed.rooms) {
    nodes.push({
      id: makeId('node', idx++),
      label: room.name || room.number || `Room ${room.id}`,
      type: 'space',
      position: room.centroid,
      floor: room.floorLevel,
      buildingId: room.buildingId,
      properties: { number: room.number, category: room.category, entityType: 'room', entityId: room.id },
    })
  }

  // Hallways → nodes (one per hallway midpoint)
  for (const hw of parsed.hallways) {
    if (hw.polyline.length === 0) continue
    const midIdx = Math.floor(hw.polyline.length / 2)
    const midpoint = hw.polyline[midIdx]
    nodes.push({
      id: makeId('node', idx++),
      label: hw.name,
      type: 'corridor',
      position: midpoint,
      floor: hw.floorLevel,
      buildingId: hw.buildingId,
      properties: { entityType: 'hallway', entityId: hw.id, width: hw.width },
    })
  }

  // Entrances → nodes
  for (const ent of parsed.entrances) {
    nodes.push({
      id: makeId('node', idx++),
      label: ent.name || 'Entrance',
      type: 'transition',
      position: ent.position,
      floor: ent.level,
      buildingId: ent.buildingId,
      properties: {
        entityType: 'entrance',
        entityId: ent.id,
        isAccessible: ent.isAccessible,
        ...(ent.connectorRoadId ? { connectorRoadId: ent.connectorRoadId } : {}),
      },
    })
  }

  // Stairs → one node PER ACCESS FLOOR (chained vertically by the edges stage)
  // A single node at a hardcoded floor 0 could never link upper-floor
  // hallways, leaving every floor above 0 unreachable (GRAPH_UNREACHABLE_ROOM).
  for (const st of parsed.stairs) {
    // P1-T9 (R2.6/D19): levels-based features emit one node per floor present
    // in `levels` (absent floors simply absent, never zero-filled) at that
    // floor's OWN placement. Legacy records fall back to the full range at
    // the single record position.
    const levelKeys = st.levels ? Object.keys(st.levels).map(Number).filter(Number.isInteger) : []
    const floors = levelKeys.length > 0 ? levelKeys.sort((a, b) => a - b) : []
    for (let i = 0; i < (floors.length || 0); i++) {
      const f = floors[i] ?? 0
      nodes.push({
        id: makeId('node', idx++),
        label: `${st.name || 'Stairs'} (F${f})`,
        type: 'transition',
        position: st.levels ? (st.levels[f]?.position ?? st.position) : st.position,
        floor: f,
        buildingId: st.buildingId,
        properties: { entityType: 'staircase', entityId: st.id, level: f, isAccessible: st.isAccessible, isElevation: true },
      })
    }
    if (floors.length === 0) {
      for (let f = st.fromLevel; f <= st.toLevel; f++) {
        nodes.push({
          id: makeId('node', idx++),
          label: `${st.name || 'Stairs'} (F${f})`,
          type: 'transition',
          position: st.position,
          floor: f,
          buildingId: st.buildingId,
          properties: { entityType: 'staircase', entityId: st.id, level: f, isAccessible: st.isAccessible, isElevation: true },
        })
      }
    }
  }

  // Elevators → one node PER ACCESS FLOOR (same model as stairs)
  for (const el of parsed.elevators) {
    const levelKeys = el.levels ? Object.keys(el.levels).map(Number).filter(Number.isInteger) : []
    const floors = levelKeys.length > 0 ? levelKeys.sort((a, b) => a - b) : []
    for (let i = 0; i < (floors.length || 0); i++) {
      const f = floors[i] ?? 0
      nodes.push({
        id: makeId('node', idx++),
        label: `${el.name || 'Elevator'} (F${f})`,
        type: 'transition',
        position: el.levels ? (el.levels[f]?.position ?? el.position) : el.position,
        floor: f,
        buildingId: el.buildingId,
        properties: { entityType: 'elevator', entityId: el.id, level: f, isAccessible: el.isAccessible, isElevation: true },
      })
    }
    if (floors.length === 0) {
      for (let f = el.fromLevel; f <= el.toLevel; f++) {
        nodes.push({
          id: makeId('node', idx++),
          label: `${el.name || 'Elevator'} (F${f})`,
          type: 'transition',
          position: el.position,
          floor: f,
          buildingId: el.buildingId,
          properties: { entityType: 'elevator', entityId: el.id, level: f, isAccessible: el.isAccessible, isElevation: true },
        })
      }
    }
  }

  // Roads → nodes (road endpoints as corridor nodes)
  for (const road of parsed.roads) {
    if (road.polyline.length >= 2) {
      nodes.push({
        id: makeId('node', idx++),
        label: `${road.name} start`,
        type: 'corridor',
        position: road.polyline[0],
        floor: 0,
        buildingId: '',
        properties: { entityType: 'road', entityId: road.id, endpoint: 'start' },
      })
      nodes.push({
        id: makeId('node', idx++),
        label: `${road.name} end`,
        type: 'corridor',
        position: road.polyline[road.polyline.length - 1],
        floor: 0,
        buildingId: '',
        properties: { entityType: 'road', entityId: road.id, endpoint: 'end' },
      })
    }
  }

  // Panorama nodes
  // P1-T4 (D9): panorama positions are building-local — derive world via the
  // owning building's origin; legacy world-stored records pass through verbatim.
  for (const pano of document.panoramas) {
    let world: LatLng | null = null
    if ((pano.position as unknown as { lat?: number }).lat !== undefined) {
      world = pano.position as unknown as LatLng
    } else if (pano.buildingId) {
      const origin = buildingOrigin(parsed, pano.buildingId)
      if (origin) world = localToLatLng(pano.position.x, pano.position.y, origin.lat, origin.lng)
    }
    if (!world) continue
    nodes.push({
      id: makeId('node', idx++),
      label: `Panorama: ${pano.label}`,
      type: 'intersection',
      position: world,
      floor: pano.floor ?? 0,
      buildingId: pano.buildingId ?? '',
      properties: { entityType: 'panorama', entityId: pano.id, hasPanorama: true },
    })
  }

  // QR Checkpoint nodes
  // P1-T4 (D9): QR positions are building-local — same derivation as panoramas.
  for (const qr of document.qrCheckpoints) {
    let world: LatLng | null = null
    if ((qr.position as unknown as { lat?: number }).lat !== undefined) {
      world = qr.position as unknown as LatLng
    } else {
      const origin = buildingOrigin(parsed, qr.buildingId)
      if (origin) world = localToLatLng(qr.position.x, qr.position.y, origin.lat, origin.lng)
    }
    if (!world) continue
    nodes.push({
      id: makeId('node', idx++),
      label: `QR: ${qr.label}`,
      type: 'intersection',
      position: world,
      floor: qr.floor,
      buildingId: qr.buildingId,
      properties: { entityType: 'qr', entityId: qr.id, hasQr: true },
    })
  }

  return nodes
}
