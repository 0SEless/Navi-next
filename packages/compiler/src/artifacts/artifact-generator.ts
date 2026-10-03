import type { CampusDocument } from '@navi/core'
import { haversine, ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import type { ExtractionResult, NavigationGraph, NavNode, NavEdge, SearchIndex, SearchEntry, POIData, POI, BuildingIndex, BuildingEntry, FloorEntry, BoundingBox } from '../types'
import { createHash } from 'crypto'

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function makeNodeId(type: string, idx: number): string {
  return `${type}-${idx}`
}

/** Prefer an authored Entrance as the destination for building search. */
function preferredBuildingNode(nodes: NavNode[] | undefined): NavNode | undefined {
  return nodes?.find(node => node.type === 'entrance' || String(node.type) === 'building_entrance') ?? nodes?.[0]
}

export function buildGraph(campus: CampusDocument, extraction: ExtractionResult): NavigationGraph {
  const nodes: NavNode[] = []
  const edges: NavEdge[] = []
  let nodeIdx = 0
  let edgeIdx = 0

  const buildingMap = new Map(campus.buildings.map(b => [b.id, b]))

  // Spaces → nav nodes
  for (const space of extraction.spaces) {
    const id = makeNodeId('node', nodeIdx++)
    nodes.push({
      id, label: space.label, type: 'space',
      position: space.position,
      floor: space.floor, buildingId: space.buildingId,
      properties: space.properties,
    })
  }

  // Transitions → nav nodes
  for (const t of extraction.transitions) {
    const id = makeNodeId('node', nodeIdx++)
    nodes.push({
      id, label: t.label,
      type: t.type === 'staircase' ? 'transition' : t.type === 'elevator' ? 'transition' : 'transition',
      position: t.position,
      floor: t.floor, buildingId: t.buildingId,
      properties: t.properties,
    })
  }

  // Corridor endpoints → nav nodes
  for (const c of extraction.corridors) {
    if (c.polyline.length >= 2) {
      const startId = makeNodeId('node', nodeIdx++)
      nodes.push({
        id: startId, label: `${c.name} start`, type: 'corridor',
        position: c.polyline[0], floor: c.floor ?? 0, buildingId: c.buildingId ?? '',
        properties: c.properties,
      })
      const endId = makeNodeId('node', nodeIdx++)
      nodes.push({
        id: endId, label: `${c.name} end`, type: 'corridor',
        position: c.polyline[c.polyline.length - 1], floor: c.floor ?? 0, buildingId: c.buildingId ?? '',
        properties: c.properties,
      })
      // Edge connecting start → end
      const dist = haversine(c.polyline[0], c.polyline[c.polyline.length - 1])
      edges.push({ id: `edge-${edgeIdx++}`, from: startId, to: endId, type: 'walk', distance: dist, weight: dist })
    }
  }

  // Connect rooms to nearest entrance on same building/floor + nearby rooms
  const spaceNodes = nodes.filter(n => n.type === 'space')
  const entranceNodes = nodes.filter(n => n.type === 'transition')
  const corridorNodes = nodes.filter(n => n.type === 'corridor')
  const seenConnections = new Set<string>()
  const edgeKey = (a: string, b: string) => a < b ? `${a}--${b}` : `${b}--${a}`

  for (const sn of spaceNodes) {
    const sameBuildingFloor = entranceNodes.filter(en => en.buildingId === sn.buildingId && en.floor === sn.floor)
    let bestDist = Infinity
    let bestNode: NavNode | null = null
    for (const en of sameBuildingFloor) {
      const d = haversine(sn.position, en.position)
      if (d < bestDist) { bestDist = d; bestNode = en }
    }
    if (bestNode && !seenConnections.has(edgeKey(sn.id, bestNode.id))) {
      seenConnections.add(edgeKey(sn.id, bestNode.id))
      edges.push({ id: `edge-${edgeIdx++}`, from: sn.id, to: bestNode.id, type: 'walk', distance: bestDist, weight: bestDist })
    }
    // Connect nearby rooms on same floor
    for (const sn2 of spaceNodes) {
      if (sn2.id >= sn.id) continue
      if (sn2.buildingId !== sn.buildingId || sn2.floor !== sn.floor) continue
      const d2 = haversine(sn.position, sn2.position)
      if (d2 < ROUTE_NETWORK_THRESHOLDS.compilerFallbackMeters && d2 > 0 && !seenConnections.has(edgeKey(sn.id, sn2.id))) {
        seenConnections.add(edgeKey(sn.id, sn2.id))
        edges.push({ id: `edge-${edgeIdx++}`, from: sn.id, to: sn2.id, type: 'walk', distance: d2, weight: d2 })
      }
    }
  }

  // Connect entrances only through an explicitly authored legacy connector.
  // New documents use Floor.entranceAccess in the V2 pipeline; this
  // deprecated path has no access relationship in ExtractionResult, so an
  // unassigned entrance must remain disconnected rather than being linked by
  // proximity.
  for (const en of entranceNodes) {
    const explicitRoadId = typeof en.properties.connectorRoadId === 'string' && en.properties.connectorRoadId.length > 0
      ? en.properties.connectorRoadId
      : corridorNodes.find((cn) =>
        cn.properties.roadId && cn.properties.connectorEntranceId === (en.properties.entityId ?? en.id),
      )?.properties.roadId

    if (!explicitRoadId) continue

    let bestDist = Infinity
    let bestNode: NavNode | null = null
    for (const cn of corridorNodes) {
      if (cn.properties.roadId !== explicitRoadId) continue
      const d = haversine(en.position, cn.position)
      if (d < bestDist) { bestDist = d; bestNode = cn }
    }
    if (bestNode) {
      edges.push({ id: `edge-${edgeIdx++}`, from: en.id, to: bestNode.id, type: 'walk', distance: bestDist, weight: bestDist })
    }
  }

  // Bounding box
  const bbox: BoundingBox = nodes.length > 0
    ? nodes.reduce((bb, n) => ({
        minLng: Math.min(bb.minLng, n.position.lng),
        maxLng: Math.max(bb.maxLng, n.position.lng),
        minLat: Math.min(bb.minLat, n.position.lat),
        maxLat: Math.max(bb.maxLat, n.position.lat),
      }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity })
    : { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 }

  const buildings = new Set(nodes.map(n => n.buildingId)).size
  const floors = new Set(nodes.map(n => `${n.buildingId}-${n.floor}`)).size

  return {
    version: '1.0.0',
    campusId: campus.metadata.name,
    createdAt: new Date().toISOString(),
    checksum: '',
    nodes, edges,
    metadata: { nodeCount: nodes.length, edgeCount: edges.length, buildings, floors, boundingBox: bbox },
  }
}

export function buildSearchIndex(campus: CampusDocument, graph: NavigationGraph): SearchIndex {
  const entries: SearchEntry[] = []
  const nodeByBuilding = new Map<string, NavNode[]>()

  for (const node of graph.nodes) {
    const list = nodeByBuilding.get(node.buildingId) ?? []
    list.push(node)
    nodeByBuilding.set(node.buildingId, list)
  }

  for (const building of campus.buildings) {
    // Building entry
    const bNode = preferredBuildingNode(nodeByBuilding.get(building.id))
    if (bNode) {
      entries.push({
        id: `search-bld-${building.id}`,
        label: building.name,
        type: 'building',
        nodeId: bNode.id,
        position: building.footprint.points.length > 0 ? building.footprint.points[0] : { lat: 0, lng: 0 },
        tags: [building.code, building.category, ...building.aliases],
        buildingId: building.id,
      })
    }

    // Room entries
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const roomNode = graph.nodes.find(n =>
          n.label === room.name && n.buildingId === building.id && n.floor === floor.level
        )
        entries.push({
          id: `search-rm-${room.id}`,
          label: room.name,
          type: 'room',
          nodeId: roomNode?.id ?? '',
          position: building.footprint.points.length > 0 ? building.footprint.points[0] : { lat: 0, lng: 0 },
          tags: [room.number, room.category],
          buildingId: building.id,
          floor: floor.level,
        })
      }
    }
  }

  return { version: '1.0.0', entries }
}

export function buildPOIData(graph: NavigationGraph): POIData {
  const points: POI[] = graph.nodes.map(n => ({
    id: `poi-${n.id}`,
    label: n.label,
    category: n.type,
    position: n.position,
    buildingId: n.buildingId,
    floor: n.floor,
    nodeId: n.id,
    properties: n.properties,
  }))
  return { version: '1.0.0', points }
}

export function buildBuildingIndex(campus: CampusDocument, graph: NavigationGraph): BuildingIndex {
  const buildings: BuildingEntry[] = campus.buildings.map(b => {
    const entrances = b.floors.flatMap(f => f.entrances.map(e => ({
      id: e.id, label: e.label, position: e.position,
    })))
    const bNode = preferredBuildingNode(graph.nodes.filter(n => n.buildingId === b.id))
    const floorPlanUrls: Record<number, string> = {}
    const floorPlanVisuals: NonNullable<BuildingEntry['floorPlanVisuals']> = {}
    const legacyFloorPlanUrls = ((b as unknown as { floorPlanUrls?: Record<number, string> }).floorPlanUrls) ?? {}

    const floors = b.floors.map(f => {
      const imageUrl = f.planImageId ?? legacyFloorPlanUrls[f.level]
      if (imageUrl) {
        floorPlanUrls[f.level] = imageUrl
        floorPlanVisuals[f.level] = {
          imageUrl,
          ...(f.planAlignment !== undefined ? { alignment: f.planAlignment } : {}),
        }
      }
      return {
        level: f.level,
        label: f.label,
        elevation: f.elevation,
        rooms: f.rooms.map(r => ({
          id: r.id, name: r.name, number: r.number,
          nodeId: graph.nodes.find(n => n.label === r.name && n.buildingId === b.id)?.id ?? '',
        })),
      }
    })

    const entry: BuildingEntry = {
      id: b.id,
      name: b.name,
      code: b.code,
      category: b.category,
      position: b.footprint?.points && b.footprint.points.length > 0 ? b.footprint.points[0] : { lat: 0, lng: 0 },
      floors,
      entrances,
      nodeId: bNode?.id ?? '',
    }

    if (Object.keys(floorPlanUrls).length > 0) {
      entry.floorPlanUrls = floorPlanUrls
      entry.floorPlanVisuals = floorPlanVisuals
    }

    const pts = b.footprint?.points
    if (Array.isArray(pts) && pts.length >= 3) {
      entry.footprint = pts.map(p => ({ lat: p.lat, lng: p.lng }))
    }
    if (b.height > 0) entry.height = b.height
    if (b.baseElevation > 0) entry.baseElevation = b.baseElevation
    if (b.color) entry.color = b.color
    if (b.metadata && Object.keys(b.metadata).length > 0) {
      entry.metadata = b.metadata
    }

    return entry
  })

  return { version: '1.0.0', buildings }
}

export interface ArtifactSet {
  navigationGraph: NavigationGraph
  searchIndex: SearchIndex
  poiData: POIData
  buildingIndex: BuildingIndex
}

export function generateArtifacts(campus: CampusDocument, extraction: ExtractionResult): ArtifactSet {
  const graph = buildGraph(campus, extraction)
  const searchIndex = buildSearchIndex(campus, graph)
  const poiData = buildPOIData(graph)
  const buildingIndex = buildBuildingIndex(campus, graph)

  // Exclude createdAt from checksum so identical input produces identical hash
  const { createdAt: _, checksum: __, ...contentOnly } = graph
  graph.checksum = sha256(JSON.stringify(contentOnly))

  return { navigationGraph: graph, searchIndex, poiData, buildingIndex }
}

export function generateManifest(campusId: string, artifacts: ArtifactSet, version: string = '0.1.0') {
  const serialize = (obj: unknown) => JSON.stringify(obj)
  const checksum = (obj: unknown) => sha256(serialize(obj))

  return {
    projectId: campusId,
    campusId,
    publishedAt: new Date().toISOString(),
    schemaVersion: 1,
    compilerVersion: version,
    artifacts: {
      navigationGraph: { filename: 'navigation.graph.json', checksum: checksum(artifacts.navigationGraph), size: serialize(artifacts.navigationGraph).length },
      searchIndex: { filename: 'search.index.json', checksum: checksum(artifacts.searchIndex), size: serialize(artifacts.searchIndex).length },
      poiData: { filename: 'poi.json', checksum: checksum(artifacts.poiData), size: serialize(artifacts.poiData).length },
      buildingIndex: { filename: 'building-index.json', checksum: checksum(artifacts.buildingIndex), size: serialize(artifacts.buildingIndex).length },
    },
  }
}
