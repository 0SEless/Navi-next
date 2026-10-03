'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { asEntityId, genId, useEditor, findConnectivityCandidates, LAYER_IDS, SOURCE_IDS, SelectionOrigin } from '@navi/editor'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'
import { SRC, LYR, CURSOR_CROSSHAIR, CURSOR_HAND } from './rendering/constants'
import { useCurrentTool } from './useCurrentTool'
import { resolvePoiPlacementContext, reportPoiPlacementBlocked } from './poi-placement-context'
import type { LatLng } from '@/types/nav-types'
import type { DrawingSessionValue } from './useDrawingSession'

interface InteractionControllerProps {
  map: maplibregl.Map
  onSetRoomDrag?: (drag: { start: LatLng; current: LatLng } | null) => void
  onEmptyMapClick?: () => void
  drawing: DrawingSessionValue
}

export function InteractionController({ map, onSetRoomDrag, onEmptyMapClick, drawing }: InteractionControllerProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const { services, document, transformer } = useEditor()
  const documentRef = useRef(document)
  documentRef.current = document
  const transformerRef = useRef(transformer)
  transformerRef.current = transformer
  const dispatcherRef = useRef(services.get('dispatcher'))
  dispatcherRef.current = services.get('dispatcher')
  const historyRef = useRef(services.get('history'))
  historyRef.current = services.get('history')
  const selectionRef = useRef(services.get('selection'))
  const toolRegistry = services.get('toolRegistry')!
  const toolRef = useRef(toolRegistry.activeToolId)
  const tracePointsRef = useRef(drawing.tracePoints)
  const drawPointsRef = useRef(drawing.drawPoints)
  const graphRef = useRef(useGraphStore.getState().graph)
  const activeFloorRef = useRef(useStudioStore.getState().activeFloor)
  const activeBuildingIdRef = useRef(useStudioStore.getState().activeBuildingId)
  const selectedNodeRef = useRef(useStudioStore.getState().selectedNodeId)
  const selectedTraceRef = useRef<string | null>(null)
  const positionEditTargetRef = useRef(useStudioStore.getState().positionEditTarget)
  const dragVertexRef = useRef<{ index: number; points: LatLng[]; source: 'trace' | 'draw' } | null>(null)
  const buildingDragRef = useRef<{ buildingId: string; originalFootprint: LatLng[]; startPoint: LatLng } | null>(null)
  const lastSelectedNodeRef = useRef<string | null>(null)
  const hoveredBldgRef = useRef<string | null>(null)
  const hoveredBldgSourceRef = useRef<string>(SOURCE_IDS.BUILDINGS)
  const hoveredAreaRef = useRef<string | null>(null)
  const hoveredPoiRef = useRef<string | null>(null)
  const selectedBldgRef = useRef<string | null>(null)

  const tool = useCurrentTool()

  const drawingRef = useRef(drawing)
  drawingRef.current = drawing
  const setRoomDragRef = useRef(onSetRoomDrag)
  const emptyMapClickRef = useRef(onEmptyMapClick)
  useEffect(() => { setRoomDragRef.current = onSetRoomDrag }, [onSetRoomDrag])
  useEffect(() => { emptyMapClickRef.current = onEmptyMapClick }, [onEmptyMapClick])

  // ── Cursor + dragPan management ──
  useEffect(() => {
    const canvas = map.getCanvas()
    if (tool === 'route' || tool === 'room' || tool === 'asset' || tool === 'boundary' || tool === 'building' || tool === 'area' || tool === 'import-osm' || tool === 'set-boundary' || tool === 'place-panorama' || tool === 'poi' || tool === 'poi-circle' || tool === 'poi-rectangle' || tool === 'poi-polygon') {
      canvas.style.cursor = CURSOR_CROSSHAIR
    } else if (tool === 'select') {
      canvas.style.cursor = ''
    } else {
      canvas.style.cursor = ''
    }
    // Clear building hover state when leaving select tool
    if (tool !== 'select' && hoveredBldgRef.current) {
      map.setFeatureState({ source: hoveredBldgSourceRef.current, id: hoveredBldgRef.current }, { hover: false })
      hoveredBldgRef.current = null
    }
    // Fix 1: leaving the route tool abandons an unresolved connection decision.
    if (tool !== 'route' && drawingRef.current.pendingRoadConnection) {
      drawingRef.current.setPendingRoadConnection(null)
    }
    if (tool !== 'select' && hoveredPoiRef.current) {
      map.setFeatureState({ source: SOURCE_IDS.POIS, id: hoveredPoiRef.current }, { hover: false })
      hoveredPoiRef.current = null
    }
    if (tool === 'route' || tool === 'room' || tool === 'boundary' || tool === 'building' || tool === 'area' || tool === 'import-osm' || tool === 'set-boundary' || tool === 'place-panorama' || tool === 'poi' || tool === 'poi-circle' || tool === 'poi-rectangle' || tool === 'poi-polygon') {
      map.dragPan.disable()
    } else {
      map.dragPan.enable()
    }
  }, [tool, map])

  useEffect(() => {
    const unsubDrawing = drawingRef.current.subscribe(() => {
      tracePointsRef.current = drawing.tracePoints
      drawPointsRef.current = drawing.drawPoints
    })
    const unsubStore = useStudioStore.subscribe((state) => {
      activeFloorRef.current = state.activeFloor
      activeBuildingIdRef.current = state.activeBuildingId
      selectedNodeRef.current = state.selectedNodeId
      selectedTraceRef.current = state.selectedTraceId
      positionEditTargetRef.current = state.positionEditTarget
    })
    const unsubTool = toolRegistry.subscribe(() => {
      toolRef.current = toolRegistry.activeToolId
    })
    return () => { unsubDrawing(); unsubStore(); unsubTool() }
  }, [toolRegistry, drawing])

  useEffect(() => {
    const unsub = useGraphStore.subscribe((state) => {
      graphRef.current = state.graph
    })
    return () => unsub()
  }, [])

  // ── Sync activeBuildingId → feature-state('selected') on building features ──
  useEffect(() => {
    if (!map) return
    const unsub = useStudioStore.subscribe((s) => {
      const bid = s.activeBuildingId
      if (bid === selectedBldgRef.current) return
      // Clear old
      if (selectedBldgRef.current) {
        try { map.setFeatureState({ source: SOURCE_IDS.BUILDINGS, id: selectedBldgRef.current }, { selected: false }) } catch {}
      }
      // Set new
      if (bid) {
        try { map.setFeatureState({ source: SOURCE_IDS.BUILDINGS, id: bid }, { selected: true }) } catch {}
      }
      selectedBldgRef.current = bid
    })
    return () => unsub()
  }, [map])

  function setCurrentPoints(points: LatLng[]) {
    const curTool = toolRef.current
    if (curTool === 'route') { drawingRef.current.setTracePoints(points) }
    if (curTool === 'building' || curTool === 'boundary' || curTool === 'area') { drawingRef.current.setDrawPoints(points) }
  }

  function findNearestVertex(mouseScreen: { x: number; y: number }, m: maplibregl.Map, points: LatLng[]): number {
    const THRESHOLD = 10
    let nearest = -1
    let nearestDist = THRESHOLD
    for (let i = 0; i < points.length; i++) {
      const screen = m.project([points[i].lng, points[i].lat])
      const dx = screen.x - mouseScreen.x
      const dy = screen.y - mouseScreen.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    }
    return nearest
  }

  useEffect(() => {
    if (!map) return

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (dragVertexRef.current) { dragVertexRef.current = null; return }
      if (buildingDragRef.current) { buildingDragRef.current = null; map.dragPan.enable(); return }
      const curTool = toolRef.current
      const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng }

      if (curTool === 'route') {
        const points = tracePointsRef.current
        // Fix 1: while a Connect / Keep Separate decision is pending, the next
        // click belongs to the decision UI, not to point placement.
        if (drawingRef.current.pendingRoadConnection) return
        const nearIdx = findNearestVertex(e.point, map, points)
        if (nearIdx >= 0) {
          dragVertexRef.current = { index: nearIdx, points: [...points], source: 'trace' }
          return
        }
        // Fix 1: 0.5 m intent detection. Nothing is snapped or mutated before
        // the admin explicitly chooses Connect. Alt = Keep Separate shortcut.
        const altHeld = (e.originalEvent as MouseEvent)?.altKey ?? false
        const discovery = findConnectivityCandidates(pos, {
          roads: documentRef.current?.roads ?? [],
          junctions: documentRef.current?.roadJunctions,
        })
        if (!altHeld && discovery.best) {
          drawingRef.current.setPendingRoadConnection({ point: pos, candidate: discovery.best })
          return
        }
        if (altHeld && discovery.best) {
          drawingRef.current.addSeparatePoint(pos, discovery.best)
          return
        }
        tracePointsRef.current = [...points, pos]
        drawingRef.current.addTracePoint(pos)
        return
      }
      if (curTool === 'poi') {
        const buildingId = activeBuildingIdRef.current

        // No active building → outdoor/campus scope: one click creates a
        // world-coordinate marker directly in CampusDocument.pois.
        if (!buildingId) {
          const id = genId('poi')
          const result = dispatcherRef.current?.execute({
            id: 'poi.create',
            label: 'Create POI',
            payload: {
              id,
              scope: 'outdoor',
              name: '',
              category: 'other',
              geometry: { type: 'point', position: { lat: pos.lat, lng: pos.lng } },
            },
          })
          if (!result) {
            reportPoiPlacementBlocked('POI tool is not connected to the editor document.')
            return
          }
          if (result.success === false) {
            reportPoiPlacementBlocked(`POI creation failed: ${result.error ?? 'unknown error'}`)
            return
          }
          selectionRef.current?.select({
            type: 'poi',
            id: asEntityId(id),
          }, SelectionOrigin.Canvas)
          return
        }

        // Active building → indoor floor-local scope. Resolve the context and
        // explain a broken context instead of silently dropping the click.
        const placement = resolvePoiPlacementContext(
          documentRef.current,
          buildingId,
          activeFloorRef.current,
        )
        if (!placement.ok) {
          reportPoiPlacementBlocked(placement.reason)
          return
        }
        const transformer = transformerRef.current
        const localPosition = transformer
          ? transformer.worldToFloorLocal(pos, placement.building.id, placement.floor.level)
          : null
        if (!localPosition) {
          reportPoiPlacementBlocked('Could not convert this point to floor coordinates. Reopen the floor and try again.')
          return
        }

        const id = genId('poi')
        const result = dispatcherRef.current?.execute({
          id: 'poi.create',
          label: 'Create POI',
          payload: {
            id,
            buildingId: placement.building.id,
            floorId: placement.floor.id,
            name: '',
            category: 'other',
            position: localPosition,
          },
        })
        if (!result) {
          reportPoiPlacementBlocked('POI tool is not connected to the editor document.')
          return
        }
        if (result.success === false) {
          reportPoiPlacementBlocked(`POI creation failed: ${result.error ?? 'unknown error'}`)
          return
        }
        selectionRef.current?.select({
          type: 'poi',
          id: asEntityId(id),
          buildingId: asEntityId(placement.building.id),
          floorId: asEntityId(placement.floor.id),
        }, SelectionOrigin.Canvas)
        return
      }
      if (curTool === 'asset') {
        useGraphStore.getState().addComponent({ id: genId('comp'), type: 'room', name: 'Asset', buildingId: activeBuildingIdRef.current ?? '', floor: activeFloorRef.current, position: pos })
        return
      }
      if (curTool === 'select') {
        const features = map.queryRenderedFeatures(e.point)
      const hitPoi = features.find((f) => f.layer.id === LAYER_IDS.POI_ICON || f.layer.id === LAYER_IDS.POI_FILL || f.layer.id === LAYER_IDS.POI_EXTRUSION || f.layer.id === LAYER_IDS.POI_OUTLINE)
        if (hitPoi) {
          const poiId = hitPoi.properties?.id as string | null
          const buildingId = hitPoi.properties?.buildingId as string | null
          const floorId = hitPoi.properties?.floorId as string | null
          if (poiId) {
            // Indoor POIs carry building/floor context; outdoor/campus POIs
            // intentionally have none (world scope).
            selectionRef.current?.select({
              type: 'poi',
              id: asEntityId(poiId),
              ...(buildingId ? { buildingId: asEntityId(buildingId) } : {}),
              ...(floorId ? { floorId: asEntityId(floorId) } : {}),
            }, SelectionOrigin.Canvas)
            return
          }
        }
        const hitNode = features.find((f) => f.layer.id === LYR.NODES || f.layer.id === LYR.NODES_CONNECTION)
        if (hitNode) {
          const nodeId = hitNode.properties?.id as string | null
          lastSelectedNodeRef.current = nodeId
          useStudioStore.getState().setSelectedNodeId(nodeId)
          return
        }
        const hitBuilding = features.find((f) =>
          f.layer.id === LAYER_IDS.BUILDING_FILL || f.layer.id === LAYER_IDS.BUILDING_EXTRUSION
        )
        if (hitBuilding) {
          const bid = hitBuilding.properties?.id
          if (bid) { useStudioStore.getState().setActiveBuilding(bid) }
          return
        }
        const hitTrace = features.find((f) =>
          f.layer.id === LAYER_IDS.ROAD_OUTLINE || f.layer.id === LAYER_IDS.ROAD_FILL || f.layer.id === LAYER_IDS.NAVIGATION_ONLY_ROAD
        )
        if (hitTrace) {
          const tid = hitTrace.properties?.id
          if (tid) {
            useStudioStore.getState().setSelectedTraceId(tid)
            return
          }
        }
        lastSelectedNodeRef.current = null
        useStudioStore.getState().setSelectedNodeId(null)
        useStudioStore.getState().setSelectedTraceId(null)
        useStudioStore.getState().setActiveBuilding(null)
        emptyMapClickRef.current?.()
        return
      }
    }

    const handleDblClick = () => {
      const curTool = toolRef.current
      if (curTool === 'route' && drawingRef.current.pendingRoadConnection) return
      if (curTool === 'route' && tracePointsRef.current.length >= 2) {
        drawingRef.current.requestConfirm('route')
      }
      if (curTool === 'select' && selectedTraceRef.current) {
        useStudioStore.getState().setVertexEditing('trace', selectedTraceRef.current)
      }
    }

    let dragStart: LatLng | null = null

    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return
      const curTool = toolRef.current
      if (curTool === 'select' && positionEditTargetRef.current?.type === 'building') {
        const targetId = positionEditTargetRef.current.id
        const features = map.queryRenderedFeatures(e.point)
        const hitBuilding = features.find((f) =>
          (f.layer.id === LAYER_IDS.BUILDING_FILL || f.layer.id === LAYER_IDS.BUILDING_EXTRUSION) &&
          f.properties?.id === targetId
        )
        if (hitBuilding) {
          const building = graphRef.current.buildings.find(b => b.id === targetId)
          if (building) {
            buildingDragRef.current = {
              buildingId: targetId,
              originalFootprint: building.footprint.map(p => ({ ...p })),
              startPoint: { lat: e.lngLat.lat, lng: e.lngLat.lng },
            }
            map.dragPan.disable()
            return
          }
        }
      }
      if (curTool === 'room') {
        dragStart = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        setRoomDragRef.current?.({ start: dragStart, current: dragStart })
        return
      }
      if (curTool === 'place-panorama') {
        // Place panorama at clicked position (outdoor, no buildingId)
        dispatcherRef.current?.execute({
          id: 'panorama.create',
          label: 'Create Panorama',
          payload: {
            position: { lat: e.lngLat.lat, lng: e.lngLat.lng },
            heading: 0,
            imageAssetId: '',
            buildingId: undefined, // Outdoor panorama
            floor: undefined,
            label: '',
          },
        })
        return
      }
      if (curTool === 'route' || curTool === 'building' || curTool === 'boundary' || curTool === 'area') {
        const points = curTool === 'route' ? tracePointsRef.current : drawPointsRef.current
        const nearIdx = findNearestVertex(e.point, map, points)
        if (nearIdx >= 0) {
          dragVertexRef.current = { index: nearIdx, points: [...points], source: curTool === 'route' ? 'trace' : 'draw' }
        }
      }
    }

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const drag = dragVertexRef.current
      if (drag) {
        drag.points[drag.index] = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        const coords = drag.points.map((p) => [p.lng, p.lat])
        const drawFeatures: GeoJSON.Feature[] = []
        drawFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
        for (const p of drag.points) {
          drawFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {} })
        }
        try {
          const src = map.getSource(SRC.DRAWING) as maplibregl.GeoJSONSource
          if (src) src.setData({ type: 'FeatureCollection', features: drawFeatures })
        } catch {}
        return
      }
      if (dragStart && toolRef.current === 'room') {
        setRoomDragRef.current?.({ start: dragStart, current: { lat: e.lngLat.lat, lng: e.lngLat.lng } })
      }
      const buildingDrag = buildingDragRef.current
      if (buildingDrag) {
        const dLat = e.lngLat.lat - buildingDrag.startPoint.lat
        const dLng = e.lngLat.lng - buildingDrag.startPoint.lng
        const buildingSrc = map.getSource(SOURCE_IDS.BUILDINGS) as maplibregl.GeoJSONSource
        if (buildingSrc) {
          const features = graphRef.current.buildings.map((bb) => {
            const footprint = bb.id === buildingDrag.buildingId
              ? buildingDrag.originalFootprint.map(p => ({ lat: p.lat + dLat, lng: p.lng + dLng }))
              : bb.footprint
            return {
              type: 'Feature' as const,
              properties: { id: bb.id, name: bb.name, color: bb.color || '#1C6BEB', height: bb.height || 15 },
              geometry: {
                type: 'Polygon' as const,
                coordinates: [footprint.map(p => [p.lng, p.lat]).concat([[footprint[0].lng, footprint[0].lat]])],
              },
            }
          })
          buildingSrc.setData({ type: 'FeatureCollection', features })
        }
        return
      }

      // ── Building hover + cursor via queryRenderedFeatures (layer-order-agnostic) ──
      const curTool = toolRef.current
      const canvas = map.getCanvas()
      if (curTool === 'select') {
        const allHitLayers = [LAYER_IDS.BUILDING_FILL, LAYER_IDS.BUILDING_EXTRUSION, LAYER_IDS.BUILDING_OUTLINE]
        const hitLayers = allHitLayers.filter(l => map.getLayer(l))
        if (hitLayers.length === 0) return
        const features = map.queryRenderedFeatures(e.point, { layers: hitLayers })
        const hit = features?.[0]
        const hitId = hit?.properties?.id as string | undefined

        if (hitId && hitId !== hoveredBldgRef.current) {
          // New building hovered
          if (hoveredBldgRef.current) {
            map.setFeatureState({ source: hoveredBldgSourceRef.current, id: hoveredBldgRef.current }, { hover: false })
          }
          hoveredBldgRef.current = hitId
          hoveredBldgSourceRef.current = SOURCE_IDS.BUILDINGS
          map.setFeatureState({ source: SOURCE_IDS.BUILDINGS, id: hitId }, { hover: true })
          canvas.style.cursor = CURSOR_HAND
        } else if (!hitId && hoveredBldgRef.current) {
          // Left all building layers
          map.setFeatureState({ source: hoveredBldgSourceRef.current, id: hoveredBldgRef.current }, { hover: false })
          hoveredBldgRef.current = null
          canvas.style.cursor = ''
        }
      }
    }

    const handleMouseUp = (e: maplibregl.MapMouseEvent) => {
      const drag = dragVertexRef.current
      if (drag) {
        setCurrentPoints(drag.points)
        dragVertexRef.current = null
        return
      }
      const buildingDrag = buildingDragRef.current
      if (buildingDrag) {
        map.dragPan.enable()
        const dLat = e.lngLat.lat - buildingDrag.startPoint.lat
        const dLng = e.lngLat.lng - buildingDrag.startPoint.lng
        if (dLat !== 0 || dLng !== 0) {
          const movedFootprint = buildingDrag.originalFootprint.map(p => ({
            lat: p.lat + dLat,
            lng: p.lng + dLng,
          }))
          const centroid = {
            lat: movedFootprint.reduce((s, p) => s + p.lat, 0) / movedFootprint.length,
            lng: movedFootprint.reduce((s, p) => s + p.lng, 0) / movedFootprint.length,
          }
          useGraphStore.getState().updateBuilding(buildingDrag.buildingId, { footprint: movedFootprint, center: centroid })
          void useGraphStore.getState().save().catch((error: unknown) => {
            console.warn('Building move persistence failed:', error)
          })
          dispatcherRef.current?.execute({ id: 'entity.update', label: 'Move Building', payload: { entityId: buildingDrag.buildingId, changes: { footprint: { points: movedFootprint } } } })
        }
        useStudioStore.getState().setPositionEditTarget(null)
        buildingDragRef.current = null
        return
      }
      if (dragStart && toolRef.current === 'room') {
        const start = dragStart
        const end = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        const polygon = [
          { lat: Math.min(start.lat, end.lat), lng: Math.min(start.lng, end.lng) },
          { lat: Math.min(start.lat, end.lat), lng: Math.max(start.lng, end.lng) },
          { lat: Math.max(start.lat, end.lat), lng: Math.max(start.lng, end.lng) },
          { lat: Math.max(start.lat, end.lat), lng: Math.min(start.lng, end.lng) },
        ]
        const center = { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 }
        useGraphStore.getState().addComponentWithPolygon({ id: genId('comp'), type: 'room', name: 'Room', buildingId: activeBuildingIdRef.current ?? '', floor: activeFloorRef.current, position: center, polygon })
        dragStart = null
        setRoomDragRef.current?.(null)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (buildingDragRef.current) {
          buildingDragRef.current = null
          map.dragPan.enable()
          useGraphStore.setState((s) => ({ renderVersion: s.renderVersion + 1 }))
          return
        }
        useStudioStore.getState().setPositionEditTarget(null)
        if (lastSelectedNodeRef.current) {
          try {
            map.setFeatureState({ source: SRC.NODES, id: lastSelectedNodeRef.current }, { selected: false })
            map.setFeatureState({ source: SRC.NODES_CONNECTION, id: lastSelectedNodeRef.current }, { selected: false })
          } catch { /* ok */ }
          lastSelectedNodeRef.current = null
        }
        tracePointsRef.current = []
        drawPointsRef.current = []
        drawingRef.current.clearTracePoints()
        drawingRef.current.clearDrawPoints()
        setRoomDragRef.current?.(null)
        useStudioStore.getState().setVertexEditing(null, null)
      }
      if (e.key === 'Delete' && selectedNodeRef.current) {
        if (lastSelectedNodeRef.current) {
          try {
            map.setFeatureState({ source: SRC.NODES, id: lastSelectedNodeRef.current }, { selected: false })
            map.setFeatureState({ source: SRC.NODES_CONNECTION, id: lastSelectedNodeRef.current }, { selected: false })
          } catch { /* ok */ }
          lastSelectedNodeRef.current = null
        }
        graphRef.current.removeNode(selectedNodeRef.current)
        useStudioStore.getState().setSelectedNodeId(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        const target = e.target as HTMLElement | null
        const isTextEntry = target?.tagName === 'INPUT'
          || target?.tagName === 'TEXTAREA'
          || target?.tagName === 'SELECT'
          || target?.isContentEditable
        if (isTextEntry) return
        e.preventDefault()
        const curTool = toolRef.current
        let removedDraftPoint = false
        if (curTool === 'route' && tracePointsRef.current.length > 0) {
          tracePointsRef.current = tracePointsRef.current.slice(0, -1)
          drawingRef.current.undoLastPoint()
          removedDraftPoint = true
        } else if ((curTool === 'building' || curTool === 'boundary' || curTool === 'area' || curTool === 'import-osm' || curTool === 'set-boundary') && drawPointsRef.current.length > 0) {
          drawPointsRef.current = drawPointsRef.current.slice(0, -1)
          drawingRef.current.undoLastDrawPoint()
          removedDraftPoint = true
        }
        if (!removedDraftPoint) historyRef.current?.undo()
        return
      }
      if (e.key === 'Enter') {
        const curTool = toolRef.current
        if (curTool === 'route' && drawingRef.current.pendingRoadConnection) return
        if (curTool === 'route' || curTool === 'building' || curTool === 'boundary' || curTool === 'area' || curTool === 'import-osm' || curTool === 'set-boundary') {
          drawingRef.current.requestConfirm(curTool as 'route' | 'building' | 'boundary' | 'area' | 'import-osm' | 'set-boundary')
        }
        return
      }
    }

    const ENTITY_LAYERS = [LYR.NODES, LYR.NODES_CONNECTION, LAYER_IDS.ROAD_OUTLINE, LAYER_IDS.ROAD_FILL, LAYER_IDS.NAVIGATION_ONLY_ROAD, LYR.AREAS_FILL, LAYER_IDS.POI_ICON, LAYER_IDS.POI_FILL, LAYER_IDS.POI_EXTRUSION, LAYER_IDS.POI_OUTLINE]

    const handleEntityEnter = (e: maplibregl.MapMouseEvent & { features?: any[] }) => {
      const curTool = toolRef.current
      if (curTool !== 'select') return
      const canvas = map.getCanvas()
      canvas.style.cursor = CURSOR_HAND
      const layerId = e.features?.[0]?.layer?.id
      const feature = e.features?.[0]
      if (!layerId || !feature) return
      if (layerId === LYR.AREAS_FILL) {
        const aid = feature.properties?.id as string | undefined
        const name = feature.properties?.name as string | undefined
        if (aid) {
          hoveredAreaRef.current = aid
          map.setFeatureState({ source: SRC.AREAS, id: aid }, { hover: true })
          if (name) setTooltip({ x: e.point.x, y: e.point.y, text: name })
        }
        return
      }
      if (layerId === LAYER_IDS.POI_ICON || layerId === LAYER_IDS.POI_FILL || layerId === LAYER_IDS.POI_EXTRUSION || layerId === LAYER_IDS.POI_OUTLINE) {
        const poiId = feature.properties?.id as string | undefined
        const name = feature.properties?.name as string | undefined
        if (poiId) {
          hoveredPoiRef.current = poiId
          map.setFeatureState({ source: SOURCE_IDS.POIS, id: poiId }, { hover: true })
          if (name) setTooltip({ x: e.point.x, y: e.point.y, text: name })
        }
        return
      }
      if (layerId === LYR.NODES_CONNECTION) {
        setTooltip({ x: e.point.x, y: e.point.y, text: 'Connection point' })
      }
    }

    const handleEntityLeave = () => {
      const canvas = map.getCanvas()
      const ct = toolRef.current
      canvas.style.cursor = ct === 'route' || ct === 'room' || ct === 'asset' || ct === 'boundary' || ct === 'building' || ct === 'area' || ct === 'import-osm' || ct === 'set-boundary' || ct === 'poi' || ct === 'poi-circle' || ct === 'poi-rectangle' || ct === 'poi-polygon' ? CURSOR_CROSSHAIR : ''
      if (hoveredBldgRef.current) {
        map.setFeatureState({ source: hoveredBldgSourceRef.current, id: hoveredBldgRef.current }, { hover: false })
        hoveredBldgRef.current = null
      }
      if (hoveredAreaRef.current) {
        map.setFeatureState({ source: SRC.AREAS, id: hoveredAreaRef.current }, { hover: false })
        hoveredAreaRef.current = null
      }
      if (hoveredPoiRef.current) {
        map.setFeatureState({ source: SOURCE_IDS.POIS, id: hoveredPoiRef.current }, { hover: false })
        hoveredPoiRef.current = null
      }
      setTooltip(null)
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)
    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    for (const l of ENTITY_LAYERS) {
      map.on('mouseenter', l, handleEntityEnter)
      map.on('mouseleave', l, handleEntityLeave)
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      try { if (hoveredBldgRef.current) map.setFeatureState({ source: hoveredBldgSourceRef.current, id: hoveredBldgRef.current }, { hover: false }) } catch {}
      hoveredBldgRef.current = null
      if (selectedBldgRef.current) {
        try { map.setFeatureState({ source: SOURCE_IDS.BUILDINGS, id: selectedBldgRef.current }, { selected: false }) } catch {}
        selectedBldgRef.current = null
      }
      try { if (hoveredAreaRef.current) map.setFeatureState({ source: SRC.AREAS, id: hoveredAreaRef.current }, { hover: false }) } catch {}
      hoveredAreaRef.current = null
      try { if (hoveredPoiRef.current) map.setFeatureState({ source: SOURCE_IDS.POIS, id: hoveredPoiRef.current }, { hover: false }) } catch {}
      hoveredPoiRef.current = null
      try { map.off('click', handleClick) } catch {}
      try { map.off('dblclick', handleDblClick) } catch {}
      try { map.off('mousedown', handleMouseDown) } catch {}
      try { map.off('mousemove', handleMouseMove) } catch {}
      try { map.off('mouseup', handleMouseUp) } catch {}
      for (const l of ENTITY_LAYERS) {
        try { map.off('mouseenter', l, handleEntityEnter) } catch {}
        try { map.off('mouseleave', l, handleEntityLeave) } catch {}
      }
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [map])

  return (
    <>
      {tooltip && (
        <div style={{
          position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 12,
          background: '#0F172A', color: '#fff', padding: '4px 10px', borderRadius: 6,
          fontSize: 11, whiteSpace: 'nowrap', zIndex: 20, pointerEvents: 'none',
          boxShadow: '0 2px 10px rgba(0,0,0,0.4)', border: '1px solid #334155',
        }}>
          {tooltip.text}
        </div>
      )}
    </>
  )
}
