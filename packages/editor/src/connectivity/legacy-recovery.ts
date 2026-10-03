/**
 * Fix 2 — Legacy connection recovery.
 *
 * Older maps were authored with implicit (geometric) connectivity: roads
 * visually meet but carry no persistent RoadJunction. This module detects
 * those likely-intended connections and CLASSIFIES them so an admin can
 * review and approve them. Nothing is mutated here.
 *
 * Rules:
 *  - Detection only; no automatic connection, no geometric inference.
 *  - Already-authorized connections (RoadJunction) are never proposed.
 *  - Explicit Keep Separate decisions (SeparatedCrossing) are respected.
 *  - Effectively coincident contacts (≤ 0.05 m) are classified high
 *    confidence; anything up to the 0.5 m discovery radius is reviewable.
 */

import type { CampusDocument, LatLng, Road } from '@navi/core'
import { haversine, ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import { nearestPointOnPolyline } from '../commands/road-connectivity'

export type LegacyConnectionKind = 'endpoint-endpoint' | 'endpoint-segment'
export type LegacyConnectionConfidence = 'high' | 'review'

export interface LegacyConnectionCandidate {
  /** Deterministic id: kind|roadA|pointIndex|roadB|lat|lng */
  id: string
  kind: LegacyConnectionKind
  /** [road whose endpoint moves to connect, target road] */
  roadIds: [string, string]
  /** Endpoint index on roadIds[0]. */
  pointIndex: number
  position: LatLng
  distanceMeters: number
  confidence: LegacyConnectionConfidence
}

const HIGH_CONFIDENCE_METERS = 0.05

export interface DetectLegacyConnectionsOptions {
  /** Review ceiling; defaults to the 0.5 m discovery radius. */
  maxDistanceMeters?: number
}

function candidateKey(kind: LegacyConnectionKind, aId: string, pointIndex: number, bId: string, position: LatLng): string {
  return `${kind}|${aId}|${pointIndex}|${bId}|${position.lat.toFixed(6)}|${position.lng.toFixed(6)}`
}

function alreadyAuthorized(
  document: CampusDocument,
  roadAId: string,
  roadBId: string,
  position: LatLng,
): boolean {
  const junction = (document.roadJunctions ?? []).some(j =>
    j.roadIds.includes(roadAId) &&
    j.roadIds.includes(roadBId) &&
    haversine(j.position, position) <= ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters,
  )
  if (junction) return true
  return (document.separatedCrossings ?? []).some(sc =>
    sc.roadIds.includes(roadAId) &&
    sc.roadIds.includes(roadBId) &&
    haversine(sc.position, position) <= ROUTE_NETWORK_THRESHOLDS.dedupeMergeMeters,
  )
}

function endpointIndexes(road: Road): number[] {
  const count = road.polyline.points.length
  if (count < 2) return []
  return [0, count - 1]
}

/**
 * Detect legacy intended connections across authored roads. Pure read-only scan.
 */
export function detectLegacyConnections(
  document: CampusDocument,
  options: DetectLegacyConnectionsOptions = {},
): LegacyConnectionCandidate[] {
  const maxDistance = options.maxDistanceMeters ?? ROUTE_NETWORK_THRESHOLDS.snapRadiusMeters
  const roads = document.roads.filter(r => r.polyline.points.length >= 2)
  const byKey = new Map<string, LegacyConnectionCandidate>()

  const add = (
    kind: LegacyConnectionKind,
    roadA: Road,
    pointIndex: number,
    roadB: Road,
    position: LatLng,
    distanceMeters: number,
  ) => {
    if (alreadyAuthorized(document, roadA.id, roadB.id, position)) return
    const key = candidateKey(kind, roadA.id, pointIndex, roadB.id, position)
    if (byKey.has(key)) return
    byKey.set(key, {
      id: key,
      kind,
      roadIds: [roadA.id, roadB.id],
      pointIndex,
      position: { ...position },
      distanceMeters,
      confidence: distanceMeters <= HIGH_CONFIDENCE_METERS ? 'high' : 'review',
    })
  }

  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const roadA = roads[i]
      const roadB = roads[j]
      const aEnds = endpointIndexes(roadA)
      const bEnds = endpointIndexes(roadB)

      // 1. Endpoint ↔ endpoint
      for (const ai of aEnds) {
        for (const bi of bEnds) {
          const d = haversine(roadA.polyline.points[ai], roadB.polyline.points[bi])
          if (d <= maxDistance) {
            add('endpoint-endpoint', roadA, ai, roadB, roadB.polyline.points[bi], d)
          }
        }
      }

      // 2. Endpoint A ↔ interior of B
      for (const ai of aEnds) {
        const point = roadA.polyline.points[ai]
        const hit = nearestPointOnPolyline(point, roadB.polyline.points, point)
        if (!hit || hit.distance > maxDistance) continue
        const bStart = roadB.polyline.points[0]
        const bEnd = roadB.polyline.points[roadB.polyline.points.length - 1]
        const interior = haversine(hit.point, bStart) > HIGH_CONFIDENCE_METERS && haversine(hit.point, bEnd) > HIGH_CONFIDENCE_METERS
        if (interior) add('endpoint-segment', roadA, ai, roadB, hit.point, hit.distance)
      }

      // 3. Endpoint B ↔ interior of A
      for (const bi of bEnds) {
        const point = roadB.polyline.points[bi]
        const hit = nearestPointOnPolyline(point, roadA.polyline.points, point)
        if (!hit || hit.distance > maxDistance) continue
        const aStart = roadA.polyline.points[0]
        const aEnd = roadA.polyline.points[roadA.polyline.points.length - 1]
        const interior = haversine(hit.point, aStart) > HIGH_CONFIDENCE_METERS && haversine(hit.point, aEnd) > HIGH_CONFIDENCE_METERS
        if (interior) add('endpoint-segment', roadB, bi, roadA, hit.point, hit.distance)
      }
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1
    return a.distanceMeters - b.distanceMeters
  })
}

/**
 * Map an approved recovery candidate to the same canonical connection request
 * used by new-road authoring. Applying it creates/merges an authored
 * RoadJunction — never geometric inference.
 */
export function buildRecoveryConnectionRequest(candidate: LegacyConnectionCandidate): {
  pointIndex: number
  action: 'connect'
  kind: 'road-endpoint' | 'road-segment'
  targetRoadId: string
  position: LatLng
} {
  return {
    pointIndex: candidate.pointIndex,
    action: 'connect',
    kind: candidate.kind === 'endpoint-endpoint' ? 'road-endpoint' : 'road-segment',
    targetRoadId: candidate.roadIds[1],
    position: { ...candidate.position },
  }
}
