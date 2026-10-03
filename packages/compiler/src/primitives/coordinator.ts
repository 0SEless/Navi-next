import type {
  NormalizedDocument,
  PrimitiveGraph,
  CompilerDiagnostic,
  GenerationContext,
  PrimitiveNode,
  PrimitiveEdge,
} from '../types'
import { extractRooms } from './room-extractor'
import { extractDoors } from './door-extractor'
import { extractAnchors } from './anchor-extractor'
import { extractConnectors } from './connector-extractor'
import { extractEntrances } from './entrance-extractor'
import { PolylineSkeletonGenerator } from './skeleton-generator'
import { extractRouteNetwork } from './route-network-extractor'
import { assessRouteNetworkAuthority } from './route-network-authority'
import { compileCanonicalAccess } from './canonical-access-compiler'
import type { CanonicalAccessResult } from './canonical-access-compiler'
import { connectPrimitives } from './connector'
import { elevationKey } from './vertical-distance'

/**
 * PrimitiveCoordinator
 *
 * Orchestrates Stage 2 (Generate Primitives):
 *   Phase 2.1 — Extract Sources (extractors, independent)
 *   Phase 2.2 — Skeletonize (polyline sampling)
 *   Phase 2.3 — Connect & Resolve (nearest-waypoint, pairing, portal edges)
 *
 * Extractor invocation order: Room → Door → Anchor → Connector → Entrance.
 * Order is deterministic — changing it would change node IDs.
 */
export function generatePrimitives(
  document: NormalizedDocument,
  context: GenerationContext,
): PrimitiveGraph {
  const allDiagnostics: CompilerDiagnostic[] = []
  let allNodes: PrimitiveNode[] = []
  let allEdges: PrimitiveEdge[] = []

  const extractors = [
    { name: 'room', fn: extractRooms },
    { name: 'door', fn: extractDoors },
    { name: 'anchor', fn: extractAnchors },
    { name: 'connector', fn: extractConnectors },
    { name: 'entrance', fn: extractEntrances },
  ]

  // Phase 2.1: Run extractors, merge contributions
  let doorSpecs: Array<{ roomId: string; doorId: string; position: { lat: number; lng: number }; floor: number; buildingId: string; width?: number; properties?: Record<string, unknown> }> = []

  for (const { name, fn } of extractors) {
    const contribution = fn(document, context)
    if (contribution.nodes) allNodes.push(...contribution.nodes)
    if (contribution.edges) allEdges.push(...contribution.edges)
    if (contribution.diagnostics) allDiagnostics.push(...contribution.diagnostics)
    if (contribution.doorSpecs) doorSpecs = contribution.doorSpecs
  }

  // Phase 2.2: Per-floor authority selection
  // Floors with USABLE routeNetwork → canonical extractor
  // Floors without → legacy skeleton generator
  const canonicalContrib = extractRouteNetwork(document)
  if (canonicalContrib.nodes) allNodes.push(...canonicalContrib.nodes)
  if (canonicalContrib.edges) allEdges.push(...canonicalContrib.edges)
  if (canonicalContrib.diagnostics) allDiagnostics.push(...canonicalContrib.diagnostics)

  // Phase 2.2a: Canonical access compilation (RoomAccess, EntranceAccess, VerticalTransitions)
  // Runs AFTER route-network extraction (needs compiled R- nodes).
  // Returns canonical sets for legacy suppression in Phase 2.3.
  const canonicalAccessContrib = compileCanonicalAccess(document, allNodes)
  if (canonicalAccessContrib.nodes) allNodes.push(...canonicalAccessContrib.nodes)
  if (canonicalAccessContrib.edges) allEdges.push(...canonicalAccessContrib.edges)
  if (canonicalAccessContrib.diagnostics) allDiagnostics.push(...canonicalAccessContrib.diagnostics)
  const canonicalAccess: CanonicalAccessResult = canonicalAccessContrib.canonicalAccess

  // Filter document for skeleton: remove hallways from floors with USABLE routeNetwork
  const usableFloorIds = new Set<string>()
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      if (assessRouteNetworkAuthority(floor) === 'USABLE') {
        usableFloorIds.add(floor.id)
      }
    }
  }

  const filteredDocument: NormalizedDocument = {
    buildings: document.buildings.map(b => ({
      ...b,
      floors: b.floors.map(f => ({
        ...f,
        hallways: usableFloorIds.has(f.id) ? [] : f.hallways,
      })),
    })),
    roads: document.roads,
    connectivitySemantics: document.connectivitySemantics,
    connectivitySemanticsVersion: document.connectivitySemanticsVersion,
  }

  const skeleton = new PolylineSkeletonGenerator()
  const skeletonContrib = skeleton.generate(filteredDocument, context)
  if (skeletonContrib.nodes) allNodes.push(...skeletonContrib.nodes)
  if (skeletonContrib.edges) allEdges.push(...skeletonContrib.edges)
  if (skeletonContrib.diagnostics) allDiagnostics.push(...skeletonContrib.diagnostics)

  // Build partial PrimitiveGraph for Phase 2.3
  const primitiveGraph: PrimitiveGraph = {
    nodes: allNodes,
    edges: allEdges,
    metadata: {
      campusId: '',
      buildingCount: document.buildings.length,
      floorCount: document.buildings.reduce((s, b) => s + b.floors.length, 0),
      generatedAt: 0,
    },
    diagnostics: allDiagnostics,
  }

  // Phase 2.3: Connect & Resolve
  //
  // Road links: reverse index entranceId → roadId built from NormalizedRoad.connectorEntranceId.
  // The forward link (entrance.connectorRoadId) travels on the portal node itself.
  const roadLinks = new Map<string, string>()
  for (const road of document.roads) {
    if (road.connectorEntranceId) roadLinks.set(road.connectorEntranceId, road.id)
  }
  // P1-T17: authored floor elevations for vertical-edge distances — keyed
  // `${buildingId}:${level}` (elevationKey), consumed by the single
  // verticalEdgeDistance helper inside connectPrimitives.
  const elevations = new Map<string, number>()
  for (const building of document.buildings) {
    for (const floor of building.floors) {
      elevations.set(elevationKey(building.id, floor.level), floor.elevation)
    }
  }
  const connection = connectPrimitives(
    primitiveGraph,
    doorSpecs,
    roadLinks,
    context.maxEntranceRoadDistance ?? 50,
    elevations,
    canonicalAccess,
  )
  allEdges.push(...connection.edges)
  allDiagnostics.push(...connection.diagnostics)

  // Count buildings/floors from the document
  const buildingIds = new Set(document.buildings.map(b => b.id))
  const floorKeys = new Set<string>()
  for (const b of document.buildings) {
    for (const f of b.floors) floorKeys.add(`${b.id}-${f.level}`)
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    metadata: {
      campusId: '',
      buildingCount: buildingIds.size,
      floorCount: floorKeys.size,
      generatedAt: 0,
    },
    diagnostics: allDiagnostics,
  }
}
