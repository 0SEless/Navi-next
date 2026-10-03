'use client'

/**
 * Phase 3C — Snap Preview Overlay
 *
 * Shows a lightweight preview of snap candidates during road drawing.
 * Displays:
 * - A marker at the candidate snap position
 * - A highlight on the target road segment
 * - "Connect to: <name>" label when candidate exists
 *
 * Hides when:
 * - No candidates within radius
 * - Alt is held (bypass mode)
 * - Ambiguous (multiple close candidates)
 */

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import { findConnectivityCandidates, EDITOR_SNAP_RADIUS_METERS } from '@navi/editor'
import type { Road, RoadJunction } from '@navi/core'

const SRC_SNAP_PREVIEW = 's-snap-preview'
const LYR_SNAP_MARKER = 'snap-preview-marker'
const LYR_SNAP_LINE = 'snap-preview-line'
const LYR_SNAP_LABEL = 'snap-preview-label'

interface SnapPreviewOverlayProps {
  map: maplibregl.Map | null
  isActive: boolean
  cursorPosition: { lat: number; lng: number } | null
  roads: Road[]
  junctions?: RoadJunction[]
  excludeRoadId?: string
  altHeld?: boolean
  /**
   * Fix 1: when a Connect / Keep Separate decision is pending, the discovered
   * candidate stays highlighted regardless of further cursor movement.
   */
  lockedCandidate?: ConnectivityCandidateLike | null
}

/** Minimal candidate shape for the locked highlight. */
export interface ConnectivityCandidateLike {
  position: { lat: number; lng: number }
  targetRoadId?: string
  label: string
}

export function SnapPreviewOverlay({
  map,
  isActive,
  cursorPosition,
  roads,
  junctions = [],
  excludeRoadId,
  altHeld = false,
  lockedCandidate = null,
}: SnapPreviewOverlayProps) {
  const lastCandidateRef = useRef<ReturnType<typeof findConnectivityCandidates> | null>(null)

  useEffect(() => {
    if (!map || !isActive) return

    // Ensure source and layers exist
    if (!map.getSource(SRC_SNAP_PREVIEW)) {
      map.addSource(SRC_SNAP_PREVIEW, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }

    if (!map.getLayer(LYR_SNAP_LINE)) {
      map.addLayer({
        id: LYR_SNAP_LINE,
        type: 'line',
        source: SRC_SNAP_PREVIEW,
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#22c55e',
          'line-width': 3,
          'line-dasharray': [3, 2],
          'line-opacity': 0.8,
        },
      })
    }

    if (!map.getLayer(LYR_SNAP_MARKER)) {
      map.addLayer({
        id: LYR_SNAP_MARKER,
        type: 'circle',
        source: SRC_SNAP_PREVIEW,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#22c55e',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      })
    }

    return () => {
      if (map.getLayer(LYR_SNAP_MARKER)) map.removeLayer(LYR_SNAP_MARKER)
      if (map.getLayer(LYR_SNAP_LINE)) map.removeLayer(LYR_SNAP_LINE)
      if (map.getSource(SRC_SNAP_PREVIEW)) map.removeSource(SRC_SNAP_PREVIEW)
    }
  }, [map, isActive])

  useEffect(() => {
    const src = map?.getSource(SRC_SNAP_PREVIEW) as maplibregl.GeoJSONSource | undefined
    if (!map || !isActive) return

    // Fix 1: frozen candidate highlight while a Connect / Keep Separate
    // decision is pending — the target stays visible until the admin chooses.
    if (lockedCandidate) {
      const lockedFeatures: GeoJSON.Feature[] = [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lockedCandidate.position.lng, lockedCandidate.position.lat] },
        properties: { kind: 'locked-candidate', label: lockedCandidate.label },
      }]
      if (lockedCandidate.targetRoadId) {
        const targetRoad = roads.find(r => r.id === lockedCandidate.targetRoadId)
        if (targetRoad && targetRoad.polyline.points.length >= 2) {
          lockedFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: targetRoad.polyline.points.map(p => [p.lng, p.lat]) },
            properties: { kind: 'target-road' },
          })
        }
      }
      src?.setData({ type: 'FeatureCollection', features: lockedFeatures })
      lastCandidateRef.current = null
      return
    }

    if (!cursorPosition) {
      // Clear preview
      src?.setData({ type: 'FeatureCollection', features: [] })
      lastCandidateRef.current = null
      return
    }

    // Find candidates at current cursor position
    const result = findConnectivityCandidates(cursorPosition, {
      roads,
      junctions,
      excludeRoadId,
      bypass: altHeld,
    })

    lastCandidateRef.current = result

    if (!src) return

    if (!result.best || result.ambiguous || result.bypassed) {
      // No valid candidate: clear preview
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    // Build preview GeoJSON
    const features: GeoJSON.Feature[] = []

    // Marker at snap position
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [result.best.position.lng, result.best.position.lat],
      },
      properties: {
        kind: result.best.kind,
        label: result.best.label,
        distance: result.best.distanceMeters.toFixed(1),
      },
    })

    // Line from cursor to snap position
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [cursorPosition.lng, cursorPosition.lat],
          [result.best.position.lng, result.best.position.lat],
        ],
      },
      properties: { kind: 'preview-line' },
    })

    // Highlight target road segment if it's a segment/endpoint candidate
    if (result.best.targetRoadId) {
      const targetRoad = roads.find(r => r.id === result.best!.targetRoadId)
      if (targetRoad && targetRoad.polyline.points.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: targetRoad.polyline.points.map(p => [p.lng, p.lat]),
          },
          properties: { kind: 'target-road' },
        })
      }
    }

    src.setData({ type: 'FeatureCollection', features })
  }, [map, isActive, cursorPosition, roads, junctions, excludeRoadId, altHeld, lockedCandidate])

  return null // Component renders via MapLibre layers, not React DOM
}

/**
 * Get the current snap preview candidate for external consumers
 * (e.g., tooltip display).
 */
export function useSnapPreviewCandidate() {
  return lastCandidateRef
}
