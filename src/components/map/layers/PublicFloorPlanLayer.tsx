'use client'

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { syncFloorPlanImageLayer, type FloorPlanMapLike } from '@/lib/floor-plan-map-source'
import { resolvePublicFloorPlan } from '@/lib/public-floor-plan'
import type { Building } from '@/types/nav-types'

export function PublicFloorPlanLayer({
  map, building, level,
}: {
  map: maplibregl.Map
  building?: Building
  level: number
}) {
  useEffect(() => {
    const sync = () => {
      if (!map.isStyleLoaded()) return
      const plan = resolvePublicFloorPlan(building, level)
      syncFloorPlanImageLayer(map as unknown as FloorPlanMapLike, {
        sourceId: 'navigation-floor-plan',
        layerId: 'navigation-floor-plan-image',
        imageUrl: plan.imageUrl,
        footprint: building?.outline ?? building?.footprint ?? [],
        alignment: plan.alignment,
        opacity: plan.alignment?.opacity,
      })
    }
    sync()
    map.on('style.load', sync)
    map.on('idle', sync)
    return () => {
      map.off('style.load', sync)
      map.off('idle', sync)
    }
  }, [building, level, map])
  return null
}
