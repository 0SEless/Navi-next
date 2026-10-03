'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import {
  useEditor,
  EntityRenderer,
  type DocumentEventBus,
  type SelectionManager,
  type Viewport,
} from '@navi/editor'

/**
 * Bridges the new-architecture EntityRenderer into the React tree.
 *
 * EntityRenderer is the canonical CampusDocument → MapLibre renderer. It
 * subscribes to the DocumentEventBus (entity.created/updated/deleted) and
 * re-pushes all document geometry, so post-mount edits (e.g. Route drawing)
 * actually redraw. Replaces the legacy MapRenderer (ADR 004 — Rendering
 * Responsibilities); it also owns the campus layer-visibility toggles.
 */
import { useStudioStore } from '@/store/studio-store'
import { LAYER_IDS } from '@navi/editor'

export interface EntityRendererBridgeProps {
  map: maplibregl.Map
}

function setLayerVis(map: maplibregl.Map, layerId: string, visible: boolean) {
  try {
    if (!map.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  } catch {
    /* layer may not exist yet */
  }
}

/**
 * EntityRendererBridge
 *
 * - Instantiates and owns the EntityRenderer (authored CampusDocument geometry).
 * - Applies the studio `layers.buildings` toggle to the navi-building layers,
 *   since building geometry is now an EntityRenderer concern (was s-buildings
 *   under the legacy MapRenderer).
 */
export function EntityRendererBridge({ map }: EntityRendererBridgeProps) {
  const { document, services, transformer } = useEditor()
  const buildingsVisible = useStudioStore((s) => s.layers.buildings)
  const showNavigationOnlyRoutes = useStudioStore((s) => s.layers.navigation_only_routes ?? false)
  const showHiddenPois = useStudioStore((s) => s.layers.hidden_pois ?? false)
  const activeFloor = useStudioStore((s) => s.activeFloor)
  const ref = useRef<EntityRenderer | null>(null)

  useEffect(() => {
    if (ref.current) return
    const eventBus = services.get('eventBus') as DocumentEventBus
    const selection = services.get('selection') as SelectionManager
    const viewport = services.get('viewport') as Viewport
    const renderer = new EntityRenderer({ map, document, eventBus, selection, viewport, transformer })
    renderer.init()
    renderer.setActiveFloor(activeFloor)
    ref.current = renderer
    return () => {
      renderer.destroy()
      ref.current = null
    }
  }, [map, document, services, transformer])

  // Update active floor when it changes
  useEffect(() => {
    ref.current?.setActiveFloor(activeFloor)
  }, [activeFloor])

  useEffect(() => {
    ref.current?.setShowNavigationOnlyRoutes(showNavigationOnlyRoutes)
  }, [showNavigationOnlyRoutes])

  useEffect(() => {
    ref.current?.setShowHiddenPois(showHiddenPois)
  }, [showHiddenPois])

  // Campus layer-visibility toggles (EntityRenderer owns building geometry).
  useEffect(() => {
    if (!map.getStyle()) return
    setLayerVis(map, LAYER_IDS.BUILDING_FILL, buildingsVisible)
    setLayerVis(map, LAYER_IDS.BUILDING_OUTLINE, buildingsVisible)
    setLayerVis(map, LAYER_IDS.BUILDING_EXTRUSION, buildingsVisible)
  }, [map, buildingsVisible])

  return null
}
