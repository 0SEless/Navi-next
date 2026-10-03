import { normalizeCaptureHeading, smoothCaptureHeading, type CaptureHeadingSmoothingOptions } from './direction'

export type CaptureCameraCenter = [number, number]
export type CaptureOrientationMode = 'north-up' | 'heading-up'

export interface CaptureCameraEaseOptions {
  center?: CaptureCameraCenter
  bearing?: number
  duration: number
}

export interface CaptureCameraMap {
  on: (type: 'dragstart', listener: () => void) => void
  off: (type: 'dragstart', listener: () => void) => void
  easeTo: (options: CaptureCameraEaseOptions) => void
}

export interface CaptureCameraController {
  isFollowing: () => boolean
  setFollowing: (following: boolean) => void
  getOrientationMode: () => CaptureOrientationMode
  setOrientationMode: (mode: CaptureOrientationMode) => void
  updateHeading: (heading?: number | null) => void
  updatePosition: (center?: CaptureCameraCenter, heading?: number | null) => void
  recenter: (center?: CaptureCameraCenter, heading?: number | null) => void
  destroy: () => void
}

export interface CaptureCameraControllerOptions {
  initialFollowing?: boolean
  initialOrientationMode?: CaptureOrientationMode
  initialHeading?: number | null
  onFollowChange?: (following: boolean) => void
  onHeadingChange?: (heading: number | null) => void
  animationDurationMs?: number
  headingSmoothing?: CaptureHeadingSmoothingOptions
}

export function createCaptureCameraController(
  map: CaptureCameraMap,
  {
    initialFollowing = true,
    initialOrientationMode = 'north-up',
    initialHeading = null,
    onFollowChange,
    onHeadingChange,
    animationDurationMs = 250,
    headingSmoothing,
  }: CaptureCameraControllerOptions = {},
): CaptureCameraController {
  let following = initialFollowing
  let orientationMode = initialOrientationMode
  let currentHeading = normalizeCaptureHeading(initialHeading)
  let appliedBearing = 0
  let lastPositionKey: string | null = null

  const setFollowing = (nextFollowing: boolean) => {
    if (following === nextFollowing) return
    following = nextFollowing
    onFollowChange?.(following)
  }

  const handleManualPan = () => setFollowing(false)
  map.on('dragstart', handleManualPan)

  const desiredBearing = () => orientationMode === 'heading-up' ? (currentHeading ?? 0) : 0

  const applyCamera = (center?: CaptureCameraCenter, includeBearing = false) => {
    if (!center && !includeBearing) return

    const options: CaptureCameraEaseOptions = { duration: animationDurationMs }
    if (center) options.center = center
    if (includeBearing) {
      options.bearing = desiredBearing()
      appliedBearing = options.bearing
    }
    map.easeTo(options)
  }

  const updateHeadingState = (heading?: number | null) => {
    if (heading === undefined) return false

    const nextHeading = smoothCaptureHeading(currentHeading, heading, headingSmoothing)
    if (nextHeading === currentHeading) return false
    currentHeading = nextHeading
    onHeadingChange?.(currentHeading)
    return true
  }

  return {
    isFollowing: () => following,
    setFollowing,
    getOrientationMode: () => orientationMode,
    setOrientationMode: (mode) => {
      if (orientationMode === mode) return
      orientationMode = mode
      const nextBearing = desiredBearing()
      if (appliedBearing !== nextBearing) applyCamera(undefined, true)
    },
    updateHeading: (heading) => {
      if (!updateHeadingState(heading)) return
      if (orientationMode === 'heading-up' && appliedBearing !== desiredBearing()) applyCamera(undefined, true)
    },
    updatePosition: (center, heading) => {
      const headingChanged = updateHeadingState(heading)
      const positionChanged = Boolean(center)
        && `${center?.[0]}:${center?.[1]}` !== lastPositionKey
      if (center && positionChanged) lastPositionKey = `${center[0]}:${center[1]}`

      const centerForCamera = center && positionChanged && following ? center : undefined
      const bearingForCamera = headingChanged && orientationMode === 'heading-up' && appliedBearing !== desiredBearing()
      applyCamera(centerForCamera, bearingForCamera)
    },
    recenter: (center, heading) => {
      if (!center) return
      updateHeadingState(heading)
      const positionKey = `${center[0]}:${center[1]}`
      lastPositionKey = positionKey
      setFollowing(true)
      const options: CaptureCameraEaseOptions = { center, duration: animationDurationMs }
      if (orientationMode === 'heading-up') {
        options.bearing = desiredBearing()
        appliedBearing = options.bearing
      }
      map.easeTo(options)
    },
    destroy: () => map.off('dragstart', handleManualPan),
  }
}
