'use client'

import type maplibregl from 'maplibre-gl'
import type { EditablePath } from '@/types/path-types'
import { LinearGeometryRenderer, type ToLatLng } from './LinearGeometryRenderer'

export interface HallwayRendererProps {
  map: maplibregl.Map | null
  path: EditablePath
  toLatLng: ToLatLng
  width: number
  visible?: boolean
}

export function HallwayRenderer({ map, path, toLatLng, width, visible }: HallwayRendererProps) {
  return (
    <LinearGeometryRenderer
      map={map}
      path={path}
      toLatLng={toLatLng}
      width={width}
      fillColor="#FFFFFF"
      outlineColor="#64748B"
      fillOpacity={0.85}
      outlineWidth={1.5}
      visible={visible}
      sourceId={`hallway-${path.id}`}
    />
  )
}
