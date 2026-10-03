'use client'

/**
 * ── Architectural Invariant (M2.6) ─────────────────────────────────
 *
 * StudioCanvas is the EDITOR COMPOSITION ROOT.
 *
 * It MUST NOT import application stores:
 *   - useGraphStore        (Graph / rendering data)
 *   - useStudioStore       (tool, layers, selection, edit target)
 *   - DocumentStore / WorkflowStore / any @navi/editor service
 *
 * It owns exactly one responsibility: construct the editor by wiring
 * subsystems together. All application state lives in the owning
 * subsystems:
 *
 *   MapRenderer          → rendering (GeoJSON, visibility, style)
 *   InteractionController→ editing interactions (cursor, dragPan, hit-test)
 *   ViewportController   → camera
 *   SelectionOverlay     → selection highlight
 *   ConfirmBar           → self-manages tool + visibility from Zustand
 *   ConfirmOverlayAdapter→ temporary bridge (deleted when ConfirmOverlay migrates)
 *
 * If future work needs store access inside StudioCanvas, the answer is
 * always: move the responsibility into the owning subsystem.
 * ──────────────────────────────────────────────────────────────────
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEditor, CAMPUS_TOOL_GROUPS, useToolDockShortcuts } from '@navi/editor'
import { useCampusBoundary } from './CampusBoundary'
import { useOsmImportTool } from './OsmImportTool'
import { ImportToast } from './ImportToast'
import { useBuildingTracer } from './BuildingTracer'
import { useVertexEditor } from './useVertexEditor'
import { useMarkerDrag } from './useMarkerDrag'
import { usePoiEditor } from './usePoiEditor'
import { ConfirmBar } from './ConfirmBar'
import { ConfirmOverlayAdapter } from './ConfirmOverlayAdapter'
import { ConnectionChoice } from './ConnectionChoice'
import { SelectionOverlay } from './SelectionOverlay'
import { ValidationIssueOverlay } from './ValidationIssueOverlay'
import { DrawingOverlay } from './DrawingOverlay'
import { PreviewOverlay } from './PreviewOverlay'
import { SnapPreviewOverlay } from './SnapPreviewOverlay'
import { DrawingSessionProvider } from './useDrawingSession'
import { useDrawingSession } from './useDrawingSession'
import { ViewportController } from './ViewportController'
import { useToolController } from './useToolController'
import { InteractionController } from './InteractionController'
import { POIGeometryAuthoring } from './POIGeometryAuthoring'
import { EntityRendererBridge } from './rendering/EntityRendererBridge'
import { NavigationGraphRenderer, getInitialMapStyle } from './rendering/NavigationGraphRenderer'
import { reportMapError } from './rendering/satellite'
import { StyleSelector } from './StyleSelector'
import { RotationHandle } from './RotationHandle'
import { useStudioStore } from '@/store/studio-store'
import { useGraphStore } from '@/store/graph-store'
import { PositionEditHint } from './PositionEditHint'
import { useCurrentTool } from './useCurrentTool'

interface StudioCanvasProps {
  center?: { lat: number; lng: number }
  onEmptyMapClick?: () => void
}

export function StudioCanvas({ center, onEmptyMapClick }: StudioCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const [cursorPos, setCursorPos] = useState<{ lat: number; lng: number } | null>(null)
  const [altHeld, setAltHeld] = useState(false)

  const drawing = useDrawingSession()
  const activeTool = useCurrentTool()
  const isVertexEditing = useStudioStore(s => s.isVertexEditing)

  useVertexEditor(mapInstance)
  useMarkerDrag(mapInstance)
  usePoiEditor(mapInstance)

  // Phase 3C: Track cursor position and Alt state for snap preview
  useEffect(() => {
    if (!mapInstance || activeTool !== 'route' || isVertexEditing) return
    const handleMove = (e: maplibregl.MapMouseEvent) => {
      setCursorPos({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false)
    }
    mapInstance.on('mousemove', handleMove)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      mapInstance.off('mousemove', handleMove)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [activeTool, isVertexEditing, mapInstance])

  useEffect(() => {
    if (mapRef.current) return
    const container = mapContainerRef.current
    if (!container) return
    let mounted = true
    const c = center ?? { lat: 11.8195, lng: 122.0922 }
    const map = new maplibregl.Map({
      container,
      style: getInitialMapStyle(),
      center: [c.lng, c.lat],
      zoom: center ? 17 : 4,
      maxZoom: 22,
      attributionControl: { compact: false },
    })
    map.on('error', reportMapError)
    map.on('load', () => {
      if (!mounted) return
      setMapInstance(map)
    })
    mapRef.current = map
    return () => {
      mounted = false
      try { map.remove() } catch {}
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const positionEditTarget = useStudioStore((s) => s.positionEditTarget)
  const isBuildingEdit = positionEditTarget?.type === 'building'

  const { services: studioServices, document } = useEditor()
  const dispatcherRef = useRef(studioServices.get('dispatcher'))
  dispatcherRef.current = studioServices.get('dispatcher')

  const handleRotateBuilding = useCallback((buildingId: string, angleDelta: number) => {
    // Update the graph store
    useGraphStore.getState().rotateBuilding(buildingId, angleDelta)

    // Also update the CampusDocument via the editor's dispatcher
    const buildings = useGraphStore.getState().graph.buildings
    const building = buildings.find(b => b.id === buildingId)
    if (building) {
      dispatcherRef.current?.execute({
        id: 'entity.update',
        label: 'Rotate Building',
        payload: {
          entityId: buildingId,
          changes: { footprint: { points: building.footprint } },
        },
      })
    }
  }, [])
  const toolRegistry = studioServices.get('toolRegistry')!

  // Data sync + visibility + style switching are managed by <MapRenderer>
  // Selection highlight is managed by <SelectionOverlay />
  // Cursor + dragPan are managed by <InteractionController />

  useToolController()

  // Default to select tool on mount
  useEffect(() => {
    if (!toolRegistry) return
    if (!toolRegistry.activeToolId) toolRegistry.activate('select')
  }, [toolRegistry])

  useToolDockShortcuts(CAMPUS_TOOL_GROUPS, toolRegistry?.activeToolId ?? '', (id) => toolRegistry?.activate(id))

  useCampusBoundary(mapInstance, (result) => {
    drawing.requestConfirm('set-boundary', result.points)
  }, drawing, {
    toolId: 'set-boundary',
  })

  useOsmImportTool(mapInstance, drawing)

  useBuildingTracer(mapInstance, (result) => {
    drawing.setDrawPoints(result.points)
    drawing.requestConfirm('building')
  }, drawing)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      <ConfirmBar drawing={drawing} />
      <ConfirmOverlayAdapter drawing={drawing} />
      <ConnectionChoice drawing={drawing} />
      <ImportToast />
      <DrawingSessionProvider value={drawing}>
        {mapInstance && <DrawingOverlay map={mapInstance} />}
        {mapInstance && <PreviewOverlay map={mapInstance} />}
        {mapInstance && activeTool === 'route' && !isVertexEditing && (
          <SnapPreviewOverlay
            map={mapInstance}
            isActive={true}
            cursorPosition={cursorPos}
            roads={document?.roads ?? []}
            junctions={document?.roadJunctions}
            altHeld={altHeld}
            lockedCandidate={drawing.pendingRoadConnection?.candidate ?? null}
          />
        )}
      </DrawingSessionProvider>
      {mapInstance && <SelectionOverlay map={mapInstance} />}
      {mapInstance && <ValidationIssueOverlay map={mapInstance} />}
      {mapInstance && isBuildingEdit && (
        <RotationHandle
          map={mapInstance}
          buildingId={positionEditTarget?.id ?? null}
          onRotate={handleRotateBuilding}
        />
      )}
      {mapInstance && <EntityRendererBridge map={mapInstance} />}
      {mapInstance && <NavigationGraphRenderer map={mapInstance} />}
      {mapInstance && <ViewportController map={mapInstance} initialCenter={center} />}
      {mapInstance && <InteractionController map={mapInstance} onSetRoomDrag={drawing.setRoomDrag} onEmptyMapClick={onEmptyMapClick} drawing={drawing} />}
      {mapInstance && <POIGeometryAuthoring map={mapInstance} />}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
        <StyleSelector />
      </div>
      <PositionEditHint />
    </div>
  )
}
