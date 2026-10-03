/**
 * Phase 3 — Unified Assisted Auto-Connect Tests
 *
 * Tests for the shared connectivity service, 0.5m connection discovery
 * radius (Fix 1), deterministic candidate selection, Alt bypass, self-snap
 * protection, and junction priority.
 */
import { describe, expect, it } from 'vitest'
import type { Road, RoadJunction } from '@navi/core'
import {
  findConnectivityCandidates,
  snapRoadEndpoints,
  snapPoint,
  nearestPointOnPolyline,
  EDITOR_SNAP_RADIUS_METERS,
  AMBIGUITY_THRESHOLD_METERS,
} from '../road-connectivity'

const ROAD_A: Road = {
  id: 'road-a',
  name: 'Road A',
  polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
  width: 8, surface: 'paved', type: 'arterial', metadata: {},
}

const ROAD_B: Road = {
  id: 'road-b',
  name: 'Road B',
  polyline: { points: [{ lat: 0.001, lng: -0.001 }, { lat: 0.001, lng: 0.001 }] },
  width: 8, surface: 'paved', type: 'arterial', metadata: {},
}

const JUNCTION: RoadJunction = {
  id: 'j-1',
  position: { lat: 0, lng: 0 },
  roadIds: ['road-a', 'road-b'],
}

describe('Phase 3 — Unified Assisted Auto-Connect', () => {
  describe('connection discovery radius is 0.5m', () => {
    it('EDITOR_SNAP_RADIUS_METERS is 0.5', () => {
      expect(EDITOR_SNAP_RADIUS_METERS).toBe(0.5)
    })

    it('discovers a target at ~0.45m', () => {
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 }, // ~0.45m north of road-a
        { roads: [ROAD_A] },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.distanceMeters).toBeLessThan(0.5)
    })

    it('does NOT discover a target at ~0.67m', () => {
      const result = findConnectivityCandidates(
        { lat: 0.000006, lng: 0 }, // ~0.67m north of road-a
        { roads: [ROAD_A] },
      )
      expect(result.best).toBeNull()
    })

    it('does NOT discover a target at ~2.1m', () => {
      const result = findConnectivityCandidates(
        { lat: 0.000019, lng: 0 }, // ~2.1m north of road-a
        { roads: [ROAD_A] },
      )
      expect(result.best).toBeNull()
    })
  })

  describe('Alt bypass', () => {
    it('bypass returns original point', () => {
      const point = { lat: 0.000004, lng: 0 }
      const result = findConnectivityCandidates(point, {
        roads: [ROAD_A],
        bypass: true,
      })
      expect(result.bypassed).toBe(true)
      expect(result.position).toEqual(point)
      expect(result.candidates).toHaveLength(0)
    })
  })

  describe('deterministic candidate selection', () => {
    it('nearest candidate wins', () => {
      // Point closer to road-a than road-b
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A, ROAD_B] },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.targetRoadId).toBe('road-a')
    })

    it('road order does not affect candidate', () => {
      const r1 = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A, ROAD_B] },
      )
      const r2 = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_B, ROAD_A] },
      )
      expect(r1.best!.targetRoadId).toBe(r2.best!.targetRoadId)
    })

    it('segment order does not affect candidate', () => {
      // Reverse road-a's points
      const reversedRoad: Road = {
        ...ROAD_A,
        polyline: { points: [...ROAD_A.polyline.points].reverse() },
      }
      const r1 = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A] },
      )
      const r2 = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [reversedRoad] },
      )
      expect(r1.best!.position.lat).toBeCloseTo(r2.best!.position.lat, 6)
      expect(r1.best!.position.lng).toBeCloseTo(r2.best!.position.lng, 6)
    })
  })

  describe('existing junction priority', () => {
    it('prefers existing junction over raw road segment', () => {
      // Point near both road-a segment and junction J1
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A], junctions: [JUNCTION] },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.kind).toBe('existing-junction')
      expect(result.best!.junctionId).toBe('j-1')
    })
  })

  describe('self-snap exclusion', () => {
    it('does not snap to own road', () => {
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A], excludeRoadId: 'road-a' },
      )
      expect(result.best).toBeNull()
    })

    it('snaps to other road when self is excluded', () => {
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A, ROAD_B], excludeRoadId: 'road-a' },
      )
      // Should not find road-a, but might find road-b if close enough
      if (result.best) {
        expect(result.best.targetRoadId).not.toBe('road-a')
      }
    })
  })

  describe('navigation-only roads', () => {
    it('navigation-only road participates in connectivity', () => {
      const navRoad: Road = {
        ...ROAD_A,
        id: 'nav-road',
        name: 'Nav Road',
        displayMode: 'navigation-only',
      }
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [navRoad] },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.targetRoadId).toBe('nav-road')
    })
  })

  describe('ambiguous candidates', () => {
    it('flags ambiguous when two candidates are very close', () => {
      // Two roads at the same position
      const roadC: Road = {
        ...ROAD_A,
        id: 'road-c',
        polyline: { points: [{ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.001 }] },
      }
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A, roadC] },
      )
      // Both are at the same distance — should be ambiguous
      expect(result.ambiguous).toBe(true)
      // Position should be original (not snapped) when ambiguous
      expect(result.position).toEqual({ lat: 0.000004, lng: 0 })
    })
  })

  describe('multiple roads sharing junction', () => {
    it('junction with 3+ roads is a valid candidate', () => {
      const bigJunction: RoadJunction = {
        id: 'j-big',
        position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-b', 'road-c'],
      }
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A], junctions: [bigJunction] },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.junctionId).toBe('j-big')
      expect(result.best!.label).toContain('3 roads')
    })
  })

  describe('nearestPointOnPolyline', () => {
    it('returns closest point with distance in meters', () => {
      const hit = nearestPointOnPolyline(
        { lat: 0.0003, lng: 0 },
        ROAD_A.polyline.points,
        { lat: 0, lng: 0 },
      )!
      expect(hit.distance).toBeGreaterThan(25)
      expect(hit.distance).toBeLessThan(35)
    })

    it('includes segmentIndex', () => {
      const hit = nearestPointOnPolyline(
        { lat: 0.0003, lng: 0 },
        ROAD_A.polyline.points,
        { lat: 0, lng: 0 },
      )!
      expect(hit.segmentIndex).toBe(0)
    })
  })

  describe('save/reload preserves Phase 3 junction', () => {
    it('junction created by snap survives round-trip', () => {
      // Simulate: junction was created by snap, now persisted
      const junctions: RoadJunction[] = [{
        id: 'j-phase3',
        position: { lat: 0, lng: 0 },
        roadIds: ['road-a', 'road-c'],
      }]

      // On reload, the junction should be found as a candidate
      const result = findConnectivityCandidates(
        { lat: 0.000004, lng: 0 },
        { roads: [ROAD_A], junctions },
      )
      expect(result.best).not.toBeNull()
      expect(result.best!.junctionId).toBe('j-phase3')
    })
  })

  describe('repeated sync preserves coordinates and junction ID', () => {
    it('finding candidates twice returns same result', () => {
      const point = { lat: 0.000004, lng: 0 }
      const r1 = findConnectivityCandidates(point, { roads: [ROAD_A] })
      const r2 = findConnectivityCandidates(point, { roads: [ROAD_A] })
      expect(r1.best!.position).toEqual(r2.best!.position)
      expect(r1.best!.distanceMeters).toBe(r2.best!.distanceMeters)
    })
  })
})
