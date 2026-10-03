'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useEditor, useDocumentSelector, useDocumentVersion, useBuilding, findBuilding, resolveLevelGeometry } from '@navi/editor'
import type { WorkflowSnapshot } from '@navi/editor'
import { canonicalRoomId, localRectangleCornersOf } from '@navi/core'
import type { CampusDocument, CoordinateTransformer, LocalCoord } from '@navi/core'
import { deriveRooms } from '@navi/editor/src/geometry/room-derivation'
import { wallsToSegments } from '@navi/editor/src/geometry/wall-to-segment'
import { useGraphStore } from '@/store/graph-store'
import type { Component, LatLng, Building } from '@/types/nav-types'

// ── Coordinate helper ──

function localPointsToWorld(points: LocalCoord[], buildingId: string, transformer: CoordinateTransformer): LatLng[] {
  const out: LatLng[] = []
  for (const p of points) {
    const w = transformer.buildingLocalToWorld(p, buildingId)
    if (w) out.push(w)
  }
  return out
}

function rectangleDimensions(points: LocalCoord[] | undefined, rotation: number): Component['dimensions'] | undefined {
  if (!points || points.length !== 4) return undefined
  return {
    width: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
    height: Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y),
    rotation,
  }
}

// ── Extract Component[] from a single floor ──

export const SEMANTIC_ROOM_SOURCE = 'derived-face'

/** Resolve Studio's floor scope by canonical identity when it is available. */
export function resolveFloorScope<T extends { id: string; level: number }>(
  floors: readonly T[],
  floorId?: string,
  level?: number,
): T | undefined {
  if (floorId) return floors.find((floor) => floor.id === floorId)
  if (level === undefined) return undefined
  return floors.find((floor) => floor.level === level)
}

export function isSemanticRoomComponent(component: Component | null | undefined): boolean {
  return component?.type === 'room' && component.metadata?.source === SEMANTIC_ROOM_SOURCE && component.metadata?.semanticRoom === true
}

function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 }
  const total = points.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 })
  return { lat: total.lat / points.length, lng: total.lng / points.length }
}

function routeNodeLabel(type: string, ordinal: number): string {
  const base = type === 'waypoint'
    ? 'Waypoint'
    : type === 'entrance'
      ? 'Entrance point'
      : type === 'stair'
        ? 'Stair connector'
        : type === 'elevator'
          ? 'Elevator connector'
          : 'Route point'
  return `${base} ${ordinal}`
}

export function extractFloorComponents(
  doc: CampusDocument,
  buildingId: string,
  floor: { id: string; level: number; rooms: any[]; hallways: any[]; staircases: any[]; elevators: any[]; entrances: any[]; doors?: any[]; parametricComponents?: any[]; walls?: any[]; roomAttributes?: any[]; routeNetwork?: { nodes: Array<{ id: string; type: string; position: LocalCoord; floor: number }>; edges: Array<{ id: string; from: string; to: string; type: string; distance: number }> } },
  transformer: CoordinateTransformer,
): Component[] {
  const result: Component[] = []
  const building = doc.buildings.find(b => b.id === buildingId)

  for (const room of floor.rooms) {
    const worldPoints = localPointsToWorld(room.polygon.points, buildingId, transformer)
    if (worldPoints.length < 3) continue
    result.push({
      id: room.id, type: 'room', name: room.name || room.number,
      buildingId, campusId: '', floor: floor.level,
      position: worldPoints[0], polygon: worldPoints,
    })
  }

  // Semantic Rooms are a projection of derived wall faces plus canonical
  // Floor.roomAttributes. They intentionally do not reuse the legacy Room
  // polygon or expose it as an editable geometry source.
  if (floor.walls?.length && floor.roomAttributes?.length) {
    const derivedRooms = deriveRooms(wallsToSegments(floor.walls), [])
    const attributesByFace = new Map<string, any>(floor.roomAttributes.map((attributes) => [attributes.faceId, attributes]))
    for (const derived of derivedRooms) {
      if (!derived.faceId) continue
      const attributes = attributesByFace.get(derived.faceId)
      if (!attributes) continue
      const worldPoints = localPointsToWorld(derived.polygon.points, buildingId, transformer)
      if (worldPoints.length < 3) continue
      const roomId = canonicalRoomId(attributes)
      const roomType = attributes.type !== undefined ? attributes.type : attributes.category
      const roomCode = attributes.code !== undefined ? attributes.code : attributes.number
      result.push({
        id: roomId,
        type: 'room',
        name: attributes.name || roomCode || 'Room',
        buildingId,
        campusId: '',
        floor: floor.level,
        position: centroid(worldPoints),
        polygon: worldPoints,
        metadata: {
          source: SEMANTIC_ROOM_SOURCE,
          semanticRoom: true,
          faceId: derived.faceId,
          roomId,
          floorId: floor.id,
          ...(roomType !== undefined ? { type: roomType } : {}),
          ...(roomCode !== undefined ? { code: roomCode } : {}),
          ...(attributes.description !== undefined ? { description: attributes.description } : {}),
          ...(attributes.number !== undefined ? { number: attributes.number } : {}),
          ...(attributes.category !== undefined ? { category: attributes.category } : {}),
          searchable: attributes.searchable !== false,
        },
      })
    }
  }

  for (const door of floor.doors ?? []) {
    const worldPosition = transformer.buildingLocalToWorld(door.position, buildingId)
    if (!worldPosition) continue
    const localPoints = door.geometry?.type === 'rectangle'
      ? localRectangleCornersOf(door.geometry)
      : undefined
    const worldPoints = localPoints ? localPointsToWorld(localPoints, buildingId, transformer) : undefined
    result.push({
      id: door.id,
      type: 'door',
      name: door.name || 'Door',
      buildingId,
      campusId: '',
      floor: floor.level,
      position: worldPosition,
      ...(worldPoints && worldPoints.length === 4 ? { polygon: worldPoints } : {}),
      dimensions: { width: door.width, height: door.depth ?? 0.2 },
      metadata: {
        ...(door.roomId ? { roomId: door.roomId } : {}),
        ownershipStatus: door.ownership?.status ?? (door.roomId ? 'assigned' : 'unassigned'),
        doorType: door.doorType,
        width: door.width,
        depth: door.depth ?? 0.2,
        rotation: door.rotation ?? door.geometry?.rotation ?? 0,
        ...(door.routeConnection ? { routeConnection: door.routeConnection } : {}),
      },
    })
  }

  for (const hw of floor.hallways) {
    const worldPoints = localPointsToWorld(hw.polyline.points, buildingId, transformer)
    if (worldPoints.length < 2) continue
    result.push({
      id: hw.id, type: 'hallway', name: hw.name,
      buildingId, campusId: '', floor: floor.level,
      position: worldPoints[0], polygon: worldPoints,
      dimensions: { width: hw.width, height: 0 },
    })
  }

  // Staircases
  if (building?.staircases && building.staircases.length > 0) {
    for (const st of building.staircases) {
      const levelGeom = st.levels[floor.level]
      if (!levelGeom) continue
      const wp = transformer.buildingLocalToWorld(levelGeom.position, buildingId)
      if (!wp) continue
      const { polygon: localPoly, landing } = resolveLevelGeometry(st, floor.level)
      let worldPoly: LatLng[] | undefined
      if (localPoly && localPoly.points.length > 0) {
        const pts = localPointsToWorld(localPoly.points, buildingId, transformer)
        if (pts.length >= 3) worldPoly = pts
      }
      result.push({
        id: `${st.id}-${floor.level}`,
        featureId: st.id,
        type: 'stair',
        name: st.name,
        buildingId,
        campusId: '',
        floor: floor.level,
        position: wp,
        polygon: worldPoly,
        ...(rectangleDimensions(localPoly?.points, levelGeom.rotation) ? { dimensions: rectangleDimensions(localPoly?.points, levelGeom.rotation) } : {}),
        range: { from: st.fromLevel, to: st.toLevel },
        metadata: { type: st.type, rotation: levelGeom.rotation, ...(landing ? { landing } : {}) },
      })
    }
  } else {
    for (const stair of floor.staircases) {
      const wp = transformer.buildingLocalToWorld(stair.position, buildingId)
      if (!wp) continue
      result.push({
        id: stair.id, type: 'stair', name: stair.name,
        buildingId, campusId: '', floor: floor.level,
        position: wp, range: { from: stair.fromLevel, to: stair.toLevel },
      })
    }
  }

  // Elevators
  if (building?.elevators && building.elevators.length > 0) {
    for (const el of building.elevators) {
      const levelGeom = el.levels[floor.level]
      if (!levelGeom) continue
      const wp = transformer.buildingLocalToWorld(levelGeom.position, buildingId)
      if (!wp) continue
      const { polygon: localPoly, landing } = resolveLevelGeometry(el, floor.level)
      let worldPoly: LatLng[] | undefined
      if (localPoly && localPoly.points.length > 0) {
        const pts = localPointsToWorld(localPoly.points, buildingId, transformer)
        if (pts.length >= 3) worldPoly = pts
      }
      result.push({
        id: `${el.id}-${floor.level}`,
        featureId: el.id,
        type: 'elevator',
        name: el.name,
        buildingId,
        campusId: '',
        floor: floor.level,
        position: wp,
        polygon: worldPoly,
        ...(rectangleDimensions(localPoly?.points, levelGeom.rotation) ? { dimensions: rectangleDimensions(localPoly?.points, levelGeom.rotation) } : {}),
        range: { from: el.fromLevel, to: el.toLevel },
        metadata: { rotation: levelGeom.rotation, ...(landing ? { landing } : {}) },
      })
    }
  } else {
    for (const elev of floor.elevators) {
      const wp = transformer.buildingLocalToWorld(elev.position, buildingId)
      if (!wp) continue
      result.push({
        id: elev.id, type: 'elevator', name: elev.name,
        buildingId, campusId: '', floor: floor.level,
        position: wp, range: { from: elev.fromLevel, to: elev.toLevel },
      })
    }
  }

  for (const ent of floor.entrances) {
    // P1-T4 (D9): entrance positions are building-local — derive world for the
    // render-model component.
    const wp = transformer.buildingLocalToWorld(ent.position, buildingId)
    if (!wp) continue
    result.push({
      id: ent.id, type: 'entrance', name: ent.label,
      buildingId, campusId: '', floor: ent.level,
      position: wp,
    })
  }

  // Route nodes and edges are editor projections of the independent
  // Floor.routeNetwork graph. They deliberately have no polygon and never
  // enter the physical-room/hallway rendering paths above.
  const routeNetwork = floor.routeNetwork
  if (routeNetwork) {
    const worldByNodeId = new Map<string, LatLng>()
    const routeNodeOrdinals = new Map<string, number>()
    for (const node of routeNetwork.nodes) {
      const position = transformer.buildingLocalToWorld(node.position, buildingId)
      if (!position) continue
      worldByNodeId.set(node.id, position)
      const ordinal = (routeNodeOrdinals.get(node.type) ?? 0) + 1
      routeNodeOrdinals.set(node.type, ordinal)
      result.push({
        id: node.id,
        type: 'route-node',
        name: routeNodeLabel(node.type, ordinal),
        buildingId,
        campusId: '',
        floor: floor.level,
        position,
        metadata: {
          routeEntity: 'node',
          nodeId: node.id,
          nodeType: node.type,
          floor: node.floor,
          localPosition: { ...node.position },
          floorId: floor.id,
        },
      })
    }

    let routeSegmentOrdinal = 0
    for (const edge of routeNetwork.edges) {
      const from = worldByNodeId.get(edge.from)
      const to = worldByNodeId.get(edge.to)
      if (!from || !to) continue
      routeSegmentOrdinal += 1
      const midpoint = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 }
      result.push({
        id: edge.id,
        type: 'route-edge',
        name: `Route segment ${routeSegmentOrdinal}`,
        buildingId,
        campusId: '',
        floor: floor.level,
        position: midpoint,
        metadata: {
          routeEntity: 'edge',
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          edgeType: edge.type,
          distance: edge.distance,
          floorId: floor.id,
        },
      })
    }
  }

  return result
}

function findOneComponent(doc: CampusDocument, id: string, transformer: CoordinateTransformer): Component | null {
  if (!transformer) return null
  for (const building of doc.buildings) {
    for (const floor of building.floors) {
      const semantic = extractFloorComponents(doc, building.id, floor, transformer)
        .find((component) => component.id === id && isSemanticRoomComponent(component))
      if (semantic) return semantic

      const routeEntity = extractFloorComponents(doc, building.id, floor, transformer)
        .find((component) => component.id === id && (component.type === 'route-node' || component.type === 'route-edge'))
      if (routeEntity) return routeEntity

      for (const room of floor.rooms) {
        if (room.id !== id) continue
        const pts = localPointsToWorld(room.polygon.points, building.id, transformer)
        if (pts.length < 3) return null
        return { id: room.id, type: 'room', name: room.name || room.number, buildingId: building.id, campusId: '', floor: floor.level, position: pts[0], polygon: pts }
      }
      for (const hw of floor.hallways) {
        if (hw.id !== id) continue
        const pts = localPointsToWorld(hw.polyline.points, building.id, transformer)
        if (pts.length < 2) return null
        return { id: hw.id, type: 'hallway', name: hw.name, buildingId: building.id, campusId: '', floor: floor.level, position: pts[0], polygon: pts, dimensions: { width: hw.width, height: 0 } }
      }

      for (const door of floor.doors ?? []) {
        if (door.id !== id) continue
        const wp = transformer.buildingLocalToWorld(door.position, building.id)
        if (!wp) return null
        const localPoints = door.geometry?.type === 'rectangle' ? localRectangleCornersOf(door.geometry) : undefined
        const polygon = localPoints ? localPointsToWorld(localPoints, building.id, transformer) : undefined
        return {
          id: door.id, type: 'door', name: door.name || 'Door', buildingId: building.id, campusId: '', floor: floor.level,
          position: wp, ...(polygon?.length === 4 ? { polygon } : {}), dimensions: { width: door.width, height: door.depth ?? 0.2 },
          metadata: { ...(door.roomId ? { roomId: door.roomId } : {}), ownershipStatus: door.ownership?.status ?? (door.roomId ? 'assigned' : 'unassigned'), doorType: door.doorType, width: door.width, depth: door.depth ?? 0.2, rotation: door.rotation ?? door.geometry?.rotation ?? 0, ...(door.routeConnection ? { routeConnection: door.routeConnection } : {}) },
        }
      }

      if (building.staircases && building.staircases.length > 0) {
        for (const st of building.staircases) {
          if (st.id !== id && `${st.id}-${floor.level}` !== id) continue
          const levelGeom = st.levels[floor.level]
          if (!levelGeom) continue
          const wp = transformer.buildingLocalToWorld(levelGeom.position, building.id)
          if (!wp) continue
          const { polygon: localPoly, landing } = resolveLevelGeometry(st, floor.level)
          let worldPoly: LatLng[] | undefined
          if (localPoly && localPoly.points.length > 0) {
            const pts = localPointsToWorld(localPoly.points, building.id, transformer)
            if (pts.length >= 3) worldPoly = pts
          }
          return {
            id: `${st.id}-${floor.level}`,
            featureId: st.id,
            type: 'stair',
            name: st.name,
            buildingId: building.id,
            campusId: '',
            floor: floor.level,
            position: wp,
            polygon: worldPoly,
            ...(rectangleDimensions(localPoly?.points, levelGeom.rotation) ? { dimensions: rectangleDimensions(localPoly?.points, levelGeom.rotation) } : {}),
            range: { from: st.fromLevel, to: st.toLevel },
            metadata: { type: st.type, rotation: levelGeom.rotation, ...(landing ? { landing } : {}) },
          }
        }
      } else {
        for (const stair of floor.staircases) {
          if (stair.id !== id) continue
          const wp = transformer.buildingLocalToWorld(stair.position, building.id)
          if (!wp) return null
          return { id: stair.id, type: 'stair', name: stair.name, buildingId: building.id, campusId: '', floor: floor.level, position: wp, range: { from: stair.fromLevel, to: stair.toLevel } }
        }
      }

      if (building.elevators && building.elevators.length > 0) {
        for (const el of building.elevators) {
          if (el.id !== id && `${el.id}-${floor.level}` !== id) continue
          const levelGeom = el.levels[floor.level]
          if (!levelGeom) continue
          const wp = transformer.buildingLocalToWorld(levelGeom.position, building.id)
          if (!wp) continue
          const { polygon: localPoly, landing } = resolveLevelGeometry(el, floor.level)
          let worldPoly: LatLng[] | undefined
          if (localPoly && localPoly.points.length > 0) {
            const pts = localPointsToWorld(localPoly.points, building.id, transformer)
            if (pts.length >= 3) worldPoly = pts
          }
          return {
            id: `${el.id}-${floor.level}`,
            featureId: el.id,
            type: 'elevator',
            name: el.name,
            buildingId: building.id,
            campusId: '',
            floor: floor.level,
            position: wp,
            polygon: worldPoly,
            ...(rectangleDimensions(localPoly?.points, levelGeom.rotation) ? { dimensions: rectangleDimensions(localPoly?.points, levelGeom.rotation) } : {}),
            range: { from: el.fromLevel, to: el.toLevel },
            metadata: { rotation: levelGeom.rotation, ...(landing ? { landing } : {}) },
          }
        }
      } else {
        for (const elev of floor.elevators) {
          if (elev.id !== id) continue
          const wp = transformer.buildingLocalToWorld(elev.position, building.id)
          if (!wp) return null
          return { id: elev.id, type: 'elevator', name: elev.name, buildingId: building.id, campusId: '', floor: floor.level, position: wp, range: { from: elev.fromLevel, to: elev.toLevel } }
        }
      }

      for (const pc of floor.parametricComponents ?? []) {
        if (pc.id !== id) continue
        const wp = transformer.buildingLocalToWorld(pc.position, building.id)
        if (!wp) return null
        const type = pc.definitionId === 'stair' ? 'stair' : pc.definitionId === 'elevator' ? 'elevator' : null
        if (!type) return null
        return { id: pc.id, type, name: type === 'stair' ? 'Staircase' : 'Elevator', buildingId: building.id, campusId: '', floor: floor.level, position: wp, range: { from: (pc.properties.fromLevel as number) ?? 0, to: (pc.properties.toLevel as number) ?? (type === 'stair' ? floor.level + 1 : 2) } }
      }

      for (const ent of floor.entrances) {
        if (ent.id !== id) continue
        // P1-T4 (D9): entrance positions are building-local — derive world.
        const wp = transformer.buildingLocalToWorld(ent.position, building.id)
        if (!wp) return null
        return { id: ent.id, type: 'entrance', name: ent.label, buildingId: building.id, campusId: '', floor: ent.level, position: wp }
      }
    }
  }
  return null
}

// ── Floor geometry hooks ──

export function useFloorComponents(buildingId: string, floor: number, floorId?: string): Component[] {
  const { transformer } = useEditor()
  const selector = useMemo(() => (doc: CampusDocument) => {
    if (!transformer) return []
    const building = findBuilding(doc, buildingId)
    if (!building) return []
    const f = resolveFloorScope(building.floors, floorId, floor)
    if (!f) return []
    return extractFloorComponents(doc, buildingId, f, transformer)
  }, [buildingId, floor, floorId, transformer])
  return useDocumentSelector(selector)
}

export function useFloorComponent(id: string | null | undefined): Component | null {
  const { transformer } = useEditor()
  const selector = useMemo(() => (doc: CampusDocument) => {
    if (!id || !transformer) return null
    return findOneComponent(doc, id, transformer)
  }, [id, transformer])
  return useDocumentSelector(selector)
}

export function useFloorComponentsAll(buildingId: string): Component[] {
  const { transformer } = useEditor()
  const selector = useMemo(() => (doc: CampusDocument) => {
    if (!transformer) return []
    const building = findBuilding(doc, buildingId)
    if (!building) return []
    const all: Component[] = []
    for (const floor of building.floors) {
      all.push(...extractFloorComponents(doc, buildingId, floor, transformer))
    }
    return all
  }, [buildingId, transformer])
  return useDocumentSelector(selector)
}

// ── Render version ──

export function useFloorRenderVersion(): number {
  return useDocumentVersion()
}

// ── Campus ID (legacy — document no longer stores campusId) ──

export function useFloorCampusId(): string {
  const { document } = useEditor()
  useDocumentVersion()
  return useMemo(() => document.buildings[0]?.id ?? '', [document])
}

// ── Sync status (graph-store bridge — kept for toolbar indicators) ──

export function useFloorSyncStatus(): string {
  return useGraphStore((s) => s.syncStatus)
}

export function useFloorSyncError(): string | null {
  return useGraphStore((s) => s.syncError ?? null)
}

export type FloorHeaderStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict' | 'checking'

/**
 * The floor header may only claim "Saved" when the graph store reports a
 * server-confirmed sync AND the workflow document has no pending edits. Graph
 * `syncStatus` alone stays `synced` through the autosave debounce after a
 * committed edit, which previously produced a false "Saved".
 *
 * Precedence: conflict > error > checking > dirty > saving/syncing >
 * server-confirmed clean > unsaved.
 */
export function deriveFloorHeaderStatus(
  syncStatus: string | null | undefined,
  saveState: string | null | undefined,
): FloorHeaderStatus {
  if (syncStatus === 'conflict') return 'conflict'
  if (syncStatus === 'error') return 'error'
  if (syncStatus === 'checking') return 'checking'
  if (saveState === 'dirty' || saveState === 'dirty-while-saving') return 'unsaved'
  if (saveState === 'saving' || syncStatus === 'syncing') return 'saving'
  if (syncStatus === 'synced' && (saveState === 'saved' || saveState === 'idle' || saveState == null)) return 'saved'
  return 'unsaved'
}

/**
 * Workflow save state for the floor surfaces. Subscribes to the editor's
 * WorkflowStore when one is registered; falls back to `idle` so legacy
 * contexts without a workflow bridge keep their previous behavior.
 */
export function useFloorWorkflowSaveState(): WorkflowSnapshot['saveState'] {
  const { services } = useEditor()
  const workflowStore = services.get('workflowStore') ?? null
  const subscribe = useCallback(
    (listener: () => void) => workflowStore?.subscribe(listener) ?? (() => {}),
    [workflowStore],
  )
  const getSnapshot = useCallback(
    () => workflowStore?.getSnapshot().saveState ?? 'idle',
    [workflowStore],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ── Legacy Building bridge (nav-types Building) ──

function toLegacyBuilding(b: import('@navi/core').Building, transformer: CoordinateTransformer): Building {
  const entrances: Building['entrances'] = []
  for (const f of b.floors) {
    for (const e of f.entrances) {
      // P1-T4 (D9): document entrance positions are building-local — the legacy
      // render model consumes world LatLng, so derive world here.
      const world = transformer.buildingLocalToWorld(e.position, b.id)
      if (!world) continue
      entrances.push({ id: e.id, position: world, floor: e.level, label: e.label })
    }
  }
  const floorPlanUrls: Record<number, string> = {}
  for (const f of b.floors) {
    if (f.planImageId) floorPlanUrls[f.level] = f.planImageId
  }
  const fpPoints: LatLng[] = Array.isArray(b.footprint) ? b.footprint : (b.footprint?.points ?? [])
  const floorData = b.floors.map((f) => ({
    id: f.id,
    level: f.level,
    label: f.label,
    elevation: f.elevation,
    planImageId: f.planImageId,
    planAlignment: f.planAlignment,
    floorPlanState: f.floorPlanState,
    locked: f.locked,
    visible: f.visible,
    textureId: f.textureId,
    svgOverlayId: f.svgOverlayId,
    metadata: f.metadata,
    walls: f.walls,
    windows: f.windows,
    openings: f.openings,
    roomAttributes: f.roomAttributes,
    entranceAccess: f.entranceAccess,
  }))

  return {
    id: b.id,
    name: b.name,
    campusId: '',
    floors: b.floors.map((f) => f.level),
    footprint: fpPoints,
    baseElevation: b.baseElevation,
    height: b.height,
    color: b.color,
    code: b.code,
    description: b.description,
    center: fpPoints[0],
    department: b.department,
    category: b.category,
    entrances,
    floorPlanUrls: Object.keys(floorPlanUrls).length > 0 ? floorPlanUrls : undefined,
    floorData,
  }
}

export function useLegacyBuilding(buildingId: string): Building | undefined {
  const { transformer } = useEditor()
  const building = useBuilding(buildingId)
  return useMemo(() => (building && transformer ? toLegacyBuilding(building, transformer) : undefined), [building, transformer])
}

export function useGraphBuilding(buildingId: string): Building | undefined {
  return useLegacyBuilding(buildingId)
}

// ── Floor plan URLs bridge ──

export function useFloorPlanUrls(): Record<number, string> | undefined {
  const { document } = useEditor()
  useDocumentVersion()
  return useMemo(() => {
    const b = document.buildings[0]
    if (!b) return undefined
    const urls: Record<number, string> = {}
    for (const f of b.floors) {
      if (f.planImageId) urls[f.level] = f.planImageId
    }
    return Object.keys(urls).length > 0 ? urls : undefined
  }, [document])
}

// ── One-shot reads (graph-store bridge for callbacks; migrated in T3–T6) ──

export function countFloorComponents(buildingId: string, floor: number, type: string): number {
  const graph = useGraphStore.getState().graph
  return graph.components.filter((c) => c.type === type && c.buildingId === buildingId && c.floor === floor).length
}

export function findGraphBuilding(buildingId: string): Building | undefined {
  const graph = useGraphStore.getState().graph
  return graph.buildings.find((b) => b.id === buildingId)
}
