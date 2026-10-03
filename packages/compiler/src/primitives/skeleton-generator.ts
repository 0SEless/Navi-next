import type { LatLng } from '@navi/core'
import {
  CONNECTIVITY_POSITION_TOLERANCE_METERS,
  hasSeparatedCrossingAtPosition,
  haversineDistance,
} from '@navi/core'
import type {
  SkeletonGenerator,
  NormalizedDocument,
  PrimitiveContribution,
  GenerationContext,
  PrimitiveNode,
  PrimitiveEdge,
  CompilerDiagnostic,
} from '../types'

let seqId = 0
function nextId(prefix: string): string {
  return `${prefix}-${++seqId}`
}

/**
 * Sample a polyline into waypoints at a fixed interval.
 *
 * `forcedPoints` are positions that MUST produce a waypoint (e.g. road junction
 * points shared with another road). Each forced point is projected onto the
 * nearest polyline segment and emitted as a waypoint that splits the skeleton
 * edge chain, so both roads end up with a waypoint at the exact same location
 * (the connectivity normalizer then merges them into one junction node).
 *
 * When `forcedPoints` is empty the emitted sequence is byte-identical to the
 * legacy algorithm (existing tests depend on this).
 */
function samplePolyline(
  polyline: LatLng[],
  interval: number,
  forcedPoints: LatLng[] = [],
): { waypoints: PrimitiveNode[]; edges: PrimitiveEdge[] } {
  const waypoints: PrimitiveNode[] = []
  const edges: PrimitiveEdge[] = []

  if (polyline.length === 0) return { waypoints, edges }

  // Project forced points onto the polyline: segmentIndex → sorted break list
  // (each break: distance-along-segment from segment start).
  const breaksBySegment = new Map<number, number[]>()
  if (forcedPoints.length > 0) {
    for (const fp of forcedPoints) {
      let bestSeg = -1
      let bestT = 0
      let bestDist = Infinity
      for (let i = 1; i < polyline.length; i++) {
        const a = polyline[i - 1]
        const b = polyline[i]
        const dx = b.lng - a.lng
        const dy = b.lat - a.lat
        const len2 = dx * dx + dy * dy
        if (len2 === 0) continue
        const t = Math.min(1, Math.max(0, ((fp.lng - a.lng) * dx + (fp.lat - a.lat) * dy) / len2))
        const proj = { lat: a.lat + t * dy, lng: a.lng + t * dx }
        const d = haversineDistance(fp, proj)
        if (d < bestDist) {
          bestDist = d
          bestSeg = i - 1
          bestT = t
        }
      }
      if (bestSeg >= 0) {
        const list = breaksBySegment.get(bestSeg) || []
        list.push(bestT * haversineDistance(polyline[bestSeg], polyline[bestSeg + 1]))
        breaksBySegment.set(bestSeg, list)
      }
    }
    for (const list of breaksBySegment.values()) list.sort((x, y) => x - y)
  }

  let prevId = nextId('W')
  waypoints.push({
    id: prevId,
    kind: 'waypoint',
    position: polyline[0],
    floor: 0,
    buildingId: '',
    source: { entityId: '', entityType: 'skeleton', generatorId: 'builtin:polyline-skeleton' },
  })
  let lastWaypointPos = polyline[0]

  let accumulated = 0

  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]
    const b = polyline[i]
    const segLen = haversineDistance(a, b)

    if (segLen === 0) continue

    // Interval-sampled positions (identical sequence to the legacy algorithm)
    let pos = interval - accumulated
    const events: number[] = []
    while (pos < segLen) {
      events.push(pos)
      pos += interval
    }
    accumulated = pos - segLen

    // Junction break positions on this segment
    const segBreaks = breaksBySegment.get(i - 1)
    if (segBreaks) events.push(...segBreaks)

    events.sort((x, y) => x - y)

    let prevEvent: number | null = null
    for (const ev of events) {
      if (prevEvent !== null && ev - prevEvent < 1e-6) continue // dedupe coincident events
      prevEvent = ev
      const t = ev / segLen
      const position = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
      const id = nextId('W')
      waypoints.push({
        id,
        kind: 'waypoint',
        position,
        floor: 0,
        buildingId: '',
        source: { entityId: '', entityType: 'skeleton', generatorId: 'builtin:polyline-skeleton' },
      })
      edges.push({
        id: nextId('SE'),
        kind: 'skeleton',
        from: prevId,
        to: id,
        distance: haversineDistance(lastWaypointPos, position),
        source: { entityId: '', entityType: 'skeleton', generatorId: 'builtin:polyline-skeleton' },
      })
      prevId = id
      lastWaypointPos = position
    }
  }

  if (waypoints.length > 0) {
    const lastPos = polyline[polyline.length - 1]
    if (haversineDistance(lastWaypointPos, lastPos) > 0.01) {
      const id = nextId('W')
      waypoints.push({
        id,
        kind: 'waypoint',
        position: lastPos,
        floor: 0,
        buildingId: '',
        source: { entityId: '', entityType: 'skeleton', generatorId: 'builtin:polyline-skeleton' },
      })
      edges.push({
        id: nextId('SE'),
        kind: 'skeleton',
        from: prevId,
        to: id,
        distance: haversineDistance(lastWaypointPos, lastPos),
        source: { entityId: '', entityType: 'skeleton', generatorId: 'builtin:polyline-skeleton' },
      })
    }
  }

  return { waypoints, edges }
}

/**
 * Planar segment–segment intersection. Treats (lat, lng) as a flat plane —
 * accurate enough at campus scale. Returns the intersection point or null.
 * Small epsilon tolerance includes endpoint touches (shared vertices).
 */
function segmentIntersection(a1: LatLng, a2: LatLng, b1: LatLng, b2: LatLng): LatLng | null {
  const d1x = a2.lng - a1.lng
  const d1y = a2.lat - a1.lat
  const d2x = b2.lng - b1.lng
  const d2y = b2.lat - b1.lat
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-12) return null // parallel or collinear
  const t = ((b1.lng - a1.lng) * d2y - (b1.lat - a1.lat) * d2x) / denom
  const u = ((b1.lng - a1.lng) * d1y - (b1.lat - a1.lat) * d1x) / denom
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return { lat: a1.lat + t * d1y, lng: a1.lng + t * d1x }
}

/** Dedupe points closer than `threshold` meters (keeps first). */
function dedupePoints(points: LatLng[], threshold: number): LatLng[] {
  const out: LatLng[] = []
  for (const p of points) {
    if (out.some((q) => haversineDistance(p, q) < threshold)) continue
    out.push(p)
  }
  return out
}

export class PolylineSkeletonGenerator implements SkeletonGenerator {
  readonly id = 'builtin:polyline-skeleton'

  generate(
    document: NormalizedDocument,
    context: GenerationContext,
  ): PrimitiveContribution {
    const nodes: PrimitiveNode[] = []
    const edges: PrimitiveEdge[] = []
    const diagnostics: CompilerDiagnostic[] = []
    const interval = context.nodeInterval || 2

    for (const building of document.buildings) {
      for (const floor of building.floors) {
        for (const hallway of floor.hallways) {
          const { waypoints, edges: skeletonEdges } = samplePolyline(hallway.polyline, interval)

          for (const wp of waypoints) {
            wp.floor = floor.level
            wp.buildingId = building.id
            wp.source = {
              entityId: hallway.id,
              entityType: 'hallway',
              field: 'polyline',
              generatorId: 'builtin:polyline-skeleton',
            }
          }
          for (const e of skeletonEdges) {
            e.source = {
              entityId: hallway.id,
              entityType: 'hallway',
              field: 'polyline',
              generatorId: 'builtin:polyline-skeleton',
            }
          }

          nodes.push(...waypoints)
          edges.push(...skeletonEdges)

          if (waypoints.length === 0) {
            diagnostics.push({
              severity: 'warning',
              sourceEntityId: hallway.id,
              phase: 'primitives',
              code: 'HALLWAY_EMPTY',
              message: `Hallway "${hallway.name}" produced no waypoints`,
            })
          }
        }
      }
    }

    // ── Road junctions: use canonical semantics when available ──
    // Canonical semantics from ConnectivitySemantics v1.0.0 provide authoritative
    // junction positions and separated crossing decisions. Geometric detection
    // is used only as legacy compatibility fallback.
    const junctionPointsByRoad: LatLng[][] = document.roads.map(() => [])
    let junctionCount = 0
    const semantics = document.connectivitySemantics
    // Use connectivitySemanticsVersion as the authoritative discriminator.
    // If the document has been stamped with a version, use canonical semantics.
    // If not, this is a legacy document and geometric inference is allowed.
    const isCanonicalMode = document.connectivitySemanticsVersion != null

    if (isCanonicalMode && semantics) {
      // ── Canonical semantics path ──
      // Build a road-index lookup for canonical junction positions
      const roadIndexById = new Map<string, number>()
      for (let r = 0; r < document.roads.length; r++) {
        roadIndexById.set(document.roads[r].id, r)
      }

      // For each canonical junction, add forced waypoints on all participating roads
      for (const cj of semantics.junctions) {
        // Check if this junction has a separated crossing at THE SAME POSITION.
        // Separation is position-specific: SeparatedCrossing(A,B,P1) must not
        // suppress RoadJunction(A,B,P2) when P1 and P2 are distinct locations.
        let hasSeparatedPairAtPosition = false
        for (let i = 0; i < cj.roadIds.length && !hasSeparatedPairAtPosition; i++) {
          for (let k = i + 1; k < cj.roadIds.length && !hasSeparatedPairAtPosition; k++) {
            if (hasSeparatedCrossingAtPosition(
              semantics.separatedCrossings,
              cj.roadIds[i],
              cj.roadIds[k],
              cj.position,
            )) hasSeparatedPairAtPosition = true
          }
        }
        if (hasSeparatedPairAtPosition) continue

        // Add forced waypoint on each participating road at the junction position
        for (const roadId of cj.roadIds) {
          const idx = roadIndexById.get(roadId)
          if (idx !== undefined) {
            junctionPointsByRoad[idx].push(cj.position)
            junctionCount++
          }
        }
      }

      // In canonical mode, geometry alone does NOT create connectivity.
      // Only explicit authored junctions create connections. The geometric
      // crossing detection that was here has been removed — it belongs in
      // the legacy fallback path only.

      diagnostics.push({
        severity: 'info',
        sourceEntityId: '',
        phase: 'primitives',
        code: 'CANONICAL_CONNECTIVITY_SEMANTICS',
        message: `Using canonical connectivity semantics: ${semantics.junctions.length} junction(s), ${semantics.separatedCrossings.length} separated crossing(s)`,
      })
    } else {
      // ── Legacy compatibility: geometric detection ──
      for (let i = 0; i < document.roads.length; i++) {
        for (let j = i + 1; j < document.roads.length; j++) {
          const pa = document.roads[i].polyline
          const pb = document.roads[j].polyline
          for (let s1 = 1; s1 < pa.length; s1++) {
            for (let s2 = 1; s2 < pb.length; s2++) {
              const hit = segmentIntersection(pa[s1 - 1], pa[s1], pb[s2 - 1], pb[s2])
              if (!hit) continue
              if (hasSeparatedCrossingAtPosition(
                semantics?.separatedCrossings ?? [],
                document.roads[i].id,
                document.roads[j].id,
                hit,
              )) continue
              junctionPointsByRoad[i].push(hit)
              junctionPointsByRoad[j].push(hit)
              junctionCount++
            }
          }
        }
      }

      if (junctionCount > 0) {
        diagnostics.push({
          severity: 'info',
          sourceEntityId: '',
          phase: 'primitives',
          code: 'LEGACY_CONNECTIVITY_INFERENCE_USED',
          message: `Legacy geometric connectivity inference: ${junctionCount} junction(s) detected. No explicit connectivity semantics in document.`,
        })
      }
    }

    // Explicit EntranceAccess segment targets are authored junctions on a
    // named outdoor route. Force those positions into the same road waypoint
    // chain so the stable access node emitted by canonical-access-compiler
    // merges with the road at the selected segment instead of floating beside
    // it. This is deliberately driven by route ID + saved position; there is
    // no nearest-Entrance inference here.
    const accessPointsByRoad = new Map<string, LatLng[]>()
    for (const building of document.buildings) {
      for (const floor of building.floors) {
        for (const access of floor.entranceAccess ?? []) {
          if (
            typeof access.outdoorRouteId !== 'string' ||
            access.outdoorRouteId.trim().length === 0 ||
            !access.outdoorPosition ||
            !Number.isFinite(access.outdoorPosition.lat) ||
            !Number.isFinite(access.outdoorPosition.lng)
          ) continue
          const points = accessPointsByRoad.get(access.outdoorRouteId) || []
          points.push(access.outdoorPosition)
          accessPointsByRoad.set(access.outdoorRouteId, points)
        }
      }
    }

    for (let r = 0; r < document.roads.length; r++) {
      const road = document.roads[r]
      const forced = dedupePoints([
        ...junctionPointsByRoad[r],
        ...(accessPointsByRoad.get(road.id) || []),
      ], CONNECTIVITY_POSITION_TOLERANCE_METERS)
      const { waypoints, edges: roadEdges } = samplePolyline(road.polyline, interval, forced)

      const syntheticBuildingId = '__outdoor__'
      for (const wp of waypoints) {
        wp.floor = 0
        wp.buildingId = syntheticBuildingId
        wp.source = {
          entityId: road.id,
          entityType: 'road',
          field: 'polyline',
          generatorId: 'builtin:polyline-skeleton',
        }
      }
      for (const e of roadEdges) {
        e.source = {
          entityId: road.id,
          entityType: 'road',
          field: 'polyline',
          generatorId: 'builtin:polyline-skeleton',
        }
        if (road.routing) {
          e.routing = {
            sourceRoadId: road.id,
            authoredOrientation: 'forward',
            authored: road.routing,
          }
        }
      }

      nodes.push(...waypoints)
      edges.push(...roadEdges)
    }

    if (junctionCount > 0) {
      diagnostics.push({
        severity: 'info',
        sourceEntityId: '',
        phase: 'primitives',
        code: 'ROAD_JUNCTION',
        message: `Detected ${junctionCount} road junction${junctionCount === 1 ? '' : 's'} (shared waypoints created)`,
      })
    }

    return { nodes, edges, diagnostics }
  }
}
