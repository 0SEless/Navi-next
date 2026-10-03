import type {
  NavigationArtifacts,
  BuildingEntry as CoreBuildingEntry,
  FloorEntry as CoreFloorEntry,
} from '@navi/core'
import { resolvePoiVisibility } from '@navi/core'
import type {
  BuiltPackage,
  NavNodeFile,
  NavEdgeFile,
  NavigationGraphFile,
  SearchEntryFile,
  SearchIndexFile,
  SpatialIndexFile,
  BuildingEntryFile,
  FloorEntryFile,
  EntranceEntryFile,
  BuildingIndexFile,
  POIEntryFile,
  POIIndexFile,
  PanoramaIndexFile,
  PanoramaEntryFile,
  HotspotFile,
  PackageMetadata,
} from './types'
import type { PublishOptions, FloorGeometryFile, QrIndexFile } from './types'

function mapNodeType(type: string): NavNodeFile['type'] {
  switch (type) {
    case 'poi': return 'poi'
    case 'transition': return 'transition'
    case 'outdoor': return 'outdoor'
    case 'entrance': return 'entrance'
    default: return 'waypoint'
  }
}

function mapEdgeType(type: string): NavEdgeFile['type'] {
  switch (type) {
    case 'stairs': return 'stairs'
    case 'elevator': return 'elevator'
    case 'transition': return 'transition'
    default: return 'walk'
  }
}

function buildGraphFile(artifacts: NavigationArtifacts, campusId: string, schemaVersion: string): NavigationGraphFile {
  const nodes: NavNodeFile[] = artifacts.graph.nodes.map(n => ({
    id: n.id,
    type: mapNodeType(n.type),
    lat: n.position.lat,
    lng: n.position.lng,
    floor: n.floor,
    buildingId: n.buildingId,
    label: n.label,
    properties: { ...n.properties },
  }))

  const edges: NavEdgeFile[] = artifacts.graph.edges.map(e => ({
    id: e.id,
    from: e.from,
    to: e.to,
    type: mapEdgeType(e.type),
    distance: e.distance,
    weight: e.weight,
    ...(e.routing ? { routing: e.routing } : {}),
  }))

  return {
    schemaVersion,
    campusId,
    checksum: artifacts.graph.checksum,
    nodes,
    edges,
  }
}

function buildSearchFile(artifacts: NavigationArtifacts, schemaVersion: string): SearchIndexFile | undefined {
  if (!artifacts.searchIndex) return undefined

  const entries: SearchEntryFile[] = artifacts.searchIndex.entries.map(e => ({
    id: e.id,
    label: e.label,
    type: e.type,
    ...(e.nodeId !== undefined ? { nodeId: e.nodeId } : {}),
    lat: e.position.lat,
    lng: e.position.lng,
    tags: e.tags,
    ...(e.buildingId !== undefined ? { buildingId: e.buildingId } : {}),
    ...(e.floor !== undefined ? { floor: e.floor } : {}),
    ...(e.category !== undefined ? { category: e.category } : {}),
    ...(e.floorId !== undefined ? { floorId: e.floorId } : {}),
    ...(e.source !== undefined ? { source: e.source } : {}),
    ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
    ...(e.scope !== undefined ? { scope: e.scope } : {}),
  }))

  return { schemaVersion, entries }
}

function buildSpatialFile(artifacts: NavigationArtifacts, schemaVersion: string): SpatialIndexFile | undefined {
  if (!artifacts.spatialIndex) return undefined

  return {
    schemaVersion,
    cellSize: artifacts.spatialIndex.cellSize,
    cells: { ...artifacts.spatialIndex.cells },
  }
}

function findEntranceNodeId(
  entranceId: string,
  entrancePosition: { lat: number; lng: number },
  buildingId: string,
  graphNodes: NavNodeFile[],
): string {
  const candidates = graphNodes.filter(
    n => n.buildingId === buildingId && (n.type === 'entrance' || n.type === 'outdoor'),
  )
  if (candidates.length === 1) return candidates[0].id

  const closest = candidates.reduce((best, n) => {
    const dist = Math.hypot(n.lat - entrancePosition.lat, n.lng - entrancePosition.lng)
    return dist < best.dist ? { node: n, dist } : best
  }, { node: candidates[0], dist: Infinity })
  return closest.node?.id ?? entranceId
}

function buildBuildingFile(
  artifacts: NavigationArtifacts,
  schemaVersion: string,
  graphNodes: NavNodeFile[],
): BuildingIndexFile | undefined {
  if (!artifacts.buildingIndex) return undefined

  const buildings: BuildingEntryFile[] = artifacts.buildingIndex.buildings.map(b => {
    const floorMap = new Map<number, string[]>()

    for (const node of graphNodes) {
      if (node.buildingId === b.id) {
        const ids = floorMap.get(node.floor) ?? []
        ids.push(node.id)
        floorMap.set(node.floor, ids)
      }
    }

    const floors: FloorEntryFile[] = b.floors.map((f: CoreFloorEntry) => ({
      level: f.level,
      label: f.label,
      elevation: f.elevation ?? 0,
      nodeIds: floorMap.get(f.level) ?? [],
      rooms: (f as any).rooms ?? [],
    }))

    const entrances: EntranceEntryFile[] = b.entrances.map(e => ({
      id: e.id,
      label: e.label,
      nodeId: findEntranceNodeId(e.id, e.position, b.id, graphNodes),
    }))

    return {
      id: b.id,
      name: b.name,
      code: b.code,
      category: (b as any).category,
      position: { lat: b.position.lat, lng: b.position.lng },
      footprint: (b as any).footprint,
      height: (b as any).height,
      baseElevation: (b as any).baseElevation,
      color: (b as any).color,
      floors,
      entrances,
      floorPlanUrls: (b as any).floorPlanUrls,
      nodeId: (b as any).nodeId,
      metadata: (b as any).metadata,
    }
  })

  return { schemaVersion, buildings }
}

function buildPOIFile(artifacts: NavigationArtifacts, schemaVersion: string): POIIndexFile | undefined {
  if (!artifacts.poiIndex) return undefined

  const points: POIEntryFile[] = artifacts.poiIndex.points.map(p => ({
    id: p.id,
    label: p.label,
    category: p.category,
    lat: p.position.lat,
    lng: p.position.lng,
    ...(p.nodeId !== undefined ? { nodeId: p.nodeId } : {}),
    ...(p.buildingId !== undefined ? { buildingId: p.buildingId } : {}),
    ...(p.floor !== undefined ? { floor: p.floor } : {}),
    ...(p.floorId !== undefined ? { floorId: p.floorId } : {}),
    ...(p.source !== undefined ? { source: p.source } : {}),
    ...(p.sourceId !== undefined ? { sourceId: p.sourceId } : {}),
    ...(p.geometry !== undefined ? { geometry: structuredClone(p.geometry) } : {}),
    ...(p.appearance !== undefined ? { appearance: structuredClone(p.appearance) } : {}),
    ...(p.scope !== undefined ? { scope: p.scope } : {}),
    ...(p.visibility !== undefined ? { visibility: structuredClone(p.visibility) } : {}),
    ...(p.approach !== undefined ? { approach: { mode: p.approach.mode, lat: p.approach.position.lat, lng: p.approach.position.lng } } : {}),
    properties: { ...p.properties },
  }))

  return { schemaVersion, points }
}

function buildPanoramaFile(artifacts: NavigationArtifacts, schemaVersion: string): PanoramaIndexFile | undefined {
  if (!artifacts.panoramaIndex) return undefined

  const panoramas: PanoramaEntryFile[] = artifacts.panoramaIndex.panoramas.map(p => ({
    id: p.id,
    title: p.title,
    imageAssetId: p.imageAssetId,
    buildingId: p.buildingId,
    floor: p.floor,
    lat: p.position.lat,
    lng: p.position.lng,
    heading: p.heading,
    hotspots: p.hotspots.map(h => ({
      id: h.id,
      type: h.type,
      target: h.target,
      yaw: h.yaw,
      pitch: h.pitch,
      label: h.label,
      // 360 Tour (R6.1/R6.2): information-hotspot fidelity — these were
      // previously dropped by this mapping, breaking authored content.
      ...(h.hotspotType !== undefined ? { hotspotType: h.hotspotType } : {}),
      ...(h.content !== undefined ? { content: structuredClone(h.content) } : {}),
    })) as HotspotFile[],
  }))

  return { schemaVersion, panoramas }
}

function buildMetadata(artifacts: NavigationArtifacts, graphNodes: NavNodeFile[]): PackageMetadata {
  const buildings = new Set<string>()
  const floors = new Set<string>()

  for (const node of graphNodes) {
    buildings.add(node.buildingId)
    floors.add(`${node.buildingId}:${node.floor}`)
  }

  const boundingBox = artifacts.graph.metadata.boundingBox
  const routeable = artifacts.graph.nodes.length >= 2 && graphNodes.length >= 2

  return {
    nodeCount: graphNodes.length,
    edgeCount: artifacts.graph.edges.length,
    buildingCount: buildings.size,
    floorCount: floors.size,
    boundingBox: { ...boundingBox },
    routeable,
  }
}

export function build(
  artifacts: NavigationArtifacts,
  options: PublishOptions,
): BuiltPackage {
  const graphSchema = options.schemaVersions?.graph ?? '1.0.0'
  const searchSchema = options.schemaVersions?.search ?? '1.0.0'
  const spatialSchema = options.schemaVersions?.spatial ?? '1.0.0'
  const buildingSchema = options.schemaVersions?.building ?? '1.0.0'
  const poiSchema = options.schemaVersions?.poi ?? '1.0.0'
  const panoramaSchema = options.schemaVersions?.panorama ?? '1.0.0'
  const floorGeometrySchema = options.schemaVersions?.floorGeometry ?? '1.0.0'
  const qrIndexSchema = options.schemaVersions?.qrIndex ?? '1.0.0'

  const graphFile = buildGraphFile(artifacts, options.campusId, graphSchema)
  const metadata = buildMetadata(artifacts, graphFile.nodes)

  return {
    campusId: options.campusId,
    campusName: options.campusName,
    publishedAt: options.publishedAt ?? new Date().toISOString(),
    compilerVersion: artifacts.metadata?.compilerVersion ?? '',
    revision: artifacts.metadata?.revision ?? '',
    metadata,
    graph: graphFile,
    search: buildSearchFile(artifacts, searchSchema),
    spatial: buildSpatialFile(artifacts, spatialSchema),
    buildings: buildBuildingFile(artifacts, buildingSchema, graphFile.nodes),
    poi: buildPOIFile(artifacts, poiSchema),
    panorama: buildPanoramaFile(artifacts, panoramaSchema),
    // P1-T10 (R6.1/D15): floor-geometry.json — optional file, emitted when
    // the compiler produced the artifact.
    floorGeometry: buildFloorGeometryFile(artifacts, floorGeometrySchema),
    // P1-T13 (R10.2/D16): qr-index.json — optional file, emitted when the
    // compiler produced the artifact.
    qrIndex: buildQrIndexFile(artifacts, qrIndexSchema),
    schemaVersions: {
      graph: graphSchema,
      search: searchSchema,
      spatial: spatialSchema,
      buildings: buildingSchema,
      poi: poiSchema,
      panorama: panoramaSchema,
      floorGeometry: floorGeometrySchema,
      qrIndex: qrIndexSchema,
    },
  }
}

// P1-T13 (R10.2/D16): qr-index.json file emission — mechanical mapping of
// the versioned core artifact onto the publisher file contract (typed).
function buildQrIndexFile(artifacts: NavigationArtifacts, schemaVersion: string): QrIndexFile | undefined {
  const idx = artifacts.qrIndex
  if (!idx) return undefined
  return {
    schemaVersion,
    formatVersion: idx.formatVersion,
    campusId: idx.campusId,
    checkpoints: idx.checkpoints.map(c => ({
      id: c.id,
      label: c.label,
      buildingId: c.buildingId,
      floor: c.floor,
      position: { x: c.position.x, y: c.position.y },
      code: c.code,
    })),
  }
}

// P1-T10 (R6.1/D15): floor-geometry.json file emission — mechanical mapping
// of the versioned core artifact onto the publisher file contract (no `as
// any`; every field typed).
function buildFloorGeometryFile(artifacts: NavigationArtifacts, schemaVersion: string): FloorGeometryFile | undefined {
  const fg = artifacts.floorGeometry
  if (!fg) return undefined
  return {
    schemaVersion,
    formatVersion: fg.formatVersion,
    campusId: fg.campusId,
    buildings: fg.buildings.map(b => ({
      id: b.id,
      name: b.name,
      anchor: { origin: { ...b.anchor.origin }, rotation: b.anchor.rotation },
      floors: b.floors.map(f => ({
        level: f.level,
        label: f.label,
        elevation: f.elevation,
        offset: { ...f.offset },
        rooms: f.rooms.map(r => ({ id: r.id, name: r.name, number: r.number, polygon: { points: r.polygon.points.map(p => ({ x: p.x, y: p.y })) } })),
        hallways: f.hallways.map(h => ({ id: h.id, name: h.name, polyline: { points: h.polyline.points.map(p => ({ x: p.x, y: p.y })) } })),
        staircases: f.staircases.map(s => ({ id: s.id, name: s.name, position: { ...s.position }, rotation: s.rotation, ...(s.polygon ? { polygon: { points: s.polygon.points.map(p => ({ x: p.x, y: p.y })) } } : {}) })),
        elevators: f.elevators.map(e => ({ id: e.id, name: e.name, position: { ...e.position }, rotation: e.rotation, ...(e.polygon ? { polygon: { points: e.polygon.points.map(p => ({ x: p.x, y: p.y })) } } : {}) })),
        doors: f.doors.map(d => ({ id: d.id, roomId: d.roomId, doorType: d.doorType, position: { ...d.position }, width: d.width })),
        pois: f.pois.map(p => ({ id: p.id, name: p.name, category: p.category, position: { ...p.position }, ...(resolvePoiVisibility(p).showOnMap === false ? { showOnMap: false } : {}) })),
        qrCheckpoints: f.qrCheckpoints.map(q => ({ id: q.id, label: q.label, code: q.code, position: { ...q.position } })),
      })),
    })),
  }
}
