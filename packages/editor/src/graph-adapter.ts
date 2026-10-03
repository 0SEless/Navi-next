import type { CampusDocument, LatLng as CoreLatLng, EntranceAccess, RoadJunction } from '@navi/core'
import { CoordinateTransformer, haversine, collectFloorDoors, explicitEntranceAccessNodeId, CONNECTIVITY_CONTRACT_VERSION, normalizeRoadRouting, ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { Graph } from '@/engine/graph'
import { compileComponent } from '@/engine/component-compiler'
import type { CompileContext } from '@/engine/component-compiler'
import type { Component, ComponentType, DoorData, TracePath, Building as LegacyBuilding, NavNode, NavEdge, LatLng as LegacyLatLng } from '@/types/nav-types'
import { pointToSegmentDistance } from '@/engine/geo-utils'
import { resolveLevelGeometry } from './geometry/resolve-level-geometry'

function coreLatLngToLegacy(p: CoreLatLng): LegacyLatLng {
  return { lat: p.lat, lng: p.lng }
}

function computeCentroid(points: LegacyLatLng[]): LegacyLatLng {
  let lat = 0, lng = 0
  for (const p of points) { lat += p.lat; lng += p.lng }
  return { lat: lat / points.length, lng: lng / points.length }
}

function computeBBox(points: LegacyLatLng[]): { width: number; height: number } {
  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  const R = 6371000
  const dLat = ((maxLat - minLat) * Math.PI) / 180
  const dLng = ((maxLng - minLng) * Math.PI) / 180
  const avgLat = ((minLat + maxLat) / 2) * Math.PI / 180
  const height = R * Math.abs(dLat)
  const width = R * Math.cos(avgLat) * Math.abs(dLng)
  return { width, height }
}

const EXPLICIT_ACCESS_NODE_REUSE_METERS = 0.75
const EXPLICIT_ACCESS_SEGMENT_TOLERANCE_METERS = 8

function traceIdsForNode(node: NavNode | undefined): string[] {
  if (!node) return []
  const metadata = node.metadata
  return [...new Set([
    ...(typeof metadata?.traceId === 'string' ? [metadata.traceId] : []),
    ...(Array.isArray(metadata?.traceIds) ? metadata.traceIds.filter((id): id is string => typeof id === 'string') : []),
  ])]
}

function nodeBelongsToTrace(node: NavNode | undefined, traceId: string): boolean {
  return traceIdsForNode(node).includes(traceId)
}

/**
 * Resolve an explicit outdoor target without using Entrance proximity. Trace
 * anchors are re-found by authored trace identity + position on every sync;
 * only a missing target is left unconnected for validation to report.
 */
function resolveExplicitOutdoorTarget(graph: Graph, access: EntranceAccess): NavNode | null {
  if (!access.outdoorRouteId || !access.outdoorPosition) {
    return graph.getNode(access.outdoorNodeId) ?? null
  }

  const routeId = access.outdoorRouteId
  const position = coreLatLngToLegacy(access.outdoorPosition)
  const traceNodes = graph.nodes.filter((node) =>
    (node.type === 'intersection' || node.type === 'outdoor') && nodeBelongsToTrace(node, routeId),
  )
  const existing = traceNodes
    .map((node) => ({ node, distance: haversine(node.position, position) }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (existing && existing.distance <= EXPLICIT_ACCESS_NODE_REUSE_METERS) return existing.node

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const edge = graph.edges
    .map((candidate) => {
      const from = nodeById.get(candidate.from)
      const to = nodeById.get(candidate.to)
      if (!from || !to) return null
      // Only authored edges within the selected outdoor trace are valid
      // segment targets. In particular, never split an already-created
      // EntranceAccess bridge merely because one endpoint is on the trace.
      if (!nodeBelongsToTrace(from, routeId) || !nodeBelongsToTrace(to, routeId)) return null
      const distance = pointToSegmentDistance(position, from.position, to.position)
      return { edge: candidate, distance }
    })
    .filter((candidate): candidate is { edge: NavEdge; distance: number } => candidate !== null)
    .sort((left, right) => left.distance - right.distance)[0]
  if (!edge || edge.distance > EXPLICIT_ACCESS_SEGMENT_TOLERANCE_METERS) return null

  const stableId = access.outdoorNodeId || explicitEntranceAccessNodeId(access.entranceId)
  const stableNode: NavNode = {
    id: stableId,
    label: 'Entrance access junction',
    name: 'Entrance access junction',
    type: 'intersection',
    buildingId: '__outdoor__',
    campusId: graph.campusId,
    floor: 0,
    position,
    metadata: {
      connectionNode: true,
      traceId: routeId,
      entranceAccessId: access.entranceId,
      explicitAccess: true,
    },
  }
  return graph.splitEdgeWithNode(edge.edge.id, stableNode)
}

function projectExplicitEntranceAccess(graph: Graph, document: CampusDocument): void {
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      for (const access of floor.entranceAccess ?? []) {
        const entranceNode = graph.nodes.find((node) =>
          node.type === 'building_entrance' && node.componentId === access.entranceId,
        )
        const indoorNode = graph.nodes.find((node) =>
          node.metadata?.routeNodeId === access.indoorRouteNodeId
            && node.buildingId === building.id
            && node.floor === floor.level,
        )
        const outdoorNode = resolveExplicitOutdoorTarget(graph, access)
        if (!entranceNode || !indoorNode || !outdoorNode) continue

        const addAccessEdge = (id: string, from: NavNode, to: NavNode) => {
          if (graph.edges.some((edge) => edge.id === id)) return
          const distance = haversine(from.position, to.position)
          graph.addEdge({
            id,
            from: from.id,
            to: to.id,
            type: 'walkway',
            distance,
            weight: distance,
            campusId: graph.campusId,
          })
        }

        addAccessEdge(`E-access-${access.entranceId}-outdoor`, outdoorNode, entranceNode)
        addAccessEdge(`E-access-${access.entranceId}-indoor`, entranceNode, indoorNode)
      }
    }
  }
}

export interface ReconcileAuthoredJunctionsInput {
  existing: RoadJunction[]
  junctionNodes: NavNode[]
  actualTraceIds: Set<string>
  validRoadIds: Set<string>
}

/**
 * Reconcile persisted junction authority after a graph sync pass.
 *
 * Two sources are combined:
 *  1. Junction nodes regenerated by this pass (reuse their stored record).
 *  2. Previously stored records that remain structurally valid (both roads
 *     still exist) but were NOT regenerated this pass.
 *
 * Persistence fix: a sync pass must never erase explicit authored junction
 * authority just because it did not regenerate a matching derived node.
 * Records referencing fewer than two existing roads are dropped (invalid).
 */
export function reconcileAuthoredJunctions(input: ReconcileAuthoredJunctionsInput): RoadJunction[] {
  const { existing, junctionNodes, actualTraceIds, validRoadIds } = input
  const existingById = new Map(existing.map(j => [j.id, j]))
  const usedIds = new Set<string>()
  const result: RoadJunction[] = []

  for (const node of junctionNodes) {
    const rawTraceIds = node.metadata?.traceIds
    if (!Array.isArray(rawTraceIds)) continue
    const traceIds = [...new Set(
      (rawTraceIds as string[]).filter(id => actualTraceIds.has(id) && validRoadIds.has(id)),
    )]
    if (traceIds.length < 2) continue

    const preSeededId = node.metadata?.junctionRecordId as string | undefined
    // Resolve only an existing authority record. Derived graph nodes never
    // create authority; the position fallback keeps old stored records stable
    // when their graph metadata predates the ID.
    const record = (preSeededId ? existingById.get(preSeededId) : undefined) ?? existing.find(j =>
      !usedIds.has(j.id) &&
      Math.abs(j.position.lat - node.position.lat) < 0.00001 &&
      Math.abs(j.position.lng - node.position.lng) < 0.00001
    )
    if (!record) continue

    usedIds.add(record.id)
    result.push({
      ...record,
      position: { ...node.position },
      roadIds: traceIds,
      source: record.source ?? 'legacy-inferred',
    })
  }

  // Preserve valid stored authority that this pass did not regenerate.
  for (const record of existing) {
    if (usedIds.has(record.id)) continue
    const roadIds = [...new Set(record.roadIds.filter(id => validRoadIds.has(id)))]
    if (roadIds.length < 2) continue
    result.push({ ...record, roadIds })
  }

  return result
}

export interface GraphAdapterScope {
  kind?: string
  buildingId?: string | null
  floor?: number | null
}

export class GraphAdapter {
  private graph: Graph
  private transformer?: CoordinateTransformer

  constructor(graph: Graph, transformer?: CoordinateTransformer) {
    this.graph = graph
    this.transformer = transformer
  }

  /**
   * P0.5 — Scope-aware canonical reconciliation wrapper.
   *
   * The legacy sync rebuilds collections from the incoming CampusDocument only.
   * Before running it we snapshot the canonical collections; afterwards we merge
   * out-of-scope canonical entities back in so a scoped/partial document can
   * never delete or duplicate unrelated canonical content.
   */
  sync(document: CampusDocument, scope?: GraphAdapterScope): void {
    const previous = {
      buildings: (this.graph.buildings ?? []).slice(),
      components: (this.graph.components ?? []).slice(),
      nodes: (this.graph.nodes ?? []).slice(),
      edges: (this.graph.edges ?? []).slice(),
      traces: (this.graph.traces ?? []).slice(),
    }
    this.syncLegacy(document, previous)
    this.reconcileCanonicalCollections(previous, document, scope)
  }

  private reconcileCanonicalCollections(
    previous: {
      buildings: Building[]
      components: Component[]
      nodes: NavNode[]
      edges: NavEdge[]
      traces: TracePath[]
    },
    document: CampusDocument,
    scope?: GraphAdapterScope,
  ): void {
    const doc = document as unknown as {
      buildings: Array<{ id: string; floors: Array<{ level: number }> }>
      roads?: unknown
    }
    const coveredBuildings = scope?.buildingId
      ? new Set([scope.buildingId])
      : new Set(doc.buildings.map((b) => b.id))
    const coveredFloors = new Map<string, Set<number>>()
    if (scope?.buildingId && scope.floor !== undefined && scope.floor !== null) {
      coveredFloors.set(scope.buildingId, new Set([scope.floor]))
    } else {
      for (const b of doc.buildings) coveredFloors.set(b.id, new Set(b.floors.map((f) => f.level)))
    }
    // Outdoor scope is covered only when:
    // - explicit outdoor scope is given, OR
    // - no scope is specified and document.roads is an array
    const outdoorCovered = scope
      ? scope.kind === 'outdoor'
      : Array.isArray(doc.roads)

    const nodeCovered = (n: NavNode): boolean => {
      const bid = (n as { buildingId?: string | null }).buildingId
      if (!bid || bid === '__outdoor__') return outdoorCovered
      if (!coveredBuildings.has(bid)) return false
      const fl = (n as { floor?: number | null }).floor
      if (fl === null || fl === undefined) return true
      return coveredFloors.get(bid)?.has(fl) ?? false
    }

    const dedupe = <T extends { id: string }>(items: T[]): T[] => {
      const seen = new Set<string>()
      const out: T[] = []
      for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        out.push(item)
      }
      return out
    }

    const rebuiltBuildings = (this.graph.buildings ?? []).slice()
    const rebuiltComponents = (this.graph.components ?? []).slice()
    const rebuiltNodes = (this.graph.nodes ?? []).slice()
    const rebuiltEdges = (this.graph.edges ?? []).slice()
    const rebuiltTraces = (this.graph.traces ?? []).slice()

    const mergedBuildings = dedupe([
      ...rebuiltBuildings,
      ...previous.buildings.filter((b) => !coveredBuildings.has(b.id) && !rebuiltBuildings.some((r) => r.id === b.id)),
    ])
    const mergedComponents = dedupe([
      ...rebuiltComponents,
      ...previous.components.filter(
        (c) => !rebuiltComponents.some((r) => r.id === c.id) && !(coveredBuildings.has((c as { buildingId?: string }).buildingId ?? '')),
      ),
    ])
    const mergedNodes = dedupe([
      ...rebuiltNodes,
      ...previous.nodes.filter((n) => !nodeCovered(n) && !rebuiltNodes.some((r) => r.id === n.id)),
    ])
    const rebuiltNodeIds = new Set(mergedNodes.map((n) => n.id))
    const mergedEdges = dedupe([
      ...rebuiltEdges,
      ...previous.edges.filter(
        (e) =>
          !rebuiltEdges.some((r) => r.id === e.id) &&
          !(nodeCovered({ id: e.from } as NavNode) && nodeCovered({ id: e.to } as NavNode)) &&
          rebuiltNodeIds.has(e.from) &&
          rebuiltNodeIds.has(e.to),
      ),
    ])
    const mergedTraces = dedupe([
      ...rebuiltTraces,
      ...previous.traces.filter((t) => !outdoorCovered && !rebuiltTraces.some((r) => r.id === t.id)),
    ])

    this.graph.setBuildings(mergedBuildings)
    this.graph.setComponents(mergedComponents)
    this.graph.setNodes(mergedNodes)
    this.graph.setEdges(mergedEdges)
    if (mergedTraces.length > 0 || (this.graph.traces ?? []).length > 0) {
      this.graph.setTraces(mergedTraces)
    }

    // Reference integrity: every edge must resolve to a node; drop nothing,
    // report loudly if the rebuild produced a dangling edge.
    const finalNodeIds = new Set((this.graph.nodes ?? []).map((n) => n.id))
    for (const e of this.graph.edges ?? []) {
      if (!finalNodeIds.has(e.from) || !finalNodeIds.has(e.to)) {
        console.warn(`[graph-adapter] dangling edge after reconciliation: ${e.id} (${e.from} -> ${e.to})`)
      }
    }
  }

  private syncLegacy(
    document: CampusDocument,
    previous?: {
      nodes?: NavNode[]
      edges?: NavEdge[]
    },
  ): void {
    // Ordinary editor sync is explicit-only. Existing RoadJunction records are
    // pre-seeded below and reconstructed, but geometry alone never authors new
    // cross-road topology (including for unversioned/legacy documents).
    const allowGeometricInference = false
    this.graph.setAllowGeometricInference(allowGeometricInference)
    this.graph.setConnectivitySemanticsVersion(undefined)

    if (!this.transformer) {
      this.transformer = new CoordinateTransformer()
    }
    for (const b of document.buildings) {
      if (!this.transformer.getBuildingSystem(b.id)) {
        const origin = b.footprint.points.length > 0 ? b.footprint.points[0] : { lat: 0, lng: 0 }
        this.transformer.registerBuilding({ buildingId: b.id, origin, rotation: b.rotation ?? 0 })
      }
      for (const f of b.floors ?? []) {
        if (!this.transformer.getFloorSystem(b.id, f.level)) {
          this.transformer.registerFloor(b.id, f.level, {
            offset: (f.offset as { x: number; y: number } | undefined) ?? { x: 0, y: 0 },
            rotation: (f.rotation as number | undefined) ?? 0,
          })
        }
      }
    }
    this.graph.setBuildings([])


    this.graph.setComponents([])
    this.graph.setNodes([])
    this.graph.setEdges([])
    this.graph.setTraces([])
    const allCompiledNodes: NavNode[] = []
    const allCompiledEdges: NavEdge[] = []
    const allProjectedDoors: DoorData[] = []

    // 1. Buildings
    for (const docBuilding of document.buildings) {
      const footprint: LegacyLatLng[] = docBuilding.footprint.points.map(coreLatLngToLegacy)
      const center = footprint.length > 0 ? computeCentroid(footprint) : { lat: 0, lng: 0 }
      const legacyBuilding: LegacyBuilding = {
        id: docBuilding.id,
        name: docBuilding.name,
        campusId: this.graph.campusId,
        floors: docBuilding.floors.map(f => f.level),
        footprint,
        baseElevation: docBuilding.baseElevation,
        height: docBuilding.height,
        center,
        code: docBuilding.code,
        description: docBuilding.description,
        color: docBuilding.color,
        department: docBuilding.department,
        aliases: docBuilding.aliases,
        metadata: docBuilding.metadata,
        ...(docBuilding.rotation !== undefined ? { rotation: docBuilding.rotation } : {}),
        staircases: docBuilding.staircases,
        elevators: docBuilding.elevators,
        ...(docBuilding.verticalTransitions !== undefined ? { verticalTransitions: docBuilding.verticalTransitions } : {}),
        floorData: docBuilding.floors.map(f => ({

          id: f.id,
          level: f.level,
          label: f.label,
          elevation: f.elevation,
          planImageId: f.planImageId,
          planAlignment: f.planAlignment,
          textureId: f.textureId,
          svgOverlayId: f.svgOverlayId,
          metadata: f.metadata,
        ...(f.walls !== undefined ? { walls: f.walls } : {}),
        ...(f.windows !== undefined ? { windows: f.windows } : {}),
        ...(f.openings !== undefined ? { openings: f.openings } : {}),
        ...(f.roomAttributes !== undefined ? { roomAttributes: f.roomAttributes } : {}),
        ...(f.entranceAccess !== undefined ? { entranceAccess: f.entranceAccess } : {}),
        ...(f.routeNetwork !== undefined ? { routeNetwork: f.routeNetwork } : {}),
        // Floor.doors is the canonical authoring record. Keep the full local
        // rectangle, ownership, and explicit route relationship in floorData;
        // graph.doors below remains only the world-coordinate runtime view.
        ...(collectFloorDoors(f).length > 0
          ? { doors: collectFloorDoors(f).map((door) => structuredClone(door)) }
          : {}),
        ...(f.shortLabel !== undefined ? { shortLabel: f.shortLabel } : {}),
        ...(f.visible !== undefined ? { visible: f.visible } : {}),
        ...(f.locked !== undefined ? { locked: f.locked } : {}),
        ...(f.floorPlanState !== undefined ? { floorPlanState: f.floorPlanState } : {}),
        ...(f.offset !== undefined ? { offset: f.offset } : {}),
        ...(f.rotation !== undefined ? { rotation: f.rotation } : {}),
        ...(f.height !== undefined ? { height: f.height } : {}),
        ...(f.pois !== undefined ? { pois: f.pois } : {}),
        })),
      }
      this.graph.addBuilding(legacyBuilding)

      // 2. Floor entities → Components
      for (const floor of docBuilding.floors) {
        const floorComponents: Component[] = []

        // Rooms
        for (const room of floor.rooms) {
          if (!this.transformer) continue
          const worldPoints: LegacyLatLng[] = []
          for (const p of room.polygon.points) {
            const world = this.transformer.buildingLocalToWorld(p, docBuilding.id)
            if (!world) continue
            worldPoints.push(coreLatLngToLegacy(world))
          }
          if (worldPoints.length < 3) continue
          const centerPos = computeCentroid(worldPoints)
          const dims = computeBBox(worldPoints)
          floorComponents.push({
            id: room.id,
            type: 'room',
            name: room.name,
            buildingId: docBuilding.id,
            campusId: this.graph.campusId,
            floor: floor.level,
            position: centerPos,
            polygon: worldPoints,
            dimensions: { width: Math.round(dims.width), height: Math.round(dims.height) },
            metadata: { number: room.number, capacity: room.capacity, roomMetadata: room.metadata ?? {} },
          })
        }

        // Hallways
        for (const hw of floor.hallways) {
          if (!this.transformer) continue
          const worldPoints: LegacyLatLng[] = []
          for (const p of hw.polyline.points) {
            const world = this.transformer.buildingLocalToWorld(p, docBuilding.id)
            if (!world) continue
            worldPoints.push(coreLatLngToLegacy(world))
          }
          if (worldPoints.length < 2) continue
          const centerPos = computeCentroid(worldPoints)
          floorComponents.push({
            id: hw.id,
            type: 'hallway',
            name: hw.name,
            buildingId: docBuilding.id,
            campusId: this.graph.campusId,
            floor: floor.level,
            position: centerPos,
            polygon: worldPoints,
            metadata: { width: hw.width, color: hw.color },
          })
        }

        // Staircases
        if (docBuilding.staircases && docBuilding.staircases.length > 0) {
          for (const st of docBuilding.staircases) {
            const levelGeom = st.levels[floor.level]
            if (!levelGeom) continue
            if (!this.transformer) continue
            const world = this.transformer.buildingLocalToWorld(levelGeom.position, docBuilding.id)
            if (!world) continue
            const { polygon: localPoly, landing } = resolveLevelGeometry(st, floor.level)
            let worldPolygon: LegacyLatLng[] | undefined
            let dims: { width: number; height: number } | undefined
            if (localPoly && localPoly.points.length > 0) {
              const pts: LegacyLatLng[] = []
              for (const p of localPoly.points) {
                const w = this.transformer.buildingLocalToWorld(p, docBuilding.id)
                if (w) pts.push(coreLatLngToLegacy(w))
              }
              if (pts.length >= 3) {
                worldPolygon = pts
                dims = computeBBox(pts)
              }
            }
            floorComponents.push({
              id: `${st.id}-${floor.level}`,
              featureId: st.id,
              type: 'stair',
              name: st.name,
              buildingId: docBuilding.id,
              campusId: this.graph.campusId,
              floor: floor.level,
              position: coreLatLngToLegacy(world),
              polygon: worldPolygon,
              dimensions: dims ? { width: Math.round(dims.width), height: Math.round(dims.height) } : undefined,
              range: { from: st.fromLevel, to: st.toLevel },
              metadata: {
                type: st.type,
                ...(landing ? { landing } : {}),
                ...(levelGeom.drawing ? { drawing: levelGeom.drawing } : {}),
              },

            })
          }
        } else {
          for (const st of floor.staircases) {
            if (!this.transformer) continue
            const world = this.transformer.buildingLocalToWorld(st.position, docBuilding.id)
            if (!world) continue
            floorComponents.push({
              id: st.id,
              type: 'stair',
              name: st.name,
              buildingId: docBuilding.id,
              campusId: this.graph.campusId,
              floor: floor.level,
              position: coreLatLngToLegacy(world),
              range: { from: st.fromLevel, to: st.toLevel },
              metadata: { type: st.type },
            })
          }
        }

        // Elevators
        if (docBuilding.elevators && docBuilding.elevators.length > 0) {
          for (const el of docBuilding.elevators) {
            const levelGeom = el.levels[floor.level]
            if (!levelGeom) continue
            if (!this.transformer) continue
            const world = this.transformer.buildingLocalToWorld(levelGeom.position, docBuilding.id)
            if (!world) continue
            const { polygon: localPoly, landing } = resolveLevelGeometry(el, floor.level)
            let worldPolygon: LegacyLatLng[] | undefined
            let dims: { width: number; height: number } | undefined
            if (localPoly && localPoly.points.length > 0) {
              const pts: LegacyLatLng[] = []
              for (const p of localPoly.points) {
                const w = this.transformer.buildingLocalToWorld(p, docBuilding.id)
                if (w) pts.push(coreLatLngToLegacy(w))
              }
              if (pts.length >= 3) {
                worldPolygon = pts
                dims = computeBBox(pts)
              }
            }
            floorComponents.push({
              id: `${el.id}-${floor.level}`,
              featureId: el.id,
              type: 'elevator',
              name: el.name,
              buildingId: docBuilding.id,
              campusId: this.graph.campusId,
              floor: floor.level,
              position: coreLatLngToLegacy(world),
              polygon: worldPolygon,
              dimensions: dims ? { width: Math.round(dims.width), height: Math.round(dims.height) } : undefined,
              range: { from: el.fromLevel, to: el.toLevel },
              metadata: {
                ...(landing ? { landing } : {}),
                ...(levelGeom.drawing ? { drawing: levelGeom.drawing } : {}),
              },

            })
          }
        } else {
          for (const el of floor.elevators) {
            if (!this.transformer) continue
            const world = this.transformer.buildingLocalToWorld(el.position, docBuilding.id)
            if (!world) continue
            floorComponents.push({
              id: el.id,
              type: 'elevator',
              name: el.name,
              buildingId: docBuilding.id,
              campusId: this.graph.campusId,
              floor: floor.level,
              position: coreLatLngToLegacy(world),
              range: { from: el.fromLevel, to: el.toLevel },
            })
          }
        }

        // Entrances
        // P1-T4 (D9): document positions are building-local — derive world for
        // the graph node. A legacy world-stored entrance (pre-migration doc) is
        // passed through verbatim so it still compiles identically.
        for (const ent of floor.entrances) {
          const legacyWorld = (ent.position as unknown as { lat?: number }).lat !== undefined
            ? (ent.position as unknown as { lat: number; lng: number })
            : (this.transformer
              ? this.transformer.buildingLocalToWorld(ent.position, docBuilding.id)
              : null)
          if (!legacyWorld) continue
          floorComponents.push({
            id: ent.id,
            type: 'entrance',
            name: ent.label,
            buildingId: docBuilding.id,
            campusId: this.graph.campusId,
            floor: ent.level,
            position: coreLatLngToLegacy(legacyWorld),
            metadata: { hasQR: ent.hasQR, hasPanorama: ent.hasPanorama },
          })
        }

        // ConnectorStops → nodes
        for (const stop of (floor.connectorStops ?? [])) {

          if (!this.transformer) continue
          const world = this.transformer.buildingLocalToWorld(stop.position, docBuilding.id)
          if (!world) continue

          const stopNode: NavNode = {
            id: `N-cstop-${stop.id}`,
            label: stop.label ?? `Connector Stop ${stop.id}`,
            name: stop.label ?? `Connector Stop ${stop.id}`,
            type: 'connector_stop',
            buildingId: docBuilding.id,
            campusId: this.graph.campusId,
            floor: floor.level,
            position: coreLatLngToLegacy(world),
            metadata: {
              connectorId: stop.connectorId,
              rotation: stop.rotation,
              connectedHallwayId: stop.connectedHallwayId,
              accessible: stop.accessible,
            },
          }
          this.graph.addNode(stopNode)
          allCompiledNodes.push(stopNode)

          // Anchors → sub-nodes
          for (const anchor of stop.anchors) {
            const anchorPos = this.transformer.buildingLocalToWorld(anchor.position, docBuilding.id)
            if (!anchorPos) continue
            if ('heading' in anchor) {
              const panoNode: NavNode = {
                id: `N-anchor-pano-${anchor.id}`,
                label: `Panorama: ${anchor.label}`,
                name: `Panorama: ${anchor.label}`,
                type: 'intersection',
                buildingId: docBuilding.id,
                campusId: this.graph.campusId,
                floor: floor.level,
                position: coreLatLngToLegacy(anchorPos),
                hasPanorama: true,
                metadata: { panoramaId: anchor.id, parentStopId: stop.id },
              }
              this.graph.addNode(panoNode)
              allCompiledNodes.push(panoNode)
            } else {
              const qrNode: NavNode = {
                id: `N-anchor-qr-${anchor.id}`,
                label: `QR: ${anchor.label}`,
                name: `QR: ${anchor.label}`,
                type: 'qr_marker',
                buildingId: docBuilding.id,
                campusId: this.graph.campusId,
                floor: floor.level,
                position: coreLatLngToLegacy(anchorPos),
                hasQr: true,
                metadata: { qrCode: anchor.code, qrId: anchor.id, parentStopId: stop.id },
              }
              this.graph.addNode(qrNode)
              allCompiledNodes.push(qrNode)
            }
          }
        }

        // Add all components to graph
        for (const comp of floorComponents) {
          this.graph.addComponent(comp)
        }

        // Compile components in dependency order: hallways first, then rooms, stairs, elevators, entrances
        const compileOrder: ComponentType[] = ['hallway', 'room', 'stair', 'elevator', 'entrance']
        const buildingMap = new Map(this.graph.buildings.map(b => [b.id, b]))

        for (const ctype of compileOrder) {
          for (const comp of floorComponents.filter(c => c.type === ctype)) {
            const context: CompileContext = {
              buildings: buildingMap,
              existingNodes: allCompiledNodes,
              existingEdges: allCompiledEdges,
              componentId: comp.id,
              campusId: this.graph.campusId,
            }
            const result = compileComponent(comp, context)
            for (const node of result.nodes) {
              this.graph.addNode(node)
              allCompiledNodes.push(node)
            }
            for (const edge of result.edges) {
              this.graph.addEdge(edge)
              allCompiledEdges.push(edge)
            }
          }
        }

        // RouteNetwork → graph nodes and edges (authored per-floor, never synthesized)
        if (floor.routeNetwork && this.transformer) {
          const routeNodeIdMap = new Map<string, string>()
          for (const rn of floor.routeNetwork.nodes) {
            const world = this.transformer.buildingLocalToWorld(rn.position, docBuilding.id)
            if (!world) continue
            const graphNodeId = `N-route-${rn.id}`
            routeNodeIdMap.set(rn.id, graphNodeId)
            const node: NavNode = {
              id: graphNodeId,
              label: `Route ${rn.type}`,
              name: `Route ${rn.type}`,
              type: 'intersection',
              buildingId: docBuilding.id,
              campusId: this.graph.campusId,
              floor: floor.level,
              position: coreLatLngToLegacy(world),
              metadata: { routeNodeId: rn.id, routeNodeType: rn.type },
            }
            this.graph.addNode(node)
            allCompiledNodes.push(node)
          }
          for (const re of floor.routeNetwork.edges) {
            const fromGraphId = routeNodeIdMap.get(re.from)
            const toGraphId = routeNodeIdMap.get(re.to)
            if (!fromGraphId || !toGraphId) continue
            const edge: NavEdge = {
              id: `E-route-${re.id}`,
              from: fromGraphId,
              to: toGraphId,
              distance: re.distance,
              type: re.type === 'stairs' ? 'stair' : re.type === 'elevator' ? 'elevator' : 'walkway',
              campusId: this.graph.campusId,
            }
            this.graph.addEdge(edge)
            allCompiledEdges.push(edge)
          }
        }
      }

      // VerticalConnector edges: connect all stops belonging to the same connector
      // Only include stops from THIS building to prevent cross-building connector ID collisions
      const stopNodesMap = new Map<string, NavNode[]>()
      for (const n of allCompiledNodes) {
        if (n.type === 'connector_stop' && n.buildingId === docBuilding.id) {
          const cid = n.metadata?.connectorId as string | undefined
          if (cid) {
            if (!stopNodesMap.has(cid)) stopNodesMap.set(cid, [])
            stopNodesMap.get(cid)!.push(n)
          }
        }
      }
      const seenEdgeIds = new Set(allCompiledEdges.map(e => e.id))
      for (const conn of (docBuilding.verticalConnectors ?? [])) {

        const stops = stopNodesMap.get(conn.id) ?? []
        // Sort by floor level to create sequential edges
        stops.sort((a, b) => a.floor - b.floor)
        for (let i = 0; i < stops.length - 1; i++) {
          const edgeId = `E-vconn-${conn.id}-${stops[i].floor}-${stops[i + 1].floor}`
          if (seenEdgeIds.has(edgeId)) continue
          seenEdgeIds.add(edgeId)
          const edge: NavEdge = {
            id: edgeId,
            from: stops[i].id,
            to: stops[i + 1].id,
            distance: 0,
            type: conn.type === 'elevator' ? 'elevator' : 'stair',
            campusId: this.graph.campusId,
          }
          this.graph.addEdge(edge)
          allCompiledEdges.push(edge)
        }
      }

      // RoomDoor edges: connect room door nodes to their neighbors (rooms OR hallways)
      // Valid routing model: room_door ↔ hallway (no direct room↔entrance links).
      // Build lookup for room_door nodes AND hallway nodes
      const connectionNodeMap = new Map<string, NavNode>()
      const hallwayNodesByFloor = new Map<number, NavNode[]>()
      for (const n of allCompiledNodes) {
        if (n.type === 'room_door' && n.componentId) {
          connectionNodeMap.set(n.componentId, n)
        }
        if (n.type === 'hallway' && n.buildingId === docBuilding.id) {
          const fl = n.floor
          if (!hallwayNodesByFloor.has(fl)) hallwayNodesByFloor.set(fl, [])
          hallwayNodesByFloor.get(fl)!.push(n)
        }
      }
      for (const floor of docBuilding.floors) {
        // P1-T6: doors read through the single-source helper (extracted
        // Floor.doors authoritative; nested legacy fallback).
        for (const door of collectFloorDoors(floor)) {
          if (!door.roomId) continue
          const sourceNode = connectionNodeMap.get(door.roomId)
          if (!sourceNode) continue

          let targetNode: NavNode | undefined
          if (door.connectedToType === 'room' && door.connectedToId !== undefined) {
            targetNode = connectionNodeMap.get(door.connectedToId)
          } else if (door.connectedToType === 'hallway') {
            // Find nearest hallway node on the same floor
            const hallwayNodes = hallwayNodesByFloor.get(floor.level) ?? []
            // Prefer the specific hallway component if connectedToId matches
            if (door.connectedToId) {
              const preferred = hallwayNodes.find(n => n.componentId === door.connectedToId)
              if (preferred) {
                targetNode = preferred
              }
            }
            if (!targetNode && hallwayNodes.length > 0) {
              // Fall back to nearest hallway node by haversine
              let bestDist = Infinity
              for (const hn of hallwayNodes) {
                const d = haversine(sourceNode.position, hn.position)
                if (d < bestDist) {
                  bestDist = d
                  targetNode = hn
                }
              }
            }
          }

          if (!targetNode) continue

          const edge: NavEdge = {
            id: `E-door-${door.id}`,
            from: sourceNode.id,
            to: targetNode.id,
            distance: haversine(sourceNode.position, targetNode.position),
            type: 'door',
            campusId: this.graph.campusId,
          }
          this.graph.addEdge(edge)
          allCompiledEdges.push(edge)
        }
      }

      // Serialize door data for the rendering pipeline
      // (separate from routing edges — these are first-class render entities)
      const allDoors: DoorData[] = []
      for (const floor of docBuilding.floors) {
        // P1-T6: single-source door access (extracted or nested legacy)
        for (const door of collectFloorDoors(floor)) {
          // Transform door position from building-local meters to world LatLng
          if (!this.transformer) continue
          const worldPos = this.transformer.buildingLocalToWorld(door.position, docBuilding.id)
          if (!worldPos) continue
          allDoors.push({
            id: door.id,
            roomId: door.roomId,
            buildingId: docBuilding.id,
            floor: floor.level,
            position: worldPos,
            width: door.width,
            connectedToId: door.connectedToId,
            isExterior: door.connectedToType === 'hallway' && !door.connectedToId,
          })
        }
      }
      allProjectedDoors.push(...allDoors)
    }

    // P0.2 SAFETY CONTRACT: door data is a scoped editor projection, NOT the
    // authority to delete canonical doors. Merge semantics:
    //   - scopes actually covered by this sync (building#floor) may add/update/
    //     remove their own doors (authored deletes stay possible);
    //   - canonical doors belonging to scopes NOT covered by this document
    //     projection are PRESERVED verbatim (a partially hydrated or scoped
    //     document can never wipe unrelated doors again).
    const coveredScopes = new Set<string>()
    for (const b of document.buildings) {
      for (const f of b.floors) coveredScopes.add(`${b.id}#${f.level}`)
    }
    const doorKey = (d: DoorData) => `${d.id}|${d.buildingId}|${d.floor}`
    const projectedKeys = new Set(allProjectedDoors.map(doorKey))
    const preservedDoors = this.graph.doors.filter(
      (d) => !coveredScopes.has(`${d.buildingId}#${d.floor}`) && !projectedKeys.has(doorKey(d)),
    )
    const mergedByKey = new Map<string, DoorData>()
    for (const d of [...preservedDoors, ...allProjectedDoors]) mergedByKey.set(doorKey(d), d)
    this.graph.setDoors([...mergedByKey.values()])

    // 9. Roads → Traces
    // Traces compile independently from buildings. They deliberately do NOT
    // connect to entrances or room doors; those relationships are projected
    // only from explicit Floor.entranceAccess below.

    // 8b. Pre-seed explicit road junction nodes so syncTraceIntersections
    // reuses their stable IDs instead of generating new ones.
    // Junction identity is authoring truth; graph nodes are derived.
    if (document.roadJunctions) {
      for (const j of document.roadJunctions) {
        if (j.roadIds.length < 2) continue
        const node: NavNode = {
          id: j.id,
          label: 'Road Junction',
          name: 'Road Junction',
          type: 'intersection',
          campusId: this.graph.campusId,
          floor: 0,
          buildingId: '',
          position: j.position,
          metadata: {
            connectionNode: true,
            traceIds: [...j.roadIds],
            junctionRecordId: j.id,
            junctionSource: j.source ?? 'legacy-inferred',
          },
        }
        this.graph.addNode(node)
      }
    }

    // Phase 4: Load separated crossings into the graph so syncTraceIntersections
    // respects "Keep Separate" decisions during X-crossing detection.
    this.graph.separatedCrossings = document.separatedCrossings ?? []

    for (const road of document.roads) {
      const routing = normalizeRoadRouting(road.routing)
      const trace: TracePath = {
        id: road.id,
        name: road.name,
        buildingId: '',
        campusId: this.graph.campusId,
        floor: 0,
        points: road.polyline.points.map(coreLatLngToLegacy),
        type: road.type === 'service' ? 'connector' : 'arterial',
        displayMode: road.displayMode ?? 'visible',
        width: road.width,
        ...(routing === undefined ? {} : { routing }),
        // Preserve authored road metadata through the Road → Trace →
        // GraphSnapshot → CampusDocument round trip. Surface is included in
        // metadata because the legacy Trace shape has no dedicated field.
        metadata: { ...(road.metadata ?? {}), surface: road.surface },
      }
      // Phase 3C: Legacy compatibility — use 5m radius for documents that
      // have legacy-inferred junctions (pre-Phase 3 maps). Canonical documents
      // use the 0.5m connection discovery radius so editor projection matches
      // the compiler merge gate (explicit authored junctions only).
      const isLegacy = (document.roadJunctions ?? []).some(j => j.source === 'legacy-inferred')
      // Canonical documents use the same 0.5 m radius as discovery and the
      // compiler merge gate — explicit authored junctions only.
      const connectivityRadius = isLegacy ? 5 : ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters
      this.graph.addTraceWithCompile(trace, connectivityRadius, allowGeometricInference, previous)
    }

    // Phase 4: Clean up pre-seeded junction nodes that are no longer valid
    // (roads moved apart, crossing disappeared). Only keep junctions that
    // have ≥2 traces that actually exist in the compiled graph.
    const actualTraceIds = new Set(this.graph.traces.map(t => t.id))
    const validJunctionIds = new Set<string>()
    for (const node of this.graph.nodes) {
      if (node.metadata?.connectionNode && Array.isArray(node.metadata?.traceIds)) {
        const traceIds = node.metadata.traceIds as string[]
        const validIds = traceIds.filter(id => actualTraceIds.has(id))
        if (validIds.length >= 2) {
          validJunctionIds.add(node.id)
          // Clean stale traceIds from metadata so _persistJunctions doesn't write them back
          if (validIds.length !== traceIds.length) {
            node.metadata = { ...node.metadata, traceIds: validIds }
          }
        }
      }
    }
    // Remove pre-seeded junction nodes that aren't valid anymore
    for (const node of [...this.graph.nodes]) {
      if (node.metadata?.junctionRecordId && !validJunctionIds.has(node.id)) {
        this.graph.removeNode(node.id)
      }
    }

    // 9a. Persist only already-authored/stored junction records from graph
    // nodes back to the document. Derived graph nodes cannot create authority.
    this._persistJunctions(document)

    // 9b. Project only explicit EntranceAccess relationships. The target may
    // reuse an authored trace node or split one compiled trace edge at the
    // exact position selected by the author.
    projectExplicitEntranceAccess(this.graph, document)

    // 10. Boundary
    this.graph.boundary = document.boundary

    // 10b. Connectivity semantics version — stamp on first save, preserve thereafter
    // This ensures legacy documents are upgraded to canonical mode after one save cycle.
    if (!document.connectivitySemanticsVersion) {
      document.connectivitySemanticsVersion = CONNECTIVITY_CONTRACT_VERSION
    }
    // Store the version only after the current pass has compiled and persisted
    // its explicit or legacy-derived connectivity.
    this.graph.setConnectivitySemanticsVersion(document.connectivitySemanticsVersion)

    // 11. Panoramas → Nodes
    // P1-T4 (D9): document positions are building-local — derive world for the
    // graph node when the panorama is anchored to a known building. A panorama
    // without buildingId (or a legacy world-stored one) passes through verbatim
    // (R15.8: entity data is never dropped).
    for (const pano of document.panoramas ?? []) {
      const legacyWorld = 'lat' in pano.position
        ? pano.position
        : (pano.buildingId && this.transformer
          ? this.transformer.buildingLocalToWorld(pano.position, pano.buildingId)
          : null)
      if (!legacyWorld) continue
      const node: NavNode = {
        id: `N-pano-${pano.id}`,
        label: `Panorama: ${pano.label}`,
        name: `Panorama: ${pano.label}`,
        type: 'intersection',
        buildingId: pano.buildingId ?? '',
        campusId: this.graph.campusId,
        floor: pano.floor ?? 0,
        position: coreLatLngToLegacy(legacyWorld),
        hasPanorama: true,
        metadata: { panoramaId: pano.id },
      }
      this.graph.addNode(node)
    }

    // 11. QR Checkpoints → Nodes
    // P1-T4 (D9): QR positions are building-local — same world derivation as
    // entrances/panoramas, with verbatim pass-through for legacy world records.
    for (const qr of document.qrCheckpoints ?? []) {
      const legacyWorld = (qr.position as unknown as { lat?: number }).lat !== undefined
        ? (qr.position as unknown as { lat: number; lng: number })
        : (this.transformer
          ? this.transformer.buildingLocalToWorld(qr.position, qr.buildingId)
          : null)
      if (!legacyWorld) continue
      const node: NavNode = {
        id: `N-qr-${qr.id}`,
        label: `QR: ${qr.label}`,
        name: `QR: ${qr.label}`,
        type: 'qr_marker',
        buildingId: qr.buildingId,
        campusId: this.graph.campusId,
        floor: qr.floor,
        position: coreLatLngToLegacy(legacyWorld),
        hasQr: true,
        metadata: { qrCode: qr.code, qrId: qr.id, qrMetadata: qr.metadata },
      }
      this.graph.addNode(node)
    }

    // 12. Areas (pass-through — no conversion needed, stored as-is)
    this.graph.areas = (document.areas ?? []).map(a => ({
      id: a.id,
      name: a.name,
      points: a.points.map(coreLatLngToLegacy),
      color: a.color,
    }))

    // 12b. Outdoor/campus POIs (pass-through — world geometry, no conversion).
    // Indoor POIs stay on Building.floorData (written in the building loop).
    this.graph.pois = (document.pois ?? []).map(poi => structuredClone(poi))
  }

  /**
   * Persist junction records from graph nodes back to the document.
   * Delegates to reconcileAuthoredJunctions, which both reuses regenerated
   * junction nodes and preserves valid stored authority that a sync pass did
   * not regenerate (persistence fix — no silent authority erasure).
   */
  private _persistJunctions(document: CampusDocument): void {
    const result = reconcileAuthoredJunctions({
      existing: document.roadJunctions ?? [],
      junctionNodes: this.graph.nodes.filter(
        n => n.metadata?.connectionNode === true && Array.isArray(n.metadata?.traceIds) && (n.metadata.traceIds as string[]).length >= 2
      ),
      actualTraceIds: new Set(this.graph.traces.map(t => t.id)),
      validRoadIds: new Set(document.roads.map(r => r.id)),
    })

    document.roadJunctions = result.length > 0 ? result : undefined
  }

  syncEntity(entityId: string, document: CampusDocument): void {
    this.sync(document)
  }
}
