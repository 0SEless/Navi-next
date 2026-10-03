import type { CampusDocument } from '../types/document'
import type {
  Building,
  LegacyElevator,
  LegacyStaircase,
} from '../types/entities'
import { isDoorType, isRouteNodeType, isRouteEdgeType } from '../types/enums'

// ── Serialize CampusDocument to JSON string ──

/**
 * Document schema version emitted when the document uses v2 features
 * (Building.staircases / Building.elevators). Unversioned docs are treated
 * as v1; legacy-only docs keep whatever version they carried.
 */
export const SCHEMA_VERSION = 2

export function serializeDocument(doc: CampusDocument): string {
  // Deep clone so dual-write regeneration never mutates the caller's document.
  const clean = JSON.parse(JSON.stringify(doc)) as CampusDocument
  delete clean._changeJournal

  const buildings = clean.buildings
  if (Array.isArray(buildings)) {
    let hasFeatures = false
    for (const bld of buildings) {
      if (Array.isArray(bld.staircases) || Array.isArray(bld.elevators)) hasFeatures = true
    }
    if (hasFeatures) {
      clean.schemaVersion = SCHEMA_VERSION
      for (const bld of buildings) {
        if (Array.isArray(bld.staircases)) deriveLegacyStaircases(bld)
        if (Array.isArray(bld.elevators)) deriveLegacyElevators(bld)
      }
    }
  }
  return JSON.stringify(clean, null, 2)
}

// Derived legacy view for the v2 compiler read path (reads floor arrays);
// regenerated on serialize; new arrays are the source of truth; removed in P5.
function deriveLegacyStaircases(bld: Building): void {
  if (!Array.isArray(bld.floors)) return
  const perFloor = new Map<number, LegacyStaircase[]>()
  for (const feature of bld.staircases ?? []) {
    if (!feature.levels) continue
    for (const levelKey of Object.keys(feature.levels)) {
      const level = Number(levelKey)
      const geom = feature.levels[level]
      if (!geom) continue
      const records = perFloor.get(level) ?? []
      records.push({
        id: `${feature.id}-${level}`,
        name: feature.name,
        position: geom.position,
        fromLevel: feature.fromLevel,
        toLevel: feature.toLevel,
        type: feature.type,
      })
      perFloor.set(level, records)
    }
  }
  for (const floor of bld.floors) {
    floor.staircases = perFloor.get(floor.level) ?? []
  }
}

function deriveLegacyElevators(bld: Building): void {
  if (!Array.isArray(bld.floors)) return
  const perFloor = new Map<number, LegacyElevator[]>()
  for (const feature of bld.elevators ?? []) {
    if (!feature.levels) continue
    for (const levelKey of Object.keys(feature.levels)) {
      const level = Number(levelKey)
      const geom = feature.levels[level]
      if (!geom) continue
      const records = perFloor.get(level) ?? []
      records.push({
        id: `${feature.id}-${level}`,
        name: feature.name,
        position: geom.position,
        fromLevel: feature.fromLevel,
        toLevel: feature.toLevel,
      })
      perFloor.set(level, records)
    }
  }
  for (const floor of bld.floors) {
    floor.elevators = perFloor.get(floor.level) ?? []
  }
}

// ── Deserialize JSON string back to CampusDocument ──

export function deserializeDocument(json: string): CampusDocument {
  const parsed = JSON.parse(json)
  validateDocument(parsed)
  migrateDocument(parsed)
  return parsed as unknown as CampusDocument
}

// ── Basic validation on deserialization ──

function validateDocument(doc: unknown): asserts doc is Record<string, unknown> {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid document: not an object')
  }
  const d = doc as Record<string, unknown>

  // schemaVersion may be absent (unversioned legacy docs are treated as v1);
  // if present it must be a number.
  if (d.schemaVersion !== undefined && typeof d.schemaVersion !== 'number') {
    throw new Error('Invalid document: invalid schemaVersion')
  }
  if (typeof d.version !== 'number') {
    throw new Error('Invalid document: missing or invalid version')
  }
  if (!d.metadata || typeof d.metadata !== 'object') {
    throw new Error('Invalid document: missing metadata')
  }
  if (!Array.isArray(d.buildings)) {
    throw new Error('Invalid document: buildings must be an array')
  }
  if (!Array.isArray(d.roads)) {
    throw new Error('Invalid document: roads must be an array')
  }
  if (!Array.isArray(d.panoramas)) {
    throw new Error('Invalid document: panoramas must be an array')
  }
  if (!Array.isArray(d.qrCheckpoints)) {
    throw new Error('Invalid document: qrCheckpoints must be an array')
  }
  // Outdoor/campus POIs are additive-optional; when present they must be an array.
  if (d.pois !== undefined && !Array.isArray(d.pois)) {
    throw new Error('Invalid document: pois must be an array')
  }
  validateFeatures(d.buildings)
}

function validateFeatures(buildings: unknown): void {
  if (!Array.isArray(buildings)) return
  for (const bld of buildings) {
    if (!bld || typeof bld !== 'object') continue
    const b = bld as Record<string, unknown>
    if (Array.isArray(b.staircases)) {
      for (const feature of b.staircases) validateFeatureShape('staircase', feature)
    }
    if (Array.isArray(b.elevators)) {
      for (const feature of b.elevators) validateFeatureShape('elevator', feature)
    }
  }
}

function validateFeatureShape(kind: 'staircase' | 'elevator', feature: unknown): void {
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
    throw new Error(`Invalid document: ${kind} entry must be an object`)
  }
  const f = feature as Record<string, unknown>
  const id = typeof f.id === 'string' ? f.id : '<unnamed>'
  const levels = f.levels
  if (!levels || typeof levels !== 'object' || Array.isArray(levels) || Object.keys(levels).length === 0) {
    throw new Error(`Invalid document: ${kind} "${id}" missing levels`)
  }
  for (const key of Object.keys(levels)) {
    if (!/^-?\d+$/.test(key)) {
      throw new Error(`Invalid document: ${kind} "${id}" has non-numeric level key "${key}"`)
    }
  }
  if (
    typeof f.fromLevel !== 'number' ||
    typeof f.toLevel !== 'number' ||
    (f.fromLevel as number) > (f.toLevel as number)
  ) {
    throw new Error(`Invalid document: ${kind} "${id}" fromLevel must be <= toLevel`)
  }
}

// ── Migration on deserialization ──

// P1-T6 (R2.4/D7): doorType is a closed enum — unknown values fail loudly
// on deserialize rather than silently corrupting the door model.
function assertDoorType(door: Record<string, unknown>): void {
  const id = typeof door.id === 'string' ? door.id : '<unnamed>'
  if (!isDoorType(door.doorType)) {
    throw new Error(`Invalid document: RoomDoor "${id}" has unknown doorType "${String(door.doorType)}"`)
  }
}

// P1-T7 (R2.5/D10): route-network node/edge types are closed enums — unknown
// values fail loudly on deserialize (same contract as assertDoorType).
function assertRouteNodeType(node: Record<string, unknown>): void {
  const id = typeof node.id === 'string' ? node.id : '<unnamed>'
  if (!isRouteNodeType(node.type)) {
    throw new Error(`Invalid document: RouteNode "${id}" has unknown type "${String(node.type)}"`)
  }
}

function assertRouteEdgeType(edge: Record<string, unknown>): void {
  const id = typeof edge.id === 'string' ? edge.id : '<unnamed>'
  if (!isRouteEdgeType(edge.type)) {
    throw new Error(`Invalid document: RouteEdge "${id}" has unknown type "${String(edge.type)}"`)
  }
}

function migrateDocument(doc: Record<string, unknown>): void {
  if (typeof doc.schemaVersion !== 'number') {
    doc.schemaVersion = 1
  }
  const buildings = doc.buildings as Record<string, unknown>[]
  if (!Array.isArray(buildings)) return
  for (const bld of buildings) {
    if (!Array.isArray(bld.verticalConnectors)) {
      bld.verticalConnectors = []
    }
    // P1-T1 (R2.1/D12): per-floor origin fields are ADDITIVE OPTIONAL — legacy
    // documents keep them absent (no rewrite, no migration prompt); defaults
    // ({x:0,y:0} / 0) are applied at consumption time (CoordinateTransformer
    // identity fallback, forward-adapter `??` fallbacks).
    mintFeatures(bld)
    const floors = bld.floors as Record<string, unknown>[]
    if (Array.isArray(floors)) {
      for (const floor of floors) {
        if (!Array.isArray(floor.connectorStops)) {
          floor.connectorStops = []
        }
        const rooms = floor.rooms as Record<string, unknown>[]
        if (Array.isArray(rooms)) {
          for (const room of rooms) {
            if (!Array.isArray(room.roomDoors)) {
              room.roomDoors = []
            } else {
              // P1-T6 (R2.4): unknown doorType values are rejected on load.
              for (const door of room.roomDoors) assertDoorType(door)
            }
          }
        }
        // P1-T6: extracted Floor.doors collection obeys the same enum.
        const doors = floor.doors as Record<string, unknown>[] | undefined
        if (Array.isArray(doors)) {
          for (const door of doors) assertDoorType(door)
        }
        // P1-T7 (R2.5/D10): authored route network obeys the closed enums.
        // Verbatim passthrough otherwise (D12 additive-absent).
        const routeNetwork = floor.routeNetwork as Record<string, unknown> | undefined
        if (routeNetwork && typeof routeNetwork === 'object') {
          const nodes = routeNetwork.nodes as Record<string, unknown>[] | undefined
          if (Array.isArray(nodes)) {
            for (const node of nodes) assertRouteNodeType(node)
          }
          const edges = routeNetwork.edges as Record<string, unknown>[] | undefined
          if (Array.isArray(edges)) {
            for (const edge of edges) assertRouteEdgeType(edge)
          }
        }
      }
    }
  }
}

// Legacy per-floor arrays → single-level feature entities (one feature per
// legacy record; id preserved; fromLevel = toLevel = the owning floor).
function mintFeatures(bld: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(bld, 'staircases')) {
    const minted = mintStaircases(bld)
    if (minted.length > 0) bld.staircases = minted
  }
  if (!Object.prototype.hasOwnProperty.call(bld, 'elevators')) {
    const minted = mintElevators(bld)
    if (minted.length > 0) bld.elevators = minted
  }
}

function mintStaircases(bld: Record<string, unknown>): Record<string, unknown>[] {
  const floors = bld.floors as Record<string, unknown>[]
  if (!Array.isArray(floors)) return []
  const minted: Record<string, unknown>[] = []
  for (const floor of floors) {
    if (!floor || typeof floor !== 'object') continue
    const level = floor.level as number
    const records = floor.staircases as Record<string, unknown>[]
    if (!Array.isArray(records)) continue
    for (const rec of records) {
      minted.push({
        id: rec.id,
        buildingId: bld.id,
        name: rec.name,
        type: rec.type,
        accessible: false,
        fromLevel: level,
        toLevel: level,
        levels: { [level]: { position: rec.position, rotation: 0 } },
      })
    }
  }
  return minted
}

function mintElevators(bld: Record<string, unknown>): Record<string, unknown>[] {
  const floors = bld.floors as Record<string, unknown>[]
  if (!Array.isArray(floors)) return []
  const minted: Record<string, unknown>[] = []
  for (const floor of floors) {
    if (!floor || typeof floor !== 'object') continue
    const level = floor.level as number
    const records = floor.elevators as Record<string, unknown>[]
    if (!Array.isArray(records)) continue
    for (const rec of records) {
      minted.push({
        id: rec.id,
        buildingId: bld.id,
        name: rec.name,
        // Legacy elevator records carry no type — default to passenger.
        type: 'passenger',
        accessible: false,
        fromLevel: level,
        toLevel: level,
        levels: { [level]: { position: rec.position, rotation: 0 } },
      })
    }
  }
  return minted
}

// ── Round-trip stability check ──
// First pass canonicalizes: legacy docs are minted into features on read and
// dual-write regenerates derived floor arrays on write; thereafter serialization
// must be idempotent. json2 === json3 asserts that stability.
export function roundTrip(doc: CampusDocument): { success: boolean; error?: string } {
  try {
    const json = serializeDocument(doc)
    const restored = deserializeDocument(json)
    const json2 = serializeDocument(restored)
    const restored2 = deserializeDocument(json2)
    const json3 = serializeDocument(restored2)
    if (json2 !== json3) {
      return { success: false, error: 'Round-trip produced different JSON' }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
