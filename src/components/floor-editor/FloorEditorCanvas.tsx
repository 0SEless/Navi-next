'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEditor, useEditingEngine, useSelection, ENABLE_CANVAS_EDITOR, InteractionController as CanonicalInteractionController, getWallJunctions, moveWallJunction, snapWallJunctionPosition } from '@navi/editor'
import type { Command } from '@navi/editor'
import { useFloorComponents, useFloorComponent, useFloorRenderVersion, useFloorCampusId, isSemanticRoomComponent, resolveFloorScope } from '@/hooks/floor-graph-selectors'
import type { Building, LatLng, Component } from '@/types/nav-types'
import type { CoordinateTransformer, LocalCoord, PlanAlignment, Wall } from '@navi/core'
import { resizeRectangleFootprint, rotateRectangleFootprint } from '@navi/core'
import type { StudioTool, LayerVisibility } from '@/types/studio-types'
import { DEFAULT_SNAP_MODE, SNAP_CONFIGS, useFloorDrawing } from './useFloorDrawing'
import type { EntranceAccessRequiredRequest } from './useFloorDrawing'
import { extractHallwayData } from '@/types/hallway-types'
import { computeHallwayPolygon } from '@/types/hallway-types'
import { FloorPlanAlignment } from './FloorPlanAlignment'
import { useEditablePathEditor, type ConstraintProvider } from './useEditablePathEditor'
import { LinearGeometryOverlay, type LocalToLngLat, type LngLatToLocal } from './LinearGeometryOverlay'
import { HallwayRenderer } from './HallwayRenderer'
import { buildRelationshipGeometry, renderRelationshipOverlay } from './renderRelationshipOverlay'
import { getInteractionController, type InteractionState } from './InteractionController'
import type { ToLatLng } from './LinearGeometryRenderer'
import type { EditablePath } from '@/types/path-types'
import { genId } from '@navi/editor'
import { generateStairGraphicsLatLng, generateElevatorGraphicsLatLng } from '@navi/editor/src/rendering/feature-graphics'
import { deriveRooms } from '@navi/editor/src/geometry/room-derivation'
import { wallsToSegments } from '@navi/editor/src/geometry/wall-to-segment'
import { wallsToExtrusionCollection, FLOOR_PRESENTATION_DATUM } from '@navi/editor/src/geometry/wall-to-polygon'
import { deriveDoorLineEndpoints, deriveOpeningPosition } from '@navi/editor/src/geometry/opening-position'
import { DERIVED_ROOM_LAYER_IDS, getSemanticRoomIdentity, readDerivedRoomHit } from './semantic-room-interaction'
import type { EntranceRouteAnchor } from './entrance-route-authoring'
import { buildFloorRectangleEditCommand, rectangleRotationHandleScreenPoint } from './floor-rectangle-authoring'
import { resolveRouteTargetHit, type DoorRouteConnectTarget } from './route-target-authoring'


import { computeFloorPlanCoords } from '@/lib/floor-plan-coords'
import { syncFloorPlanImageLayer, type FloorPlanMapLike } from '@/lib/floor-plan-map-source'
import { createPathProjection, componentToEditablePath, snapTo45Degrees } from '@/lib/path-projection'
import { screenToImagePixel, screenToBuildingLocal } from '@/lib/two-point-calibration'
import type { Point2D } from '@/lib/two-point-calibration'
// resolveFloorPlanUrl removed: FloorEditorCanvas now uses the floorPlanUrl prop
// directly (already resolved per-floor by FloorEditor). Bug A fix (T1).
// P4-T1: Canvas editor (behind feature flag)
import { CanvasViewport, componentsToFloorGeometry, useCanvasViewport, useCanvasEvents, useCanvasSelection, useCanvasEditingAdapter, screenToWorld, hitTestFloor, useMapLibreCamera } from '@navi/editor'
import { DoorTool } from '@navi/editor/src/tools/door-tool'
import { StairTool } from '@navi/editor/src/tools/stair-tool'
import { ElevatorTool } from '@navi/editor/src/tools/elevator-tool'
import { EntranceTool } from '@navi/editor/src/tools/entrance-tool'
import { POITool } from '@navi/editor/src/tools/poi-tool'

const BLANK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [],
}

/**
 * MapLibre query results may carry an internal feature prototype that its
 * worker serializer cannot transfer back through a GeoJSON source. Keep
 * hover overlays plain JSON while preserving the rendered geometry and hit
 * properties.
 */
function toPlainGeoJsonFeature(feature: maplibregl.MapGeoJSONFeature): GeoJSON.Feature {
  return {
    type: 'Feature',
    ...(feature.id !== undefined ? { id: feature.id } : {}),
    properties: feature.properties ? { ...feature.properties } : {},
    geometry: JSON.parse(JSON.stringify(feature.geometry)) as GeoJSON.Geometry,
  }
}

const CURSOR_MAP: Record<string, string> = {
  select: 'grab',
  room: 'crosshair',
  entrance: 'crosshair',
  stairs: 'crosshair',
  elevator: 'crosshair',
  hallway: 'crosshair',
  wall: 'crosshair',
  door: 'crosshair',
  window: 'crosshair',
  align: 'move',
  'route-node': 'crosshair',
  'route-edge': 'crosshair',
}


function getFp(b: Building): LatLng[] {
  const f = b.footprint
  return Array.isArray(f) ? f : (f as any)?.points ?? []
}

function buildBuildingGeo(building: Building): GeoJSON.FeatureCollection {
  const fp = getFp(building)
  if (fp.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: building.id, name: building.name, color: building.color || '#1C6EBB', height: building.height || 15 },
      geometry: {
        type: 'Polygon',
        coordinates: fp.length >= 3
          ? (() => {
              const ring: [number, number][] = fp.map((p) => [p.lng, p.lat] as [number, number])
              const first = ring[0]
              const last = ring[ring.length - 1]
              if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
              return [ring]
            })()
          : (() => {
              const c = fp.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 })
              const avg = { lat: c.lat / fp.length, lng: c.lng / fp.length }
              return [[
                [avg.lng - 0.0003, avg.lat - 0.0003],
                [avg.lng + 0.0003, avg.lat - 0.0003],
                [avg.lng + 0.0003, avg.lat + 0.0003],
                [avg.lng - 0.0003, avg.lat + 0.0003],
                [avg.lng - 0.0003, avg.lat - 0.0003],
              ]]
            })(),
      },
    }],
  }
}

function addSourcesAndLayers(map: maplibregl.Map) {
  // Guard each source individually — skip if already added (e.g. on hot-reload)
  if (!map.getSource('floor-buildings')) {
    map.addSource('floor-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-buildings-fill', type: 'fill', source: 'floor-buildings', paint: { 'fill-color': '#1C6BEB', 'fill-opacity': 0.12 } })
    map.addLayer({ id: 'floor-buildings-outline', type: 'line', source: 'floor-buildings', paint: { 'line-color': '#60A5FA', 'line-width': 2 } })
  }

  // Areas — persistent visible polygons with translucent fill and outline
  if (!map.getSource('floor-areas')) {
    map.addSource('floor-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-areas-fill', type: 'fill', source: 'floor-areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 } })
    map.addLayer({ id: 'floor-areas-outline', type: 'line', source: 'floor-areas', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8 } })
  }

  // floor-plan image source is added dynamically in the updateImage useEffect
  // floor-floorplan layer added dynamically with the image source

  if (!map.getSource('floor-rooms')) {
    map.addSource('floor-rooms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-rooms-fill', type: 'fill-extrusion', source: 'floor-rooms', paint: { 'fill-extrusion-color': '#10B981', 'fill-extrusion-opacity': 0.35, 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0 } })
    map.addLayer({ id: 'floor-rooms-outline', type: 'line', source: 'floor-rooms', paint: { 'line-color': '#10B981', 'line-width': 2 } })
  }

  if (!map.getSource('floor-door-areas')) {
    map.addSource('floor-door-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-door-areas-fill', type: 'fill', source: 'floor-door-areas', paint: { 'fill-color': '#10B981', 'fill-opacity': 0.38 } })
    map.addLayer({ id: 'floor-door-areas-outline', type: 'line', source: 'floor-door-areas', paint: { 'line-color': '#047857', 'line-width': 2 } })
    map.addLayer({ id: 'floor-door-areas-extrusion', type: 'fill-extrusion', source: 'floor-door-areas', paint: {
      'fill-extrusion-color': '#10B981',
      'fill-extrusion-opacity': 0.72,
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': 0,
    } })
  }

  // Hallway sources/layers are now managed by HallwayRenderer → LinearGeometryRenderer

  if (!map.getSource('floor-stair-areas')) {
    map.addSource('floor-stair-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-stair-areas-fill', type: 'fill', source: 'floor-stair-areas', paint: { 'fill-color': '#F97316', 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'floor-stair-areas-outline', type: 'line', source: 'floor-stair-areas', paint: { 'line-color': '#EA580C', 'line-width': 2 } })
  }

  if (!map.getSource('floor-stair-treads')) {
    map.addSource('floor-stair-treads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-stair-treads-line', type: 'line', source: 'floor-stair-treads', paint: { 'line-color': '#EA580C', 'line-width': 1.5, 'line-opacity': 0.85 } })
  }

  if (!map.getSource('floor-stair-arrows')) {
    map.addSource('floor-stair-arrows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-stair-arrows-line', type: 'line', source: 'floor-stair-arrows', paint: { 'line-color': '#C2410C', 'line-width': 2, 'line-opacity': 0.9 } })
  }

  if (!map.getSource('floor-elevator-areas')) {
    map.addSource('floor-elevator-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-elevator-areas-fill', type: 'fill', source: 'floor-elevator-areas', paint: { 'fill-color': '#7C3AED', 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'floor-elevator-areas-outline', type: 'line', source: 'floor-elevator-areas', paint: { 'line-color': '#7C3AED', 'line-width': 2 } })
  }

  if (!map.getSource('floor-elevator-cabins')) {
    map.addSource('floor-elevator-cabins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-elevator-cabins-outline', type: 'line', source: 'floor-elevator-cabins', filter: ['==', ['get', 'kind'], 'cabin'], paint: { 'line-color': '#8B5CF6', 'line-width': 1.5, 'line-dasharray': [3, 1.5], 'line-opacity': 0.85 } })
    map.addLayer({ id: 'floor-elevator-cabins-doors', type: 'line', source: 'floor-elevator-cabins', filter: ['==', ['get', 'kind'], 'door'], paint: { 'line-color': '#6D28D9', 'line-width': 3, 'line-opacity': 0.95 } })
  }


  // Roads — polygon buffers around centerlines for interaction mode
  if (!map.getSource('floor-roads')) {
    map.addSource('floor-roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-roads-fill', type: 'fill', source: 'floor-roads', paint: { 'fill-color': '#F97316', 'fill-opacity': 0.0 } })
    map.addLayer({ id: 'floor-roads-outline', type: 'line', source: 'floor-roads', paint: { 'line-color': '#F97316', 'line-width': 2, 'line-opacity': 0.0 } })
  }

  if (!map.getSource('floor-walls')) {
    map.addSource('floor-walls', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-walls-line', type: 'line', source: 'floor-walls', paint: { 'line-color': '#EF4444', 'line-width': 3, 'line-opacity': 0.9 } })
  }

  if (!map.getSource('floor-wall-edit-preview')) {
    map.addSource('floor-wall-edit-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-wall-edit-preview-line', type: 'line', source: 'floor-wall-edit-preview', paint: { 'line-color': '#F59E0B', 'line-width': 5, 'line-opacity': 0.95, 'line-dasharray': [2, 1] } })
  }

  if (!map.getSource('floor-wall-junctions')) {
    map.addSource('floor-wall-junctions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-wall-junctions-layer', type: 'circle', source: 'floor-wall-junctions', paint: { 'circle-radius': 8, 'circle-color': '#F59E0B', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })
  }

  if (!map.getSource('floor-walls-3d')) {
    map.addSource('floor-walls-3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-walls-3d-extrusion', type: 'fill-extrusion', source: 'floor-walls-3d', paint: {
      'fill-extrusion-color': '#D1D5DB',
      'fill-extrusion-opacity': 0.85,
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'base'],
    } })
  }

  if (!map.getSource('floor-openings')) {
    map.addSource('floor-openings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    // Door markers — thick gap perpendicular to wall
    map.addLayer({ id: 'floor-openings-door', type: 'line', source: 'floor-openings', filter: ['==', ['get', 'type'], 'door'], paint: { 'line-color': '#10B981', 'line-width': 6, 'line-opacity': 0.9 } })
    // Window markers — shorter perpendicular segment
    map.addLayer({ id: 'floor-openings-window', type: 'line', source: 'floor-openings', filter: ['==', ['get', 'type'], 'window'], paint: { 'line-color': '#38BDF8', 'line-width': 4, 'line-opacity': 0.85 } })
    // Door label
    map.addLayer({ id: 'floor-openings-door-label', type: 'symbol', source: 'floor-openings', filter: ['==', ['get', 'type'], 'door'], layout: { 'text-field': 'D', 'text-size': 9, 'text-allow-overlap': true, 'text-anchor': 'center' }, paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#10B981', 'text-halo-width': 1 } })
    // Window label
    map.addLayer({ id: 'floor-openings-window-label', type: 'symbol', source: 'floor-openings', filter: ['==', ['get', 'type'], 'window'], layout: { 'text-field': 'W', 'text-size': 9, 'text-allow-overlap': true, 'text-anchor': 'center' }, paint: { 'text-color': '#1E293B', 'text-halo-color': '#38BDF8', 'text-halo-width': 1 } })
  }

  if (!map.getSource('floor-derived-rooms')) {
    map.addSource('floor-derived-rooms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-derived-rooms-fill', type: 'fill-extrusion', source: 'floor-derived-rooms', paint: {
      'fill-extrusion-color': '#6366F1',
      'fill-extrusion-opacity': 0.18,
      'fill-extrusion-height': 0.1,
      'fill-extrusion-base': 0.1,
    } })
    map.addLayer({ id: 'floor-derived-rooms-outline', type: 'line', source: 'floor-derived-rooms', paint: { 'line-color': '#6366F1', 'line-width': 1.5, 'line-opacity': 0.5 } })
  }

  if (!map.getSource('floor-assets')) {
    map.addSource('floor-assets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-assets-layer', type: 'symbol', source: 'floor-assets', layout: { 'icon-image': 'marker', 'icon-size': 0.8, 'text-field': ['get', 'name'], 'text-offset': [0, -1.5], 'text-size': 10 } })
  }

  if (!map.getSource('floor-nodes')) {
    map.addSource('floor-nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-nodes-layer', type: 'circle', source: 'floor-nodes', paint: { 'circle-radius': 4, 'circle-color': '#8B5CF6', 'circle-opacity': 0.7 } })
  }

  if (!map.getSource('floor-edges')) {
    map.addSource('floor-edges', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-edges-layer', type: 'line', source: 'floor-edges', paint: { 'line-color': '#8B5CF6', 'line-width': 1.5, 'line-opacity': 0.4, 'line-dasharray': [4, 2] } })
  }

  if (!map.getSource('floor-labels')) {
    map.addSource('floor-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-labels-layer', type: 'symbol', source: 'floor-labels', layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 0] }, paint: { 'text-color': '#94A3B8', 'text-halo-color': '#1E293B', 'text-halo-width': 1 } })
  }

  if (!map.getSource('floor-room-labels')) {
    map.addSource('floor-room-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-room-labels-layer', type: 'symbol', source: 'floor-room-labels', layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, 0], 'text-allow-overlap': true }, paint: { 'text-color': '#CBD5E1', 'text-halo-color': '#1E293B', 'text-halo-width': 1 } })
  }

  if (!map.getSource('floor-point-items')) {
    map.addSource('floor-point-items', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-items-stairs', type: 'circle', source: 'floor-point-items', filter: ['==', ['get', 'type'], 'stair'], paint: { 'circle-radius': 10, 'circle-color': '#F97316', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })
    map.addLayer({ id: 'floor-items-stairs-label', type: 'symbol', source: 'floor-point-items', filter: ['==', ['get', 'type'], 'stair'], layout: { 'text-field': 'S', 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#FFFFFF' } })
    map.addLayer({ id: 'floor-items-entrance', type: 'circle', source: 'floor-point-items', filter: ['==', ['get', 'type'], 'entrance'], paint: {
      'circle-radius': ['case', ['boolean', ['get', 'activeRouteSource'], false], 12, ['boolean', ['get', 'selected'], false], 10, 8],
      'circle-color': ['case', ['boolean', ['get', 'activeRouteSource'], false], '#22D3EE', ['boolean', ['get', 'selected'], false], '#1C6BEB', '#F59E0B'],
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': ['case', ['boolean', ['get', 'activeRouteSource'], false], 4, 2],
    } })
    map.addLayer({ id: 'floor-items-entrance-label', type: 'symbol', source: 'floor-point-items', filter: ['==', ['get', 'type'], 'entrance'], layout: { 'text-field': '\u2B07', 'text-size': 10, 'text-allow-overlap': true }, paint: { 'text-color': '#FFFFFF' } })
  }

  if (!map.getSource('floor-selection')) {
    map.addSource('floor-selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-selection-fill', type: 'fill', source: 'floor-selection', filter: ['==', ['get', 'type'], 'fill'], paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.3 } })
    map.addLayer({ id: 'floor-selection-outline', type: 'line', source: 'floor-selection', filter: ['==', ['get', 'type'], 'line'], paint: { 'line-color': '#FFFFFF', 'line-width': 3, 'line-opacity': 1.0 } })
    map.addLayer({ id: 'floor-selection-circle', type: 'circle', source: 'floor-selection', filter: ['==', ['get', 'type'], 'circle'], paint: { 'circle-radius': 12, 'circle-color': '#FFFFFF', 'circle-opacity': 0.25, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3, 'circle-stroke-opacity': 0.9 } })
  }
  // Hallway selection visuals are managed by LinearGeometryOverlay

  if (!map.getSource('floor-hover')) {
    map.addSource('floor-hover', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-hover-fill', type: 'fill', source: 'floor-hover', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.2 } })
    map.addLayer({ id: 'floor-hover-outline', type: 'line', source: 'floor-hover', paint: { 'line-color': '#FFFFFF', 'line-width': 3, 'line-opacity': 0.8 } })
  }

  if (!map.getSource('relationship-overlay')) {
    map.addSource('relationship-overlay', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'relationship-road-highlight', type: 'line', source: 'relationship-overlay', filter: ['==', ['get', 'type'], 'roadHighlight'], paint: { 'line-color': '#FBBF24', 'line-width': 5, 'line-opacity': 0.8 } })
    map.addLayer({ id: 'relationship-connector', type: 'line', source: 'relationship-overlay', filter: ['==', ['get', 'type'], 'connector'], paint: { 'line-color': '#60A5FA', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [6, 4] } })
  }

  if (!map.getSource('floor-vertex-handles')) {
    map.addSource('floor-vertex-handles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-vertex-handles-layer', type: 'circle', source: 'floor-vertex-handles', filter: ['==', ['get', 'type'], 'vertex'], paint: { 'circle-radius': 8, 'circle-color': '#FFFFFF', 'circle-stroke-width': 3, 'circle-stroke-color': '#1C6BEB' } })
    map.addLayer({ id: 'floor-midpoint-handles-layer', type: 'circle', source: 'floor-vertex-handles', filter: ['==', ['get', 'type'], 'midpoint'], paint: { 'circle-radius': 5, 'circle-color': '#1C6BEB', 'circle-opacity': 0.6, 'circle-stroke-width': 0 } })
    map.addLayer({ id: 'floor-rotation-handle-layer', type: 'circle', source: 'floor-vertex-handles', filter: ['==', ['get', 'type'], 'rotate'], paint: { 'circle-radius': 7, 'circle-color': '#F59E0B', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' } })
  }

  if (!map.getSource('floor-point-preview')) {
    map.addSource('floor-point-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-point-preview-layer', type: 'circle', source: 'floor-point-preview', paint: { 'circle-radius': 8, 'circle-color': '#3B82F6', 'circle-opacity': 0.4, 'circle-stroke-width': 2, 'circle-stroke-color': '#3B82F6' } } as any)
  }

  if (!map.getSource('floor-route-nodes')) {
    map.addSource('floor-route-nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-route-nodes-circle', type: 'circle', source: 'floor-route-nodes', paint: { 'circle-radius': 6, 'circle-color': '#F59E0B', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2, 'circle-opacity': 0.9 } })
  }

  if (!map.getSource('floor-route-edges')) {
    map.addSource('floor-route-edges', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-route-edges-line', type: 'line', source: 'floor-route-edges', paint: { 'line-color': '#F59E0B', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [6, 3] } })
  }

  if (!map.getSource('floor-route-edges-3d')) {
    map.addSource('floor-route-edges-3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-route-edges-3d-extrusion', type: 'fill-extrusion', source: 'floor-route-edges-3d', paint: {
      'fill-extrusion-color': '#F59E0B',
      'fill-extrusion-opacity': 0.7,
      'fill-extrusion-height': 0.2,
      'fill-extrusion-base': 0,
    } })
  }

  if (!map.getSource('floor-route-access')) {
    map.addSource('floor-route-access', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'floor-route-access-line', type: 'line', source: 'floor-route-access', paint: { 'line-color': '#22D3EE', 'line-width': 2.5, 'line-opacity': 0.95, 'line-dasharray': [2, 2] } })
  }

  // Route layers are added after the selection source. Promote selection
  // feedback above them, then keep structural wall handles highest priority.
  promoteSelectionLayers(map)
  promoteWallEditingLayers(map)
}

const WALL_EDIT_LAYER_IDS = [
  'floor-walls-line',
  'floor-wall-edit-preview-line',
  'floor-wall-junctions-layer',
] as const

const SELECTION_LAYER_IDS = [
  'floor-selection-fill',
  'floor-selection-outline',
  'floor-selection-circle',
] as const

/** Keep selection feedback above route geometry while leaving wall handles on top. */
function promoteSelectionLayers(map: maplibregl.Map): void {
  for (const layerId of SELECTION_LAYER_IDS) {
    if (map.getLayer(layerId)) map.moveLayer(layerId)
  }
}

/** Keep structural wall editing targets above room and floor-plan presentation layers. */
function promoteWallEditingLayers(map: maplibregl.Map): void {
  for (const layerId of WALL_EDIT_LAYER_IDS) {
    if (map.getLayer(layerId)) map.moveLayer(layerId)
  }
}

interface FloorEditorCanvasProps {
  building: Building
  activeFloorId?: string
  floor: number
  tool: StudioTool
  layers: LayerVisibility
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  planAlignment?: PlanAlignment
  floorPlanUrl?: string
  alignMode?: boolean
  readOnly?: boolean
  locked?: boolean
  overlayLocked?: boolean
  aspectRatioLocked?: boolean
  onAspectRatioLockedChange?: (locked: boolean) => void
  onAlignmentChange?: (align: PlanAlignment) => void
  calibrationMode?: boolean
  calibrationStep?: 'plan-a' | 'plan-b' | 'map-a' | 'map-b' | 'preview'
  onCalibrationClick?: (type: 'plan' | 'map', point: Point2D) => void
  onCalibrationImageLoaded?: (width: number, height: number) => void
  viewMode?: '2d' | '2.5d'
  onCameraSnapshot?: (camera: { pitch: number; bearing: number; zoom: number; center: [number, number] }) => void
  cameraSnapshot?: { pitch: number; bearing: number; zoom: number; center: [number, number] } | null
  snapMode?: 'architectural' | 'trace' | 'free'
  onSnapModeChange?: (mode: 'architectural' | 'trace' | 'free') => void
  pendingRouteAnchor?: EntranceRouteAnchor
  onRouteStartRejected?: (reason: string) => void
  onRouteAccessAssigned?: (access: { entranceId: string; outdoorNodeId: string; indoorRouteNodeId: string }) => void
  onEntranceAccessRequired?: (request: EntranceAccessRequiredRequest) => void
  routeConnectPick?: { doorId: string } | null
  onRouteConnectResolved?: (target: DoorRouteConnectTarget) => void
  onRouteConnectCancel?: () => void
}

function componentToFeature(c: Component, overridePolygon?: LatLng[]): GeoJSON.Feature | null {
  const polygon = overridePolygon ?? c.polygon
  if (!polygon || polygon.length < 3) return null
  return {
    type: 'Feature', properties: { id: c.id, name: c.name },
    geometry: { type: 'Polygon', coordinates: [[...polygon.map((p) => [p.lng, p.lat] as [number, number]), [polygon[0].lng, polygon[0].lat] as [number, number]]] },
  }
}

function rectangleHandleFeatures(map: maplibregl.Map, componentId: string, polygon: LatLng[]): GeoJSON.Feature[] {
  const vertices: GeoJSON.Feature[] = polygon.map((point, vertexIndex) => ({
    type: 'Feature',
    properties: { type: 'vertex', vertexIndex, componentId },
    geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
  }))
  if (polygon.length !== 4) return vertices

  const center = polygon.reduce(
    (sum, point) => ({ lng: sum.lng + point.lng / polygon.length, lat: sum.lat + point.lat / polygon.length }),
    { lng: 0, lat: 0 },
  )
  const edge = {
    lng: (polygon[0].lng + polygon[1].lng) / 2,
    lat: (polygon[0].lat + polygon[1].lat) / 2,
  }
  const centerScreen = map.project(center)
  const edgeScreen = map.project(edge)
  const handleScreen = rectangleRotationHandleScreenPoint(centerScreen, edgeScreen)
  const handle = map.unproject([handleScreen.x, handleScreen.y])
  vertices.push({
    type: 'Feature',
    properties: { type: 'rotate', componentId },
    geometry: { type: 'Point', coordinates: [handle.lng, handle.lat] },
  })
  return vertices
}

interface WallJunctionDrag {
  junctionId: string
  originalWalls: Wall[]
  workingWalls: Wall[]
}

interface RouteNodeDrag {
  nodeId: string
  floorId: string
  originalPosition: LocalCoord
  workingPosition: LocalCoord
}

function cloneWall(wall: Wall): Wall {
  return {
    ...wall,
    start: { ...wall.start },
    end: { ...wall.end },
    ...(wall.metadata ? { metadata: { ...wall.metadata } } : {}),
  }
}

function cloneWalls(walls: readonly Wall[]): Wall[] {
  return walls.map(cloneWall)
}

function sameLocalCoord(a: LocalCoord, b: LocalCoord): boolean {
  return a.x === b.x && a.y === b.y
}

function wallChanged(original: Wall, current: Wall): boolean {
  return !sameLocalCoord(original.start, current.start) || !sameLocalCoord(original.end, current.end)
}

function wallFeature(
  wall: Wall,
  transformer: CoordinateTransformer,
  buildingId: string,
  properties: Record<string, unknown> = {},
): GeoJSON.Feature | null {
  const start = transformer.buildingLocalToWorld(wall.start, buildingId)
  const end = transformer.buildingLocalToWorld(wall.end, buildingId)
  if (!start || !end) return null
  return {
    type: 'Feature',
    id: wall.id,
    properties: { id: wall.id, ...properties },
    geometry: { type: 'LineString', coordinates: [[start.lng, start.lat], [end.lng, end.lat]] },
  }
}

function wallJunctionFeatures(
  walls: readonly Wall[],
  selectedWallId: string,
  transformer: CoordinateTransformer,
  buildingId: string,
): GeoJSON.Feature[] {
  return getWallJunctions(walls)
    .filter((junction) => junction.endpoints.some((endpoint) => endpoint.wallId === selectedWallId))
    .flatMap((junction) => {
      const world = transformer.buildingLocalToWorld(junction.position, buildingId)
      if (!world) return []
      return [{
        type: 'Feature' as const,
        id: junction.id,
        properties: { type: 'wall-junction', junctionId: junction.id, wallId: selectedWallId },
        geometry: { type: 'Point' as const, coordinates: [world.lng, world.lat] as [number, number] },
      }]
    })
}

function setSourceData(map: maplibregl.Map, sourceId: string, features: GeoJSON.Feature[]): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
  if (source) source.setData({ type: 'FeatureCollection', features })
}

export function FloorEditorCanvas({ building, activeFloorId, floor, tool, layers, selectedId, onSelect, planAlignment, floorPlanUrl, alignMode, readOnly, locked, overlayLocked, aspectRatioLocked, onAspectRatioLockedChange, onAlignmentChange, calibrationMode, calibrationStep, onCalibrationClick, onCalibrationImageLoaded, viewMode = '2d', onCameraSnapshot, cameraSnapshot, snapMode, onSnapModeChange, pendingRouteAnchor, onRouteStartRejected, onRouteAccessAssigned, onEntranceAccessRequired, routeConnectPick, onRouteConnectResolved, onRouteConnectCancel }: FloorEditorCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const readyRef = useRef(false)

  const floorComponents = useFloorComponents(building.id, floor, activeFloorId)
  const fallbackSelectedComponent = useFloorComponent(selectedId)
  // Selection is part of the render scope. A globally resolved selected entity
  // from another floor must not leak into this floor's highlight/overlay layers.
  const selectedComponent = floorComponents.find((component) => component.id === selectedId)
    ?? (fallbackSelectedComponent && fallbackSelectedComponent.floor === floor ? fallbackSelectedComponent : null)
  const renderVersion = useFloorRenderVersion()
  const campusId = useFloorCampusId()

  const editor = useEditor()
  const dispatcher = editor.services.get('dispatcher')!
  const transformer = editor.transformer
  const buildingFp = Array.isArray(building.footprint) ? building.footprint : (building.footprint as any)?.points ?? []

  const editEngine = useEditingEngine()

  // Ref for drag interaction closures
  const floorComponentsRef = useRef(floorComponents)
  useEffect(() => { floorComponentsRef.current = floorComponents }, [floorComponents])
  const selectedComponentRef = useRef(selectedComponent)
  useEffect(() => { selectedComponentRef.current = selectedComponent }, [selectedComponent])
  const toolRef = useRef(tool)
  useEffect(() => { toolRef.current = tool }, [tool])
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  // Calibration mode refs
  const calImageRef = useRef<HTMLImageElement | null>(null)
  const calibrationStepRef = useRef(calibrationStep)
  calibrationStepRef.current = calibrationStep

  // Interaction mode state
  const [interactionState, setInteractionState] = useState<InteractionState>({ mode: 'idle' })
  const hoveredRoadRef = useRef<string | null>(null)
  const isCapturedRef = useRef(false)

  // Wall editing is intentionally separate from Component selection. Walls are
  // structural geometry, not a legacy polygon Component, so selecting one
  // must never route edits through entity.update or Floor.rooms[].polygon.
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null)
  const selectedWallIdRef = useRef<string | null>(null)
  const wallDragRef = useRef<WallJunctionDrag | null>(null)
  const snapModeRef = useRef(snapMode ?? DEFAULT_SNAP_MODE)
  const [wallEditError, setWallEditError] = useState<string | null>(null)
  const routeNodeDragRef = useRef<RouteNodeDrag | null>(null)
  const [routeNodePreview, setRouteNodePreview] = useState<{ nodeId: string; position: LocalCoord } | null>(null)
  const [doorConnectPrompt, setDoorConnectPrompt] = useState<{ edgeId: string; position: LatLng } | null>(null)

  useEffect(() => { selectedWallIdRef.current = selectedWallId }, [selectedWallId])
  useEffect(() => { snapModeRef.current = snapMode ?? DEFAULT_SNAP_MODE }, [snapMode])

  const cancelWallJunctionDrag = useCallback((): boolean => {
    const drag = wallDragRef.current
    if (!drag) return false
    wallDragRef.current = null
    const map = mapRef.current
    if (map) {
      try {
        map.dragPan?.enable()
        setSourceData(map, 'floor-wall-edit-preview', [])
        if (transformer && selectedWallIdRef.current) {
          setSourceData(map, 'floor-wall-junctions', wallJunctionFeatures(drag.originalWalls, selectedWallIdRef.current, transformer, building.id))
        }
        map.getCanvas().style.cursor = CURSOR_MAP[toolRef.current] ?? 'default'
      } catch { /* map may have been removed during cancellation */ }
    }
    setWallEditError(null)
    return true
  }, [building.id, transformer])

  const deleteSelectedWall = useCallback(() => {
    if (readOnly) return
    const wallId = selectedWallIdRef.current
    if (!wallId) return

    const currentBuilding = editor.document.buildings.find((candidate) => candidate.id === building.id)
    const currentFloor = currentBuilding && resolveFloorScope(currentBuilding.floors, activeFloorId, floor)
    if (!currentFloor) {
      setWallEditError('Unable to find the active floor for this wall')
      return
    }

    const result = dispatcher.execute({
      id: 'wall.delete',
      label: 'Delete Wall',
      payload: { wallId, buildingId: building.id, floorId: currentFloor.id },
    })
    if (!result?.success) {
      setWallEditError(result?.error ?? 'Unable to delete wall')
      return
    }

    selectedWallIdRef.current = null
    setSelectedWallId(null)
    setWallEditError(null)
    onSelectRef.current?.(null)
  }, [activeFloorId, building.id, dispatcher, editor.document.buildings, floor, readOnly])

  useEffect(() => {
    if (tool === 'select') return
    if (wallDragRef.current) cancelWallJunctionDrag()
    selectedWallIdRef.current = null
    setSelectedWallId(null)
  }, [tool, cancelWallJunctionDrag])

  // Subscribe to interaction controller state changes
  useEffect(() => {
    const controller = getInteractionController()
    return controller.onChange((state) => {
      setInteractionState(state)
      isCapturedRef.current = state.mode === 'canvasCapture'
    })
  }, [])

  // Wire drawing interactions (state-driven so hook sees map after init)
  const { drawMode, pendingPolygon, rectangleMessage, confirm: confirmDrawing, cancel: cancelDrawing, removeLastPoint, routeConnectionPrompt, acceptRouteConnection, declineRouteConnection } = useFloorDrawing({ map: mapRef.current, mapReady, buildingId: building.id, campusId, floor, tool, onSelect, editEngine, snapMode, onSnapModeChange, pendingRouteAnchor, onRouteStartRejected, onRouteAccessAssigned, onEntranceAccessRequired })

  // ---- New Architecture: Linear Geometry Editing for Hallways ----

  // P1-T3: meter-space projection — the path editor runs in building-local
  // meters; lng/lat conversion happens only at the map boundary. No code path
  // treats degrees as meters.
  const pathProj = useMemo(() => (transformer ? createPathProjection(transformer, building.id) : null), [transformer, building.id])
  const project = useCallback<LocalToLngLat>((x, y) => pathProj?.project(x, y) ?? [x, y], [pathProj])
  const unproject = useCallback<LngLatToLocal>((lng, lat) => pathProj?.unproject(lng, lat) ?? { x: lng, y: lat }, [pathProj])
  const toLatLng = useCallback<ToLatLng>((x, y) => pathProj?.toLatLng(x, y) ?? { lat: y, lng: x }, [pathProj])
  const toLocal = useCallback((p: LatLng) => pathProj?.unproject(p.lng, p.lat) ?? { x: p.lng, y: p.lat }, [pathProj])

  // Build EditablePath from selected hallway (vertices in building-local meters)
  const selectedHallwayPath = useMemo<EditablePath | null>(() => {
    if (selectedComponent?.type !== 'hallway' || !pathProj) return null
    return componentToEditablePath(selectedComponent, toLocal, readOnly ?? false)
  }, [selectedComponent, readOnly, pathProj, toLocal])

  // Working copy updated during drag — drives overlay + renderer
  const [workingPath, setWorkingPath] = useState<EditablePath | null>(null)
  const displayPath = workingPath ?? selectedHallwayPath
  const hasDraggedRef = useRef(false)

  const handleVertexMoved = useCallback((vertexId: string, newPos: { x: number; y: number }) => {
    hasDraggedRef.current = true
    setWorkingPath((prev) => {
      if (!prev) return prev
      return { ...prev, vertices: prev.vertices.map((v) => v.id === vertexId ? { ...v, x: newPos.x, y: newPos.y } : v) }
    })
  }, [])

  const commitWorkingPath = useCallback((path: EditablePath) => {
    if (!selectedId || !building) return
    // Vertices are already building-local meters (P1-T3)
    const localPoints = path.vertices.map((v) => ({ x: v.x, y: v.y }))
    dispatcher.execute({
      id: 'entity.update', label: 'Edit hallway',
      payload: { entityId: selectedId, changes: { polyline: { points: localPoints } } },
    })
  }, [selectedId, building, dispatcher])

  const constraintProvider = useCallback<ConstraintProvider>((pos, origin, shift) => {
    if (!shift) return pos
    // Snap in meter space (P1-T3): a snapped displacement bears a true 45°
    return snapTo45Degrees(pos, origin)
  }, [])

  const pathEditor = useEditablePathEditor({
    path: displayPath ?? { id: '', vertices: [], segments: [], closed: false, readOnly: true },
    readOnly: !displayPath || readOnly,
    constraintProvider,
    onVertexMoved: handleVertexMoved,
    onVertexInserted: useCallback((segmentId: string, pos: { x: number; y: number }) => {
      const path = selectedHallwayPath
      if (!path || !selectedId || !building) return
      const segIdx = path.segments.findIndex((s) => s.id === segmentId)
      if (segIdx < 0) return
      // Vertices and pos are building-local meters (P1-T3)
      const points = path.vertices.map((v) => ({ x: v.x, y: v.y }))
      points.splice(segIdx + 1, 0, { x: pos.x, y: pos.y })
      dispatcher.execute({
        id: 'entity.update', label: 'Insert hallway vertex',
        payload: { entityId: selectedId, changes: { polyline: { points } } },
      })
    }, [selectedHallwayPath, selectedId, building, dispatcher]),
    onVertexDeleted: useCallback((vertexId: string) => {
      const path = selectedHallwayPath
      if (!path || !selectedId || !building) return
      const idx = path.vertices.findIndex((v) => v.id === vertexId)
      if (idx < 0) return
      const remaining = path.vertices.filter((_, i) => i !== idx)
      if (remaining.length < 2) return
      // Vertices are building-local meters (P1-T3)
      const localPoints = remaining.map((v) => ({ x: v.x, y: v.y }))
      dispatcher.execute({
        id: 'entity.update', label: 'Delete hallway vertex',
        payload: { entityId: selectedId, changes: { polyline: { points: localPoints } } },
      })
    }, [selectedHallwayPath, selectedId, building, dispatcher]),
  })

  // Detect drag end and commit
  const prevDraggingRef = useRef(false)
  useEffect(() => {
    if (prevDraggingRef.current && !pathEditor.session.isDragging && hasDraggedRef.current && workingPath) {
      commitWorkingPath(workingPath)
      setWorkingPath(null)
      hasDraggedRef.current = false
    }
    prevDraggingRef.current = pathEditor.session.isDragging
  }, [pathEditor.session.isDragging, workingPath, commitWorkingPath])

  useEffect(() => {
    if (mapRef.current) return
    let mounted = true
    const c = building.center ?? buildingFp[0] ?? { lat: 11.8195, lng: 122.0922 }
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: BLANK_STYLE,
      center: [c.lng, c.lat],
      zoom: 18,
      pitch: 30,
      attributionControl: false,
    })
    map.on('load', () => {
      if (!mounted) return
      addSourcesAndLayers(map)
      readyRef.current = true
      setMapReady(true)
      if (buildingFp.length >= 2) {
        const bounds = new maplibregl.LngLatBounds()
        buildingFp.forEach((p: LatLng) => bounds.extend([p.lng, p.lat]))
        map.fitBounds(bounds, { padding: 60 })
      }
      const bldgSrc = map.getSource('floor-buildings') as maplibregl.GeoJSONSource
      if (bldgSrc) bldgSrc.setData(buildBuildingGeo(building))
    })
    mapRef.current = map
    return () => {
      mounted = false
      try { map.remove() } catch { /* zombie map — already destroyed */ }
      mapRef.current = null
      setMapReady(false)
      readyRef.current = false
    }
  }, [building])

  // Camera state management for 2D ↔ 2.5D toggle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    if (viewMode === '2.5d') {
      // Snapshot current camera state before tilting
      const center = map.getCenter()
      const snapshot = {
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        zoom: map.getZoom(),
        center: [center.lng, center.lat] as [number, number],
      }
      onCameraSnapshot?.(snapshot)
      // Tilt camera for 2.5D preview
      map.easeTo({ pitch: 50, bearing: 0, duration: 300 })
    } else {
      // Restore camera to snapshot (or default top-down)
      if (cameraSnapshot) {
        map.easeTo({
          pitch: 0,
          bearing: cameraSnapshot.bearing,
          zoom: cameraSnapshot.zoom,
          center: cameraSnapshot.center,
          duration: 300,
        })
      } else {
        map.easeTo({ pitch: 0, bearing: 0, duration: 300 })
      }
    }
  }, [viewMode, cameraSnapshot, onCameraSnapshot, mapReady])

  // Floor plan image overlay — add source + layer dynamically when URL available.
  //
  // Bug A fix (T1): Use the `floorPlanUrl` prop directly. The parent (FloorEditor)
  // already resolves the per-floor image URL from `currentFloorData.planImageId`
  // (falling back to `building.floorPlanUrls[currentLevel]` as a read-only legacy path).
  // Re-resolving here from `building.floorPlanUrls[level]` was a parallel read that
  // (a) used the floor index instead of level number, and (b) could observe a stale
  // shared URL before the per-floor planImageId write had propagated to the building object.
  //
  // Bug B fix (T4/T5): MapLibre `type:'image'` sources are 2D-only — their four lat/lng
  // corner coordinates carry no elevation. In pitched 2.5D mode the raster sits at Z=0
  // while wall/room extrusions float above it, creating a visual gap. Hide the floor-plan
  // layer in 2.5D mode; it is only meaningful in top-down 2D authoring view.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    // In 2.5D mode the raster image has no Z coordinate and would float at ground
    // level while extruded geometry appears above it. Hide it; the 3D geometry
    // (walls, rooms) provides the visual context in that view.
    if (viewMode === '2.5d') {
      if (map.getLayer('floor-floorplan-layer')) {
        try { map.setLayoutProperty('floor-floorplan-layer', 'visibility', 'none') } catch { /* layer race */ }
      }
      return
    }

    const imgUrl = floorPlanUrl

    // Capture image dimensions for calibration coordinate conversion
    if (imgUrl && (!calImageRef.current || calImageRef.current.src !== imgUrl)) {
      const img = new Image()
      img.onload = () => {
        calImageRef.current = img
        onCalibrationImageLoaded?.(img.naturalWidth, img.naturalHeight)
      }
      img.src = imgUrl
    }

    const rendered = syncFloorPlanImageLayer(map as unknown as FloorPlanMapLike, {
      sourceId: 'floor-floorplan',
      layerId: 'floor-floorplan-layer',
      imageUrl: imgUrl,
      footprint: buildingFp,
      alignment: planAlignment,
      opacity: planAlignment?.opacity,
    })
    // The image layer is added after the static editor layers; restore wall
    // editing targets to the top so their handles remain visible and hittable.
    if (rendered) promoteWallEditingLayers(map)
  }, [floorPlanUrl, buildingFp, mapReady, planAlignment, viewMode])

  // Sync rooms + hallways for this floor
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    const roomFeatures: GeoJSON.Feature[] = floorComponents
      .filter((c) => c.type === 'room' && !isSemanticRoomComponent(c) && c.polygon && c.polygon.length >= 3)
      .map((c) => ({
        type: 'Feature' as const,
        properties: { id: c.id, name: c.name, height: 3.5 },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[...c.polygon!.map((p) => [p.lng, p.lat] as [number, number]), [c.polygon![0].lng, c.polygon![0].lat] as [number, number]]],
        },
      }))

    const stairAreaFeatures: GeoJSON.Feature[] = []
    const stairTreadFeatures: GeoJSON.Feature[] = []
    const stairArrowFeatures: GeoJSON.Feature[] = []
    const elevatorAreaFeatures: GeoJSON.Feature[] = []
    const elevatorCabinFeatures: GeoJSON.Feature[] = []
    const doorAreaFeatures: GeoJSON.Feature[] = []

    for (const c of floorComponents) {
      if (c.type === 'door' && c.polygon && c.polygon.length >= 3) {
        const coords = [...c.polygon.map((p) => [p.lng, p.lat] as [number, number]), [c.polygon[0].lng, c.polygon[0].lat] as [number, number]]
        doorAreaFeatures.push({
          type: 'Feature',
          id: c.id,
          properties: { id: c.id, name: c.name, type: 'door', height: 2.1, ownershipStatus: c.metadata?.ownershipStatus ?? 'unassigned' },
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
      } else if (c.type === 'stair' && c.polygon && c.polygon.length >= 3) {
        const graphics = generateStairGraphicsLatLng(c.polygon)
        const coords = [...graphics.outline.map((p) => [p.lng, p.lat] as [number, number]), [graphics.outline[0].lng, graphics.outline[0].lat] as [number, number]]
        stairAreaFeatures.push({
          type: 'Feature',
          id: `${c.id}-area`,
          properties: { id: c.id, name: c.name, type: 'stair' },
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
        for (let i = 0; i < graphics.treads.length; i++) {
          const tr = graphics.treads[i]
          stairTreadFeatures.push({
            type: 'Feature',
            id: `${c.id}-tread-${i}`,
            properties: { id: c.id },
            geometry: { type: 'LineString', coordinates: [[tr[0].lng, tr[0].lat], [tr[1].lng, tr[1].lat]] },
          })
        }
        if (graphics.arrow.length >= 2) {
          stairArrowFeatures.push({
            type: 'Feature',
            id: `${c.id}-arrow`,
            properties: { id: c.id },
            geometry: { type: 'LineString', coordinates: graphics.arrow.map((p) => [p.lng, p.lat]) },
          })
        }
      } else if (c.type === 'elevator' && c.polygon && c.polygon.length >= 3) {
        const graphics = generateElevatorGraphicsLatLng(c.polygon)
        const shaftCoords = [...graphics.shaftOutline.map((p) => [p.lng, p.lat] as [number, number]), [graphics.shaftOutline[0].lng, graphics.shaftOutline[0].lat] as [number, number]]
        elevatorAreaFeatures.push({
          type: 'Feature',
          id: `${c.id}-shaft`,
          properties: { id: c.id, name: c.name, type: 'elevator' },
          geometry: { type: 'Polygon', coordinates: [shaftCoords] },
        })
        if (graphics.cabinOutline.length >= 3) {
          const cabinCoords = graphics.cabinOutline.map((p) => [p.lng, p.lat] as [number, number])
          elevatorCabinFeatures.push({
            type: 'Feature',
            id: `${c.id}-cabin`,
            properties: { id: c.id, kind: 'cabin' },
            geometry: { type: 'Polygon', coordinates: [cabinCoords] },
          })
        }
        for (let i = 0; i < graphics.doorLines.length; i++) {
          const dl = graphics.doorLines[i]
          elevatorCabinFeatures.push({
            type: 'Feature',
            id: `${c.id}-door-${i}`,
            properties: { id: c.id, kind: 'door' },
            geometry: { type: 'LineString', coordinates: [[dl[0].lng, dl[0].lat], [dl[1].lng, dl[1].lat]] },
          })
        }
      }
    }

    try {
      const roomSrc = map.getSource('floor-rooms') as maplibregl.GeoJSONSource
      if (roomSrc) roomSrc.setData({ type: 'FeatureCollection', features: roomFeatures })

      const stairAreaSrc = map.getSource('floor-stair-areas') as maplibregl.GeoJSONSource | undefined
      if (stairAreaSrc) stairAreaSrc.setData({ type: 'FeatureCollection', features: stairAreaFeatures })

      const stairTreadSrc = map.getSource('floor-stair-treads') as maplibregl.GeoJSONSource | undefined
      if (stairTreadSrc) stairTreadSrc.setData({ type: 'FeatureCollection', features: stairTreadFeatures })

      const stairArrowSrc = map.getSource('floor-stair-arrows') as maplibregl.GeoJSONSource | undefined
      if (stairArrowSrc) stairArrowSrc.setData({ type: 'FeatureCollection', features: stairArrowFeatures })

      const elevAreaSrc = map.getSource('floor-elevator-areas') as maplibregl.GeoJSONSource | undefined
      if (elevAreaSrc) elevAreaSrc.setData({ type: 'FeatureCollection', features: elevatorAreaFeatures })

      const elevCabinSrc = map.getSource('floor-elevator-cabins') as maplibregl.GeoJSONSource | undefined
      if (elevCabinSrc) elevCabinSrc.setData({ type: 'FeatureCollection', features: elevatorCabinFeatures })

      const doorAreaSrc = map.getSource('floor-door-areas') as maplibregl.GeoJSONSource | undefined
      if (doorAreaSrc) doorAreaSrc.setData({ type: 'FeatureCollection', features: doorAreaFeatures })

      const pointFeatures = floorComponents
        .filter((c) => (c.type === 'stair' && (!c.polygon || c.polygon.length < 3)) || c.type === 'entrance')
        .map((c) => ({
          type: 'Feature' as const,
          properties: {
            id: c.id,
            name: c.name,
            type: c.type,
            selected: selectedId === c.id,
            activeRouteSource: c.type === 'entrance' && pendingRouteAnchor?.entranceId === c.id,
          },
          geometry: { type: 'Point' as const, coordinates: [c.position.lng, c.position.lat] as [number, number] },
        }))
      const pointSrc = map.getSource('floor-point-items') as maplibregl.GeoJSONSource | undefined
      if (pointSrc) pointSrc.setData({ type: 'FeatureCollection', features: pointFeatures })
    } catch { console.warn('FloorEditorCanvas: source not ready for setData') }
  }, [floorComponents, renderVersion, mapReady, pendingRouteAnchor, selectedId])


  // Sync roads from document to floor-roads source (for interaction mode)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const doc = editor.document
    if (!doc) return

    try {
      const roadFeatures: GeoJSON.Feature[] = []
      for (const road of doc.roads) {
        const points = road.polyline?.points
        if (!points || points.length < 2) continue

        // Compute polygon buffer around centerline
        const buffer = computeHallwayPolygon(points, road.width ?? 3)
        if (buffer.length < 3) continue

        const coords = [...buffer.map((p) => [p.lng, p.lat] as [number, number]), [buffer[0].lng, buffer[0].lat] as [number, number]]
        roadFeatures.push({
          type: 'Feature',
          properties: { id: road.id, name: road.name },
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
      }

      const roadSrc = map.getSource('floor-roads') as maplibregl.GeoJSONSource | undefined
      if (roadSrc) roadSrc.setData({ type: 'FeatureCollection', features: roadFeatures })
    } catch { console.warn('FloorEditorCanvas: road source not ready for setData') }
  }, [renderVersion, mapReady])

  // Sync areas from document to floor-areas source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const doc = editor.document
    if (!doc) return

    try {
      const areas = doc.areas ?? []
      const areaFeatures: GeoJSON.Feature[] = []
      for (const area of areas) {
        if (!area.points || area.points.length < 3) continue
        const coords = [...area.points.map((p) => [p.lng, p.lat] as [number, number]), [area.points[0].lng, area.points[0].lat] as [number, number]]
        areaFeatures.push({
          type: 'Feature',
          properties: { id: area.id, name: area.name, color: area.color || '#8B5CF6' },
          geometry: { type: 'Polygon', coordinates: [coords] },
        })
      }

      const areaSrc = map.getSource('floor-areas') as maplibregl.GeoJSONSource | undefined
      if (areaSrc) areaSrc.setData({ type: 'FeatureCollection', features: areaFeatures })
    } catch { console.warn('FloorEditorCanvas: area source not ready for setData') }
  }, [renderVersion, mapReady])

  // Sync walls from document to floor-walls source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!transformer) return

    try {
      const wallFeatures: GeoJSON.Feature[] = []
      const bld = editor.document.buildings.find((b) => b.id === building.id)
      if (!bld) return
      const fl = resolveFloorScope(bld.floors, activeFloorId, floor)
      if (!fl?.walls || fl.walls.length === 0) {
        const wallSrc = map.getSource('floor-walls') as maplibregl.GeoJSONSource | undefined
        if (wallSrc) wallSrc.setData({ type: 'FeatureCollection', features: [] })
        return
      }

      for (const wall of fl.walls) {
        const startWorld = transformer.buildingLocalToWorld(wall.start, building.id)
        const endWorld = transformer.buildingLocalToWorld(wall.end, building.id)
        if (!startWorld || !endWorld) continue
        wallFeatures.push({
          type: 'Feature',
          id: wall.id,
          properties: { id: wall.id },
          geometry: {
            type: 'LineString',
            coordinates: [[startWorld.lng, startWorld.lat], [endWorld.lng, endWorld.lat]],
          },
        })
      }

      const wallSrc = map.getSource('floor-walls') as maplibregl.GeoJSONSource | undefined
      if (wallSrc) wallSrc.setData({ type: 'FeatureCollection', features: wallFeatures })
    } catch { console.warn('FloorEditorCanvas: wall source not ready for setData') }
  }, [renderVersion, building.id, activeFloorId, floor, transformer, mapReady])

  // Sync wall extrusion polygons for 3D fill-extrusion
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!transformer) return

    try {
      const bld = editor.document.buildings.find((b) => b.id === building.id)
      if (!bld) return
      const fl = resolveFloorScope(bld.floors, activeFloorId, floor)
      if (!fl?.walls || fl.walls.length === 0) {
        const src = map.getSource('floor-walls-3d') as maplibregl.GeoJSONSource | undefined
        if (src) src.setData({ type: 'FeatureCollection', features: [] })
        return
      }

      // Build local-space extrusion collection, then transform each polygon to world.
      // Vertical contract (spec/FLOOR-ELEVATION-ACTIVE-FLOW.md): this view renders
      // exactly one floor, so the active floor's own base plane IS z=0 — every
      // renderable (rooms, derived rooms, doors, route edges, plan raster, 2D
      // overlays) is pinned to the presentation datum, and the wall extrusion must
      // match. `fl.elevation` is the stacking datum for multi-floor contexts and
      // is never applied here; authored wall coordinates are untouched.
      const localCollection = wallsToExtrusionCollection(fl.walls, FLOOR_PRESENTATION_DATUM)
      const worldFeatures: GeoJSON.Feature[] = []

      for (const feature of localCollection.features) {
        const geom = feature.geometry as GeoJSON.Polygon
        const ring = geom.coordinates[0] as [number, number][]
        const worldCoords: [number, number][] = []
        let valid = true

        for (const [lx, ly] of ring) {
          const world = transformer.buildingLocalToWorld({ x: lx, y: ly }, building.id)
          if (!world) { valid = false; break }
          worldCoords.push([world.lng, world.lat])
        }
        if (!valid || worldCoords.length < 4) continue

        worldFeatures.push({
          type: 'Feature',
          properties: feature.properties,
          geometry: { type: 'Polygon', coordinates: [worldCoords] },
        })
      }

      const src = map.getSource('floor-walls-3d') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData({ type: 'FeatureCollection', features: worldFeatures })
    } catch { console.warn('FloorEditorCanvas: wall-3d source not ready') }
  }, [renderVersion, building.id, activeFloorId, floor, transformer, mapReady])

  // Sync openings (doors/windows) from document to floor-openings source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!transformer) return

    try {
      const bld = editor.document.buildings.find((b) => b.id === building.id)
      if (!bld) return
      const fl = resolveFloorScope(bld.floors, activeFloorId, floor)
      if (!fl?.openings || fl.openings.length === 0 || !fl.walls || fl.walls.length === 0) {
        const src = map.getSource('floor-openings') as maplibregl.GeoJSONSource | undefined
        if (src) src.setData({ type: 'FeatureCollection', features: [] })
        return
      }

      const features: GeoJSON.Feature[] = []
      for (const opening of fl.openings) {
        const wall = fl.walls.find((w) => w.id === opening.wallId)
        if (!wall) continue

        if (opening.type === 'door') {
          const [startLocal, endLocal] = deriveDoorLineEndpoints(opening, wall)
          const startWorld = transformer.buildingLocalToWorld(startLocal, building.id)
          const endWorld = transformer.buildingLocalToWorld(endLocal, building.id)
          if (!startWorld || !endWorld) continue

          features.push({
            type: 'Feature', properties: { type: 'door', id: opening.id },
            geometry: {
              type: 'LineString',
              coordinates: [
                [startWorld.lng, startWorld.lat],
                [endWorld.lng, endWorld.lat],
              ],
            },
          })
        } else {
          // window
          const pos = deriveOpeningPosition(opening, wall)
          const posWorld = transformer.buildingLocalToWorld(pos, building.id)
          const wallStartWorld = transformer.buildingLocalToWorld(wall.start, building.id)
          const wallEndWorld = transformer.buildingLocalToWorld(wall.end, building.id)
          if (!posWorld || !wallStartWorld || !wallEndWorld) continue

          features.push({
            type: 'Feature', properties: { type: 'window', id: opening.id },
            geometry: {
              type: 'LineString',
              coordinates: (() => {
                const dx = wallEndWorld.lng - wallStartWorld.lng
                const dy = wallEndWorld.lat - wallStartWorld.lat
                const len = Math.sqrt(dx * dx + dy * dy)
                if (len < 1e-10) return [[posWorld.lng, posWorld.lat]]
                const halfWidth = 0.00001 // ~1m perpendicular gap
                const nx = (-dy / len) * halfWidth
                const ny = (dx / len) * halfWidth
                return [
                  [posWorld.lng + nx, posWorld.lat + ny],
                  [posWorld.lng - nx, posWorld.lat - ny],
                ]
              })(),
            },
          })
        }
      }

      const src = map.getSource('floor-openings') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData({ type: 'FeatureCollection', features })
    } catch { console.warn('FloorEditorCanvas: opening source not ready') }
  }, [renderVersion, building.id, activeFloorId, floor, transformer, mapReady])

  // Sync route network from document to MapLibre
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!transformer) return

    try {
      const bld = editor.document.buildings.find((b) => b.id === building.id)
      if (!bld) return
      const fl = resolveFloorScope(bld.floors, activeFloorId, floor)
      const network = fl?.routeNetwork

      const nodeFeatures: GeoJSON.Feature[] = []
      const edgeFeatures: GeoJSON.Feature[] = []
      const edge3dFeatures: GeoJSON.Feature[] = []

      if (network) {
        const positionForNode = (node: { id: string; position: LocalCoord }): LocalCoord =>
          routeNodePreview?.nodeId === node.id ? routeNodePreview.position : node.position

        for (const node of network.nodes) {
          const world = transformer.buildingLocalToWorld(positionForNode(node), building.id)
          if (!world) continue
          nodeFeatures.push({
            type: 'Feature',
            properties: { id: node.id, type: node.type, floor: node.floor },
            geometry: { type: 'Point', coordinates: [world.lng, world.lat] },
          })
        }

        const BUFFER_M = 0.15
        for (const edge of network.edges) {
          const fromNode = network.nodes.find(n => n.id === edge.from)
          const toNode = network.nodes.find(n => n.id === edge.to)
          if (!fromNode || !toNode) continue
          const fromWorld = transformer.buildingLocalToWorld(positionForNode(fromNode), building.id)
          const toWorld = transformer.buildingLocalToWorld(positionForNode(toNode), building.id)
          if (!fromWorld || !toWorld) continue
          edgeFeatures.push({
            type: 'Feature',
            properties: { id: edge.id, type: edge.type, distance: edge.distance },
            geometry: {
              type: 'LineString',
              coordinates: [[fromWorld.lng, fromWorld.lat], [toWorld.lng, toWorld.lat]],
            },
          })

          const dx = toWorld.lng - fromWorld.lng
          const dy = toWorld.lat - fromWorld.lat
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 1e-10) continue
          const halfWidth = BUFFER_M * (1 / 111320)
          const nx = (-dy / len) * halfWidth
          const ny = (dx / len) * halfWidth
          const coords: [number, number][] = [
            [fromWorld.lng + nx, fromWorld.lat + ny],
            [toWorld.lng + nx, toWorld.lat + ny],
            [toWorld.lng - nx, toWorld.lat - ny],
            [fromWorld.lng - nx, fromWorld.lat - ny],
            [fromWorld.lng + nx, fromWorld.lat + ny],
          ]
          edge3dFeatures.push({
            type: 'Feature',
            properties: { id: edge.id },
            geometry: { type: 'Polygon', coordinates: [coords] },
          })
        }
      }

      const nodeSrc = map.getSource('floor-route-nodes') as maplibregl.GeoJSONSource | undefined
      if (nodeSrc) nodeSrc.setData({ type: 'FeatureCollection', features: nodeFeatures })

      const edgeSrc = map.getSource('floor-route-edges') as maplibregl.GeoJSONSource | undefined
      if (edgeSrc) edgeSrc.setData({ type: 'FeatureCollection', features: edgeFeatures })

      const edge3dSrc = map.getSource('floor-route-edges-3d') as maplibregl.GeoJSONSource | undefined
      if (edge3dSrc) edge3dSrc.setData({ type: 'FeatureCollection', features: edge3dFeatures })
    } catch { console.warn('FloorEditorCanvas: route network source not ready') }
  }, [renderVersion, building.id, activeFloorId, floor, transformer, routeNodePreview, mapReady])

  // Render the selected semantic access relationship as an ephemeral connector.
  // The line is presentation-only: RoomAttributes and EntranceAccess remain the
  // persisted authorities, while routeNetwork remains the sole route geometry.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const source = map.getSource('floor-route-access') as maplibregl.GeoJSONSource | undefined
    if (!source) return

    const empty = { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] }
    if (!selectedId || !selectedComponent || !transformer) {
      source.setData(empty)
      return
    }

    const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
    const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
    const network = fl?.routeNetwork
    if (!fl || !network) {
      source.setData(empty)
      return
    }

    const routeWorld = (nodeId: string) => {
      const node = network.nodes.find((candidate) => candidate.id === nodeId)
      return node ? transformer.buildingLocalToWorld(node.position, building.id) : null
    }
    const features: GeoJSON.Feature[] = []

    if (isSemanticRoomComponent(selectedComponent)) {
      const identity = getSemanticRoomIdentity(selectedComponent)
      const attributes = identity ? fl.roomAttributes?.find((candidate) => candidate.faceId === identity.faceId) : undefined
      const anchor = selectedComponent.polygon?.length
        ? selectedComponent.polygon.reduce((sum, point) => ({ lat: sum.lat + point.lat / selectedComponent.polygon!.length, lng: sum.lng + point.lng / selectedComponent.polygon!.length }), { lat: 0, lng: 0 })
        : selectedComponent.position
      for (const access of attributes?.accessPoints ?? []) {
        const route = routeWorld(access.routeNodeId)
        if (!route) continue
        features.push({
          type: 'Feature',
          properties: { type: 'roomAccess', entityId: selectedComponent.id, routeNodeId: access.routeNodeId, primary: access.primary },
          geometry: { type: 'LineString', coordinates: [[anchor.lng, anchor.lat], [route.lng, route.lat]] },
        })
      }
    } else if (selectedComponent.type === 'entrance') {
      const access = fl.entranceAccess?.find((candidate) => candidate.entranceId === selectedComponent.id)
      const route = access ? routeWorld(access.indoorRouteNodeId) : null
      if (access && route) {
        features.push({
          type: 'Feature',
          properties: { type: 'entranceAccess', entityId: selectedComponent.id, indoorRouteNodeId: access.indoorRouteNodeId, outdoorNodeId: access.outdoorNodeId },
          geometry: { type: 'LineString', coordinates: [[selectedComponent.position.lng, selectedComponent.position.lat], [route.lng, route.lat]] },
        })
      }
    }

    source.setData({ type: 'FeatureCollection', features })
  }, [selectedId, selectedComponent, renderVersion, editor.document, building.id, activeFloorId, floor, transformer, mapReady])

  // Derive rooms from canonical wall graph (W5)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!transformer) return

    try {
      const bld = editor.document.buildings.find((b) => b.id === building.id)
      if (!bld) return
      const fl = resolveFloorScope(bld.floors, activeFloorId, floor)
      if (!fl?.walls || fl.walls.length === 0) {
        const src = map.getSource('floor-derived-rooms') as maplibregl.GeoJSONSource | undefined
        if (src) src.setData({ type: 'FeatureCollection', features: [] })
        return
      }

      const segments = wallsToSegments(fl.walls)
      const derivedRooms = deriveRooms(segments, [])

      const features: GeoJSON.Feature[] = []
      for (const room of derivedRooms) {
        const points = room.polygon.points
        if (points.length < 3 || !room.faceId) continue

        const attributes = fl.roomAttributes?.find((candidate) => candidate.faceId === room.faceId)
        const roomType = attributes ? (attributes.type ?? attributes.category) : room.category
        const roomCode = attributes ? (attributes.code ?? attributes.number) : ''

        const worldCoords: [number, number][] = []
        for (const p of points) {
          const world = transformer.buildingLocalToWorld(p, building.id)
          if (!world) continue
          worldCoords.push([world.lng, world.lat])
        }
        if (worldCoords.length < 3) continue

        // Close the ring
        const first = worldCoords[0]
        const last = worldCoords[worldCoords.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) {
          worldCoords.push(first)
        }

        features.push({
          type: 'Feature',
          properties: {
            id: attributes?.roomId ?? room.faceId,
            faceId: room.faceId,
            ...(attributes?.roomId ? { roomId: attributes.roomId } : {}),
            semanticRoom: !!attributes,
            name: attributes?.name ?? '',
            type: roomType ?? '',
            code: roomCode ?? '',
            description: attributes?.description ?? '',
            number: attributes?.number ?? '',
            category: attributes?.category ?? room.category,
            searchable: attributes?.searchable !== false,
            height: 0.1,
            base: 0.1,
          },
          geometry: { type: 'Polygon', coordinates: [worldCoords] },
        })
      }

      const src = map.getSource('floor-derived-rooms') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData({ type: 'FeatureCollection', features })
    } catch { console.warn('FloorEditorCanvas: derived rooms source not ready') }
  }, [renderVersion, building.id, activeFloorId, floor, transformer, mapReady])

  // Populate room labels from floor components
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    try {
      const features: GeoJSON.Feature[] = floorComponents
        .filter((c) => c.type === 'room' && c.polygon && c.polygon.length >= 3 && c.name)
        .map((c) => {
          const centroid = c.polygon!.reduce(
            (acc, p) => ({ lat: acc.lat + p.lat / c.polygon!.length, lng: acc.lng + p.lng / c.polygon!.length }),
            { lat: 0, lng: 0 },
          )
          return {
            type: 'Feature' as const,
            properties: { label: c.name, id: c.id },
            geometry: { type: 'Point' as const, coordinates: [centroid.lng, centroid.lat] as [number, number] },
          }
        })

      const src = map.getSource('floor-room-labels') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData({ type: 'FeatureCollection', features })
    } catch { console.warn('FloorEditorCanvas: room labels source not ready') }
  }, [floorComponents, renderVersion, mapReady])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('floor-selection') as maplibregl.GeoJSONSource
    if (!src) return
    if (selectedWallId) {
      const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
      const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
      const wall = fl?.walls?.find((candidate) => candidate.id === selectedWallId)
      const feature = wall && transformer ? wallFeature(wall, transformer, building.id, { type: 'line' }) : null
      src.setData({ type: 'FeatureCollection', features: feature ? [{ ...feature, properties: { type: 'line' } }] : [] })
      return
    }
    if (!selectedId || !selectedComponent) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const comp = selectedComponent

    // Hallway selection visuals are managed by LinearGeometryOverlay
    if (comp.type === 'hallway') {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    if (comp.type === 'route-edge') {
      const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
      const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
      const edgeId = (comp.metadata?.edgeId as string | undefined) ?? comp.id
      const edge = fl?.routeNetwork?.edges.find((candidate) => candidate.id === edgeId)
      const from = edge ? fl?.routeNetwork?.nodes.find((candidate) => candidate.id === edge.from) : undefined
      const to = edge ? fl?.routeNetwork?.nodes.find((candidate) => candidate.id === edge.to) : undefined
      const fromWorld = from && transformer ? transformer.buildingLocalToWorld(from.position, building.id) : null
      const toWorld = to && transformer ? transformer.buildingLocalToWorld(to.position, building.id) : null
      if (fromWorld && toWorld) {
        src.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { type: 'line', id: edgeId },
            geometry: { type: 'LineString', coordinates: [[fromWorld.lng, fromWorld.lat], [toWorld.lng, toWorld.lat]] },
          }],
        })
      } else {
        src.setData({ type: 'FeatureCollection', features: [] })
      }
      return
    }
    const minPoints = 3
    if (comp.polygon && comp.polygon.length >= minPoints) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { type: 'fill' }, geometry: { type: 'Polygon', coordinates: [[...comp.polygon.map((p) => [p.lng, p.lat] as [number, number]), [comp.polygon[0].lng, comp.polygon[0].lat] as [number, number]]] } },
          { type: 'Feature', properties: { type: 'line' }, geometry: { type: 'LineString', coordinates: [...comp.polygon.map((p) => [p.lng, p.lat] as [number, number]), [comp.polygon[0].lng, comp.polygon[0].lat] as [number, number]] } },
        ],
      })
    } else if (comp.position) {
      const p = comp.position
      src.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { type: 'circle' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } },
        ],
      })
    }
  }, [selectedId, selectedComponent, selectedWallId, renderVersion, editor.document, building.id, activeFloorId, floor, transformer, mapReady])

  // Relationship overlay — ephemeral visualization of entrance↔road connections
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const doc = editor.document
    if (!doc) return
    const geometry = buildRelationshipGeometry(selectedId, doc, transformer)
    renderRelationshipOverlay(map, geometry)
  }, [selectedId, renderVersion, transformer, mapReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    // Check if we're in interaction mode (roads should be highlighted)
    const interactionState = getInteractionController().getState()
    const inRelationshipMode = interactionState.mode === 'relationshipSelection'

    const in2_5D = viewMode === '2.5d'
    const visibilityMap: Record<string, boolean> = {
      'floor-floorplan-layer': layers.floor_plan,
      'floor-buildings-fill': true,
      'floor-buildings-outline': true,
      'floor-areas-fill': true,
      'floor-areas-outline': true,
      'floor-rooms-fill': layers.rooms,
      'floor-rooms-outline': layers.rooms,
      'floor-door-areas-fill': !in2_5D && layers.assets,
      'floor-door-areas-outline': !in2_5D && layers.assets,
      'floor-door-areas-extrusion': in2_5D && layers.assets,
      'floor-derived-rooms-fill': in2_5D || layers.rooms,
      'floor-derived-rooms-outline': in2_5D || layers.rooms,
      'floor-stair-areas-fill': in2_5D || layers.assets,
      'floor-stair-areas-outline': in2_5D || layers.assets,
      'floor-stair-treads-line': in2_5D || layers.assets,
      'floor-stair-arrows-line': in2_5D || layers.assets,
      'floor-elevator-areas-fill': in2_5D || layers.assets,
      'floor-elevator-areas-outline': in2_5D || layers.assets,
      'floor-elevator-cabins-outline': in2_5D || layers.assets,
      'floor-roads-fill': inRelationshipMode,
      'floor-roads-outline': inRelationshipMode,
      'floor-walls-line': layers.rooms,
      'floor-wall-edit-preview-line': layers.rooms,
      'floor-wall-junctions-layer': layers.rooms && tool === 'select' && !readOnly,
      'floor-assets-layer': layers.assets,
      'floor-items-stairs': in2_5D || layers.assets,
      'floor-items-stairs-label': in2_5D || layers.assets,
      'floor-items-entrance': in2_5D || layers.assets,
      'floor-items-entrance-label': in2_5D || layers.assets,
      'floor-nodes-layer': layers.nodes,
      'floor-edges-layer': layers.edges,
      'floor-labels-layer': in2_5D || layers.labels,
      'floor-room-labels-layer': in2_5D,
      'floor-openings-door': in2_5D || layers.rooms,
      'floor-openings-window': in2_5D || layers.rooms,
      'floor-openings-door-label': in2_5D || layers.rooms,
      'floor-openings-window-label': in2_5D || layers.rooms,
      'floor-route-nodes-circle': in2_5D || layers.nodes,
      'floor-route-edges-line': layers.edges,
      'floor-route-edges-3d-extrusion': in2_5D && layers.edges,
      'floor-route-access-line': true,
      'floor-walls-3d-extrusion': in2_5D,
    }
    for (const [id, visible] of Object.entries(visibilityMap)) {
      if (!map.getLayer(id)) continue
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }, [layers, alignMode, mapReady, interactionState, viewMode])

  // Vertex handles + dragging for polygon components
  const dragRef = useRef<{ vertexIndex: number; componentId: string; originalLocal?: LocalCoord[] } | null>(null)
  const moveDragRef = useRef<{ componentId: string; originalPolygon: LatLng[]; startLatLng: { lat: number; lng: number } } | null>(null)
  const rotationDragRef = useRef<{ componentId: string; originalLocal: LocalCoord[]; center: LocalCoord; startAngle: number } | null>(null)
  const workingPolygonRef = useRef<LatLng[] | null>(null)

  const deleteVertex = useCallback((cId: string, vIdx: number) => {
    const comp = floorComponentsRef.current.find((c) => c.id === cId)
    if (!comp?.polygon) return
    if (comp.type === 'hallway') return
    const minPoints = 3
    if (comp.polygon.length <= minPoints) return
    const newPolygon = comp.polygon.filter((_, i) => i !== vIdx)
    if (transformer) {
      const localPoints = newPolygon.map((p) => transformer.worldToBuildingLocal(p, building.id) ?? { x: 0, y: 0 })
      dispatcher.execute({ id: 'entity.update', label: `Delete ${comp.type} vertex`, payload: { entityId: cId, changes: { polygon: { points: localPoints } } } })
    }
  }, [dispatcher, transformer, building.id])

  const insertVertex = useCallback((cId: string, segIdx: number) => {
    const comp = floorComponentsRef.current.find((c) => c.id === cId)
    if (!comp?.polygon || segIdx >= comp.polygon.length - 1) return
    if (comp.type === 'hallway') return
    const mid = {
      lat: (comp.polygon[segIdx].lat + comp.polygon[segIdx + 1].lat) / 2,
      lng: (comp.polygon[segIdx].lng + comp.polygon[segIdx + 1].lng) / 2,
    }
    const newPolygon = [...comp.polygon.slice(0, segIdx + 1), mid, ...comp.polygon.slice(segIdx + 1)]
    if (transformer) {
      const localPoints = newPolygon.map((p) => transformer.worldToBuildingLocal(p, building.id) ?? { x: 0, y: 0 })
      dispatcher.execute({ id: 'entity.update', label: `Insert ${comp.type} vertex`, payload: { entityId: cId, changes: { polygon: { points: localPoints } } } })
    }
  }, [dispatcher, transformer, building.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('floor-vertex-handles') as maplibregl.GeoJSONSource
    if (!src) return
    if (readOnly) { src.setData({ type: 'FeatureCollection', features: [] }); return }
    if (!selectedId || !selectedComponent) { src.setData({ type: 'FeatureCollection', features: [] }); return }
    // Hallway vertex handles are managed by LinearGeometryOverlay
    if (selectedComponent.type === 'hallway') {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    // Semantic Rooms are projections of wall-derived faces. They never expose
    // polygon vertex handles because Walls remain the sole geometry authority.
    if (isSemanticRoomComponent(selectedComponent)) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    if (!selectedComponent.polygon || selectedComponent.polygon.length < 2) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const supportsRotation = selectedComponent.type === 'door' || selectedComponent.type === 'stair' || selectedComponent.type === 'elevator'
    const vertices = supportsRotation
      ? rectangleHandleFeatures(map, selectedComponent.id, selectedComponent.polygon)
      : selectedComponent.polygon.map((p, i) => ({
        type: 'Feature' as const,
        properties: { type: 'vertex', vertexIndex: i, componentId: selectedComponent.id },
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
      }))
    src.setData({ type: 'FeatureCollection', features: vertices })
  }, [selectedId, selectedComponent, renderVersion, readOnly, mapReady])

  // Shared wall-junction handles are shown only for a selected structural wall.
  // Semantic Room projections deliberately never receive polygon handles.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (readOnly || tool !== 'select' || !selectedWallId || !transformer) {
      setSourceData(map, 'floor-wall-junctions', [])
      return
    }

    const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
    const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
    const walls = fl?.walls
    if (!walls?.length) {
      setSourceData(map, 'floor-wall-junctions', [])
      return
    }

    setSourceData(map, 'floor-wall-junctions', wallJunctionFeatures(walls, selectedWallId, transformer, building.id))
  }, [selectedWallId, renderVersion, readOnly, tool, transformer, building.id, activeFloorId, floor, editor.document, mapReady])

  // Point placement preview (entrance / stair / elevator tools)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    const onMove = (e: maplibregl.MapMouseEvent) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      const curTool = toolRef.current
      const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng }

      const previewSrc = map.getSource('floor-point-preview') as maplibregl.GeoJSONSource
      if (previewSrc) {
        if (curTool === 'entrance' || curTool === 'stairs' || curTool === 'elevator') {
          previewSrc.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pos.lng, pos.lat] }, properties: {} }] })
        } else {
          previewSrc.setData({ type: 'FeatureCollection', features: [] })
        }
      }
    }

    map.on('mousemove', onMove)

    return () => {
      try { map.off('mousemove', onMove) } catch { /* zombie map */ }
    }
  }, [mapReady])

  // Drag vertex interaction
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (readOnly) return
    const canvas = map.getCanvas()
    let pendingFrame: number | null = null

    const updateWallDragVisuals = (drag: WallJunctionDrag) => {
      if (!transformer || !selectedWallIdRef.current) return
      const originalById = new Map(drag.originalWalls.map((wall) => [wall.id, wall]))
      const previewFeatures = drag.workingWalls
        .filter((wall) => {
          const original = originalById.get(wall.id)
          return original ? wallChanged(original, wall) : false
        })
        .map((wall) => wallFeature(wall, transformer, building.id, { type: 'wall-edit-preview' }))
        .filter((feature): feature is GeoJSON.Feature => feature !== null)
      setSourceData(map, 'floor-wall-edit-preview', previewFeatures)
      setSourceData(map, 'floor-wall-junctions', wallJunctionFeatures(drag.workingWalls, selectedWallIdRef.current, transformer, building.id))
    }

    const onWallJunctionMouseDown = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (isCapturedRef.current || readOnly || toolRef.current !== 'select') return
      const props = e.features?.[0]?.properties as Record<string, unknown> | undefined
      const junctionId = props?.junctionId as string | undefined
      const wallId = props?.wallId as string | undefined
      if (!junctionId || !wallId) return

      const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
      const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
      const walls = fl?.walls
      if (!walls?.length) return
      const junction = getWallJunctions(walls).find((candidate) => candidate.id === junctionId)
      if (!junction || !junction.endpoints.some((endpoint) => endpoint.wallId === wallId)) return

      e.preventDefault()
      const clonedWalls = cloneWalls(walls)
      wallDragRef.current = { junctionId, originalWalls: clonedWalls, workingWalls: cloneWalls(clonedWalls) }
      selectedWallIdRef.current = wallId
      setSelectedWallId(wallId)
      onSelectRef.current?.(null)
      map.dragPan?.disable()
      setWallEditError(null)
      canvas.style.cursor = 'grabbing'
    }

    const onRouteNodeMouseDown = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (isCapturedRef.current || readOnly || toolRef.current !== 'select') return
      const props = e.features?.[0]?.properties as Record<string, unknown> | undefined
      const nodeId = (props?.id ?? props?.nodeId) as string | undefined
      if (!nodeId) return

      const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
      const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
      const node = fl?.routeNetwork?.nodes.find((candidate) => candidate.id === nodeId)
      if (!fl || !node) return

      e.preventDefault()
      const originalPosition = { ...node.position }
      routeNodeDragRef.current = {
        nodeId,
        floorId: fl.id,
        originalPosition,
        workingPosition: originalPosition,
      }
      setRouteNodePreview({ nodeId, position: originalPosition })
      selectedWallIdRef.current = null
      setSelectedWallId(null)
      onSelectRef.current?.(nodeId)
      map.dragPan?.disable()
      canvas.style.cursor = 'grabbing'
    }

    const onMouseDown = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      if (!e.features || e.features.length === 0) return
      const props = e.features[0].properties as Record<string, unknown>
      const cId = props.componentId as string
      const vIdx = props.vertexIndex as number
      const segIdx = props.segmentIndex as number
      const handleType = props.type as string | undefined
      if (!cId) return
      const comp = floorComponentsRef.current.find((c) => c.id === cId)
      if (!comp?.polygon) return
      if (handleType === 'rotate') {
        if (comp.polygon.length !== 4 || !transformer) return
        const originalLocal = comp.polygon
          .map((point) => transformer.worldToBuildingLocal(point, building.id))
          .filter((point): point is LocalCoord => Boolean(point))
        if (originalLocal.length !== 4) return
        const center = originalLocal.reduce(
          (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
          { x: 0, y: 0 },
        )
        const pointer = transformer.worldToBuildingLocal({ lat: e.lngLat.lat, lng: e.lngLat.lng }, building.id)
        if (!pointer) return
        rotationDragRef.current = { componentId: cId, originalLocal, center, startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x) }
        workingPolygonRef.current = comp.polygon.map((point) => ({ ...point }))
        map.dragPan?.disable()
        canvas.style.cursor = 'grabbing'
        return
      }
      const isDblClick = (e.originalEvent as MouseEvent).detail === 2
      if (isDblClick) {
        if (vIdx != null) {
          deleteVertex(cId, vIdx)
        } else if (segIdx != null) {
          insertVertex(cId, segIdx)
        }
        return
      }
      if (vIdx == null) return
      const isRectangle = comp.type === 'door' || comp.type === 'stair' || comp.type === 'elevator'
      const originalLocal = isRectangle && transformer
        ? comp.polygon.map((point) => transformer.worldToBuildingLocal(point, building.id)).filter((point): point is LocalCoord => Boolean(point))
        : undefined
      dragRef.current = { vertexIndex: vIdx, componentId: cId, ...(originalLocal?.length === 4 ? { originalLocal } : {}) }
      workingPolygonRef.current = comp.polygon.map((p) => ({ ...p }))
      map.dragPan?.disable()
      canvas.style.cursor = 'grabbing'
    }

    const onBodyMouseDown = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      if (tool !== 'select') return
      if (!e.features || e.features.length === 0) return
      const props = e.features[0].properties as Record<string, unknown>
      const cId = props.id as string
      if (!cId) return
      const comp = floorComponentsRef.current.find((c) => c.id === cId)
      if (!comp?.polygon) return
      if (comp.type !== 'room' && comp.type !== 'hallway' && comp.type !== 'elevator' && comp.type !== 'stair' && comp.type !== 'door') return

      // Hallway body drag is handled by useEditablePathEditor
      if (comp.type === 'hallway') return
      moveDragRef.current = {
        componentId: cId,
        originalPolygon: comp.polygon.map((p) => ({ ...p })),
        startLatLng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
      }
      workingPolygonRef.current = comp.polygon.map((p) => ({ ...p }))
      map.dragPan?.disable()
      canvas.style.cursor = 'grabbing'
    }

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      const routeNodeDrag = routeNodeDragRef.current
      if (routeNodeDrag) {
        const local = transformer?.worldToBuildingLocal({ lat: e.lngLat.lat, lng: e.lngLat.lng }, building.id)
        if (!local) return
        routeNodeDrag.workingPosition = { ...local }
        setRouteNodePreview({ nodeId: routeNodeDrag.nodeId, position: routeNodeDrag.workingPosition })
        canvas.style.cursor = 'grabbing'
        return
      }
      const wallDrag = wallDragRef.current
      if (wallDrag) {
        const local = transformer?.worldToBuildingLocal({ lat: e.lngLat.lat, lng: e.lngLat.lng }, building.id)
        if (!local) {
          setWallEditError('Wall handle could not be converted to building coordinates.')
          return
        }
        const snap = snapWallJunctionPosition(local, wallDrag.originalWalls, wallDrag.junctionId, SNAP_CONFIGS[snapModeRef.current])
        const moved = moveWallJunction(wallDrag.originalWalls, wallDrag.junctionId, snap.position)
        if (!moved) {
          setWallEditError('Wall move would create invalid geometry.')
          return
        }
        wallDrag.workingWalls = moved
        setWallEditError(null)
        updateWallDragVisuals(wallDrag)
        return
      }
      const rotationDrag = rotationDragRef.current
      if (rotationDrag && transformer) {
        const pointer = transformer.worldToBuildingLocal({ lat: e.lngLat.lat, lng: e.lngLat.lng }, building.id)
        if (!pointer) return
        const angle = Math.atan2(pointer.y - rotationDrag.center.y, pointer.x - rotationDrag.center.x)
        const localPoints = rotateRectangleFootprint(rotationDrag.originalLocal, angle - rotationDrag.startAngle)
        const worldPoints = localPoints
          .map((point) => transformer.buildingLocalToWorld(point, building.id))
          .filter((point): point is LatLng => Boolean(point))
        if (worldPoints.length === 4) workingPolygonRef.current = worldPoints
      } else if (moveDragRef.current) {
        // Body drag translates entire polygon before vertex drag check
        const deltaLat = e.lngLat.lat - moveDragRef.current.startLatLng.lat
        const deltaLng = e.lngLat.lng - moveDragRef.current.startLatLng.lng
        const working = workingPolygonRef.current
        if (working) {
          for (let i = 0; i < moveDragRef.current.originalPolygon.length; i++) {
            working[i] = { lat: moveDragRef.current.originalPolygon[i].lat + deltaLat, lng: moveDragRef.current.originalPolygon[i].lng + deltaLng }
          }
        }
      }
      const drag = dragRef.current ?? moveDragRef.current ?? rotationDragRef.current
      const working = workingPolygonRef.current
      if (!drag || !working) return
      // Vertex index only applies to vertex drags; for body drag all points are already set above
      if (dragRef.current) {
        if (dragRef.current.originalLocal && transformer) {
          const pointer = transformer.worldToBuildingLocal({ lat: e.lngLat.lat, lng: e.lngLat.lng }, building.id)
          const resized = pointer ? resizeRectangleFootprint(dragRef.current.originalLocal, dragRef.current.vertexIndex, pointer) : null
          const worldPoints = resized
            ?.map((point) => transformer.buildingLocalToWorld(point, building.id))
            .filter((point): point is LatLng => Boolean(point))
          if (worldPoints?.length === 4) workingPolygonRef.current = worldPoints
        } else {
          working[dragRef.current.vertexIndex] = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        }
      }

      if (pendingFrame != null) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        const drag = dragRef.current ?? moveDragRef.current ?? rotationDragRef.current
        const working = workingPolygonRef.current
        if (!drag || !working) return

        const allFloor = floorComponentsRef.current
        const comp = allFloor.find((c) => c.id === drag.componentId)
        if (!comp) return
        const isRoom = comp.type === 'room'
        const isElevator = comp.type === 'elevator'
        const isStair = comp.type === 'stair'
        const isDoor = comp.type === 'door'
        const srcId = isRoom ? 'floor-rooms' : isElevator ? 'floor-elevator-areas' : isStair ? 'floor-stair-areas' : isDoor ? 'floor-door-areas' : undefined


        if (srcId && working.length >= 3) {
          const src = map.getSource(srcId) as maplibregl.GeoJSONSource
          if (src) {
            const features: GeoJSON.Feature[] = []
            for (const c of allFloor) {
              if (c.type !== comp.type || !c.polygon) continue
              const f = componentToFeature(c, c.id === drag.componentId ? working : undefined)
              if (f) features.push(f)
            }
            src.setData({ type: 'FeatureCollection', features })
          }
        }

        const handleSrc = map.getSource('floor-vertex-handles') as maplibregl.GeoJSONSource
        if (handleSrc) {
          const handleFeatures = (isDoor || isElevator || isStair)
            ? rectangleHandleFeatures(map, drag.componentId, working)
            : working.map((p, i) => ({
              type: 'Feature' as const,
              properties: { type: 'vertex', vertexIndex: i, componentId: drag.componentId },
              geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
            }))
          handleSrc.setData({ type: 'FeatureCollection', features: handleFeatures })
        }

        if (isRoom || isElevator || isStair || isDoor) {
          const selSrc = map.getSource('floor-selection') as maplibregl.GeoJSONSource
          if (selSrc && working.length >= 3) {
            selSrc.setData({
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', properties: { type: 'fill' }, geometry: { type: 'Polygon', coordinates: [[...working.map((p) => [p.lng, p.lat] as [number, number]), [working[0].lng, working[0].lat] as [number, number]]] } },
                { type: 'Feature', properties: { type: 'line' }, geometry: { type: 'LineString', coordinates: [...working.map((p) => [p.lng, p.lat] as [number, number]), [working[0].lng, working[0].lat] as [number, number]] } },
              ],
            })
          }
        }
      })
    }

    const onMouseUp = () => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      const routeNodeDrag = routeNodeDragRef.current
      if (routeNodeDrag) {
        routeNodeDragRef.current = null
        map.dragPan?.enable()
        setRouteNodePreview(null)
        canvas.style.cursor = CURSOR_MAP[toolRef.current] ?? 'default'

        if (!sameLocalCoord(routeNodeDrag.originalPosition, routeNodeDrag.workingPosition)) {
          dispatcher.execute({
            id: 'route.node.update',
            label: 'Move Route Node',
            payload: {
              nodeId: routeNodeDrag.nodeId,
              patch: { position: { ...routeNodeDrag.workingPosition } },
            },
          })
        }
        return
      }
      const wallDrag = wallDragRef.current
      if (wallDrag) {
        wallDragRef.current = null
        map.dragPan?.enable()
        setSourceData(map, 'floor-wall-edit-preview', [])

        const originalById = new Map(wallDrag.originalWalls.map((wall) => [wall.id, wall]))
        const patches = wallDrag.workingWalls
          .filter((wall) => {
            const original = originalById.get(wall.id)
            return original ? wallChanged(original, wall) : false
          })
          .map((wall) => {
            const original = originalById.get(wall.id)!
            return {
              wallId: wall.id,
              patch: {
                ...(sameLocalCoord(original.start, wall.start) ? {} : { start: { ...wall.start } }),
                ...(sameLocalCoord(original.end, wall.end) ? {} : { end: { ...wall.end } }),
              },
            }
          })
        const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
        const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)

        if (patches.length > 0 && fl) {
          const result = dispatcher.execute({
            id: 'wall.junction.update',
            label: 'Move Wall Junction',
            payload: { buildingId: building.id, floorId: fl.id, patches },
          })
          if (!result?.success) {
            setWallEditError(result?.error ?? 'Wall edit was rejected.')
            if (transformer && selectedWallIdRef.current) {
              setSourceData(map, 'floor-wall-junctions', wallJunctionFeatures(wallDrag.originalWalls, selectedWallIdRef.current, transformer, building.id))
            }
          } else {
            setWallEditError(null)
            if (transformer && selectedWallIdRef.current) {
              setSourceData(map, 'floor-wall-junctions', wallJunctionFeatures(wallDrag.workingWalls, selectedWallIdRef.current, transformer, building.id))
            }
          }
        } else if (transformer && selectedWallIdRef.current) {
          setSourceData(map, 'floor-wall-junctions', wallJunctionFeatures(wallDrag.originalWalls, selectedWallIdRef.current, transformer, building.id))
        }
        canvas.style.cursor = CURSOR_MAP[toolRef.current] ?? 'default'
        return
      }
      if (pendingFrame != null) { cancelAnimationFrame(pendingFrame); pendingFrame = null }
      const vertexDrag = dragRef.current
      const bodyDrag = moveDragRef.current
      const rotationDrag = rotationDragRef.current
      const drag = vertexDrag ?? bodyDrag ?? rotationDrag
      const working = workingPolygonRef.current
      if (!drag || !working) return
      dragRef.current = null
      moveDragRef.current = null
      rotationDragRef.current = null
      workingPolygonRef.current = null
      map.dragPan?.enable()
      canvas.style.cursor = CURSOR_MAP[tool] ?? 'default'

      const comp = floorComponentsRef.current.find((c) => c.id === drag.componentId)
      if (comp && transformer) {
        const localPoints: { x: number; y: number }[] = []
        for (const p of working) {
          const local = transformer.worldToBuildingLocal(p, building.id)
          if (local) localPoints.push(local)
        }
        const isRectangle = comp.type === 'door' || comp.type === 'stair' || comp.type === 'elevator'
        if (isRectangle && localPoints.length === 4) {
          dispatcher.execute(buildFloorRectangleEditCommand({
            id: comp.id,
            ...(comp.featureId ? { featureId: comp.featureId } : {}),
            type: comp.type as 'door' | 'stair' | 'elevator',
            floor: comp.floor,
          }, localPoints) as Command)
          return
        }

        const changes: Record<string, unknown> = { polygon: { points: localPoints } }

        if (bodyDrag) {
          const origLocal = transformer.worldToBuildingLocal(bodyDrag.originalPolygon[0], building.id)
          const deltaX = origLocal ? (localPoints[0]?.x ?? 0) - origLocal.x : 0
          const deltaY = origLocal ? (localPoints[0]?.y ?? 0) - origLocal.y : 0
          editEngine.begin({ kind: 'move', entityId: drag.componentId, deltaX, deltaY })
          editEngine.doCommit()
        } else if (vertexDrag) {
          const vIdx = vertexDrag.vertexIndex
          editEngine.begin({ kind: 'resize', entityId: drag.componentId, vertexIndex: vIdx, newX: localPoints[vIdx]?.x ?? 0, newY: localPoints[vIdx]?.y ?? 0 })
          editEngine.doCommit()
        }

        dispatcher.execute({
          id: 'entity.update',
          label: bodyDrag ? `Move ${comp.type}` : vertexDrag ? `Resize ${comp.type}` : rotationDrag ? `Rotate ${comp.type}` : `Update ${comp.type}`,
          payload: { entityId: drag.componentId, changes },
        })
      }
    }

    const SELECTABLE_FILL_LAYERS = ['floor-buildings-fill', 'floor-rooms-fill', 'floor-door-areas-fill', 'floor-door-areas-extrusion', 'floor-stair-areas-fill', 'floor-elevator-areas-fill', 'floor-areas-fill']
    const SELECTABLE_POINT_LAYERS = ['floor-items-stairs', 'floor-items-entrance', 'floor-nodes-layer', 'floor-route-nodes-circle']
    const SELECTABLE_ROUTE_LAYERS = ['floor-route-edges-line']
    const SELECTABLE_WALL_LAYERS = ['floor-walls-line']

    // Helper to get road layer IDs for interaction mode
    const getRoadLayerIds = (): string[] => {
      return ['floor-roads-fill', 'floor-roads-outline']
    }

    const onHoverMove = (e: maplibregl.MapMouseEvent) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      if (wallDragRef.current || routeNodeDragRef.current) return
      const controller = getInteractionController()
      const interactionState = controller.getState()

      // Handle interaction mode hover
      if (interactionState.mode === 'relationshipSelection') {
        const roadLayers = getRoadLayerIds()
        const features = map.queryRenderedFeatures(e.point, { layers: roadLayers })
        const hoverSrc = map.getSource('floor-hover') as maplibregl.GeoJSONSource

        if (features.length > 0) {
          canvas.style.cursor = 'pointer'
          // Highlight the hovered road
          const feat = features[0]
          const geom = feat.geometry
          if (hoverSrc && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
            hoverSrc.setData({ type: 'FeatureCollection', features: [toPlainGeoJsonFeature(feat)] })
          }
          // Update cursor
        } else {
          canvas.style.cursor = 'crosshair'
          if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [] })
        }
        return
      }

      const curTool = toolRef.current
      if (curTool === 'space') {
        const features = map.queryRenderedFeatures(e.point, { layers: [...DERIVED_ROOM_LAYER_IDS] })
        const hoverSrc = map.getSource('floor-hover') as maplibregl.GeoJSONSource
        const hit = features.length > 0
          ? readDerivedRoomHit((features[0].properties ?? {}) as Record<string, unknown>)
          : null
        if (hit) {
          canvas.style.cursor = 'pointer'
          if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [toPlainGeoJsonFeature(features[0])] })
        } else {
          canvas.style.cursor = CURSOR_MAP[curTool] ?? 'default'
          if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [] })
        }
        return
      }
      if (curTool !== 'select') {
        if (canvas.style.cursor !== CURSOR_MAP[curTool]) canvas.style.cursor = CURSOR_MAP[curTool] ?? 'default'
        const hoverSrc = map.getSource('floor-hover') as maplibregl.GeoJSONSource
        if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      const wallFeatures = map.queryRenderedFeatures(e.point, { layers: SELECTABLE_WALL_LAYERS })
      if (wallFeatures.length > 0) {
        canvas.style.cursor = 'pointer'
        const hoverSrc = map.getSource('floor-hover') as maplibregl.GeoJSONSource
        if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [toPlainGeoJsonFeature(wallFeatures[0])] })
        return
      }
      const semanticRoomFeature = map.queryRenderedFeatures(e.point, { layers: [...DERIVED_ROOM_LAYER_IDS] })
        .find((feature) => readDerivedRoomHit((feature.properties ?? {}) as Record<string, unknown>)?.roomId)
      if (semanticRoomFeature) {
        canvas.style.cursor = 'pointer'
        const hoverSrc = map.getSource('floor-hover') as maplibregl.GeoJSONSource
        if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [toPlainGeoJsonFeature(semanticRoomFeature)] })
        return
      }
      const allLayers = [...SELECTABLE_FILL_LAYERS, ...SELECTABLE_POINT_LAYERS, ...SELECTABLE_ROUTE_LAYERS]
      const features = map.queryRenderedFeatures(e.point, { layers: allLayers })
      const hoverSrc = map.getSource('floor-hover') as maplibregl.GeoJSONSource
      if (features.length > 0) {
        canvas.style.cursor = 'pointer'
        if (hoverSrc) {
          const feat = features[0]
          const geom = feat.geometry
          if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            hoverSrc.setData({ type: 'FeatureCollection', features: [toPlainGeoJsonFeature(feat)] })
          } else {
            hoverSrc.setData({ type: 'FeatureCollection', features: [] })
          }
        }
      } else {
        canvas.style.cursor = CURSOR_MAP[curTool] ?? 'default'
        if (hoverSrc) hoverSrc.setData({ type: 'FeatureCollection', features: [] })
      }
    }

    const onClickSelect = (e: maplibregl.MapMouseEvent) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return

      // Calibration mode: intercept clicks and convert coordinates
      if (calibrationMode && onCalibrationClick && buildingFp.length >= 3) {
        const step = calibrationStepRef.current
        if (step === 'plan-a' || step === 'plan-b') {
          // Convert screen click through the active image transform into source pixels.
          const canvas = map.getCanvas()
          const rect = canvas.getBoundingClientRect()
          const imgWidth = calImageRef.current?.naturalWidth ?? 1000
          const imgHeight = calImageRef.current?.naturalHeight ?? 800
          const px = screenToImagePixel(e.originalEvent.clientX, e.originalEvent.clientY, map, rect, buildingFp, imgWidth, imgHeight, planAlignment)
          onCalibrationClick('plan', px)
        } else if (step === 'map-a' || step === 'map-b') {
          // Convert screen click to building-local meters
          const canvas = map.getCanvas()
          const rect = canvas.getBoundingClientRect()
          const centroid: Point2D = [buildingFp[0].lng, buildingFp[0].lat]
          const pt = screenToBuildingLocal(e.originalEvent.clientX, e.originalEvent.clientY, map, rect, centroid, buildingFp)
          onCalibrationClick('map', pt)
        }
        return
      }

      const controller = getInteractionController()
      const interactionState = controller.getState()

      // Handle interaction mode (RelationshipSelection)
      if (interactionState.mode === 'relationshipSelection') {
        // Query road layers for clicked feature
        const roadLayers = getRoadLayerIds()
        const features = map.queryRenderedFeatures(e.point, { layers: roadLayers })
        if (features.length > 0) {
          const props = features[0].properties as Record<string, unknown>
          const roadId = props.id as string
          if (roadId) {
            // Dispatch connect command
            dispatcher.execute({
              id: 'entrance.connectRoad',
              label: 'Connect Entrance to Road',
              payload: { entranceId: interactionState.ownerId, roadId },
            })
            // Return to idle
            controller.onCancel({ type: 'cancel', reason: 'modeSwitch' })
          }
        }
        return
      }

      // Room mode selects a derived face and declares semantic metadata when
      // the face has not been assigned yet. It never selects a legacy polygon.
      const curTool = toolRef.current
      if (curTool === 'space') {
        if (readOnly) return
        const features = map.queryRenderedFeatures(e.point, { layers: [...DERIVED_ROOM_LAYER_IDS] })
        const hit = features.length > 0
          ? readDerivedRoomHit((features[0].properties ?? {}) as Record<string, unknown>)
          : null
        if (!hit) {
          onSelectRef.current?.(null)
          return
        }
        if (hit.roomId) {
          onSelectRef.current?.(hit.roomId)
          return
        }

        const bld = editor.document.buildings.find((candidate) => candidate.id === building.id)
        const fl = bld && resolveFloorScope(bld.floors, activeFloorId, floor)
        if (!fl) return
        const result = dispatcher.execute({
          id: 'roomAttributes.declare',
          label: 'Declare Room',
          payload: { buildingId: building.id, floorId: fl.id, faceId: hit.faceId },
        })
        if (result?.success) onSelectRef.current?.(result.entityId ?? null)
        return
      }

      // Normal select mode
      if (curTool !== 'select') return
      const wallFeatures = map.queryRenderedFeatures(e.point, { layers: SELECTABLE_WALL_LAYERS })
      if (wallFeatures.length > 0) {
        const wallId = (wallFeatures[0].properties as Record<string, unknown> | undefined)?.id as string | undefined
        if (wallId) {
          selectedWallIdRef.current = wallId
          setSelectedWallId(wallId)
          onSelectRef.current?.(null)
        }
        return
      }
      selectedWallIdRef.current = null
      setSelectedWallId(null)
      const semanticRoomFeature = map.queryRenderedFeatures(e.point, { layers: [...DERIVED_ROOM_LAYER_IDS] })
        .find((feature) => readDerivedRoomHit((feature.properties ?? {}) as Record<string, unknown>)?.roomId)
      if (semanticRoomFeature) {
        const roomHit = readDerivedRoomHit((semanticRoomFeature.properties ?? {}) as Record<string, unknown>)
        if (roomHit?.roomId) onSelectRef.current?.(roomHit.roomId)
        return
      }
      const allLayers = [...SELECTABLE_FILL_LAYERS, ...SELECTABLE_POINT_LAYERS, ...SELECTABLE_ROUTE_LAYERS]
      const features = map.queryRenderedFeatures(e.point, { layers: allLayers })
      if (features.length > 0) {
        const props = features[0].properties as Record<string, unknown>
        const cId = props.id as string
        if (cId) onSelectRef.current?.(cId)
      }
    }

    const onVertexEnter = () => { canvas.style.cursor = 'grab' }
    const onVertexLeave = () => { if (!dragRef.current) canvas.style.cursor = CURSOR_MAP[tool] ?? 'default' }
    const onMidpointEnter = () => { canvas.style.cursor = 'copy' }
    const onMidpointLeave = () => { if (!dragRef.current) canvas.style.cursor = CURSOR_MAP[tool] ?? 'default' }

    map.on('mouseenter', 'floor-vertex-handles-layer', onVertexEnter)
    map.on('mouseleave', 'floor-vertex-handles-layer', onVertexLeave)
    map.on('mouseenter', 'floor-midpoint-handles-layer', onMidpointEnter)
    map.on('mouseleave', 'floor-midpoint-handles-layer', onMidpointLeave)
    map.on('mouseenter', 'floor-rotation-handle-layer', onVertexEnter)
    map.on('mouseleave', 'floor-rotation-handle-layer', onVertexLeave)
    map.on('mousedown', 'floor-wall-junctions-layer', onWallJunctionMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-route-nodes-circle', onRouteNodeMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-vertex-handles-layer', onMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-midpoint-handles-layer', onMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-rotation-handle-layer', onMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-rooms-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-door-areas-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-door-areas-extrusion', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-stair-areas-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('mousedown', 'floor-elevator-areas-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
    map.on('click', onClickSelect)
    map.on('mousemove', onMouseMove)
    map.on('mousemove', onHoverMove)
    map.on('mouseup', onMouseUp)

    // Right-click cancels interaction mode
    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      // P4-T4: Suppress MapLibre when Canvas has captured pointer
      if (isCapturedRef.current) return
      const controller = getInteractionController()
      if (controller.getState().mode !== 'idle') {
        e.preventDefault()
        controller.onCancel({ type: 'cancel', reason: 'rightClick' })
      }
    }
    map.on('contextmenu', onContextMenu)

    return () => {
      cancelWallJunctionDrag()
      if (routeNodeDragRef.current) {
        routeNodeDragRef.current = null
        map.dragPan?.enable()
        setRouteNodePreview(null)
      }
      if (pendingFrame != null) cancelAnimationFrame(pendingFrame)
      try {
        map.off('mouseenter', 'floor-vertex-handles-layer', onVertexEnter)
        map.off('mouseleave', 'floor-vertex-handles-layer', onVertexLeave)
        map.off('mouseenter', 'floor-midpoint-handles-layer', onMidpointEnter)
        map.off('mouseleave', 'floor-midpoint-handles-layer', onMidpointLeave)
        map.off('mouseenter', 'floor-rotation-handle-layer', onVertexEnter)
        map.off('mouseleave', 'floor-rotation-handle-layer', onVertexLeave)
        map.off('mousedown', 'floor-wall-junctions-layer', onWallJunctionMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-route-nodes-circle', onRouteNodeMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-vertex-handles-layer', onMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-midpoint-handles-layer', onMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-rotation-handle-layer', onMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-rooms-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-door-areas-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-door-areas-extrusion', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-stair-areas-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('mousedown', 'floor-elevator-areas-fill', onBodyMouseDown as (e: maplibregl.MapMouseEvent) => void)
        map.off('click', onClickSelect)
        map.off('mousemove', onMouseMove)
        map.off('mousemove', onHoverMove)
        map.off('mouseup', onMouseUp)
        map.off('contextmenu', onContextMenu)
      } catch { /* zombie map — already destroyed */ }
    }

  }, [mapReady, selectedId, floorComponents, tool, dispatcher, transformer, renderVersion, editEngine, building.id, activeFloorId, floor, readOnly, onSelect, cancelWallJunctionDrag, calibrationMode, onCalibrationClick, planAlignment, buildingFp, onCalibrationImageLoaded])

  // Door "Connect to Route…" pick mode: a node click resolves directly, an
  // edge click opens the junction-creation prompt.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !routeConnectPick) return
    const handlePickClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['floor-route-nodes-circle', 'floor-route-edges-line'] })
      const target = resolveRouteTargetHit(features as never, { lat: e.lngLat.lat, lng: e.lngLat.lng })
      if (!target) return
      if (target.kind === 'node') {
        onRouteConnectResolved?.({ doorId: routeConnectPick.doorId, routeNodeId: target.id })
        return
      }
      if (target.kind === 'edge') {
        setDoorConnectPrompt({ edgeId: target.id, position: target.position })
      }
    }
    map.on('click', handlePickClick)
    return () => { try { map.off('click', handlePickClick) } catch { /* map removed */ } }
  }, [mapReady, routeConnectPick, onRouteConnectResolved])

  useEffect(() => {
    if (!routeConnectPick) setDoorConnectPrompt(null)
  }, [routeConnectPick])

  // Keyboard shortcuts (window-level — no canvas focus needed)
  useEffect(() => {
    if (readOnly) return
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return

      if (e.key === 'Escape' && wallDragRef.current) {
        cancelWallJunctionDrag()
        return
      }

      if (e.key === 'Escape' && selectedWallIdRef.current) {
        selectedWallIdRef.current = null
        setSelectedWallId(null)
        return
      }

      // Handle interaction mode Esc first — but fall through to also
      // cancel any active drawing so the preview line is cleared.
      const controller = getInteractionController()
      if (e.key === 'Escape' && controller.getState().mode !== 'idle') {
        controller.onCancel({ type: 'cancel', reason: 'escape' })
      }

      if (e.key === 'Escape') {
        if (drawMode !== 'idle') {
          cancelDrawing()
        } else if (selectedId) {
          onSelect?.(null)
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        if (selectedComponent) {
          const semanticIdentity = getSemanticRoomIdentity(selectedComponent)
          if (semanticIdentity) {
            dispatcher.execute({ id: 'roomAttributes.unassign', label: 'Unassign Room', payload: { ...semanticIdentity } })
          } else {
            editEngine.begin({ kind: 'delete', entityIds: [selectedId] })
            editEngine.doCommit()

            if (selectedComponent.type === 'stair' || selectedComponent.type === 'elevator') {
              const featureId = selectedComponent.featureId || (selectedId.includes('-') ? selectedId.split('-')[0] : selectedId)
              dispatcher.execute({ id: 'feature.delete', label: `Delete ${selectedComponent.type}`, payload: { featureId } })
            } else {
              const commandByType: Record<string, string> = { room: 'room.delete', hallway: 'hallway.delete', entrance: 'entrance.delete', restroom: 'room.delete', area: 'area.delete', door: 'door.delete' }
              const payloadByType: Record<string, string> = { room: 'roomId', hallway: 'hallwayId', entrance: 'entranceId', restroom: 'roomId', area: 'areaId', door: 'doorId' }
              const cmdId = commandByType[selectedComponent.type]
              const payloadKey = payloadByType[selectedComponent.type]
              if (cmdId && payloadKey) {
                dispatcher.execute({ id: cmdId, label: `Delete ${selectedComponent.type}`, payload: { [payloadKey]: selectedId } })
              }
            }
          }

        }
        onSelect?.(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedId, onSelect, selectedComponent, dispatcher, drawMode, cancelDrawing, readOnly, cancelWallJunctionDrag])

  // Align mode cursor + 2.5D inspection cursor
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (viewMode === '2.5d') {
      map.getCanvas().style.cursor = 'crosshair'
    } else {
      map.getCanvas().style.cursor = CURSOR_MAP[tool] ?? 'default'
    }
  }, [tool, alignMode, viewMode])

  // Bug A fix (T1): the floorPlanUrl prop is the already-correct per-floor URL
  // resolved by the parent. Use it directly instead of re-reading from the shared
  // building.floorPlanUrls which could shadow the per-floor planImageId.
  const activePlanUrl = floorPlanUrl
  const hasFloorPlan = !!activePlanUrl

  const effectiveFootprint: LatLng[] = useMemo(() => {
    if (buildingFp.length >= 3) return buildingFp
    const compPolys = floorComponents.flatMap((c) => c.polygon ?? []).filter(Boolean)
    if (compPolys.length >= 3) return compPolys
    const centerLat = building?.center?.lat ?? 14.5995
    const centerLng = building?.center?.lng ?? 120.9842
    const delta = 0.0003
    return [
      { lat: centerLat + delta, lng: centerLng - delta },
      { lat: centerLat + delta, lng: centerLng + delta },
      { lat: centerLat - delta, lng: centerLng + delta },
      { lat: centerLat - delta, lng: centerLng - delta },
    ]
  }, [buildingFp, floorComponents, building?.center])

  const floorPlanCoords = alignMode && hasFloorPlan && effectiveFootprint.length >= 3
    ? computeFloorPlanCoords(effectiveFootprint, planAlignment)
    : null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Renderer indicator badge */}
      <div style={{
        position: 'absolute', top: 4, left: 4, zIndex: 100,
        background: ENABLE_CANVAS_EDITOR ? '#10B981' : '#F59E0B',
        color: '#fff', fontSize: 11, fontWeight: 'bold', padding: '3px 8px',
        borderRadius: 4, fontFamily: 'monospace', pointerEvents: 'none',
      }}>
        {ENABLE_CANVAS_EDITOR ? 'CANVAS + MAPLIBRE' : 'MAPLIBRE'}
      </div>
      {/* MapLibre — always renders (geographic context) */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      {/* Canvas overlay — renders when flag is ON (indoor authoring) */}
      {ENABLE_CANVAS_EDITOR && (
        <CanvasFloorView
          building={building}
          floorIndex={floor}
          floorComponents={floorComponents}
          pathProj={pathProj}
          transformer={transformer}
          onSelect={onSelect}
          tool={tool}
          mapRef={mapRef}
          buildingFp={buildingFp}
        />
      )}
      {alignMode && mapReady && floorPlanCoords && (
        <FloorPlanAlignment
          map={mapRef.current!}
          floorPlanCoords={floorPlanCoords}
          buildingFp={effectiveFootprint}
          alignment={planAlignment ?? {}}
          floorPlanUrl={activePlanUrl}
          locked={overlayLocked ?? planAlignment?.locked ?? locked}
          aspectRatioLocked={aspectRatioLocked}
          onAspectRatioLockedChange={onAspectRatioLockedChange}
          onChange={(a) => onAlignmentChange?.({ ...planAlignment, ...a })}
        />
      )}
      {mapReady && floorComponents.filter((c) => c.type === 'hallway').map((c) => {
        const path = pathProj ? componentToEditablePath(c, toLocal, true) : null
        const data = extractHallwayData(c)
        if (!path || !data) return null
        return (
          <HallwayRenderer
            key={c.id}
            map={mapRef.current!}
            path={path}
            toLatLng={toLatLng}
            width={data.width}
            visible={layers.hallways}
          />
        )
      })}
      {displayPath && mapReady && tool === 'select' && (
        <LinearGeometryOverlay
          map={mapRef.current!}
          path={displayPath}
          session={pathEditor.session}
          project={project}
          unproject={unproject}
          onVertexPointerDown={pathEditor.onVertexPointerDown}
          onSegmentPointerDown={pathEditor.onSegmentPointerDown}
          onPointerMove={pathEditor.onPointerMove}
          onPointerUp={pathEditor.onPointerUp}
          insertVertex={(segmentId) => pathEditor.insertVertex(segmentId)}
          setHoveredVertex={pathEditor.setHoveredVertex}
          setHoveredSegment={pathEditor.setHoveredSegment}
          enabled={true}
        />
      )}
      {drawMode !== 'idle' && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 6, background: '#1E293B', borderRadius: 8, padding: '4px 6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, color: '#94A3B8', padding: '0 4px' }}>
            {tool === 'hallway' ? 'Route: ' : ''}{pendingPolygon.length} point{pendingPolygon.length !== 1 ? 's' : ''} (need {tool === 'hallway' ? 2 : 3})
          </span>
          <button onClick={removeLastPoint} disabled={pendingPolygon.length < 1}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', borderRadius: 6, border: 'none', background: pendingPolygon.length < 1 ? '#374151' : '#475569', color: pendingPolygon.length < 1 ? '#6B7280' : '#fff', fontSize: 11, cursor: pendingPolygon.length < 1 ? 'not-allowed' : 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
          <button onClick={confirmDrawing} disabled={pendingPolygon.length < (tool === 'hallway' ? 2 : 3)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: 'none', background: pendingPolygon.length < (tool === 'hallway' ? 2 : 3) ? '#374151' : '#10B981', color: pendingPolygon.length < (tool === 'hallway' ? 2 : 3) ? '#6B7280' : '#fff', fontSize: 11, cursor: pendingPolygon.length < (tool === 'hallway' ? 2 : 3) ? 'not-allowed' : 'pointer' }}>
            {tool === 'hallway' ? '✓ Finish Route' : '✓ Confirm'}
          </button>
          <button onClick={cancelDrawing}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
            ✗ Cancel
          </button>
        </div>
      )}
      {routeConnectionPrompt && (
        <div
          role="dialog"
          aria-label="Connect to this route network?"
          data-testid="route-connection-prompt"
          style={{
            position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 8, background: '#1E293B',
            borderRadius: 8, padding: '8px 10px', boxShadow: '0 4px 12px rgba(0,0,0,0.35)', zIndex: 13,
          }}
        >
          <span style={{ fontSize: 12, color: '#F8FAFC' }}>Connect to this route network?</span>
          <button type="button" onClick={acceptRouteConnection}
            style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Yes
          </button>
          <button type="button" onClick={declineRouteConnection}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #475569', background: '#334155', color: '#E2E8F0', fontSize: 11, cursor: 'pointer' }}>
            No
          </button>
        </div>
      )}
      {doorConnectPrompt && routeConnectPick && (
        <div role="dialog" aria-label="Create junction and connect door?" data-testid="door-route-connect-prompt"
          style={{ position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, background: '#1E293B', borderRadius: 8, padding: '8px 10px', boxShadow: '0 4px 12px rgba(0,0,0,0.35)', zIndex: 13 }}>
          <span style={{ fontSize: 12, color: '#F8FAFC' }}>Create junction and connect door?</span>
          <button type="button"
            onClick={() => {
              // The prompt stores the click in world LatLng for display purposes;
              // door.route.connect consumes building-local meters (LocalCoord).
              const local = transformer?.worldToBuildingLocal(doorConnectPrompt.position, building.id)
              if (!local) return
              onRouteConnectResolved?.({ doorId: routeConnectPick.doorId, segment: { edgeId: doorConnectPrompt.edgeId, position: { x: local.x, y: local.y } } })
              setDoorConnectPrompt(null)
            }}
            style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Yes</button>
          <button type="button"
            onClick={() => { setDoorConnectPrompt(null); onRouteConnectCancel?.() }}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #475569', background: '#334155', color: '#E2E8F0', fontSize: 11, cursor: 'pointer' }}>No</button>
        </div>
      )}
      {rectangleMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="floor-rectangle-authoring-status"
          style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            maxWidth: 'min(460px, calc(100% - 32px))', background: '#1E293B', color: '#F8FAFC',
            borderRadius: 8, padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 12, pointerEvents: 'none', fontSize: 12, textAlign: 'center',
          }}
        >
          {rectangleMessage}
        </div>
      )}
      {selectedWallId && (
        <div role="status" style={{
          position: 'absolute', top: 28, left: 10, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: 2,
          background: '#1E293B', color: '#F8FAFC', borderRadius: 6, padding: '6px 9px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)', fontSize: 11,
        }}>
          <span>Wall selected — drag an orange corner handle to reshape</span>
          <span style={{ color: '#94A3B8' }}>Escape cancels a drag</span>
          {wallEditError && <span style={{ color: '#FCA5A5' }}>{wallEditError}</span>}
          {!readOnly && (
            <button type="button" aria-label="Delete Wall" onMouseDown={(event) => event.stopPropagation()} onClick={deleteSelectedWall}
              style={{ alignSelf: 'flex-start', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 7px', borderRadius: 4, border: 'none', background: '#DC2626', color: '#fff', fontSize: 10, cursor: 'pointer' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              Delete Wall
            </button>
          )}
        </div>
      )}
      {selectedId && selectedComponent && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 6, background: '#1E293B', borderRadius: 8, padding: '4px 6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10,
        }}>
          <button onClick={() => {
            if (selectedComponent) {
              const semanticIdentity = getSemanticRoomIdentity(selectedComponent)
              if (semanticIdentity) {
                dispatcher.execute({ id: 'roomAttributes.unassign', label: 'Unassign Room', payload: { ...semanticIdentity } })
              } else if (selectedComponent.type === 'route-node') {
                const result = dispatcher.execute({
                  id: 'route.node.delete',
                  label: 'Delete Route Node',
                  payload: { nodeId: selectedId },
                })
                if (!result?.success) return
              } else if (selectedComponent.type === 'route-edge') {
                const result = dispatcher.execute({
                  id: 'route.edge.delete',
                  label: 'Delete Route Edge',
                  payload: { edgeId: selectedId },
                })
                if (!result?.success) return
              } else if (selectedComponent.type === 'stair' || selectedComponent.type === 'elevator') {
                editEngine.begin({ kind: 'delete', entityIds: [selectedId] })
                editEngine.doCommit()
                const featureId = selectedComponent.featureId ?? selectedId
                dispatcher.execute({ id: 'feature.delete', label: `Delete ${selectedComponent.type}`, payload: { featureId } })
              } else {
                editEngine.begin({ kind: 'delete', entityIds: [selectedId] })
                editEngine.doCommit()
                const commandByType: Record<string, string> = { room: 'room.delete', hallway: 'hallway.delete', entrance: 'entrance.delete', restroom: 'room.delete', area: 'area.delete', door: 'door.delete' }
                const payloadByType: Record<string, string> = { room: 'roomId', hallway: 'hallwayId', entrance: 'entranceId', restroom: 'roomId', area: 'areaId', door: 'doorId' }
                const cmdId = commandByType[selectedComponent.type]
                const payloadKey = payloadByType[selectedComponent.type]
                if (cmdId && payloadKey) {
                  dispatcher.execute({ id: cmdId, label: `Delete ${selectedComponent.type}`, payload: { [payloadKey]: selectedId } })
                }
              }
            }
            onSelect?.(null)
          }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            {getSemanticRoomIdentity(selectedComponent) ? 'Delete Room' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── P4-T1/T2/T3: Canvas floor view (behind ENABLE_CANVAS_EDITOR flag) ──

interface CanvasFloorViewProps {
  building: Building
  floorIndex: number
  floorComponents: Component[]
  pathProj: ReturnType<typeof createPathProjection> | null
  transformer: any
  onSelect?: (id: string | null) => void
  tool: StudioTool
  mapRef: React.RefObject<maplibregl.Map | null>
  buildingFp: LatLng[]
}

/**
 * Canvas-based floor view that replaces MapLibre when ENABLE_CANVAS_EDITOR is true.
 * Uses the P2/P3 canvas modules for rendering, hit-testing, and selection.
 * Reuses the existing document state and command system — no parallel editing.
 */
function CanvasFloorView({ building, floorIndex, floorComponents, pathProj, transformer, onSelect, tool, mapRef, buildingFp }: CanvasFloorViewProps) {
  const { lastSelected } = useSelection()
  const selectedId = lastSelected?.id ?? null
  const selectedComponent = floorComponents.find((component) => component.id === selectedId) ?? null
  const editor = useEditor()
  const dispatcher = editor.services.get('dispatcher')!
  const toolRegistry = editor.services.get('toolRegistry')!

  // 12A.2: Canonical InteractionController for event routing/tool delegation
  const canonicalControllerRef = useRef<CanonicalInteractionController | null>(null)
  if (!canonicalControllerRef.current) {
    canonicalControllerRef.current = new CanonicalInteractionController({
      toolRegistry,
      toolContext: { services: editor.services },
      screenToBuildingLocal: (screen) => {
        // Convert Canvas screen pixels to building-local meters
        // using the Canvas viewport's camera state
        return screenToWorld(screen, viewport.camera, viewport.canvasSize)
      },
      buildingLocalToLatLng: transformer
        ? (local) => transformer.buildingLocalToWorld(local, building.id)
        : undefined,
    })
    canonicalControllerRef.current.registerTool(new DoorTool())
    canonicalControllerRef.current.registerTool(new StairTool())
    canonicalControllerRef.current.registerTool(new ElevatorTool())
    canonicalControllerRef.current.registerTool(new EntranceTool())
    canonicalControllerRef.current.registerTool(new POITool())
  }

  // P4-T4: Extract MapLibre camera state for bridge transform
  const mapCamera = useMapLibreCamera(mapRef.current)
  const mapOrigin = building.center ?? buildingFp[0] ?? null

  // P4-T4: InteractionController subscription (local controller for domain modes)
  const [interactionState, setInteractionState] = useState<InteractionState>({ mode: 'idle' })
  useEffect(() => {
    const controller = getInteractionController()
    return controller.onChange((state) => {
      setInteractionState(state)
    })
  }, [])

  // P4-T4: Capture/release semantics — suppress MapLibre when Canvas is active
  const isCaptured = interactionState.mode === 'canvasCapture'
  const controllerRef = useRef(getInteractionController())

  // P4-T4: Hover state for visual feedback
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Convert components to floor geometry
  const floorGeometry = useMemo(() => {
    if (!pathProj) return null
    return componentsToFloorGeometry(floorComponents, floorIndex, pathProj)
  }, [floorComponents, floorIndex, pathProj])

  // Build editable path from selected hallway
  const selectedHallwayPath = useMemo(() => {
    if (selectedComponent?.type !== 'hallway' || !pathProj) return null
    const toLocal = (p: LatLng) => pathProj.unproject(p.lng, p.lat)
    return componentToEditablePath(selectedComponent, toLocal, false)
  }, [selectedComponent, pathProj])

  // Working copy during drag — updated in real-time, committed on drag end
  const [workingPath, setWorkingPath] = useState<EditablePath | null>(null)
  const displayPath = workingPath ?? selectedHallwayPath
  const hasDraggedRef = useRef(false)

  // P4-T3: Vertex drag → local workingPath update
  const handleVertexMoved = useCallback((vertexId: string, newPos: { x: number; y: number }) => {
    hasDraggedRef.current = true
    setWorkingPath((prev) => {
      if (!prev) return prev
      return { ...prev, vertices: prev.vertices.map((v) => v.id === vertexId ? { ...v, x: newPos.x, y: newPos.y } : v) }
    })
  }, [])

  // P4-T3: Commit workingPath → dispatcher (entity.update command)
  const commitWorkingPath = useCallback((path: EditablePath) => {
    if (!selectedId || !building) return
    const localPoints = path.vertices.map((v) => ({ x: v.x, y: v.y }))
    dispatcher.execute({
      id: 'entity.update', label: 'Edit hallway',
      payload: { entityId: selectedId, changes: { polyline: { points: localPoints } } },
    })
  }, [selectedId, building, dispatcher])

  // Shift-snap constraint (matches MapLibre path exactly)
  const constraintProvider = useCallback<ConstraintProvider>((pos, origin, shift) => {
    if (!shift) return pos
    return snapTo45Degrees(pos, origin)
  }, [])

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // P4-T3: Wire editing with command dispatch
  const editingEditor = useEditablePathEditor({
    path: displayPath ?? { id: '', vertices: [], segments: [], closed: false, readOnly: true },
    readOnly: !displayPath,
    constraintProvider,
    onVertexMoved: handleVertexMoved,
    onVertexInserted: useCallback((segmentId: string, pos: { x: number; y: number }) => {
      const path = selectedHallwayPath
      if (!path || !selectedId || !building) return
      const segIdx = path.segments.findIndex((s) => s.id === segmentId)
      if (segIdx < 0) return
      const points = path.vertices.map((v) => ({ x: v.x, y: v.y }))
      points.splice(segIdx + 1, 0, { x: pos.x, y: pos.y })
      dispatcher.execute({
        id: 'entity.update', label: 'Insert hallway vertex',
        payload: { entityId: selectedId, changes: { polyline: { points } } },
      })
    }, [selectedHallwayPath, selectedId, building, dispatcher]),
    onVertexDeleted: useCallback((vertexId: string) => {
      const path = selectedHallwayPath
      if (!path || !selectedId || !building) return
      const idx = path.vertices.findIndex((v) => v.id === vertexId)
      if (idx < 0) return
      const remaining = path.vertices.filter((_, i) => i !== idx)
      if (remaining.length < 2) return
      const localPoints = remaining.map((v) => ({ x: v.x, y: v.y }))
      dispatcher.execute({
        id: 'entity.update', label: 'Delete hallway vertex',
        payload: { entityId: selectedId, changes: { polyline: { points: localPoints } } },
      })
    }, [selectedHallwayPath, selectedId, building, dispatcher]),
  })

  // P4-T3: Detect drag end and commit
  const prevDraggingRef = useRef(false)
  useEffect(() => {
    if (prevDraggingRef.current && !editingEditor.session.isDragging && hasDraggedRef.current && workingPath) {
      commitWorkingPath(workingPath)
      setWorkingPath(null)
      hasDraggedRef.current = false
    }
    prevDraggingRef.current = editingEditor.session.isDragging
  }, [editingEditor.session.isDragging, workingPath, commitWorkingPath])

  // P4-T4: Viewport with selection/hover/handleState in render loop
  const viewport = useCanvasViewport(canvasRef as any, {
    floor: floorGeometry,
    selection: selectedId && selectedComponent ? { type: selectedComponent.type, id: selectedId, name: selectedComponent.name } : null,
    hover: hoveredId ? (() => {
      const hc = floorComponents.find((c) => c.id === hoveredId)
      return hc ? { type: hc.type, id: hc.id, name: hc.name } : null
    })() : null,
    handleState: displayPath && tool === 'select' ? {
      hoveredVertexId: editingEditor.session.hoveredVertexId,
      hoveredSegmentId: editingEditor.session.hoveredSegmentId,
      dragVertexId: editingEditor.session.dragVertexId,
    } : null,
    handleVertices: displayPath ? displayPath.vertices.map((v) => ({ x: v.x, y: v.y, id: v.id })) : [],
    maplibreCamera: mapCamera,
    mapOrigin: mapOrigin,
  })

  const { selection, handleClick } = useCanvasSelection({
    camera: viewport.camera,
    canvasSize: viewport.canvasSize,
    floor: floorGeometry ?? { level: 0, label: '', elevation: 0, offset: { x: 0, y: 0 }, rooms: [], hallways: [], staircases: [], elevators: [], doors: [], pois: [], qrCheckpoints: [] },
    onSelect: (id) => onSelect?.(id),
  })

  const editingAdapter = useCanvasEditingAdapter({
    camera: viewport.camera,
    canvasSize: viewport.canvasSize,
    path: displayPath ?? { id: '', vertices: [], segments: [], closed: false, readOnly: true },
    editor: editingEditor,
    readOnly: !displayPath,
  })

  // P4-T4: Canvas click handler — routes through InteractionController when active
  const handleCanvasClick = useCallback((screenPoint: { x: number; y: number }) => {
    const controller = getInteractionController()
    const icState = controller.getState()

    if (icState.mode === 'relationshipSelection') {
      // In relationship selection mode, route click through InteractionController
      // For Canvas, we do hit-test and pass the result
      if (floorGeometry) {
        const world = screenToWorld(screenPoint, viewport.camera, viewport.canvasSize)
        const hit = hitTestFloor(world, floorGeometry)
        if (hit) {
          const latlng = transformer?.buildingLocalToWorld(world, building.id)
          controller.onClick({
            type: 'click',
            latLng: latlng ?? { lat: 0, lng: 0 },
            featureId: hit.id,
            featureType: hit.type,
          }, editor.document!)
        }
      }
      return
    }

    // Normal selection mode
    handleClick(screenPoint)
  }, [handleClick, floorGeometry, viewport.camera, viewport.canvasSize, editor])

  // P4-T4: Canvas hover handler — routes through InteractionController when active
  const handleCanvasHover = useCallback((worldPoint: { x: number; y: number } | null) => {
    const controller = getInteractionController()
    const icState = controller.getState()

    if (icState.mode === 'relationshipSelection') {
      // In relationship selection mode, route hover through InteractionController
      if (worldPoint && floorGeometry) {
        const hit = hitTestFloor(worldPoint, floorGeometry)
        const latlng = transformer?.buildingLocalToWorld(worldPoint, building.id)
        controller.onHover({
          type: 'hover',
          latLng: latlng ?? { lat: 0, lng: 0 },
          featureId: hit?.id,
          featureType: hit?.type,
        }, editor.document!)
      }
      return
    }

    // Normal hover — update hoveredId for visual feedback
    if (worldPoint && floorGeometry) {
      const hit = hitTestFloor(worldPoint, floorGeometry)
      setHoveredId(hit?.id ?? null)
    } else {
      setHoveredId(null)
    }
  }, [floorGeometry, editor])

  // P4-T4: Keyboard events — route Escape through InteractionController
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return

      // 12A.2: Route through canonical InteractionController for event routing
      const canonicalController = canonicalControllerRef.current
      if (canonicalController) {
        const interactionEvent = {
          type: 'keydown' as const,
          target: 'canvas' as const,
          position: { x: 0, y: 0 },
          originalEvent: e,
          key: e.key,
          code: e.code,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
        }
        canonicalController.handleEvent(interactionEvent)
      }

      // Also route through local controller for domain-specific behavior
      const controller = getInteractionController()
      if (e.key === 'Escape' && controller.getState().mode !== 'idle') {
        controller.onCancel({ type: 'cancel', reason: 'escape' })
        return
      }
    }

    const handleContextMenu = (e: MouseEvent) => {
      const controller = getInteractionController()
      if (controller.getState().mode !== 'idle') {
        e.preventDefault()
        controller.onCancel({ type: 'cancel', reason: 'rightClick' })
      }
    }

    window.addEventListener('keydown', handleKey)
    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [])

  // Cursor based on tool and interaction state
  const cursorStyle = interactionState.mode !== 'idle' ? 'crosshair' : (tool === 'select' ? 'grab' : 'crosshair')

  // P4-T4: Handle pointer capture/release for MapLibre suppression
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // 12A.2: Route through canonical InteractionController for event routing
    const canonicalController = canonicalControllerRef.current
    if (canonicalController) {
      const interactionEvent = {
        type: 'pointerDown' as const,
        target: 'canvas' as const,
        position: { x: e.clientX, y: e.clientY },
        originalEvent: e.nativeEvent,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
      }
      canonicalController.handleEvent(interactionEvent)
    }

    // Capture pointer events — suppress MapLibre navigation
    controllerRef.current.capture(tool)
    editingAdapter.onPointerDown(e.nativeEvent, e.currentTarget as HTMLCanvasElement)
  }, [editingAdapter, tool])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // 12A.2: Route through canonical InteractionController for event routing
    const canonicalController = canonicalControllerRef.current
    if (canonicalController) {
      const interactionEvent = {
        type: 'pointerUp' as const,
        target: 'canvas' as const,
        position: { x: e.clientX, y: e.clientY },
        originalEvent: e.nativeEvent,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
      }
      canonicalController.handleEvent(interactionEvent)
    }

    editingAdapter.onPointerUp(e.nativeEvent)
    // Release capture — MapLibre regains navigation control
    if (controllerRef.current.isCaptured()) {
      controllerRef.current.release()
    }
  }, [editingAdapter])

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 5, pointerEvents: 'auto' }}>
      <div ref={viewport.containerRef} style={{ width: '100%', height: '100%' }}>
        <canvas
          ref={viewport.canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', cursor: cursorStyle }}
          onClick={(e) => handleCanvasClick({ x: e.clientX, y: e.clientY })}
          onPointerDown={handlePointerDown}
          onPointerMove={(e) => {
            // 12A.2: Route through canonical InteractionController for event routing
            const canonicalController = canonicalControllerRef.current
            if (canonicalController) {
              const interactionEvent = {
                type: 'pointerMove' as const,
                target: 'canvas' as const,
                position: { x: e.clientX, y: e.clientY },
                originalEvent: e.nativeEvent,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
              }
              canonicalController.handleEvent(interactionEvent)
            }

            editingAdapter.onPointerMove(e.nativeEvent)
            // Also fire hover for InteractionController
            if (viewport.canvasSize.width > 0) {
              const world = screenToWorld(
                { x: e.clientX, y: e.clientY },
                viewport.camera,
                viewport.canvasSize,
              )
              handleCanvasHover(world)
            }
          }}
          onPointerUp={handlePointerUp}
        />
      </div>
      {/* Canvas status indicator */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        background: '#10B981', color: '#fff', fontSize: 10, padding: '2px 6px',
        borderRadius: 4, fontFamily: 'monospace',
      }}>
        Canvas | {floorComponents.length} components | zoom {viewport.camera.zoom.toFixed(1)}
        {selectedHallwayPath && ` | editing ${selectedHallwayPath.vertices.length} vertices`}
      </div>
    </div>
  )
}
