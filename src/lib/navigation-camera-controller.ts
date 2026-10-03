import {
  getNavigationCameraMode,
  getNavigationCameraPolicy,
  getNavigationTransitionDuration,
  NAVIGATION_POV_PREFERRED_PITCH,
  NAVIGATION_TOP_MAX_ZOOM,
  resetNavigationCompass,
  type NavigationCameraMode,
  type NavigationCameraSurface,
  type TopCameraOrientation,
} from '@/lib/navigation-camera-policy'
import { normalizeCaptureHeading, smoothCaptureHeading } from '@/features/capture/direction'

export type NavigationCameraCenter = [number, number]
export type NavigationCameraOffset = [number, number]

export interface NavigationCameraBounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

export interface NavigationCameraEaseOptions {
  center?: NavigationCameraCenter
  pitch?: number
  bearing?: number
  zoom?: number
  offset?: NavigationCameraOffset
  duration: number
}

export interface NavigationCameraFitBoundsOptions {
  padding: { top: number; right: number; bottom: number; left: number }
  duration: number
  maxZoom?: number
}

export interface NavigationCameraHandler {
  enable: () => void
  disable: () => void
  isEnabled?: () => boolean
}

export interface NavigationCameraTouchZoomRotateHandler extends NavigationCameraHandler {
  enableRotation: () => void
  disableRotation: () => void
}

interface NavigationCameraInteractionEvent {
  originalEvent?: unknown
}

/** The small MapLibre surface the imperative controller is allowed to touch. */
export interface NavigationCameraMap {
  isStyleLoaded: () => boolean
  getBearing: () => number
  getPitch: () => number
  getMaxPitch?: () => number
  getZoom?: () => number
  getMaxZoom?: () => number
  setMaxZoom?: (zoom: number) => void
  stop?: () => void
  easeTo: (options: NavigationCameraEaseOptions) => void
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options: NavigationCameraFitBoundsOptions,
  ) => void
  on: (type: 'dragstart' | 'rotatestart' | 'zoomstart' | 'moveend' | 'styledata' | 'idle', listener: (event?: NavigationCameraInteractionEvent) => void) => void
  off: (type: 'dragstart' | 'rotatestart' | 'zoomstart' | 'moveend' | 'styledata' | 'idle', listener: (event?: NavigationCameraInteractionEvent) => void) => void
  dragPan: NavigationCameraHandler
  dragRotate: NavigationCameraHandler
  scrollZoom: NavigationCameraHandler
  doubleClickZoom: NavigationCameraHandler
  touchZoomRotate: NavigationCameraTouchZoomRotateHandler
  touchPitch: NavigationCameraHandler
}

export interface NavigationCameraUpdate {
  surface: NavigationCameraSurface
  mode: NavigationCameraMode
  topOrientation?: TopCameraOrientation
  position?: NavigationCameraCenter | null
  heading?: number | null
  headingFollowEnabled?: boolean
  routeBounds?: NavigationCameraBounds | null
  initialSetup?: boolean
  reducedMotion?: boolean
}

export interface NavigationCameraControllerState {
  mode: NavigationCameraMode
  topOrientation: TopCameraOrientation
  followSuspended: boolean
  headingFollowSuspended: boolean
  headingFollowEnabled: boolean
  bearing: number
}

export interface NavigationCameraControllerOptions {
  reducedMotion?: boolean
  initialSetup?: boolean
  onSuspensionChange?: (suspended: boolean) => void
}

export interface NavigationCameraController {
  update: (input: NavigationCameraUpdate) => void
  recenter: (position?: NavigationCameraCenter | null, heading?: number | null) => void
  setHeadingFollowEnabled: (enabled: boolean, heading?: number | null) => void
  resetCompass: () => void
  fitRoute: (bounds: NavigationCameraBounds) => void
  getState: () => NavigationCameraControllerState
  destroy: () => void
}

const FOLLOW_OFFSET: NavigationCameraOffset = [0, 110]
const POV_OFFSET: NavigationCameraOffset = [0, 150]
const ROUTE_PREVIEW_PADDING = { top: 184, right: 32, bottom: 168, left: 32 }
const ROUTE_PREVIEW_DURATION_MS = 400
const ROUTE_PREVIEW_MAX_ZOOM = NAVIGATION_TOP_MAX_ZOOM

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isValidCenter(center: NavigationCameraCenter | null | undefined): center is NavigationCameraCenter {
  return center !== null
    && center !== undefined
    && isFiniteNumber(center[0])
    && isFiniteNumber(center[1])
}

function isValidBounds(bounds: NavigationCameraBounds | null | undefined): bounds is NavigationCameraBounds {
  return bounds !== null
    && bounds !== undefined
    && isFiniteNumber(bounds.minLng)
    && isFiniteNumber(bounds.maxLng)
    && isFiniteNumber(bounds.minLat)
    && isFiniteNumber(bounds.maxLat)
    && bounds.minLng <= bounds.maxLng
    && bounds.minLat <= bounds.maxLat
}

function offsetForMode(mode: NavigationCameraMode): NavigationCameraOffset | undefined {
  if (mode === 'FOLLOW') return FOLLOW_OFFSET
  if (mode === 'POV') return POV_OFFSET
  return undefined
}

function boundsKey(bounds: NavigationCameraBounds): string {
  return [bounds.minLng, bounds.maxLng, bounds.minLat, bounds.maxLat].join(':')
}

function cameraKey(options: Omit<NavigationCameraEaseOptions, 'duration'>): string {
  const cameraIntent = { ...options }
  delete cameraIntent.zoom
  return JSON.stringify(cameraIntent)
}

function recenterInputKey(
  mode: NavigationCameraMode,
  topOrientation: TopCameraOrientation,
  headingFollowEnabled: boolean,
  position: NavigationCameraCenter | null | undefined,
  heading: number | null,
): string {
  return JSON.stringify({
    mode,
    topOrientation,
    headingFollowEnabled,
    position: isValidCenter(position) ? position : null,
    heading,
  })
}

function applyHandler(handler: NavigationCameraHandler, enabled: boolean): void {
  if (enabled) handler.enable()
  else handler.disable()
}

function applyCameraHandlers(map: NavigationCameraMap, policy: ReturnType<typeof getNavigationCameraPolicy>): void {
  applyHandler(map.dragPan, policy.allowPan)
  applyHandler(map.scrollZoom, policy.allowZoom)
  applyHandler(map.doubleClickZoom, policy.allowZoom)
  applyHandler(map.dragRotate, policy.allowRotate)
  applyHandler(map.touchZoomRotate, policy.allowZoom)

  if (policy.allowRotate) map.touchZoomRotate.enableRotation()
  else map.touchZoomRotate.disableRotation()

  applyHandler(map.touchPitch, policy.allowPitch)
}

export function createNavigationCameraController(
  map: NavigationCameraMap,
  options: NavigationCameraControllerOptions = {},
): NavigationCameraController {
  const state: NavigationCameraControllerState = {
    mode: 'TOP',
    topOrientation: 'free',
    followSuspended: false,
    headingFollowSuspended: false,
    headingFollowEnabled: false,
    bearing: map.getBearing(),
  }

  let destroyed = false
  let hasUpdated = false
  let lastCameraKey: string | null = null
  let lastAppliedZoom: number | undefined
  let lastRecenterKey: string | null = null
  let pendingRecenterUpdateKey: string | null = null
  let lastRouteBoundsKey: string | null = null
  let reducedMotion = options.reducedMotion === true
  let transitionGeneration = 0
  let smoothedHeading: number | null = null
  let styleWasReady = false
  let pendingUpdate: NavigationCameraUpdate | null = null
  let userGestureActive = false
  let cameraTransitionActive = false
  let setupSessionActive = options.initialSetup === true
  let initialFramingApplied = false
  let initialFramingSuppressed = false
  const initialMaxZoom = map.getMaxZoom?.()
  let appliedMaxZoom: number | undefined

  const resolveLiveHeading = (heading: number | null | undefined): number | null => {
    if (heading === undefined) return smoothedHeading
    smoothedHeading = smoothCaptureHeading(smoothedHeading, heading)
    return smoothedHeading
  }

  const resolveExplicitHeading = (heading: number | null | undefined): number | null => {
    if (heading === undefined) return smoothedHeading
    smoothedHeading = normalizeCaptureHeading(heading)
    return smoothedHeading
  }

  const beginTransition = (): number => {
    transitionGeneration += 1
    cameraTransitionActive = true
    if (hasUpdated) map.stop?.()
    return transitionGeneration
  }

  const applyMaxZoom = (maxZoom: number): void => {
    if (!map.setMaxZoom || appliedMaxZoom === maxZoom) return
    map.setMaxZoom(maxZoom)
    appliedMaxZoom = maxZoom
  }

  const currentZoom = (): number | null => {
    const zoom = map.getZoom?.()
    return zoom !== undefined && Number.isFinite(zoom) ? zoom : null
  }

  const clampPitchToMap = (pitch: number): number => {
    const maxPitch = map.getMaxPitch?.()
    return maxPitch !== undefined && Number.isFinite(maxPitch)
      ? Math.min(pitch, maxPitch)
      : pitch
  }

  const handleManualInteraction = (event?: NavigationCameraInteractionEvent): void => {
    if (destroyed || !event?.originalEvent) return

    userGestureActive = true
    lastRecenterKey = null
    pendingRecenterUpdateKey = null
    if (setupSessionActive && !initialFramingApplied) initialFramingSuppressed = true
    if (state.followSuspended) return

    state.followSuspended = true
    state.headingFollowSuspended = false
    options.onSuspensionChange?.(true)
  }

  map.on('dragstart', handleManualInteraction)
  map.on('rotatestart', handleManualInteraction)
  map.on('zoomstart', handleManualInteraction)

  // Consume transition/gesture moveend notifications before considering a
  // settled pitch repair. A stopped easeTo can emit moveend after a newer
  // transition begins, so it must never become a new competing writer.
  const handleMoveEnd = (): void => {
    if (destroyed) return
    if (userGestureActive) {
      userGestureActive = false
      cameraTransitionActive = false
      state.bearing = map.getBearing()
      return
    }
    if (cameraTransitionActive) {
      cameraTransitionActive = false
      return
    }
    if (state.followSuspended) return
    if (state.mode !== 'TOP' && state.mode !== 'FOLLOW' && state.mode !== 'POV') return
    const targetPitch = clampPitchToMap(
      state.mode === 'TOP'
        ? 0
        : state.mode === 'POV'
          ? NAVIGATION_POV_PREFERRED_PITCH
          : 55,
    )
    const currentPitch = map.getPitch()
    if (Math.abs(currentPitch - targetPitch) > 0.5) {
      applyCamera({ pitch: targetPitch }, 200, transitionGeneration)
    }
  }
  map.on('moveend', handleMoveEnd)

  const isReady = (): boolean => {
    if (destroyed) return false
    if (styleWasReady) return true
    styleWasReady = map.isStyleLoaded()
    return styleWasReady
  }

  const clearSuspension = (): void => {
    const hadFollowSuspension = state.followSuspended
    userGestureActive = false
    state.followSuspended = false
    state.headingFollowSuspended = false
    if (hadFollowSuspension) options.onSuspensionChange?.(false)
  }

  const applyCamera = (
    target: Omit<NavigationCameraEaseOptions, 'duration'>,
    duration: number,
    generation = transitionGeneration,
  ): void => {
    if (generation !== transitionGeneration || destroyed) return
    const nextKey = cameraKey(target)
    const requestedZoom = target.zoom
    if (nextKey === lastCameraKey
      && (requestedZoom === undefined || requestedZoom === lastAppliedZoom)) return
    cameraTransitionActive = true
    map.easeTo({ ...target, duration })
    lastCameraKey = nextKey
    if (requestedZoom !== undefined) lastAppliedZoom = requestedZoom
    if (target.bearing !== undefined) state.bearing = target.bearing
  }

  const fitRoute = (bounds: NavigationCameraBounds): void => {
    if (!isReady() || !isValidBounds(bounds)) return
    const nextBoundsKey = boundsKey(bounds)
    if (nextBoundsKey === lastRouteBoundsKey) return

    map.fitBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      {
        padding: ROUTE_PREVIEW_PADDING,
        duration: reducedMotion ? 0 : ROUTE_PREVIEW_DURATION_MS,
        maxZoom: ROUTE_PREVIEW_MAX_ZOOM,
      },
    )
    lastRouteBoundsKey = nextBoundsKey
  }

  const update = (input: NavigationCameraUpdate): void => {
    if (!isReady()) {
      pendingUpdate = input
      return
    }
    pendingUpdate = null

    reducedMotion = input.reducedMotion ?? options.reducedMotion === true
    if (input.initialSetup && !setupSessionActive) {
      setupSessionActive = true
      initialFramingApplied = false
      initialFramingSuppressed = false
    } else if (!input.initialSetup && setupSessionActive) {
      setupSessionActive = false
      initialFramingApplied = false
      initialFramingSuppressed = false
    }
    const nextMode = getNavigationCameraMode({
      surface: input.surface,
      temporaryMode: input.mode,
      contextDefaultMode: input.mode,
    })
    const nextTopOrientation = input.surface === 'explore' || input.surface === 'route-preview'
      ? 'free'
      : input.topOrientation ?? 'free'
    const modeChanged = !hasUpdated
      || nextMode !== state.mode
      || nextTopOrientation !== state.topOrientation
    const defaultHeadingFollowEnabled = input.surface === 'active'
      && (nextMode === 'TOP' ? nextTopOrientation === 'heading-follow' : true)
    const nextHeadingFollowEnabled = input.headingFollowEnabled
      ?? (modeChanged ? defaultHeadingFollowEnabled : state.headingFollowEnabled)
    const headingFollowChanged = hasUpdated && nextHeadingFollowEnabled !== state.headingFollowEnabled
    const generation = modeChanged || headingFollowChanged ? beginTransition() : transitionGeneration
    const preserveInitialSetupGesture = Boolean(
      input.initialSetup
      && setupSessionActive
      && state.followSuspended,
    )

    if (modeChanged) {
      if (!preserveInitialSetupGesture) clearSuspension()
      lastCameraKey = null
      lastAppliedZoom = undefined
      lastRecenterKey = null
      pendingRecenterUpdateKey = null
      lastRouteBoundsKey = null
    }

    if (headingFollowChanged) {
      state.headingFollowSuspended = false
      lastCameraKey = null
      lastRecenterKey = null
      pendingRecenterUpdateKey = null
    }

    state.mode = nextMode
    state.topOrientation = nextTopOrientation
    state.headingFollowEnabled = nextHeadingFollowEnabled

    const currentBearing = map.getBearing()
    const resolvedHeading = modeChanged
      ? resolveExplicitHeading(input.heading)
      : resolveLiveHeading(input.heading)
    const policy = getNavigationCameraPolicy({
      mode: nextMode,
      surface: input.surface,
      topOrientation: nextTopOrientation,
      heading: resolvedHeading,
      currentBearing,
      headingFollowEnabled: nextHeadingFollowEnabled,
      followSuspended: state.followSuspended,
      headingFollowSuspended: state.headingFollowSuspended,
      reducedMotion,
    })

    applyCameraHandlers(map, policy)

    if (input.initialSetup
      && setupSessionActive
      && !initialFramingApplied
      && !initialFramingSuppressed
      && !state.followSuspended
      && isValidCenter(input.position)) {
      const target: Omit<NavigationCameraEaseOptions, 'duration'> = {
        center: input.position,
        pitch: clampPitchToMap(policy.pitch),
        bearing: policy.bearing,
        zoom: policy.preferredZoom,
      }
      const offset = offsetForMode(policy.mode)
      if (offset) target.offset = offset
      applyCamera(
        target,
        modeChanged ? getNavigationTransitionDuration(reducedMotion) : 220,
        generation,
      )
      initialFramingApplied = true
      applyMaxZoom(policy.maxZoom)
      hasUpdated = true
      return
    }

    if (input.initialSetup
      && setupSessionActive
      && initialFramingApplied
      && !modeChanged
      && !headingFollowChanged
      && !policy.followsPosition) {
      applyMaxZoom(policy.maxZoom)
      hasUpdated = true
      return
    }

    const sameInputAfterRecenter = !modeChanged
      && !headingFollowChanged
      && !state.followSuspended
      && pendingRecenterUpdateKey === recenterInputKey(
        nextMode,
        nextTopOrientation,
        nextHeadingFollowEnabled,
        input.position,
        resolvedHeading,
      )
    if (sameInputAfterRecenter) {
      pendingRecenterUpdateKey = null
      applyMaxZoom(policy.maxZoom)
      hasUpdated = true
      return
    }
    pendingRecenterUpdateKey = null

    if (input.surface === 'route-preview' && input.routeBounds) {
      fitRoute(input.routeBounds)
      applyMaxZoom(policy.maxZoom)
      hasUpdated = true
      return
    }

    if (state.followSuspended && (!modeChanged || preserveInitialSetupGesture)) {
      // A genuine user gesture owns center, bearing, and zoom until Recenter
      // or an explicit mode/session reset. TOP may repair only its pitch lock.
      const target: Omit<NavigationCameraEaseOptions, 'duration'> = {}
      if (state.mode === 'TOP') {
        const targetPitch = clampPitchToMap(0)
        if (Math.abs(map.getPitch() - targetPitch) > 0.5) target.pitch = targetPitch
      }
      if (Object.keys(target).length > 0) applyCamera(target, 0, generation)
      applyMaxZoom(policy.maxZoom)
      hasUpdated = true
      return
    }

    if (!modeChanged && !policy.followsPosition && state.mode !== 'TOP') {
      // Preserve the user's inspected center/bearing while following is
      // suspended. Only repair the mode's pitch lock or an over-ceiling zoom.
      const target: Omit<NavigationCameraEaseOptions, 'duration'> = {}
      const targetPitch = clampPitchToMap(policy.pitch)
      if (Math.abs(map.getPitch() - targetPitch) > 0.5) target.pitch = targetPitch
      const zoom = currentZoom()
      if (zoom !== null && zoom > policy.maxZoom) target.zoom = policy.maxZoom
      if (Object.keys(target).length > 0) applyCamera(target, 0, generation)
      applyMaxZoom(policy.maxZoom)
      hasUpdated = true
      return
    }

    const target: Omit<NavigationCameraEaseOptions, 'duration'> = {
      pitch: clampPitchToMap(policy.pitch),
      bearing: policy.bearing,
    }
    // Set preferred zoom when switching modes (user can still zoom freely)
    const zoom = currentZoom()
    if (modeChanged || (zoom !== null && zoom > policy.maxZoom)) {
      target.zoom = zoom !== null && zoom > policy.maxZoom
        ? policy.maxZoom
        : policy.preferredZoom
    }
    const offset = offsetForMode(policy.mode)
    if (offset) target.offset = offset
    if (policy.followsPosition && isValidCenter(input.position)) target.center = input.position

    const duration = modeChanged
      ? getNavigationTransitionDuration(reducedMotion)
      : policy.transitionDurationMs === 0
        ? 0
        : 220
    applyCamera(target, duration, generation)
    applyMaxZoom(policy.maxZoom)
    hasUpdated = true
  }

  const handleStyleData = (): void => {
    if (destroyed || !pendingUpdate) return
    const input = pendingUpdate
    pendingUpdate = null
    update(input)
  }

  map.on('styledata', handleStyleData)
  map.on('idle', handleStyleData)

  const setHeadingFollowEnabled = (enabled: boolean, heading?: number | null): void => {
    if (!isReady() || state.headingFollowEnabled === enabled) return

    const generation = beginTransition()
    const resolvedHeading = resolveExplicitHeading(heading)
    state.headingFollowEnabled = enabled
    state.headingFollowSuspended = false
    lastCameraKey = null
    lastRecenterKey = null
    pendingRecenterUpdateKey = null

    if (state.followSuspended) return

    const policy = getNavigationCameraPolicy({
      mode: state.mode,
      surface: 'active',
      topOrientation: state.topOrientation,
      heading: resolvedHeading,
      currentBearing: map.getBearing(),
      headingFollowEnabled: enabled,
      followSuspended: state.followSuspended,
      headingFollowSuspended: false,
      reducedMotion,
    })
    const target: Omit<NavigationCameraEaseOptions, 'duration'> = {
      pitch: clampPitchToMap(policy.pitch),
      bearing: policy.bearing,
    }
    const offset = offsetForMode(policy.mode)
    if (offset) target.offset = offset
    applyCamera(target, policy.transitionDurationMs, generation)
  }

  const recenter = (position?: NavigationCameraCenter | null, heading?: number | null): void => {
    if (!isReady()) return
    clearSuspension()
    const resolvedHeading = resolveExplicitHeading(heading)

    const policy = getNavigationCameraPolicy({
      mode: state.mode,
      surface: 'active',
      topOrientation: state.topOrientation,
      heading: resolvedHeading,
      currentBearing: map.getBearing(),
      headingFollowEnabled: state.headingFollowEnabled,
      followSuspended: false,
      headingFollowSuspended: false,
      reducedMotion,
    })
    const target: Omit<NavigationCameraEaseOptions, 'duration'> = {
      pitch: clampPitchToMap(policy.pitch),
      bearing: policy.bearing,
      zoom: policy.preferredZoom,
    }
    const offset = offsetForMode(policy.mode)
    if (offset) target.offset = offset
    // Recenter ALWAYS centers on user's position — that's its purpose
    if (isValidCenter(position)) target.center = position

    const recenterKey = JSON.stringify({
      mode: state.mode,
      topOrientation: state.topOrientation,
      headingFollowEnabled: state.headingFollowEnabled,
      target,
    })
    if (recenterKey === lastRecenterKey) return

    const generation = beginTransition()
    lastRecenterKey = recenterKey
    pendingRecenterUpdateKey = recenterInputKey(
      state.mode,
      state.topOrientation,
      state.headingFollowEnabled,
      position,
      resolvedHeading,
    )
    lastCameraKey = null
    lastAppliedZoom = undefined
    applyCamera(target, getNavigationTransitionDuration(reducedMotion), generation)
    applyMaxZoom(policy.maxZoom)
  }

  const resetCompass = (): void => {
    if (!isReady()) return
    const generation = beginTransition()
    lastRecenterKey = null
    pendingRecenterUpdateKey = null

    const reset = resetNavigationCompass({
      mode: state.mode,
      topOrientation: state.topOrientation,
      heading: null,
      currentBearing: map.getBearing(),
    })
    const hadFollowSuspension = state.followSuspended
    state.followSuspended = reset.followSuspended
    if (hadFollowSuspension) state.followSuspended = true
    state.headingFollowSuspended = reset.headingFollowSuspended

    const policy = getNavigationCameraPolicy({
      mode: state.mode,
      surface: 'active',
      topOrientation: state.topOrientation,
      heading: null,
      currentBearing: reset.bearing,
      headingFollowEnabled: state.headingFollowEnabled,
      followSuspended: state.followSuspended,
      headingFollowSuspended: state.headingFollowSuspended,
      reducedMotion,
    })
    const target: Omit<NavigationCameraEaseOptions, 'duration'> = {
      pitch: clampPitchToMap(policy.pitch),
      bearing: reset.bearing,
    }
    const offset = offsetForMode(policy.mode)
    if (offset) target.offset = offset

    lastCameraKey = null
    applyCamera(target, getNavigationTransitionDuration(reducedMotion), generation)
  }

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    map.off('dragstart', handleManualInteraction)
    map.off('rotatestart', handleManualInteraction)
    map.off('zoomstart', handleManualInteraction)
    map.off('moveend', handleMoveEnd)
    map.off('styledata', handleStyleData)
    map.off('idle', handleStyleData)
    if (map.setMaxZoom && initialMaxZoom !== undefined && appliedMaxZoom !== initialMaxZoom) {
      try { map.setMaxZoom(initialMaxZoom) } catch {}
    }
  }

  return {
    update,
    recenter,
    resetCompass,
    setHeadingFollowEnabled,
    fitRoute,
    getState: () => ({ ...state }),
    destroy,
  }
}
