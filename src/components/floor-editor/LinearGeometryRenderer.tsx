'use client'

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { EditablePath } from '@/types/path-types'
import { computeHallwayPolygon } from '@/types/hallway-types'

export type ToLatLng = (x: number, y: number) => { lat: number; lng: number }

export interface LinearGeometryRendererProps {
  map: maplibregl.Map | null
  path: EditablePath
  toLatLng: ToLatLng
  width: number
  fillColor: string
  outlineColor: string
  fillOpacity?: number
  outlineWidth?: number
  sourceId?: string
  zIndex?: number
  visible?: boolean
}

export function LinearGeometryRenderer({
  map, path, toLatLng, width,
  fillColor, outlineColor,
  fillOpacity = 0.85, outlineWidth = 1.5,
  sourceId = 'geo-fill',
  zIndex,
  visible = true,
}: LinearGeometryRendererProps) {
  const disposedRef = useRef(false)

  const fillLayerId = `${sourceId}-fill`
  const outlineLayerId = `${sourceId}-outline`

  useEffect(() => {
    if (!map) return
    if (map.getSource(sourceId)) return
    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: fillLayerId, type: 'fill', source: sourceId,
      paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity },
    })
    map.addLayer({
      id: outlineLayerId, type: 'line', source: sourceId,
      paint: { 'line-color': outlineColor, 'line-width': outlineWidth },
    })
    return () => {
      disposedRef.current = true
      try {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getLayer(outlineLayerId)) map.removeLayer(outlineLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // map may already be destroyed during React cleanup
      }
    }
  }, [map, sourceId])

  useEffect(() => {
    if (!map) return
    if (!map.getSource(sourceId)) return

    const disposed = disposedRef.current
    if (disposed) return

    const centerline = path.vertices.map((v) => toLatLng(v.x, v.y))
    if (centerline.length < 2) {
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
      if (src) src.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    const buffer = computeHallwayPolygon(centerline, width)
    if (buffer.length < 3) return

    const coords = [...buffer.map((p) => [p.lng, p.lat] as [number, number]), [buffer[0].lng, buffer[0].lat] as [number, number]]

    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource
    if (!src) return
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      }],
    })
  }, [map, sourceId, path, toLatLng, width])

  // Update paint properties when styling changes
  useEffect(() => {
    if (!map) return
    if (!map.getLayer(fillLayerId)) return
    map.setPaintProperty(fillLayerId, 'fill-color', fillColor)
    map.setPaintProperty(fillLayerId, 'fill-opacity', fillOpacity)
    map.setPaintProperty(outlineLayerId, 'line-color', outlineColor)
    map.setPaintProperty(outlineLayerId, 'line-width', outlineWidth)
    if (zIndex != null) {
      map.moveLayer(fillLayerId)
      map.moveLayer(outlineLayerId)
    }
  }, [map, fillLayerId, outlineLayerId, fillColor, fillOpacity, outlineColor, outlineWidth, zIndex])

  // Layer visibility management
  useEffect(() => {
    if (!map) return
    const vis = visible ? 'visible' : 'none'
    if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', vis)
    if (map.getLayer(outlineLayerId)) map.setLayoutProperty(outlineLayerId, 'visibility', vis)
  }, [map, fillLayerId, outlineLayerId, visible])

  return null
}
