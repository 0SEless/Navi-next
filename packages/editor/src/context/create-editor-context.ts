import { DocumentStore } from './document-store'
import { ServiceRegistry } from './service-registry'
import { DocumentEventBus } from '../eventbus'
import { CommandRegistry } from '../commands/registry'
import { CommandDispatcher } from '../commands/dispatcher'
import { HistoryStack } from '../history'
import { entityUpdateHandler } from '../commands/entity-update-handler'
import { roomCreateHandler, roomDeleteHandler } from '../commands/room-handlers'
import { semanticRoomDeclareHandler, semanticRoomUpdateHandler, semanticRoomUnassignHandler } from '../commands/semantic-room-handlers'
import { hallwayCreateHandler, hallwayDeleteHandler } from '../commands/hallway-handlers'
import { staircaseCreateHandler, staircaseDeleteHandler } from '../commands/staircase-handlers'
import { elevatorCreateHandler, elevatorDeleteHandler } from '../commands/elevator-handlers'
import { entranceCreateHandler, entranceDeleteHandler } from '../commands/entrance-handlers'
import { connectEntranceHandler, disconnectEntranceHandler } from '../commands/relationship-handlers'
import { buildingCreateHandler, buildingDeleteHandler } from '../commands/building-handlers'
import { roadCreateHandler, roadDeleteHandler } from '../commands/road-handlers'
import { roadRecoveryApplyHandler } from '../commands/road-recovery-handlers'
import { floorCreateHandler, floorRenameHandler, floorDeleteHandler, floorDuplicateHandler, floorReorderHandler } from '../commands/floor-handlers'
import { floorManageHandler, buildingEditInteriorHandler, buildingAdjustPositionHandler } from '../commands/ui-action-handlers'
import { boundarySetHandler, boundaryClearHandler } from '../commands/boundary-handlers'
import { areaCreateHandler, areaDeleteHandler } from '../commands/area-handlers'
import { parametricCreateHandler, parametricDeleteHandler, parametricUpdateHandler } from '../commands/parametric-handlers'
import { featureCreateHandler, featureUpdateHandler, featureModeTransitionHandler, featureDeleteHandler, featureReplaceHandler } from '../commands/feature-handlers'
import { poiCreateHandler, poiUpdateHandler, poiDeleteHandler, doorCreateHandler, doorUpdateHandler, doorDeleteHandler, doorDuplicateHandler, doorRouteConnectHandler, doorRouteDisconnectHandler, openingCreateHandler, openingDeleteHandler } from '../commands/feature-handlers'
import { doorOwnershipReconcileHandler } from '../commands/door-ownership'
import { routePathCreateHandler, routeNodeCreateHandler, routeNodeUpdateHandler, routeNodeDeleteHandler, routeEdgeCreateHandler, routeEdgeDeleteHandler } from '../commands/route-network-handlers'
import { roomAccessAssignHandler, roomAccessUnassignHandler, entranceAccessAssignHandler, entranceAccessUnassignHandler } from '../commands/route-access-handlers'
import { featureLevelUpdateHandler, featureLevelCopyHandler } from '../commands/levels-handlers'
import { wallCreateHandler, wallUpdateHandler, wallDeleteHandler } from '../commands/wall-handlers'
import { wallJunctionUpdateHandler } from '../commands/wall-junction-handlers'
import { wallSplitHandler, wallSplitUndoHandler, wallCrossingSplitHandler, wallCrossingSplitUndoHandler, wallTJunctionSplitHandler, wallMergeHandler, wallMergeUndoHandler } from '../commands/wall-topology-handlers'
import { panoramaCreateHandler, panoramaDeleteHandler } from '../commands/panorama-handlers'
import { hotspotCreateHandler, hotspotUpdateHandler, hotspotDeleteHandler } from '../commands/hotspot-handlers'

import { SelectionManager } from '../selection'
import { CurrentToolStore } from '../tools/CurrentToolStore'
import { toolRegistry } from '../tools/tool-registry'
import { Viewport } from '../viewport'
import { ValidationEngine } from '../validation/validation-engine'
import { AutoFixRegistry, assignUntitledFix, assignFloorLevelFix, clearRoadReferenceFix, clearEntranceReferenceFix, closePolygonFix } from '../validation/fix'
import { disconnectedGraphRule, missingNameRule, zeroAreaPolygonRule } from '../validation/rules/modules/skeleton'
import { polygonClosureRule } from '../validation/rules/modules/polygon-closure'
import { selfIntersectionRule } from '../validation/rules/modules/self-intersection'
import { duplicateIdsRule } from '../validation/rules/modules/duplicate-ids'
import { entranceConnectivityRule } from '../validation/rules/modules/entrance-connectivity'
import { floorMetadataRule } from '../validation/rules/modules/floor-metadata'
import { roadConnectivityRule } from '../validation/rules/modules/road-connectivity'
import { referenceRule } from '../validation/rules/modules/reference'
import { missingFootprintRule } from '../validation/rules/modules/missing-footprint'
import { orphanReferenceRule } from '../validation/rules/modules/orphan-reference'
import { connectorConnectivityRule } from '../validation/rules/modules/connector-connectivity'
import { roomDoorConnectivityRule } from '../validation/rules/modules/room-door-connectivity'
import { roomDoorGeometryRule } from '../validation/rules/modules/room-door-geometry'
import { featureExtentRule, featureOverlapRule, featureConnectivityRule } from '../validation/rules/modules/feature-rules'
import { routeNetworkRules } from '../validation/rules/modules/route-network'

import { GraphAnalysisPass, GeometryAnalysisPass, MetadataIndexPass } from '../validation/rules/analysis'
import { NavigationCompiler } from '../services/navigation-compiler'
import { PersistenceService } from '../services/persistence-service'
import type { PersistenceAdapter } from '../services/persistence-service'
import { WorkflowStore } from '../services/workflow-store'
import { WorkflowService } from '../services/workflow-service'
import { AutosaveService } from '../services/autosave-service'
import { PublishStore } from '../services/publish-store'
import { PublishService } from '../services/publish-service'
import { EditingContextService } from '../editing-context'
import { CoordinateTransformer, CONNECTIVITY_CONTRACT_VERSION, migrateAreasToPois, normalizeRoadRouting } from '@navi/core'
import type { CampusDocument, Room, Hallway, LegacyStaircase, LegacyElevator, Entrance, LocalCoord, Floor, Staircase, Elevator, RoomDoor, RouteNetwork, Wall, Window, RoomAttributes, Opening, EntranceAccess, Road, PlanAlignment } from '@navi/core'
import type { TracePath } from '@/types/nav-types'
import { resolveLevelGeometry } from '../geometry/resolve-level-geometry'
import type { EditorContext } from './editor-context'

function computeCentroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  let lat = 0, lng = 0
  for (const p of points) { lat += p.lat; lng += p.lng }
  return { lat: lat / points.length, lng: lng / points.length }
}

function computeFallbackBuildingOrigin(buildingId: string, graph: any): { lat: number; lng: number } {
  const comps: any[] = graph.components ?? []
  const allPoints: Array<{ lat: number; lng: number }> = []
  for (const c of comps) {
    if (c.buildingId !== buildingId) continue
    if (c.type === 'room' || c.type === 'hallway') {
      const poly = c.polygon ?? c.polyline
      if (poly?.points?.length) {
        allPoints.push(...poly.points)
      }
    }
  }
  if (allPoints.length > 0) return computeCentroid(allPoints)
  return { lat: 0, lng: 0 }
}

function worldPointsToLocal(points: Array<{ lat: number; lng: number }>, buildingId: string, transformer?: CoordinateTransformer): LocalCoord[] {
  if (!transformer) return []
  const result: LocalCoord[] = []
  for (const p of points) {
    const local = transformer.worldToBuildingLocal({ lat: p.lat, lng: p.lng }, buildingId)
    if (local) result.push(local)
  }
  return result
}

function getFloorLevel(f: any): number {
  return typeof f === 'number' ? f : (f.level ?? 0)
}

function nodePosition(n: any): { lat: number; lng: number } {
  if (n.position) return n.position
  return { lat: n.lat ?? 0, lng: n.lng ?? 0 }
}

// ── P1-T4 (D9): world LatLng → building-local LocalCoord ──
// Canonical path is the CoordinateTransformer (Web Mercator, registered origin).
// When no transformer is available (test-only createDocument(graph) calls), fall
// back to equirect math about the footprint centroid — deterministic, matches the
// compiler's localToLatLng convention, and never zeroes a real position (R15.4).
// When even the origin is unknown, copy the numeric values verbatim (R15.8 —
// fields are never dropped; such a building has no geometry to anchor to anyway).
const EQUIRECT_METER_PER_DEG = 111320

function equirectWorldToLocal(pos: { lat: number; lng: number }, origin: { lat: number; lng: number }): LocalCoord {
  return {
    x: (pos.lng - origin.lng) * EQUIRECT_METER_PER_DEG * Math.cos((origin.lat * Math.PI) / 180),
    y: (pos.lat - origin.lat) * EQUIRECT_METER_PER_DEG,
  }
}

function worldToLocalWithFallback(
  pos: { lat: number; lng: number },
  buildingId: string,
  transformer: CoordinateTransformer | undefined,
  origin: { lat: number; lng: number } | undefined,
): LocalCoord {
  if (transformer) {
    const local = transformer.worldToBuildingLocal(pos, buildingId)
    if (local) return local
  }
  if (origin) return equirectWorldToLocal(pos, origin)
  return { x: pos.lat, y: pos.lng }
}

function buildingOriginsMap(graph: any): Map<string, { lat: number; lng: number }> {
  const origins = new Map<string, { lat: number; lng: number }>()
  for (const b of (graph.buildings ?? [])) {
    const rawFootprint: any = b.footprint
    const points: Array<{ lat: number; lng: number }> = Array.isArray(rawFootprint)
      ? rawFootprint
      : (rawFootprint?.points ?? [])
    origins.set(b.id, points.length > 0 ? computeCentroid(points) : computeFallbackBuildingOrigin(b.id, graph))
  }
  return origins
}

// ── P0 T0.3: legacy per-floor records → feature entities ──
// One feature per legacy record (single-level `levels = { level }`), id
// PRESERVED from the legacy record (component id → feature id), so features
// are stable across reloads. No automatic cross-floor grouping — the legacy
// shape carries no reliable grouping key; a future "merge into stairwell"
// command is out of scope (plan Part I).

function mintStaircaseFeatures(buildingId: string, floors: Floor[], comps?: any[], transformer?: CoordinateTransformer): Staircase[] {
  const features: Staircase[] = []
  for (const floor of floors) {
    for (const s of floor.staircases) {
      const comp = comps?.find((c: any) => c.buildingId === buildingId && c.floor === floor.level && (c.id === s.id || c.id.startsWith(`${s.id}-`) || s.id.startsWith(`${c.id}-`)))
      let localPoly: LocalPolygon | undefined
      if (comp?.polygon && transformer) {
        const pts = worldPointsToLocal(comp.polygon, buildingId, transformer)
        if (pts.length >= 3) localPoly = { points: pts }
      }
      // Canonical feature id: (1) explicit featureId on the legacy record,
      // (2) the matching component's featureId (graph-adapter round-trip),
      // (3) exact component match → the record IS the component, keep verbatim
      // (e.g. 'comp-stair-1'), (4) legacy per-floor records with a numeric
      // suffix and NO matching component → strip the per-floor suffix so
      // multiple floor records dedupe into one feature id.
      const featureId = (s as any).featureId || comp?.featureId || (comp && comp.id === s.id ? s.id : (s.id.includes('-') && !isNaN(Number(s.id.split('-').pop())) ? s.id.slice(0, s.id.lastIndexOf('-')) : s.id))
      features.push({
        id: featureId,
        buildingId,
        name: s.name,
        type: s.type,
        accessible: false,
        fromLevel: s.fromLevel,
        toLevel: s.toLevel,
        levels: {
          [floor.level]: {
            position: s.position,
            rotation: 0,
            ...(localPoly ? { polygon: localPoly } : {}),
            ...(comp?.metadata?.drawing ? { drawing: comp.metadata.drawing } : {}),
          },
        },
      })
    }
  }
  return features
}

function mintElevatorFeatures(buildingId: string, floors: Floor[], comps?: any[], transformer?: CoordinateTransformer): Elevator[] {
  const features: Elevator[] = []
  for (const floor of floors) {
    for (const e of floor.elevators) {
      const comp = comps?.find((c: any) => c.buildingId === buildingId && c.floor === floor.level && (c.id === e.id || c.id.startsWith(`${e.id}-`) || e.id.startsWith(`${c.id}-`)))
      let localPoly: LocalPolygon | undefined
      if (comp?.polygon && transformer) {
        const pts = worldPointsToLocal(comp.polygon, buildingId, transformer)
        if (pts.length >= 3) localPoly = { points: pts }
      }
      // Same canonical-id rule as staircases (see mintStaircaseFeatures).
      const featureId = (e as any).featureId || comp?.featureId || (comp && comp.id === e.id ? e.id : (e.id.includes('-') && !isNaN(Number(e.id.split('-').pop())) ? e.id.slice(0, e.id.lastIndexOf('-')) : e.id))
      features.push({
        id: featureId,
        buildingId,
        name: e.name,
        // Legacy elevator records carry no type — default to passenger.
        type: 'passenger',
        accessible: false,
        fromLevel: e.fromLevel ?? floor.level,
        toLevel: e.toLevel ?? floor.level,
        levels: {
          [floor.level]: {
            position: e.position,
            rotation: 0,
            ...(localPoly ? { polygon: localPoly } : {}),
            ...(comp?.metadata?.drawing ? { drawing: comp.metadata.drawing } : {}),
          },
        },
      })
    }
  }
  return features
}



// Parametric records (in-memory `floor.parametricComponents`, shape
// `{ id, definitionId: 'stair'|'elevator', position, rotation, properties }`)
// mint into features carrying the drawing AND the resolved polygon computed
// via the T0.4 bridge (definition geometry() → rect → polygonizeRect) — the
// R1 contract that `polygon` is always the resolved geometry. Nothing new
// writes parametricComponents after this migration.
function mintParametricFeatures(
  buildingId: string,
  floors: Floor[],
  rawFloors: any[],
): { stairs: Staircase[]; elevators: Elevator[] } {
  const stairs: Staircase[] = []
  const elevators: Elevator[] = []
  for (let i = 0; i < rawFloors.length; i++) {
    const raw = rawFloors[i]
    if (!raw || typeof raw !== 'object') continue
    const level = getFloorLevel(raw)
    const floor = floors[i]
    const records: any[] = (raw as any).parametricComponents ?? []
    for (let j = 0; j < records.length; j++) {
      const rec = records[j]
      const definitionId = rec?.definitionId
      if (definitionId !== 'stair' && definitionId !== 'elevator') continue
      // Deterministic id: preserved from the record; if the record carries no
      // id, derive one from the (stable) record position — never a counter.
      const id = typeof rec.id === 'string' && rec.id.length > 0
        ? rec.id
        : `pc-${buildingId}-${level}-${j}`
      const position = rec.position ?? { x: 0, y: 0 }
      const rotation = rec.rotation ?? 0
      const name = typeof rec.name === 'string' && rec.name.length > 0 ? rec.name : id
      const levels: Record<number, any> = {
        [level]: {
          position,
          rotation,
          drawing: { definitionId, properties: rec.properties ?? {} },
        },
      }
      const feature = {
        id,
        buildingId,
        name,
        type: definitionId === 'stair' ? 'open' : 'passenger',
        accessible: false,
        fromLevel: level,
        toLevel: level,
        levels,
      } as Staircase | Elevator
      // Resolve the physical geometry exactly like every other consumer does
      // (single geometry-resolution path; deterministic).
      const resolved = resolveLevelGeometry(feature, level)
      if (resolved.polygon) levels[level].polygon = resolved.polygon
      if (definitionId === 'stair') stairs.push(feature as Staircase)
      else elevators.push(feature as Elevator)
    }
  }
  return { stairs, elevators }
}

export function createDocument(graph: any, transformer?: CoordinateTransformer, options?: { stampConnectivityVersion?: boolean }): CampusDocument {
  const compsByKey = new Map<string, any[]>()
  for (const c of (graph.components ?? [])) {
    const key = `${c.buildingId}:${c.floor}`
    if (!compsByKey.has(key)) compsByKey.set(key, [])
    compsByKey.get(key)!.push(c)
  }
  // P1-T4 (D9): per-building origins for the world→building-local migration
  // fallback (used for top-level panoramas/QRs that live outside the loop).
  const origins = buildingOriginsMap(graph)

  // Unified POI / Area migration: legacy Area records become outdoor 2D
  // polygon POIs on load. Existing POI ids (outdoor + indoor) are reserved so
  // a conflicting Area id is renamed deterministically. Invalid Area records
  // are never dropped — they stay as compatibility `areas[]`.
  const existingPoiIds = new Set<string>()
  for (const poi of (graph.pois ?? []) as Array<{ id?: string }>) {
    if (typeof poi?.id === 'string') existingPoiIds.add(poi.id)
  }
  for (const building of (graph.buildings ?? [])) {
    const floorSources = [...(building.floorData ?? []), ...(building.floors ?? [])]
    for (const floor of floorSources) {
      for (const poi of (floor?.pois ?? []) as Array<{ id?: string }>) {
        if (typeof poi?.id === 'string') existingPoiIds.add(poi.id)
      }
    }
  }
  const areaMigration = migrateAreasToPois((graph as any).areas, existingPoiIds)

  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: graph.campusId ?? 'Campus',
      name: graph.name ?? graph.campusId ?? 'Campus',
      description: graph.description ?? '',
      lastModified: graph.updatedAt ?? new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: (graph.buildings ?? []).map((b: any) => {
      const rawFloors: any[] = b.floors ?? []
      // Footprint is stored inconsistently across the graph model:
      // either a direct LatLng[] array OR an object { points: LatLng[] }.
      // Normalize both into { points: LatLng[] } for the document model.
      const rawFootprint: any = b.footprint
      const rawFootprintPoints: Array<{ lat: number; lng: number }> = Array.isArray(rawFootprint)
        ? rawFootprint
        : (rawFootprint?.points ?? [])
      // P1-T4 (D9): building-local anchor for world→local migration fallback.
      const buildingOrigin = rawFootprintPoints.length > 0
        ? computeCentroid(rawFootprintPoints)
        : computeFallbackBuildingOrigin(b.id, graph)
    // Build a floor metadata lookup from floorData (stored by GraphAdapter)
    const floorByLevel = new Map<number, any>()
    if (Array.isArray(b.floorData)) {
      for (const fd of b.floorData) {
        floorByLevel.set(fd.level as number, fd)
      }
    }

    const floors = rawFloors.map((f: any) => {
      const level = getFloorLevel(f)
      const key = `${b.id}:${level}`
      const comps = compsByKey.get(key) ?? []
      const fd = floorByLevel.get(level) ?? {}

      // Start with metadata from legacy floor-level entities (if any)
      const legacyRooms: Room[] = (f.rooms ?? []).map((r: any) => ({
        id: r.id, name: r.name ?? r.id, number: r.number ?? '',
        category: r.category ?? 'classroom', polygon: { points: [] },
        capacity: r.capacity, roomDoors: [], metadata: r.metadata ?? {},
      }))
        // P1-T6 (R2.4/D7): extract nested room.roomDoors into the floor-level
        // door collection. Verbatim copy of every field (R15.9); nested arrays
        // are EMPTIED, never kept alongside — one geometry source (R15.2).
        const legacyDoors: RoomDoor[] = []
        for (const r of f.rooms ?? []) {
          if (Array.isArray(r.roomDoors)) {
            for (const d of r.roomDoors) {
              legacyDoors.push({
                ...structuredClone(d),
                id: d.id,
                roomId: d.roomId ?? r.id,
                // Verbatim: optional fields stay absent when the source
                // lacks them (D12 additive-absent applies per-field).
                ...(d.connectedToId !== undefined ? { connectedToId: d.connectedToId } : {}),
                ...(d.connectedToType !== undefined ? { connectedToType: d.connectedToType } : {}),
                doorType: d.doorType ?? 'standard',
                position: d.position ?? { x: 0, y: 0 },
                width: d.width ?? 0.9,
                metadata: d.metadata ?? {},
              })
            }
          }
        }
        // New-shape input wins on id conflicts; nested leftovers merge in.
        const rawDoors = ((fd.doors as any[] | undefined) ?? (f.doors as any[] | undefined))
        const mergedDoors: RoomDoor[] | undefined = rawDoors !== undefined || legacyDoors.length > 0
          ? (() => {
              const byId = new Map<string, RoomDoor>()
              for (const d of legacyDoors) byId.set(d.id, d)
              for (const d of rawDoors ?? []) {
                byId.set(d.id, {
                  ...structuredClone(d),
                  id: d.id,
                  roomId: d.roomId,
                  ...(d.connectedToId !== undefined ? { connectedToId: d.connectedToId } : {}),
                  ...(d.connectedToType !== undefined ? { connectedToType: d.connectedToType } : {}),
                  doorType: d.doorType ?? 'standard',
                  position: d.position ?? { x: 0, y: 0 },
                  width: d.width ?? 0.9,
                  metadata: d.metadata ?? {},
                })
              }
              return Array.from(byId.values())
            })()
          : undefined
        const legacyHallways: Hallway[] = (f.hallways ?? []).map((h: any) => ({
          id: h.id, name: h.name ?? h.id, polyline: { points: [] },
          width: h.width ?? 2, color: h.color,
        }))
        const legacyStaircases: LegacyStaircase[] = (f.staircases ?? []).map((s: any) => ({
          id: s.id, name: s.name ?? s.id,
          // T0.3: carry the record's building-local position (never drop it —
          // zeroing would lose the only geometric anchor for the minted
          // feature). Graph components override it with a fresh world→local
          // conversion below.
          position: s.position ?? { x: 0, y: 0 },
          fromLevel: s.fromLevel ?? level, toLevel: s.toLevel ?? level + 1, type: s.type ?? 'open',
        }))
        const legacyElevators: LegacyElevator[] = (f.elevators ?? []).map((e: any) => ({
          id: e.id, name: e.name ?? e.id, position: e.position ?? { x: 0, y: 0 },
          // T0.3: legacy elevator records may lack from/to — fall back to the
          // owning floor's level for BOTH ends (single-level extent), so the
          // minted feature and the legacy view agree.
          fromLevel: e.fromLevel ?? level, toLevel: e.toLevel ?? level,
        }))
        const legacyEntrances: Entrance[] = (f.entrances ?? []).map((e: any) => ({
          id: e.id, label: e.name ?? e.id,
          // P1-T4 (D9): world-stored legacy records convert to building-local;
          // already-local records (new-shape input wins) copy verbatim.
          position: ('lat' in (e.position ?? {}))
            ? worldToLocalWithFallback({ lat: e.position.lat, lng: e.position.lng }, b.id, transformer, buildingOrigin)
            : (e.position ?? { x: 0, y: 0 }),
          level, type: e.type ?? 'main', hasQR: e.hasQR ?? false, hasPanorama: e.hasPanorama ?? false,
        }))
        // P1-T5 (R2.2): POIs are building-local by contract — copy verbatim
        // (R15.8/R15.9). Absent in legacy docs → stays absent (D12 additive).
        const legacyPois = ((fd.pois as any[] | undefined) ?? (f.pois as any[] | undefined))?.map((p: any) => ({
          id: p.id, name: p.name ?? '', category: p.category ?? 'other',
          // Geometry is the sole spatial source for explicit shape records.
          // Legacy position-only records retain their compatibility form;
          // never synthesize a competing position beside geometry.
          ...(p.geometry !== undefined
            ? { geometry: p.geometry }
            : { position: p.position ?? { x: 0, y: 0 } }),
          ...(p.metadata !== undefined ? { metadata: p.metadata } : {}),
          ...(p.appearance !== undefined ? { appearance: p.appearance } : {}),
        }))

        // Overlay geometry from graph.components
        for (const c of comps) {
          switch (c.type) {
            case 'room': {
              const points = c.polygon
                ? worldPointsToLocal(c.polygon, b.id, transformer)
                : []
              const existing = legacyRooms.find(r => r.id === c.id)
              if (existing) {
                if (points.length >= 3) existing.polygon = { points }
                if (c.metadata?.number) existing.number = c.metadata.number as string
                if (c.metadata?.capacity != null) existing.capacity = c.metadata.capacity as number
                if (c.metadata?.roomMetadata) existing.metadata = { ...existing.metadata, ...c.metadata.roomMetadata as Record<string, unknown> }
              } else if (points.length >= 3) {
                legacyRooms.push({
                  id: c.id, name: c.name ?? c.id,
                  number: (c.metadata?.number as string) ?? c.number ?? '',
                  category: 'classroom', polygon: { points },
                  capacity: (c.metadata?.capacity as number) ?? c.capacity,
                  roomDoors: [],
                  metadata: (c.metadata?.roomMetadata as Record<string, unknown>) ?? c.metadata ?? {},
                })
              }
              break
            }
            case 'hallway': {
              const points = c.polygon
                ? worldPointsToLocal(c.polygon, b.id, transformer)
                : []
              const existing = legacyHallways.find(h => h.id === c.id)
              if (existing) {
                if (points.length >= 2) existing.polyline = { points }
                if (c.metadata?.width != null) existing.width = c.metadata.width as number
                if (c.metadata?.color) existing.color = c.metadata.color as string
              } else if (points.length >= 2) {
                legacyHallways.push({
                  id: c.id, name: c.name ?? c.id, polyline: { points },
                  width: (c.metadata?.width as number) ?? c.width ?? 2,
                  color: (c.metadata?.color as string) ?? c.color,
                })
              }
              break
            }
            case 'stair': {
              if (!transformer) continue
              const local = transformer.worldToBuildingLocal({ lat: c.position.lat, lng: c.position.lng }, b.id)
              if (!local) continue
              const existing = legacyStaircases.find(s => s.id === c.id)
              if (existing) {
                existing.position = local
                if (c.metadata?.type) existing.type = c.metadata.type as any
              } else {
                legacyStaircases.push({
                  id: c.id, name: c.name ?? c.id, position: local,
                  fromLevel: c.range?.from ?? level, toLevel: c.range?.to ?? level + 1,
                  type: (c.metadata?.type as any) ?? 'open',
                })
              }
              break
            }
            case 'elevator': {
              if (!transformer) continue
              const local = transformer.worldToBuildingLocal({ lat: c.position.lat, lng: c.position.lng }, b.id)
              if (!local) continue
              const existing = legacyElevators.find(e => e.id === c.id)
              if (existing) {
                existing.position = local
              } else {
                legacyElevators.push({
                  id: c.id, name: c.name ?? c.id, position: local,
                  // T0.3: no range metadata on the component → single-level
                  // extent at the owning floor (both ends).
                  fromLevel: c.range?.from ?? level, toLevel: c.range?.to ?? level,
                })
              }
              break
            }
            case 'entrance': {
              const existing = legacyEntrances.find(e => e.id === c.id)
              if (!existing) {
                legacyEntrances.push({
                  id: c.id, label: c.name ?? c.id,
                  // P1-T4 (D9): component positions are world — migrate to
                  // building-local (same fallback chain as legacy records).
                  position: worldToLocalWithFallback({ lat: c.position.lat, lng: c.position.lng }, b.id, transformer, buildingOrigin),
                  level, type: 'main', hasQR: c.metadata?.hasQR ?? false,
                  hasPanorama: c.metadata?.hasPanorama ?? false,
                })
              }
              break
            }
          }
        }

        // Infer floor height from elevation delta (old docs) or default to 3.5
        const floorHeight = (fd.height as number) ?? (f.height as number) ?? 3.5

        return {
          id: (fd.id as string) ?? f.id ?? `flr-${b.id}-${level}`,
          level,
          label: (fd.label as string) ?? f.label
            ?? (level === 0 ? 'Ground Floor' : level > 0 ? `Floor ${level}` : `Basement ${Math.abs(level)}`),
          height: floorHeight,
          elevation: (fd.elevation as number) ?? f.elevation ?? 0,
          // P1-T1 (R2.1): copy per-floor origin fields verbatim when present.
          // Defaults ({x:0,y:0} / 0) are applied at consumption; the document
          // keeps them absent for legacy floors (D12 additive, no rewrite).
          ...((fd.offset ?? f.offset) !== undefined ? { offset: (fd.offset ?? f.offset) as { x: number; y: number } } : {}),
          ...((fd.rotation ?? f.rotation) !== undefined ? { rotation: (fd.rotation ?? f.rotation) as number } : {}),
          ...((fd.shortLabel as string | undefined) !== undefined
            ? { shortLabel: fd.shortLabel as string }
            : {}),
          planImageId: (fd.planImageId as string) ?? f.planImageId,
          planAlignment: (fd.planAlignment as PlanAlignment | undefined) ?? f.planAlignment,
          textureId: (fd.textureId as string) ?? f.textureId,
          svgOverlayId: (fd.svgOverlayId as string) ?? f.svgOverlayId,
          ...((fd.visible as boolean | undefined) !== undefined
            ? { visible: fd.visible as boolean }
            : {}),
          ...((fd.locked as boolean | undefined) !== undefined
            ? { locked: fd.locked as boolean }
            : {}),
          ...((fd.floorPlanState as string | undefined) !== undefined
            ? { floorPlanState: fd.floorPlanState as 'none' | 'active' | 'locked' }
            : {}),
          rooms: legacyRooms,
          hallways: legacyHallways,
          staircases: legacyStaircases,
          elevators: legacyElevators,
          entrances: legacyEntrances,
          connectorStops: [],
          parametricComponents: [],
          ...(legacyPois !== undefined ? { pois: legacyPois } : {}),
          ...(mergedDoors !== undefined ? { doors: mergedDoors } : {}),
          // P1-T7 (R2.5/D3): authored route network passes through verbatim —
          // first-class persisted entity, never synthesized from geometry.
          // New-shape floorData wins, raw floor record is the fallback (same
          // precedence as doors above). Absent stays absent (D12 additive).
          ...(((fd.routeNetwork as RouteNetwork | undefined) ?? (f.routeNetwork as RouteNetwork | undefined)) !== undefined
            ? { routeNetwork: ((fd.routeNetwork as RouteNetwork | undefined) ?? (f.routeNetwork as RouteNetwork | undefined)) as RouteNetwork }
            : {}),
          metadata: (fd.metadata as Record<string, unknown>) ?? f.metadata ?? {},
          ...(fd.walls !== undefined ? { walls: fd.walls as Wall[] } : {}),
          ...(fd.windows !== undefined ? { windows: fd.windows as Window[] } : {}),
          ...(fd.openings !== undefined ? { openings: fd.openings as Opening[] } : {}),
          ...(fd.roomAttributes !== undefined ? { roomAttributes: fd.roomAttributes as RoomAttributes[] } : {}),
          ...(fd.entranceAccess !== undefined ? { entranceAccess: fd.entranceAccess as EntranceAccess[] } : {}),
        }
      })

      // ── P0 T0.3: mint feature entities from legacy per-floor records ──
      // New-shape input wins (serializer T0.2 path): if the graph building
      // already carries feature arrays, use them verbatim and do NOT mint
      // from the legacy arrays.
      const parametric = mintParametricFeatures(b.id, floors, rawFloors)
      const staircases = Array.isArray(b.staircases)
        ? (b.staircases as Staircase[])
        : [...mintStaircaseFeatures(b.id, floors, graph.components, transformer), ...parametric.stairs]
      const elevators = Array.isArray(b.elevators)
        ? (b.elevators as Elevator[])
        : [...mintElevatorFeatures(b.id, floors, graph.components, transformer), ...parametric.elevators]


      return {
        id: b.id,
        name: b.name ?? b.id,
        code: b.code ?? '',
        category: b.category ?? 'academic',
        description: b.description ?? '',
        department: b.department ?? '',
        floors,
        ...(staircases.length > 0 ? { staircases } : {}),
        ...(elevators.length > 0 ? { elevators } : {}),
        // W11: vertical transitions connecting route nodes across floors
        ...(Array.isArray(b.verticalTransitions) && b.verticalTransitions.length > 0
          ? { verticalTransitions: b.verticalTransitions }
          : {}),
        footprint: { points: rawFootprintPoints.map((p: any) => ({ lat: p.lat, lng: p.lng })) },
        baseElevation: b.baseElevation ?? 0,
        height: b.height ?? 10,
        // P1-T1 (D4): carry building rotation verbatim when present; legacy
        // buildings have none → absent (default 0 at consumption, D12 additive).
        ...(b.rotation !== undefined ? { rotation: b.rotation as number } : {}),
        verticalConnectors: [],
        color: b.color ?? '#1C6BEB',
        aliases: (b.aliases as string[]) ?? [],
        metadata: (b.metadata as Record<string, unknown>) ?? {},
      }
    }),
    // Reverse-map graph entities that live outside the building/floor hierarchy.
    // GraphAdapter.sync() converts Road→Trace, Panorama→Node(hasPanorama),
    // QRCheckpoint→Node(hasQr). We reconstruct the document entities here so the
    // round-trip is lossless (best-effort: surface, heading, hotspots use defaults
    // since the graph doesn't store them).
    roads: (graph.traces ?? []).map((t: TracePath) => {
      const routing = normalizeRoadRouting(t.routing)
      return {
        id: t.id,
        name: t.name ?? '',
        polyline: { points: t.points ?? [] },
        width: t.width ?? 3,
        surface: (t.metadata?.surface ?? 'paved') as Road['surface'],
        type: (t.type === 'connector' ? 'service' : 'arterial') as Road['type'],
        displayMode: t.displayMode === 'navigation-only' ? 'navigation-only' : 'visible',
        ...(routing === undefined ? {} : { routing }),
        metadata: t.metadata ?? {},
      }
    }),
    // Reconstruct explicit road junctions from graph snapshot nodes.
    // Junction identity is authoring truth — it survives the full rebuild cycle.
    roadJunctions: (() => {
      const junctionNodes = (graph.nodes ?? []).filter(
        (n: any) => n.metadata?.connectionNode === true &&
          Array.isArray(n.metadata?.traceIds) &&
          (n.metadata.traceIds as string[]).length >= 2
      )
      if (junctionNodes.length === 0) return undefined
      return junctionNodes.map((n: any) => ({
        id: (n.metadata?.junctionRecordId as string) || n.id,
        position: { lat: n.position.lat, lng: n.position.lng },
        roadIds: [...(n.metadata.traceIds as string[])],
        source: (n.metadata?.junctionSource as 'authored' | 'legacy-inferred') ?? 'legacy-inferred',
      }))
    })(),
    panoramas: (graph.nodes ?? [])
      .filter((n: any) => n.hasPanorama && n.metadata?.panoramaId)
      .map((n: any) => ({
        id: n.metadata.panoramaId as string,
        label: (n.label ?? '').replace('Panorama: ', ''),
        // P1-T4 (D9): graph node positions are world — migrate to building-local
        // when a building is known; otherwise keep verbatim (R15.8 fallback).
        position: n.buildingId
          ? worldToLocalWithFallback(nodePosition(n), n.buildingId, transformer, origins.get(n.buildingId))
          : nodePosition(n),
        heading: 0,
        imageAssetId: '',
        buildingId: n.buildingId || undefined,
        floor: n.floor ?? undefined,
        hotspots: [],
      })),
    qrCheckpoints: (graph.nodes ?? [])
      .filter((n: any) => n.type === 'qr_marker' || (n.hasQr && n.metadata?.qrCode))
      .map((n: any) => ({
        id: (n.metadata?.qrId as string) ?? n.id,
        label: (n.label ?? '').replace(/^QR:\s*/, ''),
        position: worldToLocalWithFallback(nodePosition(n), n.buildingId, transformer, origins.get(n.buildingId)),
        floor: n.floor,
        buildingId: n.buildingId,
        code: (n.metadata?.qrCode ?? n.metadata?.code ?? '') as string,
        metadata: (n.metadata?.qrMetadata as Record<string, unknown>) ?? {},
      })),
    // Compatibility reader: legacy Area records that could not be migrated
    // (invalid geometry) are preserved verbatim; valid ones become POIs above.
    areas: areaMigration.unmigrated.length > 0
      ? areaMigration.unmigrated.map((a: any) => ({
          id: a.id,
          name: a.name ?? '',
          points: (a.points ?? []).map((p: any) => ({ lat: p.lat, lng: p.lng })),
          color: a.color ?? '#8B5CF6',
        }))
      : undefined,
    // Outdoor/campus POIs (world geometry) + Areas migrated to POIs on load.
    // Invalid legacy Areas stay as compatibility records (never dropped).
    ...(() => {
      const pois = [
        ...(((graph as any).pois ?? []) as any[]).map((poi: any) => structuredClone(poi)),
        ...areaMigration.pois.map((poi) => structuredClone(poi)),
      ]
      return pois.length > 0 ? { pois } : {}
    })(),
    separatedCrossings: (graph as any).separatedCrossings?.length > 0
      ? (graph as any).separatedCrossings.map((sc: any) => ({
          id: sc.id,
          roadIds: [...sc.roadIds],
          position: { lat: sc.position.lat, lng: sc.position.lng },
        }))
      : undefined,
    boundary: graph.boundary ? { points: graph.boundary.points.map((p: any) => ({ lat: p.lat, lng: p.lng })) } : undefined,
    connectivitySemanticsVersion: (graph as any)._connectivitySemanticsVersion ?? (options?.stampConnectivityVersion ? CONNECTIVITY_CONTRACT_VERSION : undefined),
  }
}

export function createEditorContext(
  graph: any,
  persistenceAdapter: PersistenceAdapter,
  navCompiler: NavigationCompiler,
): EditorContext {
  const transformer = new CoordinateTransformer()
  for (const b of (graph.buildings ?? [])) {
    // Building.footprint may be either LatLng[] (post-sync format) or
    // { points: LatLng[] } (legacy WorldPolygon format). Handle both.
    const rawFootprint: any = b.footprint
    const footprintPoints: Array<{ lat: number; lng: number }> = Array.isArray(rawFootprint)
      ? rawFootprint
      : (rawFootprint?.points ?? [])
    const center = footprintPoints.length > 0
      ? computeCentroid(footprintPoints)
      : computeFallbackBuildingOrigin(b.id, graph)
    transformer.registerBuilding({
      buildingId: b.id,
      origin: { lat: center.lat, lng: center.lng },
      // P1-T1 (D4/D18): carry building rotation from the graph when present;
      // legacy graphs have none → default 0 (R2.1, additive optional).
      rotation: (b.rotation as number) ?? 0,
    })
    // P1-T1 (R2.1): register per-floor offset/rotation so floor-local →
    // building-local transforms resolve in-editor. Legacy floors have none →
    // identity defaults (R2.1, no migration prompt). Rotation math only — no
    // rotation editing UI in V1 (R3.5).
    for (const f of (b.floors ?? [])) {
      const level = getFloorLevel(f)
      transformer.registerFloor(b.id, level, {
        offset: (f.offset as { x: number; y: number } | undefined) ?? { x: 0, y: 0 },
        rotation: (f.rotation as number | undefined) ?? 0,
      })
    }
  }

  const document = createDocument(graph, transformer)

  const registry = new ServiceRegistry()

  const eventBus = new DocumentEventBus()
  registry.register('eventBus', eventBus)

  const documentStore = new DocumentStore(document, eventBus)

  const registryCmd = new CommandRegistry()
  registryCmd.register(entityUpdateHandler)
  registryCmd.register(roomCreateHandler)
  registryCmd.register(roomDeleteHandler)
  registryCmd.register(semanticRoomDeclareHandler)
  registryCmd.register(semanticRoomUpdateHandler)
  registryCmd.register(semanticRoomUnassignHandler)
  registryCmd.register(hallwayCreateHandler)
  registryCmd.register(hallwayDeleteHandler)
  registryCmd.register(staircaseCreateHandler)
  registryCmd.register(staircaseDeleteHandler)
  registryCmd.register(elevatorCreateHandler)
  registryCmd.register(elevatorDeleteHandler)
  registryCmd.register(entranceCreateHandler)
  registryCmd.register(entranceDeleteHandler)
  registryCmd.register(connectEntranceHandler)
  registryCmd.register(disconnectEntranceHandler)
  registryCmd.register(buildingCreateHandler)
  registryCmd.register(buildingDeleteHandler)
  registryCmd.register(roadCreateHandler)
  registryCmd.register(roadDeleteHandler)
  registryCmd.register(roadRecoveryApplyHandler)
  registryCmd.register(floorCreateHandler)
  registryCmd.register(floorRenameHandler)
  registryCmd.register(floorDeleteHandler)
  registryCmd.register(floorDuplicateHandler)
  registryCmd.register(floorReorderHandler)
  registryCmd.register(floorManageHandler)
  registryCmd.register(buildingEditInteriorHandler)
  registryCmd.register(buildingAdjustPositionHandler)
  registryCmd.register(boundarySetHandler)
  registryCmd.register(boundaryClearHandler)
  registryCmd.register(areaCreateHandler)
  registryCmd.register(areaDeleteHandler)
  // P1-T5 (R2.2): POI discovery landmarks
  registryCmd.register(poiCreateHandler)
  registryCmd.register(poiUpdateHandler)
  registryCmd.register(poiDeleteHandler)
  // P1-T6 (R2.4/D7): RoomDoor as an independent entity
  registryCmd.register(doorCreateHandler)
  registryCmd.register(doorUpdateHandler)
  registryCmd.register(doorDeleteHandler)
  registryCmd.register(doorDuplicateHandler)
  registryCmd.register(doorRouteConnectHandler)
  registryCmd.register(doorRouteDisconnectHandler)
  registryCmd.register(doorOwnershipReconcileHandler)
  // W7A: canonical wall-attached openings (doors + windows)
  registryCmd.register(openingCreateHandler)
  registryCmd.register(openingDeleteHandler)
  // P1-T7 (R2.5/R8.1/D3): route network as a first-class entity
  registryCmd.register(routeNodeCreateHandler)
  registryCmd.register(routeNodeUpdateHandler)
  registryCmd.register(routeNodeDeleteHandler)
  registryCmd.register(routeEdgeCreateHandler)
  registryCmd.register(routeEdgeDeleteHandler)
  registryCmd.register(routePathCreateHandler)
  registryCmd.register(roomAccessAssignHandler)
  registryCmd.register(roomAccessUnassignHandler)
  registryCmd.register(entranceAccessAssignHandler)
  registryCmd.register(entranceAccessUnassignHandler)
  // P1-T9 (R2.6/R8.4): per-floor feature placement (levels)
  registryCmd.register(featureLevelUpdateHandler)
  registryCmd.register(featureLevelCopyHandler)
  registryCmd.register(parametricCreateHandler)
  registryCmd.register(parametricDeleteHandler)
  registryCmd.register(parametricUpdateHandler)
  registryCmd.register(featureCreateHandler)
  registryCmd.register(featureUpdateHandler)
  registryCmd.register(featureModeTransitionHandler)
  registryCmd.register(featureDeleteHandler)
  registryCmd.register(featureReplaceHandler)
  // Panorama handlers
  registryCmd.register(panoramaCreateHandler)
  registryCmd.register(panoramaDeleteHandler)
  // Hotspot handlers
  registryCmd.register(hotspotCreateHandler)
  registryCmd.register(hotspotUpdateHandler)
  registryCmd.register(hotspotDeleteHandler)
  // Wall handlers
  registryCmd.register(wallCreateHandler)
  registryCmd.register(wallUpdateHandler)
  registryCmd.register(wallDeleteHandler)
  registryCmd.register(wallJunctionUpdateHandler)
  // Wall topology handlers
  registryCmd.register(wallSplitHandler)
  registryCmd.register(wallSplitUndoHandler)
  registryCmd.register(wallCrossingSplitHandler)
  registryCmd.register(wallCrossingSplitUndoHandler)
  registryCmd.register(wallTJunctionSplitHandler)
  registryCmd.register(wallMergeHandler)
  registryCmd.register(wallMergeUndoHandler)


  const dispatcher = new CommandDispatcher(registryCmd, document, eventBus)

  const history = new HistoryStack(dispatcher, document, registryCmd, 200, documentStore)
  dispatcher.addPreHook(history)
  dispatcher.addPostHook(history)

  const selectionManager = new SelectionManager(document, eventBus)

  registry.register('documentStore', documentStore)
  registry.register('dispatcher', dispatcher)
  registry.register('history', history)
  registry.register('selection', selectionManager)

  const toolRegistryStore = new CurrentToolStore()
  toolRegistryStore.setValidToolIds(new Set(toolRegistry.getAll().map((t) => t.id)))
  const viewport = new Viewport(eventBus)
  registry.register('toolRegistry', toolRegistryStore)
  registry.register('viewport', viewport)

  const validationEngine = new ValidationEngine()
  validationEngine.registerRule(disconnectedGraphRule)
  validationEngine.registerRule(missingFootprintRule)
  validationEngine.registerRule(orphanReferenceRule)
  validationEngine.registerRule(missingNameRule)
  validationEngine.registerRule(zeroAreaPolygonRule)
  validationEngine.registerRule(polygonClosureRule)
  validationEngine.registerRule(selfIntersectionRule)
  validationEngine.registerRule(duplicateIdsRule)
  validationEngine.registerRule(entranceConnectivityRule)
  validationEngine.registerRule(floorMetadataRule)
  validationEngine.registerRule(roadConnectivityRule)
  validationEngine.registerRule(referenceRule)
  validationEngine.registerRule(connectorConnectivityRule)
  validationEngine.registerRule(roomDoorConnectivityRule)
  validationEngine.registerRule(roomDoorGeometryRule)
  validationEngine.registerRule(featureExtentRule)
  validationEngine.registerRule(featureOverlapRule)
  validationEngine.registerRule(featureConnectivityRule)
  for (const routeRule of routeNetworkRules) {
    validationEngine.registerRule(routeRule)
  }

  validationEngine.registerAnalysisPass(new GraphAnalysisPass())
  validationEngine.registerAnalysisPass(new GeometryAnalysisPass())
  validationEngine.registerAnalysisPass(new MetadataIndexPass())
  validationEngine.initialize()
  registry.register('validationEngine', validationEngine)

  eventBus.on('document.changed', () => {
    validationEngine.markDirty()
  })

  const autoFixRegistry = new AutoFixRegistry()
  autoFixRegistry.registerFix(assignUntitledFix)
  autoFixRegistry.registerFix(assignFloorLevelFix)
  autoFixRegistry.registerFix(clearRoadReferenceFix)
  autoFixRegistry.registerFix(clearEntranceReferenceFix)
  autoFixRegistry.registerFix(closePolygonFix)
  autoFixRegistry.initialize()
  registry.register('autoFixRegistry', autoFixRegistry)

  const persistence = new PersistenceService(persistenceAdapter)
  const workflowStore = new WorkflowStore()
  const workflow = new WorkflowService()
  const editingContext = new EditingContextService()

  registry.register('navigationCompiler', navCompiler)
  registry.register('persistence', persistence)
  registry.register('workflowStore', workflowStore)
  registry.register('workflow', workflow)
  const autosave = new AutosaveService()
  registry.register('autosave', autosave)
  const publishStore = new PublishStore()
  const publishService = new PublishService(publishStore)
  registry.register('publishStore', publishStore)
  registry.register('publish', publishService)
  registry.register('editingContext', editingContext)

  void registry.init(document)

  return { document, services: registry, transformer }
}
