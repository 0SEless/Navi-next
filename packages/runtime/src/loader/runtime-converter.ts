import type {
  NavigationGraphFile,
  NavNodeFile,
  NavEdgeFile,
  SearchIndexFile,
  SearchEntryFile,
  BuildingIndexFile,
  BuildingEntryFile,
  EntranceEntryFile,
  FloorEntryFile,
  POIIndexFile,
  POIEntryFile,
 PanoramaIndexFile,
  PanoramaEntryFile,
  QrIndexFile,
  QrIndex,
  HotspotFile,
  FloorGeometryFile,
} from '@navi/core'
import type {
  NavigationGraph,
  NavNode,
  NavEdge,
  SearchIndex,
  SearchEntry,
  BuildingIndex,
  BuildingEntry,
  FloorEntry,
  POIIndex,
  POI,
  PanoramaIndex,
  PanoramaEntry,
  HotspotEntry,
  BoundingBox,
  FloorGeometryArtifact,
} from '@navi/core'

function computeBoundingBox(nodes: NavNodeFile[]): BoundingBox {
  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity
  for (const n of nodes) {
    if (n.lat < minLat) minLat = n.lat
    if (n.lat > maxLat) maxLat = n.lat
    if (n.lng < minLng) minLng = n.lng
    if (n.lng > maxLng) maxLng = n.lng
  }
  return { minLat, maxLat, minLng, maxLng }
}

function toNavNode(n: NavNodeFile): NavNode {
  return {
    id: n.id,
    label: n.label ?? '',
    type: n.type as NavNode['type'],
    position: { lat: n.lat, lng: n.lng },
    floor: n.floor,
    buildingId: n.buildingId,
    properties: n.properties ? { ...n.properties } : {},
  }
}

function toNavEdge(e: NavEdgeFile): NavEdge {
  const type = e.type === 'escalator' || e.type === 'ramp' ? 'walk' as const : e.type as NavEdge['type']
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    type,
    distance: e.distance,
    weight: e.weight,
    ...(e.routing ? { routing: e.routing } : {}),
  }
}

function toSearchEntry(e: SearchEntryFile): SearchEntry {
  return {
    id: e.id,
    label: e.label,
    type: e.type,
    position: { lat: e.lat, lng: e.lng },
    tags: e.tags,
    ...(e.nodeId !== undefined ? { nodeId: e.nodeId } : {}),
    ...(e.buildingId !== undefined ? { buildingId: e.buildingId } : {}),
    ...(e.floor !== undefined ? { floor: e.floor } : {}),
    ...(e.category !== undefined ? { category: e.category } : {}),
    ...(e.floorId !== undefined ? { floorId: e.floorId } : {}),
    ...(e.source !== undefined ? { source: e.source } : {}),
    ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
    ...(e.scope !== undefined ? { scope: e.scope } : {}),
  }
}

function toFloorEntry(f: FloorEntryFile): FloorEntry {
  return {
    level: f.level,
    label: f.label,
    elevation: f.elevation ?? 0,
    rooms: (f.rooms ?? f.nodeIds.map(id => ({ id, name: '', number: '' }))).map(r => ({
      id: r.id,
      name: r.name,
      number: r.number,
      nodeId: r.id,
    })),
  }
}

function toBuildingEntry(b: BuildingEntryFile): BuildingEntry {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    category: b.category ?? '',
    position: b.position,
    floors: b.floors.map(toFloorEntry),
    entrances: b.entrances.map((e: EntranceEntryFile) => ({
      id: e.id,
      label: e.label,
      position: { lat: 0, lng: 0 },
    })),
    footprint: b.footprint,
    color: b.color,
    height: b.height,
    baseElevation: b.baseElevation,
    nodeId: b.nodeId ?? '',
    metadata: b.metadata,
    floorPlanUrls: b.floorPlanUrls,
    floorPlanVisuals: b.floorPlanVisuals,
  }
}

function toPOI(p: POIEntryFile): POI {
  return {
    id: p.id,
    label: p.label,
    category: p.category,
    position: { lat: p.lat, lng: p.lng },
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
    ...(p.approach !== undefined ? { approach: { mode: p.approach.mode, position: { lat: p.approach.lat, lng: p.approach.lng } } } : {}),
    properties: p.properties,
  }
}

export function toRuntimeGraph(file: NavigationGraphFile): NavigationGraph {
  const nodes = file.nodes.map(toNavNode)
  return {
    version: file.schemaVersion,
    campusId: file.campusId,
    createdAt: '',
    checksum: file.checksum,
    nodes,
    edges: file.edges.map(toNavEdge),
    metadata: {
      nodeCount: nodes.length,
      edgeCount: file.edges.length,
      buildings: 0,
      floors: 0,
      boundingBox: computeBoundingBox(file.nodes),
    },
  }
}

export function toRuntimeSearch(file: SearchIndexFile): SearchIndex {
  return { version: file.schemaVersion, entries: file.entries.map(toSearchEntry) }
}

export function toRuntimeBuildings(file: BuildingIndexFile): BuildingIndex {
  return { version: file.schemaVersion, buildings: file.buildings.map(toBuildingEntry) }
}

export function toRuntimePOI(file: POIIndexFile): POIIndex {
  return { version: file.schemaVersion, points: file.points.map(toPOI) }
}

function toHotspot(h: HotspotFile): HotspotEntry {
  return {
    id: h.id,
    type: h.type,
    target: h.target,
    yaw: h.yaw,
    pitch: h.pitch,
    label: h.label,
    hotspotType: h.hotspotType,
    content: h.content,
  }
}

function toPanoramaEntry(p: PanoramaEntryFile): PanoramaEntry {
  return {
    id: p.id,
    title: p.title,
    imageAssetId: p.imageAssetId,
    buildingId: p.buildingId,
    floor: p.floor,
    position: { lat: p.lat, lng: p.lng },
    heading: p.heading,
    hotspots: p.hotspots.map(toHotspot),
  }
}

export function toRuntimePanorama(file: PanoramaIndexFile): PanoramaIndex {
  return { version: file.schemaVersion, panoramas: file.panoramas.map(toPanoramaEntry) }
}

// P1-T13 (R10.2/D16): qr-index.json → runtime QrIndex (positions stay
// building-local meters — world derivation happens at consumption).
export function toRuntimeQrIndex(file: QrIndexFile): QrIndex {
  return {
    schemaVersion: 1,
    formatVersion: 0,
    campusId: file.campusId,
    checkpoints: file.checkpoints.map(c => ({
      id: c.id,
      label: c.label,
      buildingId: c.buildingId,
      floor: c.floor,
      position: { x: c.position.x, y: c.position.y },
      code: c.code,
    })),
  }
}

// P1.5 (R6.1/D15): floor-geometry.json → runtime FloorGeometryArtifact
// (structural pass-through — file and artifact schemas are equivalent;
// schemaVersion narrowed from string to number for the runtime contract).
export function toRuntimeFloorGeometry(file: FloorGeometryFile): FloorGeometryArtifact {
  return {
    schemaVersion: parseInt(file.schemaVersion, 10) || 1,
    formatVersion: file.formatVersion,
    campusId: file.campusId,
    buildings: file.buildings.map(b => ({
      id: b.id,
      name: b.name,
      anchor: { origin: b.anchor.origin, rotation: b.anchor.rotation },
      floors: b.floors.map(f => ({
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
      })),
    })),
  }
}
