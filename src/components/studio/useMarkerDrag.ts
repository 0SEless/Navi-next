'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useEditor, useEditingEngine } from '@navi/editor'
import { useStudioStore } from '@/store/studio-store'
import type { LatLng } from '@/types/nav-types'

const MARKER_SRC = 's-position-marker'
const MARKER_LYR = 'l-position-marker'

function addMarkerSource(map: maplibregl.Map) {
  if (map.getSource(MARKER_SRC)) return
  map.addSource(MARKER_SRC, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: MARKER_LYR,
    type: 'circle',
    source: MARKER_SRC,
    paint: {
      'circle-radius': 8,
      'circle-color': '#f59e0b',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#fff',
      'circle-opacity': 0.9,
    },
  })
}

function removeMarkerSource(map: maplibregl.Map) {
  if (map.isStyleLoaded?.()) {
    if (map.getLayer(MARKER_LYR)) map.removeLayer(MARKER_LYR)
    if (map.getSource(MARKER_SRC)) map.removeSource(MARKER_SRC)
  }
}

function updateMarker(map: maplibregl.Map, pos: LatLng) {
  const src = map.getSource(MARKER_SRC) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pos.lng, pos.lat] },
      properties: {},
    }],
  })
}

function findEntity(document: any, type: string, id: string): { position: any; buildingId?: string } | null {
  if (type === 'entrance') {
    for (const b of document.buildings ?? []) {
      for (const f of b.floors ?? []) {
        const e = (f.entrances ?? []).find((en: any) => en.id === id)
        if (e) return { position: e.position, buildingId: b.id }
      }
    }
    return null
  }
  if (type === 'panorama') {
    const pano = (document.panoramas ?? []).find((p: any) => p.id === id)
    return pano ?? null
  }
  if (type === 'qr') {
    const qr = (document.qrCheckpoints ?? []).find((q: any) => q.id === id)
    return qr ?? null
  }
  return null
}

export function useMarkerDrag(map: maplibregl.Map | null) {
  const target = useStudioStore((s) => s.positionEditTarget)
  const setPositionEditTarget = useStudioStore((s) => s.setPositionEditTarget)
  const { document, services, transformer } = useEditor()
  const editEngine = useEditingEngine()

  const mapRef = useRef(map)
  mapRef.current = map
  const targetRef = useRef(target)
  targetRef.current = target
  const docRef = useRef(document)
  docRef.current = document

  const dragRef = useRef<{
    originalPos: LatLng
    startPoint: LatLng
  } | null>(null)

  useEffect(() => {
    const m = mapRef.current
    if (!m) return

    if (!target || target.type === 'building') {
      removeMarkerSource(m)
      return
    }

    const entity = findEntity(docRef.current, target.type, target.id)
    if (!entity) return

    // P1-T4 (D9): entities are stored building-local — derive world for the
    // marker display/drag math; legacy world-stored records pass through.
    const toWorld = (e: any): LatLng | null => {
      if (e?.position?.lat !== undefined) return { lat: e.position.lat, lng: e.position.lng }
      if (e?.buildingId && transformer) return transformer.buildingLocalToWorld(e.position, e.buildingId)
      return null
    }
    const worldPos = toWorld(entity)
    if (!worldPos) return

    addMarkerSource(m)
    updateMarker(m, worldPos)

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return
      if (useStudioStore.getState().tool !== 'select') return

      const features = m.queryRenderedFeatures(e.point, { layers: [MARKER_LYR] })
      if (features.length === 0) return

      const entity = findEntity(docRef.current, targetRef.current!.type, targetRef.current!.id)
      if (!entity) return
      const worldPos = toWorld(entity)
      if (!worldPos) return

      dragRef.current = {
        originalPos: { ...worldPos },
        startPoint: { lat: e.lngLat.lat, lng: e.lngLat.lng },
      }
      m.dragPan.disable()
    }

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const drag = dragRef.current
      if (!drag) return

      const dLat = e.lngLat.lat - drag.startPoint.lat
      const dLng = e.lngLat.lng - drag.startPoint.lng

      updateMarker(m, {
        lat: drag.originalPos.lat + dLat,
        lng: drag.originalPos.lng + dLng,
      })
    }

    const onMouseUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      m.dragPan.enable()

      const target = targetRef.current!
      const dispatcher = services.get<any>('dispatcher')

      const entity = findEntity(docRef.current, target.type, target.id)
      if (!entity) return

      const src = m.getSource(MARKER_SRC) as maplibregl.GeoJSONSource | undefined
      if (!src) return

      const srcData = (src as any)._data as GeoJSON.FeatureCollection
      if (!srcData?.features?.[0]) return

      const coords = (srcData.features[0].geometry as GeoJSON.Point).coordinates
      const newPos = { lat: coords[1], lng: coords[0] }

      // P1-T4 (D9): entrances/panoramas/QRs are stored building-local — convert
      // the dragged world position before writing. Without a building anchor the
      // move is refused rather than storing world values in local fields.
      const anchorBuildingId = entity.buildingId
      const local = anchorBuildingId && transformer
        ? transformer.worldToBuildingLocal(newPos, anchorBuildingId)
        : null
      if (!local) return

      editEngine.begin({ kind: 'assign', entityId: target.id, property: 'position', value: local })
      editEngine.doCommit()
      dispatcher.execute({
        id: 'entity.update',
        label: `Move ${target.type}`,
        payload: { entityId: target.id, changes: { position: local } },
      })

      useStudioStore.getState().setPositionEditTarget(null)
    }

    m.on('mousedown', onMouseDown)
    m.on('mousemove', onMouseMove)
    m.on('mouseup', onMouseUp)

    return () => {
      m.off('mousedown', onMouseDown)
      m.off('mousemove', onMouseMove)
      m.off('mouseup', onMouseUp)
      removeMarkerSource(m)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.type, target?.id, editEngine, services, transformer])
}
