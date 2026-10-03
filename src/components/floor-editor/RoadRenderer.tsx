'use client'

import type maplibregl from 'maplibre-gl'
import type { EditablePath } from '@/types/path-types'
import { LinearGeometryRenderer, type ToLatLng } from './LinearGeometryRenderer'

export interface RoadRendererProps {
  map: maplibregl.Map | null
  path: EditablePath
  toLatLng: ToLatLng
  width: number
  visible?: boolean
}

export function RoadRenderer({ map, path, toLatLng, width, visible }: RoadRendererProps) {
  return (
    <LinearGeometryRenderer
      map={map}
      path={path}
      toLatLng={toLatLng}
      width={width}
      fillColor="#F97316"
      outlineColor="#9A3412"
      fillOpacity={0.7}
      outlineWidth={2}
      visible={visible}
      sourceId={`road-${path.id}`}
    />
  )
}
