import type { NavNode, NavEdge, Building, LatLng, Component, DoorData, CampusBundle } from '@/types/nav-types'
import type { NavigationGraph } from '@navi/core'
import type { NavNode as CompilerNavNode, NavEdge as CompilerNavEdge } from '@navi/core'
import type { FloorGeometryArtifact, FloorGeometryBuilding, FloorGeometryFloor, LocalCoord } from '@navi/core'
import { CoordinateTransformer } from '@navi/core'
import { deriveBuildingFootprint } from '@/lib/campus-geometry'

// ── Types ─────────────────────────────────────────────────────

export interface BuildingRenderData {
  id: string
  name: string
  footprint: LatLng[]
  color: string
  height: number
  floors: number
  entrances: { id: string; label: string; position: LatLng; floor: number }[]
  nodeIds: string[]
}

export interface EntranceRenderData {
  id: string
  label: string
  position: LatLng
  floor: number
  buildingId: string
}

// ── Indoor render types ────────────────────────────────────────

export interface RoomRenderData {
  id: string
  name: string
  buildingId: string
  floor: number
  polygon: LatLng[]
  center: LatLng
}

export interface HallwayRenderData {
  id: string
  name: string
  buildingId: string
  floor: number
  polygon: LatLng[]
  center: LatLng
}

export interface StairRenderData {
  id: string
  name: string
  buildingId: string
  floor: number
  position: LatLng
  polygon?: LatLng[]
}

export interface ElevatorRenderData {
  id: string
  name: string
  buildingId: string
  floor: number
  position: LatLng
  polygon?: LatLng[]
}


export interface DoorRenderData {
  id: string
  roomId: string
  buildingId: string
  floor: number
  /** Door center in world coordinates. */
  position: LatLng
  width: number
  /** Opening bearing in degrees (0 = E–W line). Consumed by DoorLayer to rotate the wall-opening line. */
  angle?: number
  /** Optional (P1-T6): unlinked/exterior doors may have no target. */
  connectedToId?: string
  isExterior: boolean
}

export interface PoiRenderData {
  id: string
  name: string
  buildingId: string
  floor: number
  /** POI center in world coordinates. */
  position: LatLng
  /** Optional category hint (e.g. 'restroom', 'helpdesk') for future icon mapping. */
  category?: string
  /** Authored visibility; false = hidden from the public map by default. */
  showOnMap?: boolean
}

export interface WallRenderData {
  id: string
  buildingId: string
  floor: number
  /** Wall start in world coordinates. */
  start: LatLng
  /** Wall end in world coordinates. */
  end: LatLng
  thickness: number
  height: number
}

export interface OpeningRenderData {
  id: string
  buildingId: string
  floor: number
  type: 'door' | 'window'
  wallId: string
  offset: number
  width: number
  height?: number
  sillHeight?: number
  /** Opening bearing in degrees (0 = E–W line). Consumed by OpeningLayer to rotate the opening line. */
  orientation?: number
}

export interface IndoorRenderData {
  rooms: RoomRenderData[]
  hallways: HallwayRenderData[]
  stairs: StairRenderData[]
  elevators: ElevatorRenderData[]
  doors: DoorRenderData[]
  /** Optional — empty until a POI data-contract task wires a source. */
  pois: PoiRenderData[]
  /** W16B: canonical wall geometry from floorGeometry. */
  walls: WallRenderData[]
  /** W16B: canonical wall-attached openings (doors/windows) from floorGeometry. */
  openings: OpeningRenderData[]
}

export interface NavigationRenderModel {
  buildings: BuildingRenderData[]
  entrances: EntranceRenderData[]
  boundary: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null
  nodes: NavNode[]
  edges: NavEdge[]
  indoor: IndoorRenderData
}

// ── Building color palette ─────────────────────────────────────

const BUILDING_COLORS = [
  '#3B82F6', // blue
  '#059669', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EF4444', // red
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
]

// ── Indoor transformation ──────────────────────────────────────

const EMPTY_INDOOR: IndoorRenderData = { rooms: [], hallways: [], stairs: [], elevators: [], doors: [], pois: [], walls: [], openings: [] }

/**
 * Transform raw Component[] from CampusBundle into typed indoor render data.
 * Filters by type, validates geometry, and computes centers.
 */
function buildIndoorData(components: Component[] | undefined): IndoorRenderData {
  if (!components || components.length === 0) return EMPTY_INDOOR

  const rooms: RoomRenderData[] = []
  const hallways: HallwayRenderData[] = []
  const stairs: StairRenderData[] = []
  const elevators: ElevatorRenderData[] = []

  for (const c of components) {
    switch (c.type) {
      case 'room': {
        if (!c.polygon || c.polygon.length < 3) break
        rooms.push({
          id: c.id,
          name: c.name,
          buildingId: c.buildingId,
          floor: c.floor,
          polygon: c.polygon,
          center: c.position,
        })
        break
      }
      case 'hallway': {
        if (!c.polygon || c.polygon.length < 3) break
        hallways.push({
          id: c.id,
          name: c.name,
          buildingId: c.buildingId,
          floor: c.floor,
          polygon: c.polygon,
          center: c.position,
        })
        break
      }
      case 'stair': {
        stairs.push({
          id: c.id,
          name: c.name,
          buildingId: c.buildingId,
          floor: c.floor,
          position: c.position,
          polygon: c.polygon,
        })
        break
      }
      case 'elevator': {
        elevators.push({
          id: c.id,
          name: c.name,
          buildingId: c.buildingId,
          floor: c.floor,
          position: c.position,
          polygon: c.polygon,
        })
        break
      }

      // 'entrance' and 'restroom' are not rendered as indoor layers yet
    }
  }

  return { rooms, hallways, stairs, elevators, doors: [], pois: [], walls: [], openings: [] }
}

/**
 * Transform DoorData[] from CampusBundle into typed door render data.
 * Doors are authored as building-local coordinates — no coordinate conversion needed.
 */
function buildDoors(doors: DoorData[] | undefined): DoorRenderData[] {
  if (!doors || doors.length === 0) return []
  return doors.map(d => ({
    id: d.id,
    roomId: d.roomId,
    buildingId: d.buildingId,
    floor: d.floor,
    position: d.position,
    width: d.width,
    angle: d.angle,
    connectedToId: d.connectedToId,
    isExterior: d.isExterior ?? false,
  }))
}

// ── FloorGeometry → Render Data (W16B) ─────────────────────────

/**
 * Convert a LocalCoord point to world LatLng via the CoordinateTransformer.
 * Returns null if conversion fails.
 */
function localToWorld(
  local: LocalCoord,
  buildingId: string,
  transformer: CoordinateTransformer,
): LatLng | null {
  return transformer.buildingLocalToWorld(local, buildingId)
}

/**
 * Convert a LocalPolygon points array to world LatLng[].
 */
function polygonToWorld(
  points: LocalCoord[],
  buildingId: string,
  transformer: CoordinateTransformer,
): LatLng[] {
  const result: LatLng[] = []
  for (const pt of points) {
    const w = localToWorld(pt, buildingId, transformer)
    if (w) result.push(w)
  }
  return result
}

/**
 * W16B: Build IndoorRenderData from FloorGeometryArtifact.
 *
 * Uses building-local → world conversion via CoordinateTransformer.
 * FloorGeometry coordinates are building-local meters; the anchor provides
 * origin LatLng + rotation for world derivation.
 *
 * RouteNetwork nodes/edges are NOT exposed to user layers (kept internal only).
 */
function buildIndoorFromFloorGeometry(
  floorGeometry: FloorGeometryArtifact,
  transformer: CoordinateTransformer,
): IndoorRenderData {
  const rooms: RoomRenderData[] = []
  const hallways: HallwayRenderData[] = []
  const stairs: StairRenderData[] = []
  const elevators: ElevatorRenderData[] = []
  const doors: DoorRenderData[] = []
  const pois: PoiRenderData[] = []
  const walls: WallRenderData[] = []
  const openings: OpeningRenderData[] = []

  for (const fgBuilding of floorGeometry.buildings) {
    const buildingId = fgBuilding.id

    for (const fgFloor of fgBuilding.floors) {
      const floorLevel = fgFloor.level

      // Rooms
      for (const r of fgFloor.rooms) {
        const polygon = polygonToWorld(r.polygon.points, buildingId, transformer)
        if (polygon.length < 3) continue
        // Compute center as centroid of world polygon
        const center = polygon.reduce(
          (acc, p) => ({ lat: acc.lat + p.lat / polygon.length, lng: acc.lng + p.lng / polygon.length }),
          { lat: 0, lng: 0 },
        )
        rooms.push({
          id: r.id,
          name: r.name,
          buildingId,
          floor: floorLevel,
          polygon,
          center,
        })
      }

      // Hallways
      for (const h of fgFloor.hallways) {
        const polygon = polygonToWorld(h.polyline.points, buildingId, transformer)
        if (polygon.length < 2) continue
        const center = polygon.reduce(
          (acc, p) => ({ lat: acc.lat + p.lat / polygon.length, lng: acc.lng + p.lng / polygon.length }),
          { lat: 0, lng: 0 },
        )
        hallways.push({
          id: h.id,
          name: h.name,
          buildingId,
          floor: floorLevel,
          polygon,
          center,
        })
      }

      // Staircases
      for (const s of fgFloor.staircases) {
        const position = localToWorld(s.position, buildingId, transformer)
        if (!position) continue
        const polygon = s.polygon
          ? polygonToWorld(s.polygon.points, buildingId, transformer)
          : undefined
        stairs.push({
          id: s.id,
          name: s.name,
          buildingId,
          floor: floorLevel,
          position,
          polygon: polygon && polygon.length >= 3 ? polygon : undefined,
        })
      }

      // Elevators
      for (const e of fgFloor.elevators) {
        const position = localToWorld(e.position, buildingId, transformer)
        if (!position) continue
        const polygon = e.polygon
          ? polygonToWorld(e.polygon.points, buildingId, transformer)
          : undefined
        elevators.push({
          id: e.id,
          name: e.name,
          buildingId,
          floor: floorLevel,
          position,
          polygon: polygon && polygon.length >= 3 ? polygon : undefined,
        })
      }

      // Doors
      for (const d of fgFloor.doors) {
        const position = localToWorld(d.position, buildingId, transformer)
        if (!position) continue
        doors.push({
          id: d.id,
          roomId: d.roomId,
          buildingId,
          floor: floorLevel,
          position,
          width: d.width,
          isExterior: false,
        })
      }

      // POIs
      for (const p of fgFloor.pois) {
        const position = localToWorld(p.position, buildingId, transformer)
        if (!position) continue
        pois.push({
          id: p.id,
          name: p.name,
          buildingId,
          floor: floorLevel,
          position,
          category: p.category,
          ...(p.showOnMap === false ? { showOnMap: false } : {}),
        })
      }

      // Walls (W15E canonical wall geometry)
      for (const w of fgFloor.walls ?? []) {
        const start = localToWorld(w.start, buildingId, transformer)
        const end = localToWorld(w.end, buildingId, transformer)
        if (!start || !end) continue
        walls.push({
          id: w.id,
          buildingId,
          floor: floorLevel,
          start,
          end,
          thickness: w.thickness,
          height: w.height,
        })
      }

      // Openings (W7A wall-attached doors/windows)
      for (const o of fgFloor.openings ?? []) {
        openings.push({
          id: o.id,
          buildingId,
          floor: floorLevel,
          type: o.type,
          wallId: o.wallId,
          offset: o.offset,
          width: o.width,
          height: o.height,
          sillHeight: o.sillHeight,
          orientation: o.orientation,
        })
      }

      // NOTE: RouteNetwork, roomAccess, entranceAccess are intentionally
      // NOT exposed to user render layers. They are retained internally
      // for routing but not user-visible.
    }
  }

  return { rooms, hallways, stairs, elevators, doors, pois, walls, openings }
}

// ── Type Mappers ───────────────────────────────────────────────

function mapCompilerNodeType(type: CompilerNavNode['type']): NavNode['type'] {
  switch (type) {
    case 'space': return 'room'
    case 'corridor': return 'hallway'
    case 'transition': return 'connector_stop'
    case 'intersection': return 'intersection'
    case 'poi': return 'room'
    case 'waypoint': return 'walkway'
    case 'outdoor': return 'outdoor'
    case 'entrance': return 'building_entrance'
    default: return 'walkway'
  }
}

function mapCompilerEdgeType(type: CompilerNavEdge['type']): NavEdge['type'] {
  switch (type) {
    case 'walk': return 'walkway'
    case 'stairs': return 'stair'
    case 'elevator': return 'elevator'
    case 'transition': return 'transition'
    default: return 'walkway'
  }
}

function compilerToAStar(node: CompilerNavNode, campusId: string): NavNode {
  return {
    id: node.id,
    label: node.label || node.id,
    name: node.label || undefined,
    position: node.position,
    floor: node.floor,
    buildingId: node.buildingId || '',
    campusId,
    type: mapCompilerNodeType(node.type),
    hasQr: (node.properties?.hasQr as boolean) ?? false,
    hasPanorama: (node.properties?.hasPanorama as boolean) ?? false,
  }
}

// ── Adapter ────────────────────────────────────────────────────

/**
 * Convert NavigationGraph nodes/edges into BuildingRenderData.
 * Groups nodes by buildingId, derives footprints from node positions.
 */
export function buildFromNavigationGraph(
  graph: NavigationGraph,
  existingBuildings?: Building[],
): NavigationRenderModel {
  const compilerNodes = graph.nodes
  const campusId = graph.campusId || 'campus'

  // Convert all compiler nodes to A* format first
  const aStarNodes = compilerNodes.map(n => compilerToAStar(n, campusId))

  // Group A* nodes by buildingId
  const buildingNodeMap = new Map<string, NavNode[]>()
  for (const node of aStarNodes) {
    const bid = node.buildingId || '__outdoor__'
    if (!buildingNodeMap.has(bid)) buildingNodeMap.set(bid, [])
    buildingNodeMap.get(bid)!.push(node)
  }

  const buildings: BuildingRenderData[] = []
  let colorIdx = 0

  for (const [buildingId, nodes] of buildingNodeMap) {
    if (buildingId === '__outdoor__') continue

    // Create a synthetic Building object for deriveBuildingFootprint
    const existing = existingBuildings?.find(b => b.id === buildingId)
    const floorSet = new Set(nodes.map(n => n.floor))
    const floorList = [...floorSet].sort((a, b) => a - b)
    const syntheticBuilding: Building = {
      id: buildingId,
      name: existing?.name || buildingId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      campusId,
      floors: existing?.floors ?? floorList,
      footprint: existing?.footprint ?? [],
      baseElevation: existing?.baseElevation ?? 0,
      height: existing?.height ?? Math.max(3, floorList.length * 3),
      color: existing?.color || BUILDING_COLORS[colorIdx % BUILDING_COLORS.length],
      code: existing?.code || buildingId.slice(0, 4).toUpperCase(),
      category: existing?.category || 'academic',
      outline: existing?.outline,
      entrances: existing?.entrances ?? nodes
        .filter(n => n.type === 'building_entrance')
        .map(n => ({
          id: n.id,
          label: n.label || n.id,
          position: n.position,
          floor: n.floor,
        })),
    }

    // Derive footprint using the shared utility
    const footprint = deriveBuildingFootprint(syntheticBuilding, aStarNodes)

    if (!footprint || footprint.length < 3) continue

    // Determine floors
    const minFloor = Math.min(...floorSet)
    const maxFloor = Math.max(...floorSet)
    const floorCount = maxFloor - minFloor + 1

    // Collect entrances
    const entrances = (syntheticBuilding.entrances ?? []).map(e => ({
      id: e.id,
      label: e.label || e.id,
      position: e.position,
      floor: e.floor,
    }))

    buildings.push({
      id: buildingId,
      name: syntheticBuilding.name,
      footprint,
      color: syntheticBuilding.color ?? BUILDING_COLORS[colorIdx % BUILDING_COLORS.length],
      height: syntheticBuilding.height ?? Math.max(3, floorCount * 3),
      floors: floorCount,
      entrances,
      nodeIds: nodes.map(n => n.id),
    })

    colorIdx++
  }

  // Compute boundary from metadata
  const bb = graph.metadata?.boundingBox
  const boundary = bb ? {
    minLat: bb.minLat,
    maxLat: bb.maxLat,
    minLng: bb.minLng,
    maxLng: bb.maxLng,
  } : null

  // Convert compiler edges to A* format
  const convertedEdges: NavEdge[] = graph.edges.map(e => ({
    id: e.id,
    from: e.from,
    to: e.to,
    distance: e.distance,
    weight: e.weight,
    type: mapCompilerEdgeType(e.type),
    campusId,
  }))

  // Collect all entrances
  const allEntrances: EntranceRenderData[] = buildings.flatMap(b =>
    b.entrances.map(e => ({
      ...e,
      buildingId: b.id,
    }))
  )

  return {
    buildings,
    entrances: allEntrances,
    boundary,
    nodes: aStarNodes,
    edges: convertedEdges,
    indoor: EMPTY_INDOOR,
  }
}

// ── Campus Bundle Adapter ──────────────────────────────────────

/**
 * Build a NavigationRenderModel directly from a CampusBundle (runtime data).
 *
 * This is the clean path: no conversion to compiler format, no adapter layer.
 * The runtime boundary stays intact.
 *
 * W16B: When floorGeometry is present, uses it as the canonical data source
 * for indoor render data (rooms, hallways, stairs, elevators, doors, walls,
 * openings). Falls back to legacy components[] when floorGeometry is absent.
 *
 * @see ADR-001-domain-boundaries.md
 */
export function buildFromCampusBundle(bundle: {
  buildings: Building[]
  nodes: NavNode[]
  edges: NavEdge[]
  boundingBox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null
  components?: Component[]
  doors?: DoorData[]
  floorGeometry?: FloorGeometryArtifact
}): NavigationRenderModel {
  const { buildings: campusBuildings, nodes, edges, boundingBox, components, doors, floorGeometry } = bundle

  // Build render data for each building
  const buildings: BuildingRenderData[] = []
  let colorIdx = 0

  for (const b of campusBuildings) {
    // Derive footprint from building data (uses real footprint if available)
    const footprint = deriveBuildingFootprint(b, nodes)
    if (!footprint || footprint.length < 3) continue

    // Collect entrance render data
    const entrances = (b.entrances ?? []).map(e => ({
      id: e.id,
      label: e.label || e.id,
      position: e.position,
      floor: e.floor,
    }))

    // Count floors
    const floorCount = b.floors.length > 0
      ? Math.max(...b.floors) - Math.min(...b.floors) + 1
      : 1

    // Collect node IDs for this building
    const nodeIds = nodes
      .filter(n => n.buildingId === b.id)
      .map(n => n.id)

    buildings.push({
      id: b.id,
      name: b.name,
      footprint,
      color: b.color || BUILDING_COLORS[colorIdx % BUILDING_COLORS.length],
      height: b.height || Math.max(3, floorCount * 3),
      floors: floorCount,
      entrances,
      nodeIds,
    })

    colorIdx++
  }

  // Collect all entrances
  const allEntrances: EntranceRenderData[] = buildings.flatMap(b =>
    b.entrances.map(e => ({
      ...e,
      buildingId: b.id,
    }))
  )

  // W16B: floorGeometry takes precedence over legacy components[]
  let indoor: IndoorRenderData
  if (floorGeometry && floorGeometry.buildings.length > 0) {
    // Build a CoordinateTransformer from floorGeometry building anchors
    const transformer = new CoordinateTransformer()
    for (const fgBuilding of floorGeometry.buildings) {
      transformer.registerBuilding({
        buildingId: fgBuilding.id,
        origin: fgBuilding.anchor.origin,
        rotation: fgBuilding.anchor.rotation,
      })
    }
    indoor = buildIndoorFromFloorGeometry(floorGeometry, transformer)
  } else {
    // Fallback to legacy components[] + doors[]
    indoor = { ...buildIndoorData(components), doors: buildDoors(doors), walls: [], openings: [] }
  }

  return {
    buildings,
    entrances: allEntrances,
    boundary: boundingBox,
    nodes,
    edges,
    indoor,
  }
}

/**
 * Cache pure campus geometry/render data by the published bundle's object identity.
 * Campus bundles are immutable for their in-memory lifetime; WeakMap lets replaced
 * bundles be collected once no store, page, or other consumer retains them.
 */
export function createNavigationRenderModelCache(
  builder: (bundle: CampusBundle) => NavigationRenderModel = buildFromCampusBundle,
): (bundle: CampusBundle) => NavigationRenderModel {
  const cache = new WeakMap<CampusBundle, NavigationRenderModel>()

  return (bundle) => {
    const cachedModel = cache.get(bundle)
    if (cachedModel) return cachedModel

    const model = builder(bundle)
    cache.set(bundle, model)
    return model
  }
}

const getCachedModelForBundle = createNavigationRenderModelCache()

export function getCachedNavigationRenderModel(bundle: CampusBundle): NavigationRenderModel {
  return getCachedModelForBundle(bundle)
}
