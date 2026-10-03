'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { CampusBundle } from '@/types/nav-types'
import type { NavigationContextValue } from './NavigationContext'

type CampusBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number }

interface NavigationMapRuntimeOptions {
  center: [number, number]
  zoom: number
  pitch: number
  maxPitch: number
  maxZoom: number
  minZoom: number
  showZoomControls: boolean
}

interface NavigationMapContextValue {
  map: maplibregl.Map | null
  isReady: boolean
  isActive: boolean
  hostRequested: boolean
  requestMap: (options: NavigationMapRuntimeOptions) => void
  getInitialOptions: () => NavigationMapRuntimeOptions | null
  attachMap: (map: maplibregl.Map) => void
  markMapReady: (map: maplibregl.Map) => void
  detachMap: (map: maplibregl.Map) => void
  fitBoundsIfChanged: (
    bounds: CampusBounds,
    options: { padding: number; duration: number; maxZoom: number },
  ) => boolean
}

export interface NavigationMapSceneState {
  bundle: CampusBundle
  route: { path: string[]; cost: number } | null
  navigationTargetBuildingId?: string
  navigationContext: NavigationContextValue | null
  fitCamera: boolean
}

interface NavigationMapSceneContextValue {
  state: NavigationMapSceneState | null
  publish: (owner: symbol, state: NavigationMapSceneState) => void
  clear: (owner: symbol) => void
}

const NavigationMapContext = createContext<NavigationMapContextValue>({
  map: null,
  isReady: false,
  isActive: false,
  hostRequested: false,
  requestMap: () => undefined,
  getInitialOptions: () => null,
  attachMap: () => undefined,
  markMapReady: () => undefined,
  detachMap: () => undefined,
  fitBoundsIfChanged: () => false,
})

const NavigationMapSceneContext = createContext<NavigationMapSceneContextValue>({
  state: null,
  publish: () => undefined,
  clear: () => undefined,
})

export function useNavigationMap() {
  return useContext(NavigationMapContext)
}

export function useNavigationMapScene() {
  return useContext(NavigationMapSceneContext)
}

interface NavigationMapProviderProps {
  active: boolean
  surfaceKey: string | null
  children: ReactNode
}

/** Owns the one MapLibre runtime for the lifetime of the public /map shell. */
export function NavigationMapProvider({ active, surfaceKey, children }: NavigationMapProviderProps) {
  const [hostRequested, setHostRequested] = useState(false)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [isReady, setIsReady] = useState(false)
  const hostRequestedRef = useRef(false)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const isReadyRef = useRef(false)
  const initialOptionsRef = useRef<NavigationMapRuntimeOptions | null>(null)
  const lastFittedBoundsRef = useRef<string | null>(null)
  const [sceneState, setSceneState] = useState<NavigationMapSceneState | null>(null)
  const sceneOwnerRef = useRef<symbol | null>(null)

  const requestMap = useCallback((options: NavigationMapRuntimeOptions) => {
    if (!hostRequestedRef.current) {
      hostRequestedRef.current = true
      initialOptionsRef.current = options
      setHostRequested(true)
      return
    }

    const currentMap = mapRef.current
    if (currentMap && options.maxPitch > currentMap.getMaxPitch()) {
      currentMap.setMaxPitch(options.maxPitch)
      return
    }

    if (!currentMap && initialOptionsRef.current && options.maxPitch > initialOptionsRef.current.maxPitch) {
      initialOptionsRef.current = { ...initialOptionsRef.current, maxPitch: options.maxPitch }
    }
  }, [])

  const getInitialOptions = useCallback(() => initialOptionsRef.current, [])

  const attachMap = useCallback((instance: maplibregl.Map) => {
    mapRef.current = instance
  }, [])

  const markMapReady = useCallback((instance: maplibregl.Map) => {
    if (mapRef.current !== instance) return
    isReadyRef.current = true
    setMap(instance)
    setIsReady(true)
  }, [])

  const detachMap = useCallback((instance: maplibregl.Map) => {
    if (mapRef.current !== instance) return
    mapRef.current = null
    isReadyRef.current = false
    lastFittedBoundsRef.current = null
  }, [])

  const fitBoundsIfChanged = useCallback((bounds: CampusBounds, options: {
    padding: number
    duration: number
    maxZoom: number
  }) => {
    const currentMap = mapRef.current
    if (!currentMap || !isReadyRef.current) return false

    const key = JSON.stringify([bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng])
    if (lastFittedBoundsRef.current === key) return false

    currentMap.fitBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      options,
    )
    lastFittedBoundsRef.current = key
    return true
  }, [])

  const publishSceneState = useCallback((owner: symbol, state: NavigationMapSceneState) => {
    sceneOwnerRef.current = owner
    setSceneState(state)
  }, [])

  const clearSceneState = useCallback((owner: symbol) => {
    if (sceneOwnerRef.current !== owner) return
    sceneOwnerRef.current = null
    setSceneState(null)
  }, [])

  useEffect(() => {
    if (!map || !isReady) return
    if (!active) {
      map.stop()
      return
    }

    let frameId: number | null = null
    let timerId: number | null = null
    const resize = () => {
      if (mapRef.current === map && active) map.resize()
    }

    if (typeof window.requestAnimationFrame === 'function') {
      frameId = window.requestAnimationFrame(resize)
    } else {
      timerId = window.setTimeout(resize, 0)
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (timerId !== null) window.clearTimeout(timerId)
    }
  }, [active, isReady, map, surfaceKey])

  const contextValue = useMemo<NavigationMapContextValue>(() => ({
    map,
    isReady,
    isActive: active,
    hostRequested,
    requestMap,
    getInitialOptions,
    attachMap,
    markMapReady,
    detachMap,
    fitBoundsIfChanged,
  }), [
    active,
    attachMap,
    detachMap,
    fitBoundsIfChanged,
    getInitialOptions,
    hostRequested,
    isReady,
    map,
    markMapReady,
    requestMap,
  ])

  const sceneContextValue = useMemo<NavigationMapSceneContextValue>(() => ({
    state: sceneState,
    publish: publishSceneState,
    clear: clearSceneState,
  }), [clearSceneState, publishSceneState, sceneState])

  return (
    <NavigationMapContext.Provider value={contextValue}>
      <NavigationMapSceneContext.Provider value={sceneContextValue}>
        {children}
      </NavigationMapSceneContext.Provider>
    </NavigationMapContext.Provider>
  )
}

/** Persistent canvas host rendered inside the shell's main viewport. */
export function NavigationMapHost() {
  const {
    hostRequested,
    isActive,
    getInitialOptions,
    attachMap,
    markMapReady,
    detachMap,
  } = useNavigationMap()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const options = getInitialOptions()
    if (!hostRequested || !container || !options || mapRef.current) return undefined

    const mapInstance = new maplibregl.Map({
      container,
      style: OSM_STYLE,
      center: options.center,
      zoom: options.zoom,
      pitch: options.pitch,
      maxPitch: options.maxPitch,
      maxZoom: options.maxZoom,
      minZoom: options.minZoom,
      attributionControl: false,
    })
    mapRef.current = mapInstance
    attachMap(mapInstance)

    mapInstance.addControl(new maplibregl.NavigationControl({
      showCompass: false,
      showZoom: options.showZoomControls,
    }), 'bottom-right')
    mapInstance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    mapInstance.on('error', (event) => {
      if (event.error?.status === 0 || `${event.error}`.includes('Failed to fetch') || `${event.error}`.includes('CORS')) return
      console.error(event.error)
    })

    const handleLoad = () => {
      if (mapRef.current === mapInstance) markMapReady(mapInstance)
    }
    mapInstance.on('load', handleLoad)

    return () => {
      try { mapInstance.off('load', handleLoad) } catch {}
      try { mapInstance.remove() } catch {}
      if (mapRef.current === mapInstance) mapRef.current = null
      detachMap(mapInstance)
    }
  }, [attachMap, detachMap, getInitialOptions, hostRequested, markMapReady])

  if (!hostRequested) return null

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-0 h-full w-full${isActive ? '' : ' hidden'}`}
      data-testid="navigation-map-host"
      data-active={isActive ? 'true' : 'false'}
      aria-hidden={!isActive}
      style={{ width: '100%', height: '100%', pointerEvents: isActive ? 'auto' : 'none' }}
    />
  )
}

// ── Props ──────────────────────────────────────────────────────

export interface NavigationMapProps {
  center?: [number, number]
  zoom?: number
  pitch?: number
  maxPitch?: number
  maxZoom?: number
  minZoom?: number
  showZoomControls?: boolean
  bounds?: CampusBounds | null
  fitBoundsOnChange?: boolean
  style?: CSSProperties
  className?: string
  onMapReady?: (map: maplibregl.Map) => void
  children?: ReactNode
}

const DEFAULT_CENTER: [number, number] = [122.1677, 11.8197]

/** Route-scoped map scene adapter that reuses the shell-owned MapLibre host. */
export default function NavigationMap({
  ...props
}: NavigationMapProps) {
  const { isActive } = useNavigationMap()

  if (isActive) return <NavigationMapScene {...props} />

  return (
    <div
      className={props.className}
      style={{ position: 'relative', width: '100%', height: '100%', ...props.style }}
    >
      <NavigationMapProvider active surfaceKey="standalone">
        <NavigationMapHost />
        <NavigationMapScene {...props} />
      </NavigationMapProvider>
    </div>
  )
}

function NavigationMapScene({
  center = DEFAULT_CENTER,
  zoom = 16,
  pitch = 0,
  maxPitch = 60,
  maxZoom = 22,
  minZoom = 12,
  showZoomControls = true,
  bounds,
  fitBoundsOnChange = true,
  onMapReady,
  children,
}: NavigationMapProps) {
  const { map, isReady, requestMap, fitBoundsIfChanged } = useNavigationMap()
  const centerLng = center[0]
  const centerLat = center[1]

  useEffect(() => {
    requestMap({ center: [centerLng, centerLat], zoom, pitch, maxPitch, maxZoom, minZoom, showZoomControls })
  }, [centerLat, centerLng, maxPitch, maxZoom, minZoom, pitch, requestMap, showZoomControls, zoom])

  useEffect(() => {
    if (!map || !isReady || !bounds || !fitBoundsOnChange) return
    fitBoundsIfChanged(bounds, { padding: 60, duration: 800, maxZoom: 18 })
  }, [bounds, fitBoundsIfChanged, fitBoundsOnChange, isReady, map])

  useEffect(() => {
    if (map && isReady) onMapReady?.(map)
  }, [isReady, map, onMapReady])

  return isReady ? <>{children}</> : null
}

// ── Base Style ─────────────────────────────────────────────────

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}
