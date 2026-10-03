'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import NavigationMap, { useNavigationMap } from '@/components/map/NavigationMap'
import { createCaptureRecorder } from '../recorder'
import { useCaptureDirection } from '../hooks/useCaptureDirection'
import {
  buildCaptureDirectionGeoJson,
  type CaptureDirectionGeoJson,
} from '../direction'
import type { CaptureOrientationMode } from '../camera'
import { createCaptureDisplayPositionStabilizer } from '../display-position'
import type { CaptureCoordinate } from '../types'
import { captureCoordinatesToGeoJsonLine, getCaptureBounds } from '../geometry'
import { CaptureLiveHud } from './CaptureLiveHud'
import { CaptureMapCamera } from './CaptureMapCamera'
import type { CaptureMarkerDraft, CaptureSession, RawGpsSample } from '../types'
import { MarkerSheet } from './MarkerSheet'
import {
  buildPassiveLocationPositionGeoJson,
  createPassiveLocationMarkerLayers,
  ensurePassiveLocationMarkerImage,
  removePassiveLocationMarkerLayers,
  type PassiveLocationMarkerIds,
} from '@/lib/navigation-heading-arrow'

const SOURCE_IDS = {
  raw: 'capture-raw-route',
  candidate: 'capture-candidate-route',
  current: 'capture-current-position',
  markers: 'capture-markers',
  direction: 'capture-current-direction',
} as const

const LAYER_IDS = {
  raw: 'capture-raw-route-line',
  candidate: 'capture-candidate-route-line',
  current: 'capture-current-position-point',
  markers: 'capture-marker-points',
  directionArrow: 'capture-current-direction-arrow',
} as const

export const CAPTURE_DIRECTION_ARROW_IMAGE_ID = 'capture-direction-arrow-icon'

const CAPTURE_PASSIVE_MARKER_IDS: PassiveLocationMarkerIds = {
  positionSourceId: SOURCE_IDS.current,
  positionLayerId: LAYER_IDS.current,
  directionSourceId: SOURCE_IDS.direction,
  directionLayerId: LAYER_IDS.directionArrow,
  imageId: CAPTURE_DIRECTION_ARROW_IMAGE_ID,
}

const emptyFeatureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties> = { type: 'FeatureCollection', features: [] }

function lineData(points: Array<{ latitude: number; longitude: number }>) {
  if (points.length < 2) return emptyFeatureCollection
  return {
    type: 'FeatureCollection' as const,
    features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: captureCoordinatesToGeoJsonLine(points) } }],
  }
}

function pointData(session: CaptureSession, displayPosition?: CaptureCoordinate | null) {
  const point = displayPosition ?? session.lastPosition
  return buildPassiveLocationPositionGeoJson(point
    ? { latitude: point.latitude, longitude: point.longitude }
    : null)
}

function markerData(session: CaptureSession) {
  return {
    type: 'FeatureCollection' as const,
    features: session.markers.map((marker) => ({
      type: 'Feature' as const,
      properties: { markerType: marker.type, label: marker.label ?? '' },
      geometry: { type: 'Point' as const, coordinates: [marker.position.longitude, marker.position.latitude] },
    })),
  }
}

function directionData(directionGeoJson?: CaptureDirectionGeoJson): GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties> {
  return {
    type: 'FeatureCollection',
    features: [...(directionGeoJson?.arrow.features ?? [])],
  }
}

export const CAPTURE_DIRECTION_ARROW_LAYER = createPassiveLocationMarkerLayers(CAPTURE_PASSIVE_MARKER_IDS).direction

function ensureCaptureDirectionArrowImage(map: maplibregl.Map) {
  ensurePassiveLocationMarkerImage(map, CAPTURE_DIRECTION_ARROW_IMAGE_ID)
}

export function removeCaptureLayers(map: maplibregl.Map | null | undefined) {
  if (!map || typeof map.getLayer !== 'function' || typeof map.getSource !== 'function') return

  try {
    removePassiveLocationMarkerLayers(map, CAPTURE_PASSIVE_MARKER_IDS)
    ;[LAYER_IDS.raw, LAYER_IDS.candidate, LAYER_IDS.markers].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id)
    })
    ;[SOURCE_IDS.raw, SOURCE_IDS.candidate, SOURCE_IDS.markers].forEach((id) => {
      if (map.getSource(id)) map.removeSource(id)
    })
    if (typeof map.hasImage === 'function'
      && map.hasImage(CAPTURE_DIRECTION_ARROW_IMAGE_ID)
      && typeof map.removeImage === 'function') {
      map.removeImage(CAPTURE_DIRECTION_ARROW_IMAGE_ID)
    }
  } catch {
    // NavigationMap can tear down its MapLibre instance before child cleanup.
  }
}

function CaptureMapLayers({ session, displayPosition, directionGeoJson }: { session: CaptureSession; displayPosition?: CaptureCoordinate | null; directionGeoJson?: CaptureDirectionGeoJson }) {
  const { map, isReady } = useNavigationMap()

  useEffect(() => {
    if (!map || !isReady) return

    if (!map.getSource(SOURCE_IDS.raw)) map.addSource(SOURCE_IDS.raw, { type: 'geojson', data: emptyFeatureCollection })
    if (!map.getSource(SOURCE_IDS.candidate)) map.addSource(SOURCE_IDS.candidate, { type: 'geojson', data: emptyFeatureCollection })
    if (!map.getSource(SOURCE_IDS.current)) map.addSource(SOURCE_IDS.current, { type: 'geojson', data: emptyFeatureCollection })
    if (!map.getSource(SOURCE_IDS.markers)) map.addSource(SOURCE_IDS.markers, { type: 'geojson', data: emptyFeatureCollection })
    if (!map.getSource(SOURCE_IDS.direction)) map.addSource(SOURCE_IDS.direction, { type: 'geojson', data: emptyFeatureCollection })

    if (!map.getLayer(LAYER_IDS.raw)) map.addLayer({ id: LAYER_IDS.raw, type: 'line', source: SOURCE_IDS.raw, paint: { 'line-color': '#2563EB', 'line-width': 4, 'line-opacity': 0.48 } })
    if (!map.getLayer(LAYER_IDS.candidate)) map.addLayer({ id: LAYER_IDS.candidate, type: 'line', source: SOURCE_IDS.candidate, paint: { 'line-color': '#7C3AED', 'line-width': 5, 'line-dasharray': [1, 1.4] } })
    ensureCaptureDirectionArrowImage(map)
    if (!map.getLayer(LAYER_IDS.directionArrow)) map.addLayer(CAPTURE_DIRECTION_ARROW_LAYER as never)
    const passiveLayers = createPassiveLocationMarkerLayers(CAPTURE_PASSIVE_MARKER_IDS)
    if (!map.getLayer(LAYER_IDS.current)) map.addLayer(passiveLayers.position as never)
    if (!map.getLayer(LAYER_IDS.markers)) map.addLayer({ id: LAYER_IDS.markers, type: 'circle', source: SOURCE_IDS.markers, paint: { 'circle-color': '#F97316', 'circle-radius': 7, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 } })

    return () => removeCaptureLayers(map)
  }, [isReady, map])

  useEffect(() => {
    if (!map || !isReady) return
    const raw = map.getSource(SOURCE_IDS.raw) as maplibregl.GeoJSONSource | undefined
    const candidate = map.getSource(SOURCE_IDS.candidate) as maplibregl.GeoJSONSource | undefined
    const current = map.getSource(SOURCE_IDS.current) as maplibregl.GeoJSONSource | undefined
    const markers = map.getSource(SOURCE_IDS.markers) as maplibregl.GeoJSONSource | undefined
    const direction = map.getSource(SOURCE_IDS.direction) as maplibregl.GeoJSONSource | undefined
    raw?.setData(lineData(session.rawSamples))
    candidate?.setData(lineData(session.candidateRoute?.points ?? []))
    current?.setData(pointData(session, displayPosition))
    markers?.setData(markerData(session))
    direction?.setData(directionData(directionGeoJson))
  }, [directionGeoJson, displayPosition, isReady, map, session])

  return null
}

export { CaptureMapLayers }

export interface RecordingMapProps {
  session: CaptureSession
  onBack: () => void
  onStart: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onResume: () => void | Promise<void>
  onFinish: () => void | Promise<void>
  onAddMarker: (draft: CaptureMarkerDraft) => void | Promise<void>
  onPosition: (sample: RawGpsSample) => void | Promise<void>
  onSample: (sample: RawGpsSample) => void | Promise<void>
  onGpsError: (message: string) => void | Promise<void>
}

function CaptureRecorderBridge({ sessionId, status, onPosition, onSample, onGpsError }: {
  sessionId: string
  status: CaptureSession['status']
  onPosition: (sample: RawGpsSample) => void | Promise<void>
  onSample: (sample: RawGpsSample) => void | Promise<void>
  onGpsError: (message: string) => void | Promise<void>
}) {
  const recorderRef = useRef<ReturnType<typeof createCaptureRecorder> | null>(null)
  const onPositionRef = useRef(onPosition)
  const onSampleRef = useRef(onSample)
  const onGpsErrorRef = useRef(onGpsError)

  useEffect(() => {
    onPositionRef.current = onPosition
    onSampleRef.current = onSample
    onGpsErrorRef.current = onGpsError
  }, [onGpsError, onPosition, onSample])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      void onGpsErrorRef.current('Location is unavailable in this browser.')
      return undefined
    }
    const recorder = createCaptureRecorder({
      geolocation: navigator.geolocation,
      onPosition: (sample) => void onPositionRef.current(sample),
      onSample: (sample) => void onSampleRef.current(sample),
      onError: (error) => void onGpsErrorRef.current(error.message || 'Location permission was not granted.'),
    })
    recorderRef.current = recorder
    return () => {
      recorder.destroy()
      recorderRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (status === 'preparing') recorder.observe()
    if (status === 'recording') recorder.start()
    if (status === 'paused') recorder.pause()
    if (status === 'finished') recorder.finish()
  }, [sessionId, status])

  return null
}

export function RecordingMap({ session, onBack, onStart, onPause, onResume, onFinish, onAddMarker, onPosition, onSample, onGpsError }: RecordingMapProps) {
  const [markerSheetOpen, setMarkerSheetOpen] = useState(false)
  const [followLocation, setFollowLocation] = useState(true)
  const [orientationMode, setOrientationMode] = useState<CaptureOrientationMode>('north-up')
  const [displayHeading, setDisplayHeading] = useState<number | null>(null)
  const lastPosition = session.lastPosition ?? session.rawSamples.at(-1) ?? null
  const displayPositionSession = useMemo(
    () => ({ id: session.id, stabilizer: createCaptureDisplayPositionStabilizer() }),
    [session.id],
  )
  const displayPosition = useMemo(
    () => lastPosition
      ? displayPositionSession.stabilizer.update(lastPosition)
      : displayPositionSession.stabilizer.getCurrent(),
    [displayPositionSession, lastPosition],
  )
  const center: [number, number] | undefined = displayPosition ? [displayPosition.longitude, displayPosition.latitude] : undefined
  const bounds = getCaptureBounds(session)
  const captureDirection = useCaptureDirection({
    position: displayPosition,
    gpsSample: lastPosition,
    enabled: session.status !== 'finished',
  })
  const headingForArrow = captureDirection.direction.heading === null
    ? null
    : displayHeading ?? captureDirection.direction.heading
  const directionGeoJson = buildCaptureDirectionGeoJson(displayPosition ?? { latitude: Number.NaN, longitude: Number.NaN }, headingForArrow)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--navi-content)' }}>
      <CaptureRecorderBridge sessionId={session.id} status={session.status} onPosition={onPosition} onSample={onSample} onGpsError={onGpsError} />
      <header aria-label="Capture navigation" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 12px', borderBottom: '1px solid var(--navi-border)', background: 'var(--navi-card)', zIndex: 2 }}>
        <button type="button" aria-label="Back to Capture Home" onClick={onBack} style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--navi-border)', borderRadius: 8, color: 'var(--navi-text)', background: 'var(--navi-card)', cursor: 'pointer' }}><ArrowLeft size={18} aria-hidden="true" /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'var(--navi-text)', fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</div>
        </div>
      </header>
      <div data-testid="capture-map-region" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <NavigationMap center={center} zoom={18} bounds={bounds} fitBoundsOnChange={false} className="capture-map-container" style={{ minHeight: '100%' }}>
          <CaptureMapLayers session={session} displayPosition={displayPosition} directionGeoJson={directionGeoJson} />
          <CaptureMapCamera
            center={center}
            follow={followLocation}
            onFollowChange={setFollowLocation}
            heading={captureDirection.direction.heading}
            orientationMode={orientationMode}
            onOrientationChange={setOrientationMode}
            onHeadingChange={setDisplayHeading}
          />
        </NavigationMap>
        {markerSheetOpen && lastPosition && (
          <MarkerSheet
            position={lastPosition}
            accuracy={lastPosition.accuracy}
            onCancel={() => setMarkerSheetOpen(false)}
            onSave={async (draft) => { await onAddMarker(draft); setMarkerSheetOpen(false) }}
          />
          )}
      </div>
      <CaptureLiveHud
        session={session}
        direction={captureDirection.direction}
        canRequestDirection={captureDirection.canRequestPermission}
        onEnableDirection={session.status === 'preparing' ? captureDirection.enableDirection : undefined}
        onMarker={() => setMarkerSheetOpen(true)}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onFinish={onFinish}
      />
    </div>
  )
}
