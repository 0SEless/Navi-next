import type {
  LatLng,
  NavEdge,
  NavNode,
  NavigationGraph,
  POI,
  POIIndex,
  RuntimePOIGeometry,
} from '@navi/core'
import { SpatialQueryService } from '@navi/core'
import {
  STANDARD_PEDESTRIAN_ELIGIBILITY_V1,
  isTraversalEligible,
} from './edge-eligibility'
import type {
  DestinationRequest,
  PoiApproachCandidate,
  PoiDestinationFailure,
  PoiDestinationOverlay,
  PoiDestinationResolution,
  PoiOverlayEdgePolicy,
  ResolvedPoiDestination,
} from './destination'

export const MAX_POI_APPROACH_DISTANCE_METERS = 50

const PROJECTION_ENDPOINT_EPSILON = 1e-7

interface ValidatedGeometry {
  geometry: RuntimePOIGeometry
  supportPoints: LatLng[]
  referencePosition: LatLng
}

interface CandidateEvaluation {
  candidate: PoiApproachCandidate
  tieKind: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidPosition(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false
  const position = value as { lat?: unknown; lng?: unknown }
  return isFiniteNumber(position.lat)
    && isFiniteNumber(position.lng)
    && position.lat >= -90
    && position.lat <= 90
    && position.lng >= -180
    && position.lng <= 180
}

function samePosition(left: LatLng, right: LatLng): boolean {
  return left.lat === right.lat && left.lng === right.lng
}

function dedupeClosingPoint(points: LatLng[]): LatLng[] {
  if (points.length > 1 && samePosition(points[0], points[points.length - 1])) {
    return points.slice(0, -1)
  }
  return points.slice()
}

function centroid(points: LatLng[]): LatLng {
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  )
  return { lat: sum.lat / points.length, lng: sum.lng / points.length }
}

function circleBoundaryPoint(center: LatLng, radiusMeters: number, bearingDegrees: number): LatLng {
  const bearing = bearingDegrees * Math.PI / 180
  const metersPerDegreeLat = 111_320
  const metersPerDegreeLng = Math.max(Math.cos(center.lat * Math.PI / 180) * metersPerDegreeLat, 1)
  return {
    lat: center.lat + Math.cos(bearing) * radiusMeters / metersPerDegreeLat,
    lng: center.lng + Math.sin(bearing) * radiusMeters / metersPerDegreeLng,
  }
}

function validateGeometry(poi: POI): ValidatedGeometry | null {
  if (!isValidPosition(poi.position)) return null

  const geometry = poi.geometry
  if (!geometry) {
    return {
      geometry: { type: 'point', position: poi.position },
      supportPoints: [poi.position],
      referencePosition: poi.position,
    }
  }

  if (geometry.type === 'point') {
    return isValidPosition(geometry.position)
      ? { geometry, supportPoints: [geometry.position], referencePosition: geometry.position }
      : null
  }

  if (geometry.type === 'circle') {
    if (!isValidPosition(geometry.center) || !isFiniteNumber(geometry.radius) || geometry.radius < 0) return null
    return {
      geometry,
      supportPoints: [
        geometry.center,
        circleBoundaryPoint(geometry.center, geometry.radius, 0),
        circleBoundaryPoint(geometry.center, geometry.radius, 90),
        circleBoundaryPoint(geometry.center, geometry.radius, 180),
        circleBoundaryPoint(geometry.center, geometry.radius, 270),
      ],
      referencePosition: geometry.center,
    }
  }

  const points = dedupeClosingPoint(geometry.points)
  const minimumPoints = geometry.type === 'rectangle' ? 4 : 3
  if (points.length < minimumPoints || !points.every(isValidPosition)) return null
  return {
    geometry: { ...geometry, points },
    supportPoints: [...points, centroid(points)],
    referencePosition: centroid(points),
  }
}

function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]
    const prior = polygon[previous]
    const crosses = (current.lat > point.lat) !== (prior.lat > point.lat)
      && point.lng < ((prior.lng - current.lng) * (point.lat - current.lat)) / (prior.lat - current.lat) + current.lng
    if (crosses) inside = !inside
  }
  return inside
}

function distanceToBoundary(point: LatLng, points: LatLng[], spatial: SpatialQueryService): number {
  let best = Infinity
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const projected = spatial.nearestPointOnSegment(point, points[index], next)
    best = Math.min(best, spatial.distanceMeters(point, projected))
  }
  return best
}

function distanceToGeometry(point: LatLng, geometry: RuntimePOIGeometry, spatial: SpatialQueryService): number {
  if (geometry.type === 'point') return spatial.distanceMeters(point, geometry.position)
  if (geometry.type === 'circle') {
    return Math.max(0, spatial.distanceMeters(point, geometry.center) - geometry.radius)
  }
  if (pointInPolygon(point, geometry.points)) return 0
  return distanceToBoundary(point, geometry.points, spatial)
}

function projectionParameter(point: LatLng, from: LatLng, to: LatLng): number {
  const latitudeScale = 111_320
  const longitudeScale = Math.max(Math.cos(((from.lat + to.lat) / 2) * Math.PI / 180) * latitudeScale, 1)
  const px = point.lng * longitudeScale
  const py = point.lat * latitudeScale
  const ax = from.lng * longitudeScale
  const ay = from.lat * latitudeScale
  const bx = to.lng * longitudeScale
  const by = to.lat * latitudeScale
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return 0
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
}

function isOutdoorNode(node: NavNode): boolean {
  return node.type === 'outdoor' || (node.buildingId === '' && node.floor === 0)
}

function cloneEdge(edge: NavEdge): NavEdge {
  return {
    ...edge,
    ...(edge.routing
      ? { routing: { ...edge.routing, authored: { ...edge.routing.authored } } }
      : {}),
  }
}

function cloneGraph(graph: NavigationGraph): NavigationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, properties: { ...node.properties } })),
    edges: graph.edges.map(cloneEdge),
    metadata: { ...graph.metadata, boundingBox: { ...graph.metadata.boundingBox } },
  }
}

function updateMetadata(graph: NavigationGraph): void {
  graph.metadata = {
    ...graph.metadata,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  }
}

function temporaryTargetId(graph: NavigationGraph, poiId: string): string {
  const base = `__navi_poi_target__${encodeURIComponent(poiId)}`
  let candidate = base
  let suffix = 1
  const ids = new Set(graph.nodes.map((node) => node.id))
  while (ids.has(candidate)) {
    candidate = `${base}::${suffix}`
    suffix += 1
  }
  return candidate
}

function scopedEdge(
  edge: NavEdge,
  nodeById: ReadonlyMap<string, NavNode>,
  poi: POI,
): boolean {
  const from = nodeById.get(edge.from)
  const to = nodeById.get(edge.to)
  if (!from || !to) return false
  if (!isTraversalEligible(edge, edge.from, STANDARD_PEDESTRIAN_ELIGIBILITY_V1)
    && !isTraversalEligible(edge, edge.to, STANDARD_PEDESTRIAN_ELIGIBILITY_V1)) return false

  if (poi.buildingId) {
    if (from.buildingId !== poi.buildingId || to.buildingId !== poi.buildingId) return false
    if (poi.floor !== undefined && (from.floor !== poi.floor || to.floor !== poi.floor)) return false
    return true
  }

  return isOutdoorNode(from) && isOutdoorNode(to)
}

function chooseCandidate(
  graph: NavigationGraph,
  poi: POI,
  geometry: ValidatedGeometry,
  anchorOverride: LatLng | null = null,
): { candidate: PoiApproachCandidate; tooFar: boolean } | null {
  const spatial = new SpatialQueryService()
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const eligibleEdges = graph.edges
    .filter((edge) => scopedEdge(edge, nodeById, poi))
    .sort((left, right) => left.id.localeCompare(right.id))
  const eligibleNodeIds = new Set<string>()
  for (const edge of eligibleEdges) {
    eligibleNodeIds.add(edge.from)
    eligibleNodeIds.add(edge.to)
  }

  // A resolved preferred anchor ranks candidates by distance to the anchor
  // instead of the generic shape support points. Topology is untouched.
  const supportPoints = anchorOverride ? [anchorOverride] : geometry.supportPoints
  const distanceFor = (point: LatLng): number => anchorOverride
    ? spatial.distanceMeters(point, anchorOverride)
    : distanceToGeometry(point, geometry.geometry, spatial)

  const candidates: CandidateEvaluation[] = []
  for (const nodeId of [...eligibleNodeIds].sort((left, right) => left.localeCompare(right))) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    candidates.push({
      tieKind: 0,
      candidate: {
        kind: 'node',
        networkId: node.id,
        position: node.position,
        distanceMeters: distanceFor(node.position),
        floor: node.floor,
        buildingId: node.buildingId,
      },
    })
  }

  for (const edge of eligibleEdges) {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (!from || !to) continue
    let bestForEdge: CandidateEvaluation | null = null
    for (const supportPoint of supportPoints) {
      const projection = spatial.nearestPointOnSegment(supportPoint, from.position, to.position)
      const parameter = projectionParameter(projection, from.position, to.position)
      if (parameter <= PROJECTION_ENDPOINT_EPSILON || parameter >= 1 - PROJECTION_ENDPOINT_EPSILON) continue
      const distanceMeters = distanceFor(projection)
      const candidate: PoiApproachCandidate = {
        kind: 'edge',
        networkId: edge.id,
        position: projection,
        distanceMeters,
        floor: from.floor,
        buildingId: from.buildingId,
        projection: parameter,
        edge,
      }
      const evaluation = { tieKind: 1, candidate }
      if (!bestForEdge || compareCandidates(evaluation, bestForEdge) < 0) bestForEdge = evaluation
    }
    if (bestForEdge) candidates.push(bestForEdge)
  }

  if (candidates.length === 0) return null
  candidates.sort(compareCandidates)
  const best = candidates[0].candidate
  return { candidate: best, tooFar: best.distanceMeters > MAX_POI_APPROACH_DISTANCE_METERS }
}

function compareCandidates(left: CandidateEvaluation, right: CandidateEvaluation): number {
  const distanceDelta = left.candidate.distanceMeters - right.candidate.distanceMeters
  if (Math.abs(distanceDelta) > 1e-7) return distanceDelta
  if (left.tieKind !== right.tieKind) return left.tieKind - right.tieKind
  const networkDelta = left.candidate.networkId.localeCompare(right.candidate.networkId)
  if (networkDelta !== 0) return networkDelta
  return (left.candidate.projection ?? 0) - (right.candidate.projection ?? 0)
}

function buildOverlay(
  graph: NavigationGraph,
  candidate: PoiApproachCandidate,
  poi: POI,
): PoiDestinationOverlay {
  const overlayGraph = cloneGraph(graph)
  const targetId = temporaryTargetId(graph, poi.id)
  const targetNode: NavNode = {
    id: targetId,
    label: poi.label,
    type: 'poi',
    position: candidate.position,
    floor: candidate.floor,
    buildingId: candidate.buildingId,
    properties: { temporaryPoiTarget: true, poiId: poi.id },
  }
  overlayGraph.nodes.push(targetNode)
  const edgePolicies = new Map<string, PoiOverlayEdgePolicy>()

  if (candidate.kind === 'node') {
    overlayGraph.edges.push({
      id: `${targetId}::connector`,
      from: candidate.networkId,
      to: targetId,
      type: 'walk',
      distance: 0,
      weight: 0,
    })
  } else {
    const original = candidate.edge!
    overlayGraph.edges = overlayGraph.edges.filter((edge) => edge.id !== original.id)
    const parameter = candidate.projection ?? 0.5
    const firstId = `${targetId}::segment::a`
    const secondId = `${targetId}::segment::b`
    overlayGraph.edges.push(
      {
        ...cloneEdge(original),
        id: firstId,
        from: original.from,
        to: targetId,
        distance: original.distance * parameter,
        weight: original.weight * parameter,
      },
      {
        ...cloneEdge(original),
        id: secondId,
        from: targetId,
        to: original.to,
        distance: original.distance * (1 - parameter),
        weight: original.weight * (1 - parameter),
      },
    )
    edgePolicies.set(firstId, {
      originalEdge: original,
      ratio: parameter,
      segmentFromNodeId: original.from,
      segmentToNodeId: targetId,
    })
    edgePolicies.set(secondId, {
      originalEdge: original,
      ratio: 1 - parameter,
      segmentFromNodeId: targetId,
      segmentToNodeId: original.to,
    })
  }

  updateMetadata(overlayGraph)
  return { graph: overlayGraph, temporaryRoutingTargetId: targetId, candidate, edgePolicies }
}

function failure(code: PoiDestinationFailure['code'], message: string): PoiDestinationFailure {
  return { ok: false, code, message }
}

export function resolvePoiDestination(
  graph: NavigationGraph,
  poiIndex: POIIndex | undefined,
  request: DestinationRequest,
): PoiDestinationResolution {
  if (!poiIndex) return failure('POI_NOT_FOUND', `POI ${request.poiId} was not found`)
  const poi = poiIndex.points.find((point) => point.id === request.poiId)
  if (!poi) return failure('POI_NOT_FOUND', `POI ${request.poiId} was not found`)

  const geometry = validateGeometry(poi)
  if (!geometry) return failure('POI_INVALID_DESTINATION_GEOMETRY', `POI ${request.poiId} has invalid destination geometry`)

  // Preferred approach: use the resolved anchor (if any) as the ranking
  // reference; topology stays isolated in the request-local overlay.
  const anchorOverride = poi.approach?.mode === 'preferred' && isValidPosition(poi.approach.position)
    ? poi.approach.position
    : null

  const selected = chooseCandidate(graph, poi, geometry, anchorOverride)
  if (!selected) return failure('POI_NO_ELIGIBLE_APPROACH', `POI ${request.poiId} has no eligible approach network`)
  if (selected.tooFar) return failure('POI_APPROACH_TOO_FAR', `POI ${request.poiId} is farther than the supported approach radius`)

  const overlay = buildOverlay(graph, selected.candidate, poi)
  const resolution: ResolvedPoiDestination = {
    poi,
    referencePosition: geometry.referencePosition,
    candidate: selected.candidate,
    temporaryRoutingTargetId: overlay.temporaryRoutingTargetId,
    overlay,
  }
  return { ok: true, resolution }
}
