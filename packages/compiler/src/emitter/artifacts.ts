import type { ConnectivityGraph, NavigationGraph, NavigationArtifacts, SearchEntry, BuildingEntry, FloorEntry } from '../types'
import type { CampusDocument, PanoramaIndex, PanoramaEntry, FloorGeometryArtifact, RoomAttributes } from '@navi/core'
import { collectFloorDoors, encodeQrCode, CoordinateTransformer } from '@navi/core'
import { COMPILER_VERSION } from '../version'
import { buildPOIIndex, getPointOfInterestRepresentative } from './poi-projection'

/**
 * Phase 4: Build Navigation Artifacts.
 *
 * Transforms the emited NavigationGraph + original ConnectivityGraph metadata
 * into search, spatial, building, POI, and (optionally) panorama indexes, plus
 * the P1-T10 floor-geometry artifact (R6.1/D15).
 *
 * Zero spatial search. Zero validation. Pure mechanical transform (except the
 * floor-geometry emitter, which fails loudly on malformed geometry — R6.4).
 */
export function buildArtifacts(graph: ConnectivityGraph, navGraph: NavigationGraph, document: CampusDocument): NavigationArtifacts {
  const panoramaIndex = buildPanoramaIndex(document)
  const poiIndex = buildPOIIndex(navGraph, document)
  return {
    graph: navGraph,
    searchIndex: buildSearchIndex(navGraph, document, poiIndex),
    spatialIndex: buildSpatialIndex(navGraph),
    buildingIndex: buildBuildingIndex(graph, navGraph, document),
    poiIndex,
    panoramaIndex,
    // P1-T10 (R6.1/D15): dedicated floor-geometry artifact (local meters +
    // building anchor). Throws a clear error on malformed geometry (R6.4).
    floorGeometry: buildFloorGeometry(document),
    // P1-T13 (R10.2/D16): published QR index (opaque checkpoint resolution).
    qrIndex: buildQrIndex(document),
    // Phase 7B: these legacy-compatible runtime projections are derived from
    // the same source document as floorGeometry and the navigation graph.
    components: buildComponents(document),
    doors: buildDoors(document),
    metadata: {
      campusId: document.metadata.campusId,
      ...(document.connectivitySemanticsVersion !== undefined
        ? { connectivitySemanticsVersion: document.connectivitySemanticsVersion }
        : {}),
      compilerVersion: COMPILER_VERSION,
      revision: String(document.version),
      sourceDocumentVersion: String(document.version),
      compiledAt: navGraph.createdAt,
    },
    extensions: {},
  }
}

type WorldPoint = { lat: number; lng: number }
type LocalPoint = { x: number; y: number }

function worldCentroid(points: WorldPoint[]): WorldPoint {
  if (points.length === 0) return { lat: 0, lng: 0 }
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function worldBounds(points: WorldPoint[]): { width: number; height: number } {
  if (points.length === 0) return { width: 0, height: 0 }
  const lats = points.map(point => point.lat)
  const lngs = points.map(point => point.lng)
  return {
    width: Math.max(...lngs) - Math.min(...lngs),
    height: Math.max(...lats) - Math.min(...lats),
  }
}

function registerDocumentCoordinates(document: CampusDocument, transformer: CoordinateTransformer): void {
  for (const building of document.buildings ?? []) {
    transformer.registerBuilding({
      buildingId: building.id,
      origin: footprintCentroid(building.footprint) ?? { lat: 0, lng: 0 },
      rotation: building.rotation ?? 0,
    })
    for (const floor of building.floors ?? []) {
      transformer.registerFloor(building.id, floor.level, {
        offset: floor.offset ?? { x: 0, y: 0 },
        rotation: floor.rotation ?? 0,
      })
    }
  }
}

function transformLocalPoints(
  transformer: CoordinateTransformer,
  points: LocalPoint[],
  buildingId: string,
  level: number,
): WorldPoint[] {
  return points
    .map(point => transformer.floorLocalToWorld(point, buildingId, level))
    .filter((point): point is WorldPoint => point !== null)
}

function transformFeaturePolygon(
  transformer: CoordinateTransformer,
  polygon: { points: LocalPoint[] } | undefined,
  buildingId: string,
  level: number,
): WorldPoint[] | undefined {
  if (!polygon?.points?.length) return undefined
  const points = transformLocalPoints(transformer, polygon.points, buildingId, level)
  return points.length > 0 ? points : undefined
}

function buildComponents(document: CampusDocument): unknown[] {
  const transformer = new CoordinateTransformer()
  registerDocumentCoordinates(document, transformer)
  const components: unknown[] = []

  for (const building of document.buildings ?? []) {
    for (const floor of building.floors ?? []) {
      for (const room of floor.rooms ?? []) {
        const polygon = transformLocalPoints(
          transformer,
          room.polygon?.points ?? [],
          building.id,
          floor.level,
        )
        if (polygon.length < 3) continue
        const bounds = worldBounds(polygon)
        components.push({
          id: room.id,
          type: 'room',
          name: room.name,
          buildingId: building.id,
          campusId: document.metadata.campusId,
          floor: floor.level,
          position: worldCentroid(polygon),
          polygon,
          dimensions: { width: bounds.width, height: bounds.height },
          metadata: {
            number: room.number,
            capacity: room.capacity,
            roomMetadata: room.metadata ?? {},
          },
        })
      }

      for (const hallway of floor.hallways ?? []) {
        const polygon = transformLocalPoints(
          transformer,
          hallway.polyline?.points ?? [],
          building.id,
          floor.level,
        )
        if (polygon.length < 2) continue
        components.push({
          id: hallway.id,
          type: 'hallway',
          name: hallway.name,
          buildingId: building.id,
          campusId: document.metadata.campusId,
          floor: floor.level,
          position: worldCentroid(polygon),
          polygon,
          metadata: { width: hallway.width, color: hallway.color },
        })
      }

      if ((building.staircases ?? []).length > 0) {
        for (const staircase of building.staircases ?? []) {
          const levelGeometry = staircase.levels?.[floor.level]
          if (!levelGeometry) continue
          const position = transformer.floorLocalToWorld(levelGeometry.position, building.id, floor.level)
          if (!position) continue
          components.push({
            id: staircase.id,
            type: 'stair',
            name: staircase.name,
            buildingId: building.id,
            campusId: document.metadata.campusId,
            floor: floor.level,
            position,
            range: { from: staircase.fromLevel, to: staircase.toLevel },
            featureId: staircase.id,
            metadata: { type: staircase.type },
            ...(transformFeaturePolygon(transformer, levelGeometry.polygon, building.id, floor.level)
              ? { polygon: transformFeaturePolygon(transformer, levelGeometry.polygon, building.id, floor.level) }
              : {}),
          })
        }
      } else {
        for (const staircase of floor.staircases ?? []) {
          const position = transformer.floorLocalToWorld(staircase.position, building.id, floor.level)
          if (!position) continue
          components.push({
            id: staircase.id,
            type: 'stair',
            name: staircase.name,
            buildingId: building.id,
            campusId: document.metadata.campusId,
            floor: floor.level,
            position,
            range: { from: staircase.fromLevel, to: staircase.toLevel },
          })
        }
      }

      if ((building.elevators ?? []).length > 0) {
        for (const elevator of building.elevators ?? []) {
          const levelGeometry = elevator.levels?.[floor.level]
          if (!levelGeometry) continue
          const position = transformer.floorLocalToWorld(levelGeometry.position, building.id, floor.level)
          if (!position) continue
          components.push({
            id: elevator.id,
            type: 'elevator',
            name: elevator.name,
            buildingId: building.id,
            campusId: document.metadata.campusId,
            floor: floor.level,
            position,
            range: { from: elevator.fromLevel, to: elevator.toLevel },
            featureId: elevator.id,
            ...(transformFeaturePolygon(transformer, levelGeometry.polygon, building.id, floor.level)
              ? { polygon: transformFeaturePolygon(transformer, levelGeometry.polygon, building.id, floor.level) }
              : {}),
          })
        }
      } else {
        for (const elevator of floor.elevators ?? []) {
          const position = transformer.floorLocalToWorld(elevator.position, building.id, floor.level)
          if (!position) continue
          components.push({
            id: elevator.id,
            type: 'elevator',
            name: elevator.name,
            buildingId: building.id,
            campusId: document.metadata.campusId,
            floor: floor.level,
            position,
            range: { from: elevator.fromLevel, to: elevator.toLevel },
          })
        }
      }

      for (const entrance of floor.entrances ?? []) {
        const rawPosition = entrance.position as unknown as { lat?: unknown; lng?: unknown }
        const position = typeof rawPosition.lat === 'number' && typeof rawPosition.lng === 'number'
          ? { lat: rawPosition.lat, lng: rawPosition.lng }
          : transformer.floorLocalToWorld(entrance.position, building.id, floor.level)
        if (!position) continue
        components.push({
          id: entrance.id,
          type: 'entrance',
          name: entrance.label,
          buildingId: building.id,
          campusId: document.metadata.campusId,
          floor: entrance.level,
          position,
          metadata: { hasQR: entrance.hasQR, hasPanorama: entrance.hasPanorama },
        })
      }
    }
  }

  return components
}

function buildDoors(document: CampusDocument): unknown[] {
  const transformer = new CoordinateTransformer()
  registerDocumentCoordinates(document, transformer)
  const doors: unknown[] = []

  for (const building of document.buildings ?? []) {
    for (const floor of building.floors ?? []) {
      for (const door of collectFloorDoors(floor)) {
        const position = transformer.floorLocalToWorld(door.position, building.id, floor.level)
        if (!position) continue
        doors.push({
          id: door.id,
          roomId: door.roomId,
          buildingId: building.id,
          floor: floor.level,
          position,
          width: door.width,
          ...(door.angle !== undefined ? { angle: door.angle } : {}),
          ...(door.connectedToId !== undefined ? { connectedToId: door.connectedToId } : {}),
          isExterior: door.connectedToType === 'hallway' && !door.connectedToId,
        })
      }
    }
  }

  return doors
}

function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().split(/[\s_\-:;,.!?]+/).filter(Boolean)
  return [...new Set(tokens)]
}

function buildSearchIndex(
  navGraph: NavigationGraph,
  document?: CampusDocument,
  poiIndex?: NavigationArtifacts['poiIndex'],
): NavigationArtifacts['searchIndex'] {
  const entries: SearchEntry[] = []
  const seenIds = new Set<string>()

  // 1. Index buildings from source document
  if (document?.buildings) {
    for (const b of document.buildings) {
      if (!b.id || b.id === '__outdoor__') continue
      const label = b.name || b.code || b.id
      const tags = tokenize(`${b.name} ${b.code ?? ''} ${b.description ?? ''} ${(b.aliases ?? []).join(' ')}`)
      const entryId = `search_bldg_${b.id}`
      seenIds.add(entryId)

      // Calculate centroid from footprint points if available
      let position = { lat: 0, lng: 0 }
      const pts = b.footprint?.points
      if (Array.isArray(pts) && pts.length > 0) {
        position = {
          lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
          lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
        }
      }

      entries.push({
        id: entryId,
        label,
        type: 'building',
        nodeId: resolveBuildingNodeId(navGraph, b.id),
        position,
        tags,
        buildingId: b.id,
      })

      // 2. Index rooms from building floors
      // W15E: When RoomAttributes exist for a floor, use as search authority.
      // Otherwise fall back to legacy Floor.rooms[] search behavior.
      for (const floor of b.floors ?? []) {
        const hasSemanticRooms = Array.isArray(floor.roomAttributes) && floor.roomAttributes.length > 0

        if (hasSemanticRooms) {
          // W15E Part A: Use RoomAttributes as search authority
          for (const ra of floor.roomAttributes!) {
            // Room identity: use roomId (stable semantic ID) — never face ordering
            const stableId = ra.roomId ?? ra.faceId
            const roomCode = ra.code !== undefined ? ra.code : ra.number
            const roomType = ra.type !== undefined ? ra.type : ra.category
            const roomLabel = ra.name || roomCode || stableId
            if (!roomLabel) continue

            // Respect searchable flag
            if (ra.searchable === false) continue

            const roomTags = tokenize(`${ra.name} ${roomCode ?? ''} ${roomType ?? ''} ${ra.description ?? ''} ${b.name}`)
            const rEntryId = `search_room_${stableId}`

            // One Room → one search entry: skip if already indexed
            if (seenIds.has(rEntryId)) continue
            seenIds.add(rEntryId)

            // Resolve the room's POI nav node for navigation
            const nodeId = resolvePoiNodeId(navGraph, b.id, floor.level, roomLabel, roomCode ?? '')

            // Position: derive from POI node if available, else building centroid fallback
            let position = { lat: 0, lng: 0 }
            if (nodeId) {
              const poiNode = navGraph.nodes.find(n => n.id === nodeId)
              if (poiNode) position = poiNode.position
            } else {
              // Fallback to building centroid
              const origin = footprintCentroid(b.footprint)
              if (origin) position = origin
            }

            entries.push({
              id: rEntryId,
              label: roomLabel,
              type: 'room',
              nodeId,
              position,
              tags: roomTags,
              buildingId: b.id,
              floor: floor.level,
            })
          }
        } else {
          // Legacy fallback: existing Floor.rooms[] search behavior
          for (const room of floor.rooms ?? []) {
            const roomLabel = room.name || room.number || room.id
            if (!roomLabel) continue
            const roomTags = tokenize(`${room.name} ${room.number ?? ''} ${room.category ?? ''} ${b.name}`)
            const rEntryId = `search_room_${room.id}`
            seenIds.add(rEntryId)

            // Room centroid from its polygon (building-local → world via origin)
            let position = { lat: 0, lng: 0 }
            const poly = room.polygon?.points
            if (Array.isArray(poly) && poly.length > 0) {
              const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
              const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length
              const origin = footprintCentroid(b.footprint)
              if (origin) {
                position = {
                  lat: origin.lat + cy / METER_PER_DEG,
                  lng: origin.lng + cx / (METER_PER_DEG * Math.cos((origin.lat * Math.PI) / 180)),
                }
              }
            }

            entries.push({
              id: rEntryId,
              label: roomLabel,
              type: 'room',
              // P1-T11: graph-anchored contract — resolve the room's POI nav
              // node id (search → navigation). POI labels carry the room's
              // display form "Name (number)" (room-extractor); match either
              // the plain label or the display form. Ambiguous or missing
              // matches stay '' (document-only entry).
              nodeId: resolvePoiNodeId(navGraph, b.id, floor.level, roomLabel, room.number ?? ''),
              position,
              tags: roomTags,
              buildingId: b.id,
              floor: floor.level,
            })
          }
        }
      }
    }
  }

  // 3. Index graph nodes (entrances / POIs)
  for (const node of navGraph.nodes) {
    let type: SearchEntry['type']
    switch (node.type) {
      case 'outdoor':
      case 'entrance':
        type = 'entrance'
        break
      case 'poi':
        type = 'poi'
        break
      default:
        continue
    }

    const id = `${node.id}_search`
    if (seenIds.has(id)) continue

    const tags = node.label ? tokenize(node.label) : []

    entries.push({
      id,
      label: node.label || '',
      type,
      nodeId: node.id,
      position: node.position,
      tags,
      buildingId: node.buildingId,
      floor: node.floor,
    })
  }

  // 4B: authored Floor.pois are searchable projections of the canonical
  // runtime POI index. They intentionally have no graph node or topology
  // side effect; the representative world position is already resolved by
  // the Phase 4A POI projection.
  for (const point of poiIndex?.points ?? []) {
    if (point.source !== 'authored') continue
    // Visibility: non-searchable POIs are excluded from the public search
    // index; hidden-but-searchable POIs stay searchable (transient reveal is a
    // presentation concern, not a projection concern).
    if (point.visibility?.searchable === false) continue
    if (seenIds.has(point.id)) {
      throw new Error(`POI_SEARCH_ID_COLLISION ${point.id}: authored search ID is already in use`)
    }

    const metadataTokens = Object.entries(point.properties).flatMap(([key, value]) => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return []
      return [key, String(value)]
    })
    const tags = tokenize([point.label, point.category, ...metadataTokens].join(' '))
    seenIds.add(point.id)
    entries.push({
      id: point.id,
      label: point.label,
      type: 'poi',
      position: point.position,
      tags,
      category: point.category,
      buildingId: point.buildingId,
      floor: point.floor,
      floorId: point.floorId,
      source: point.source,
      sourceId: point.sourceId,
      // Outdoor/campus scope marker; absent for indoor POIs.
      ...(point.scope !== undefined ? { scope: point.scope } : {}),
    })
  }

  return { version: '1.0.0', entries }
}

const METER_PER_DEG = 111320

/** Resolve the emitted POI nav node for a room (graph-anchored search entry).
 *  Returns '' when no unique match exists (document-only entry). */
function resolvePoiNodeId(navGraph: NavigationGraph, buildingId: string, floor: number, roomLabel: string, roomNumber: string): string {
  const matches = navGraph.nodes.filter(
    n => n.type === 'poi' && n.buildingId === buildingId && n.floor === floor
      && (n.label === roomLabel || n.label === `${roomLabel} (${roomNumber})`),
  )
  return matches.length === 1 ? matches[0].id : ''
}

function footprintCentroid(footprint: { points: Array<{ lat: number; lng: number }> } | undefined): { lat: number; lng: number } | null {
  const pts = footprint?.points ?? []
  if (pts.length === 0) return null
  let lat = 0
  let lng = 0
  for (const p of pts) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / pts.length, lng: lng / pts.length }
}

function buildSpatialIndex(navGraph: NavigationGraph): NavigationArtifacts['spatialIndex'] {
  const cellSize = 0.001 // ~111m at equator
  const cells: Record<string, string[]> = {}

  for (const node of navGraph.nodes) {
    const cellKey = `${Math.floor(node.position.lat / cellSize)},${Math.floor(node.position.lng / cellSize)}`
    if (!cells[cellKey]) cells[cellKey] = []
    cells[cellKey].push(node.id)
  }

  return { version: '1.0.0', cells, cellSize }
}

function buildBuildingIndex(
  graph: ConnectivityGraph,
  navGraph: NavigationGraph,
  document?: CampusDocument,
): NavigationArtifacts['buildingIndex'] {
  const docBuildingMap = new Map((document?.buildings ?? []).map(b => [b.id, b]))
  const buildingMap = new Map<string, { name: string; entrances: { id: string; label: string; position: { lat: number; lng: number } }[]; floors: Set<number>; nodeIds: Set<string> }>()

  // Collect building info from connectivity graph nodes
  for (const node of graph.nodes) {
    if (!buildingMap.has(node.buildingId)) {
      buildingMap.set(node.buildingId, {
        name: '',
        entrances: [],
        floors: new Set(),
        nodeIds: new Set(),
      })
    }
    const entry = buildingMap.get(node.buildingId)!
    entry.floors.add(node.floor)
  }

  // Map nav node IDs to buildings
  const nodeBuildingMap = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.buildingId === '__outdoor__') continue
    const navIds = navGraph.nodes.filter(n => {
      return n.buildingId === node.buildingId && n.floor === node.floor
    })
    for (const n of navIds) {
      nodeBuildingMap.set(n.id, node.buildingId)
    }
  }

  // Collect entrance nodes
  for (const node of navGraph.nodes) {
    if (node.type === 'entrance' || node.type === 'outdoor') {
      const buildingId = nodeBuildingMap.get(node.id) || node.buildingId
      if (!buildingId || buildingId === '__outdoor__') continue
      if (!buildingMap.has(buildingId)) {
        buildingMap.set(buildingId, {
          name: '',
          entrances: [],
          floors: new Set(),
          nodeIds: new Set(),
        })
      }
      const entry = buildingMap.get(buildingId)!
      entry.entrances.push({
        id: node.id,
        label: node.label || '',
        position: node.position,
      })
    }
  }

  const buildings: BuildingEntry[] = []
  for (const [id, data] of buildingMap) {
    if (id === '__outdoor__') continue
    const docBuilding = docBuildingMap.get(id)
    const sortedFloors = [...data.floors].sort((a, b) => a - b)
    const floorPlanUrls: Record<number, string> = {}
    const floorPlanVisuals: NonNullable<BuildingEntry['floorPlanVisuals']> = {}
    const legacyFloorPlanUrls = ((docBuilding as unknown as { floorPlanUrls?: Record<number, string> } | undefined)?.floorPlanUrls) ?? {}

    const floorEntries: FloorEntry[] = sortedFloors.map(level => {
      const docFloor = docBuilding?.floors?.find(f => f.level === level)
      const imageUrl = docFloor?.planImageId ?? legacyFloorPlanUrls[level]
      if (imageUrl) {
        floorPlanUrls[level] = imageUrl
        floorPlanVisuals[level] = {
          imageUrl,
          ...(docFloor?.planAlignment !== undefined ? { alignment: docFloor.planAlignment } : {}),
        }
      }
      return {
        level,
        label: docFloor?.label || `Floor ${level}`,
        elevation: docFloor?.elevation ?? level * 3,
        rooms: (docFloor?.rooms ?? []).map(r => ({
          id: r.id,
          name: r.name,
          number: r.number,
          nodeId: r.id,
        })),
      }
    })

    const navNode = navGraph.nodes.find(n => n.id === resolveBuildingNodeId(navGraph, id))
    const entry: BuildingEntry = {
      id,
      name: docBuilding?.name || data.name || id,
      code: docBuilding?.code || id.toLowerCase().replace(/\s+/g, '-'),
      category: docBuilding?.category || 'building',
      position: navNode?.position || (docBuilding?.footprint?.points?.[0] ? { lat: docBuilding.footprint.points[0].lat, lng: docBuilding.footprint.points[0].lng } : { lat: 0, lng: 0 }),
      floors: floorEntries,
      entrances: data.entrances,
      nodeId: navNode?.id || '',
    }

    // P1-T10 (R15.9): typed contract field — no `as any` cast.
    if (Object.keys(floorPlanUrls).length > 0) {
      entry.floorPlanUrls = floorPlanUrls
      entry.floorPlanVisuals = floorPlanVisuals
    }

    // Emit render metadata from the source document when available
    if (docBuilding) {
      const pts = docBuilding.footprint?.points
      if (Array.isArray(pts) && pts.length >= 3) {
        entry.footprint = pts.map(p => ({ lat: p.lat, lng: p.lng }))
      }
      if (docBuilding.height > 0) entry.height = docBuilding.height
      if (docBuilding.baseElevation > 0) entry.baseElevation = docBuilding.baseElevation
      if (docBuilding.color) entry.color = docBuilding.color
      if (docBuilding.metadata && Object.keys(docBuilding.metadata).length > 0) {
        entry.metadata = docBuilding.metadata
      }
    }

    buildings.push(entry)
  }

  return { version: '1.0.0', buildings }
}

/**
 * Resolve the graph destination used when a user searches for a building.
 * Prefer the authored building Entrance so an outdoor route can traverse the
 * explicit EntranceAccess bridge; only fall back to another building node
 * for legacy/incomplete documents with no emitted Entrance node.
 */
function resolveBuildingNodeId(navGraph: NavigationGraph, buildingId: string): string {
  const buildingNodes = navGraph.nodes.filter(node => node.buildingId === buildingId)
  const entranceNode = buildingNodes.find(node => node.type === 'entrance' || String(node.type) === 'building_entrance')
  return entranceNode?.id ?? buildingNodes[0]?.id ?? ''
}

function normalizeHotspotType(hotspotType: string | undefined, targetType: string): 'navigation' | 'information' | 'link' {
  // Use explicit hotspotType when available (new documents)
  if (hotspotType === 'information') return 'information'
  if (hotspotType === 'navigation') {
    // Check if it's a URL link
    if (targetType === 'url') return 'link'
    return 'navigation'
  }
  // Fallback: derive from target type (legacy documents)
  if (targetType === 'url') return 'link'
  if (targetType === 'panorama' || targetType === 'room' || targetType === 'entrance' || targetType === 'qr') return 'navigation'
  return 'information'
}

function buildPanoramaIndex(document: CampusDocument): PanoramaIndex {
  const panoramas: PanoramaEntry[] = document.panoramas
    .map(p => {
      // D9 coordinate semantics:
      // 1. Legacy world-stored records (position has `lat` property) → pass through
      // 2. Building-associated panoramas (buildingId present, position is LocalCoord) → convert via buildingOrigin
      // 3. Outdoor/campus-wide panoramas (buildingId absent, position is LocalCoord) → treat as world LatLng
      const isLatLng = (p.position as unknown as { lat?: number }).lat !== undefined
      let position: { lat: number; lng: number }
      if (isLatLng) {
        // Case 1: Legacy world-stored record or outdoor panorama stored as LatLng
        position = { lat: (p.position as unknown as { lat: number }).lat, lng: (p.position as unknown as { lng: number }).lng }
      } else if (p.buildingId) {
        // Case 2: Building-associated panorama — convert building-local to world
        const origin = buildingOrigin(document, p.buildingId)
        position = worldFromLocal(p.position as LocalCoord, origin)
      } else {
        // Case 3: Outdoor panorama without buildingId but position is LocalCoord (not LatLng)
        // This is a data error — outdoor panoramas should store LatLng.
        // Fall back to (0,0) with a console warning.
        console.warn(`Panorama ${p.id}: outdoor panorama without buildingId should store position as LatLng, not LocalCoord. Falling back to (0,0).`)
        position = { lat: 0, lng: 0 }
      }
      return {
        id: p.id,
        title: p.label,
        imageAssetId: p.imageAssetId,
        buildingId: p.buildingId,
        floor: p.floor,
        position,
        heading: p.heading,
        hotspots: p.hotspots.map(h => ({
          id: `${p.id}_hotspot_${h.position.yaw}_${h.position.pitch}`,
          type: normalizeHotspotType(h.hotspotType, h.target.type),
          target: h.target.targetId,
          yaw: h.position.yaw,
          pitch: h.position.pitch,
          label: h.label,
          hotspotType: h.hotspotType,
          content: h.content,
        })),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  return { version: '1.0.0', panoramas }
}

/** Building world anchor (footprint centroid) for a building id. */
function buildingOrigin(document: CampusDocument, buildingId: string | undefined): { lat: number; lng: number } | null {
  if (!buildingId) return null
  const bld = document.buildings.find(b => b.id === buildingId)
  if (!bld) return null
  return footprintCentroid(bld.footprint)
}

/** Building-local meters → world LatLng (equirectangular approximation). */
function worldFromLocal(pos: { x: number; y: number }, origin: { lat: number; lng: number } | null): { lat: number; lng: number } {
  if (!origin) return { lat: 0, lng: 0 }
  return {
    lat: origin.lat + pos.y / METER_PER_DEG,
    lng: origin.lng + pos.x / (METER_PER_DEG * Math.cos((origin.lat * Math.PI) / 180)),
  }
}

// ── P1-T10 (R6.1/R6.4/D15): floor-geometry.json emission ──
// Built directly from the source document: rooms (closed polygons), hallways
// (centerlines), stair/elevator per-floor entries matching `levels`, doors,
// POIs, QR — all building-local meters (floor-local + floor.offset applied at
// emission) — plus the building world anchor for world derivation.
// R15.9: no `as any` casts — every field is a typed contract field.
// R6.4: malformed geometry (room polygon < 3 points, non-finite coords) fails
// with a clear error rather than emitting a corrupt artifact.

// P1-T13 (R10.2/D16): QR index artifact — the ONLY resolution source for
// opaque QR checkpoint codes (ID → buildingId/floor/position, building-local).
function buildQrIndex(document: CampusDocument): NavigationArtifacts['qrIndex'] {
  return {
    schemaVersion: 1,
    formatVersion: 0,
    campusId: document.metadata.campusId,
    checkpoints: (document.qrCheckpoints ?? []).map(q => ({
      id: q.id,
      label: q.label,
      buildingId: q.buildingId,
      floor: q.floor,
      // Building-local meters (D9) — never converted; world is derived at
      // consumption via CoordinateTransformer.
      position: { x: q.position.x, y: q.position.y },
      // Opaque payload — derived from the id; whatever the document stored,
      // the PUBLISHED contract is navi.app/q/{id} (D16/Q5).
      code: encodeQrCode(q.id),
    })),
  }
}

function assertFiniteLocalCoord(value: { x: number; y: number }, what: string, id: string): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`Cannot emit floor-geometry: ${what} "${id}" has non-finite coordinates`)
  }
}

function translatePoints(points: Array<{ x: number; y: number }>, offset: { x: number; y: number }): Array<{ x: number; y: number }> {
  return points.map(p => ({ x: p.x + offset.x, y: p.y + offset.y }))
}

function buildFloorGeometry(document: CampusDocument): FloorGeometryArtifact {
  interface FloorSlot {
    level: number
    label: string
    elevation: number
    offset: { x: number; y: number }
    rooms: Array<{ id: string; name: string; number: string; polygon: { points: Array<{ x: number; y: number }> } }>
    hallways: Array<{ id: string; name: string; polyline: { points: Array<{ x: number; y: number }> } }>
    staircases: Array<{ id: string; name: string; position: { x: number; y: number }; rotation: number; polygon?: { points: Array<{ x: number; y: number }> } }>
    elevators: Array<{ id: string; name: string; position: { x: number; y: number }; rotation: number; polygon?: { points: Array<{ x: number; y: number }> } }>
    doors: Array<{ id: string; roomId: string; doorType: string; position: { x: number; y: number }; width: number }>
    pois: Array<{ id: string; name: string; category: string; position: { x: number; y: number } }>
    qrCheckpoints: Array<{ id: string; label: string; code: string; position: { x: number; y: number } }>
    // W15E: wall-first architectural data
    walls: Array<{ id: string; start: { x: number; y: number }; end: { x: number; y: number }; thickness: number; height: number }>
    openings: Array<{ id: string; type: 'door' | 'window'; wallId: string; offset: number; width: number; height?: number; sillHeight?: number; orientation?: number }>
    roomAttributes: Array<{ roomId: string; name: string; type?: string; code?: string; description?: string; number?: string; category?: string; searchable: boolean }>
    routeNetwork?: import('@navi/core').RouteNetwork
    roomAccess?: import('@navi/core').RoomAccess[]
    entranceAccess?: import('@navi/core').EntranceAccess[]
  }

  const buildings = document.buildings.map(b => {
    const origin = footprintCentroid(b.footprint) ?? { lat: 0, lng: 0 }
    const rotation = b.rotation ?? 0

    const floors: FloorSlot[] = b.floors.map(floor => {
      const offset = floor.offset ?? { x: 0, y: 0 }

      const rooms = (floor.rooms ?? []).map(r => {
        const pts = r.polygon?.points ?? []
        if (pts.length < 3) {
          throw new Error(`Cannot emit floor-geometry: room "${r.id}" polygon has <3 points`)
        }
        for (const p of pts) assertFiniteLocalCoord(p, 'room polygon point', r.id)
        // R6.4 invariant: every room polygon emitted as a CLOSED ring (first
        // point appended when the source ring is open).
        const closed = translatePoints(pts, offset)
        const first = closed[0]
        const last = closed[closed.length - 1]
        if (first.x !== last.x || first.y !== last.y) closed.push({ ...first })
        return {
          id: r.id,
          name: r.name,
          number: r.number ?? '',
          polygon: { points: closed },
        }
      })

      const hallways = (floor.hallways ?? []).map(hw => ({
        id: hw.id,
        name: hw.name,
        polyline: { points: translatePoints((hw.polyline?.points ?? []), offset) },
      }))

      const doors = collectFloorDoors(floor).map(d => {
        assertFiniteLocalCoord(d.position, 'door', d.id)
        return {
          id: d.id,
          roomId: d.roomId,
          doorType: d.doorType,
          position: { x: d.position.x + offset.x, y: d.position.y + offset.y },
          width: d.width ?? 0.9,
          ...(d.angle !== undefined ? { angle: d.angle } : {}),
        }
      })

      const pois = (floor.pois ?? []).map(p => {
        const representative = getPointOfInterestRepresentative(p)
        assertFiniteLocalCoord(representative, 'poi representative', p.id)
        return {
          id: p.id,
          name: p.name,
          category: p.category,
          position: { x: representative.x + offset.x, y: representative.y + offset.y },
        }
      })

      const qrCheckpoints = (document.qrCheckpoints ?? [])
        .filter(q => q.buildingId === b.id && q.floor === floor.level)
        .map(q => {
          assertFiniteLocalCoord(q.position, 'qr checkpoint', q.id)
          return {
            id: q.id,
            label: q.label,
            code: q.code,
            position: { x: q.position.x + offset.x, y: q.position.y + offset.y },
          }
        })

      // W15E: walls — canonical wall-first structural geometry
      const walls = (floor.walls ?? []).map(w => ({
        id: w.id,
        start: { x: w.start.x + offset.x, y: w.start.y + offset.y },
        end: { x: w.end.x + offset.x, y: w.end.y + offset.y },
        thickness: w.thickness,
        height: w.height,
      }))

      // W15E: openings — canonical wall-attached openings
      const openings = (floor.openings ?? []).map(o => ({
        id: o.id,
        type: o.type,
        wallId: o.wallId,
        offset: o.offset,
        width: o.width,
        ...(o.height !== undefined ? { height: o.height } : {}),
        ...(o.sillHeight !== undefined ? { sillHeight: o.sillHeight } : {}),
        ...(o.orientation !== undefined ? { orientation: o.orientation } : {}),
      }))

      // W15E: roomAttributes — derived room metadata from wall topology
      const roomAttributes = (floor.roomAttributes ?? []).map(ra => ({
        roomId: ra.roomId ?? ra.faceId,
        name: ra.name,
        ...(ra.type !== undefined ? { type: ra.type } : {}),
        ...(ra.code !== undefined ? { code: ra.code } : {}),
        ...(ra.description !== undefined ? { description: ra.description } : {}),
        ...(ra.number !== undefined ? { number: ra.number } : {}),
        ...(ra.category !== undefined ? { category: ra.category } : {}),
        searchable: ra.searchable,
      }))

      return {
        level: floor.level,
        label: floor.label,
        elevation: floor.elevation,
        offset,
        rooms,
        hallways,
        staircases: [],
        elevators: [],
        doors,
        pois,
        qrCheckpoints,
        walls,
        openings,
        roomAttributes,
        // W15E: routeNetwork, roomAccess, entranceAccess
        routeNetwork: floor.routeNetwork,
        roomAccess: collectRoomAccess(floor),
        entranceAccess: floor.entranceAccess,
      }
    })

    // P1-T10 (R6.4): per-floor stair/elevator entries MATCHING levels keys —
    // one entry per access floor present in `levels`, absent floors absent.
    const floorByLevel = new Map(floors.map(f => [f.level, f]))
    for (const st of b.staircases ?? []) {
      for (const [levelKey, geom] of Object.entries(st.levels ?? {})) {
        const level = Number(levelKey)
        if (!Number.isInteger(level)) continue
        const slot = floorByLevel.get(level)
        if (!slot) continue
        assertFiniteLocalCoord(geom.position, 'stair', st.id)
        slot.staircases.push({
          id: st.id,
          name: st.name,
          position: { x: geom.position.x + offsetFor(b, level).x, y: geom.position.y + offsetFor(b, level).y },
          rotation: geom.rotation ?? 0,
          ...(geom.polygon ? { polygon: { points: translatePoints(geom.polygon.points, offsetFor(b, level)) } } : {}),
        })
      }
    }
    for (const el of b.elevators ?? []) {
      for (const [levelKey, geom] of Object.entries(el.levels ?? {})) {
        const level = Number(levelKey)
        if (!Number.isInteger(level)) continue
        const slot = floorByLevel.get(level)
        if (!slot) continue
        assertFiniteLocalCoord(geom.position, 'elevator', el.id)
        slot.elevators.push({
          id: el.id,
          name: el.name,
          position: { x: geom.position.x + offsetFor(b, level).x, y: geom.position.y + offsetFor(b, level).y },
          rotation: geom.rotation ?? 0,
          ...(geom.polygon ? { polygon: { points: translatePoints(geom.polygon.points, offsetFor(b, level)) } } : {}),
        })
      }
    }

    return {
      id: b.id,
      name: b.name,
      anchor: { origin, rotation },
      floors: floors.map(f => ({
        level: f.level,
        label: f.label,
        elevation: f.elevation,
        offset: f.offset,
        rooms: f.rooms,
        hallways: f.hallways,
        staircases: f.staircases,
        elevators: f.elevators,
        doors: f.doors,
        pois: f.pois,
        qrCheckpoints: f.qrCheckpoints,
        // W15E: wall-first architectural data
        ...(f.walls && f.walls.length > 0 ? { walls: f.walls } : {}),
        ...(f.openings && f.openings.length > 0 ? { openings: f.openings } : {}),
        ...(f.roomAttributes && f.roomAttributes.length > 0 ? { roomAttributes: f.roomAttributes } : {}),
        ...(f.routeNetwork ? { routeNetwork: f.routeNetwork } : {}),
        ...(f.roomAccess && f.roomAccess.length > 0 ? { roomAccess: f.roomAccess } : {}),
        ...(f.entranceAccess && f.entranceAccess.length > 0 ? { entranceAccess: f.entranceAccess } : {}),
      })),
    }
  })

  return {
    schemaVersion: 1,
    formatVersion: 0,
    campusId: document.metadata.campusId,
    buildings,
  }

  /** Per-floor offset lookup for feature levels (floor-local → building-local). */
  function offsetFor(b: { floors: Array<{ level: number; offset?: { x: number; y: number } }> }, level: number): { x: number; y: number } {
    return b.floors.find(f => f.level === level)?.offset ?? { x: 0, y: 0 }
  }

  /** W15E: collect RoomAccess entries from RoomAttributes on a floor. */
  function collectRoomAccess(floor: { roomAttributes?: RoomAttributes[] }): import('@navi/core').RoomAccess[] | undefined {
    if (!floor.roomAttributes || floor.roomAttributes.length === 0) return undefined
    const allAccess: import('@navi/core').RoomAccess[] = []
    for (const ra of floor.roomAttributes) {
      if (ra.accessPoints && ra.accessPoints.length > 0) {
        allAccess.push(...ra.accessPoints)
      }
    }
    return allAccess.length > 0 ? allAccess : undefined
  }
}
