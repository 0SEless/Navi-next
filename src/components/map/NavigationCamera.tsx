'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NavigationCameraControls, {
  type NavigationCameraControlsProps,
  type NavigationHeadingStatus,
} from './NavigationCameraControls'
import { useNavigationMap } from './NavigationMap'
import { useOptionalNavigationContext } from './NavigationContext'
import {
  createNavigationCameraController,
  type NavigationCameraBounds,
  type NavigationCameraCenter,
  type NavigationCameraController,
  type NavigationCameraMap,
} from '@/lib/navigation-camera-controller'
import {
  isNavigationCompassVisible,
  type NavigationCameraMode,
  type NavigationCameraSurface,
  type TopCameraOrientation,
} from '@/lib/navigation-camera-policy'

export interface NavigationCameraProps {
  surface: NavigationCameraSurface
  mode: NavigationCameraMode
  topOrientation?: TopCameraOrientation
  position?: NavigationCameraCenter | null
  heading?: number | null
  bearing?: number | null
  routeBounds?: NavigationCameraBounds | null
  initialSetup?: boolean
  reducedMotion?: boolean
  showControls?: boolean
  controlsClassName?: string
  suspended?: boolean
  headingStatus?: NavigationHeadingStatus
  canRequestHeadingPermission?: boolean
  headingFollowEnabled?: boolean
  onModeChange?: (mode: NavigationCameraMode) => void
  onRecenter?: () => void
  onResetCompass?: () => void
  onToggleHeadingFollow?: (enabled: boolean) => void
  onRequestHeadingPermission?: () => void
}

export type NavigationCameraConfig = NavigationCameraProps

function contextPositionToCenter(
  position: { lat: number; lng: number } | null | undefined,
): NavigationCameraCenter | null | undefined {
  return position ? [position.lng, position.lat] : position
}

function toControllerMap(map: unknown): NavigationCameraMap {
  return map as NavigationCameraMap
}

/** React lifecycle bridge for the imperative navigation camera controller. */
export default function NavigationCamera({
  surface,
  mode,
  topOrientation = 'free',
  position,
  heading = null,
  bearing = null,
  routeBounds = null,
  initialSetup = false,
  reducedMotion = false,
  showControls = true,
  controlsClassName,
  suspended: suspendedProp,
  headingStatus = 'none',
  canRequestHeadingPermission = false,
  headingFollowEnabled = false,
  onModeChange,
  onRecenter,
  onResetCompass,
  onToggleHeadingFollow,
  onRequestHeadingPermission,
}: NavigationCameraProps) {
  const { map, isReady } = useNavigationMap()
  const navigationContext = useOptionalNavigationContext()
  const controllerRef = useRef<NavigationCameraController | null>(null)
  const initialSetupAtMountRef = useRef(initialSetup)
  const [suspendedState, setSuspendedState] = useState(false)

  const contextPosition = contextPositionToCenter(navigationContext?.location)
  const effectivePosition = position !== undefined ? position : contextPosition
  const effectiveMode = surface === 'active' ? mode : 'TOP'
  const effectiveSuspended = suspendedProp ?? suspendedState

  const handleSuspensionChange = useCallback((suspended: boolean) => {
    setSuspendedState(suspended)
  }, [])

  useEffect(() => {
    if (!map || !isReady) {
      controllerRef.current?.destroy()
      controllerRef.current = null
      return
    }

    const controller = createNavigationCameraController(toControllerMap(map), {
      reducedMotion,
      initialSetup: initialSetupAtMountRef.current,
      onSuspensionChange: handleSuspensionChange,
    })
    controllerRef.current = controller

    return () => {
      controller.destroy()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [handleSuspensionChange, isReady, map, reducedMotion])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return

    controller.update({
      surface,
      mode: effectiveMode,
      topOrientation,
      position: effectivePosition,
      heading,
      headingFollowEnabled,
      routeBounds,
      initialSetup,
      reducedMotion,
    })
  }, [effectiveMode, effectivePosition, heading, headingFollowEnabled, initialSetup, isReady, reducedMotion, routeBounds, surface, topOrientation])

  const compassBearing = bearing ?? heading ?? null
  const compassVisible = isNavigationCompassVisible(compassBearing)
  const hasLocation = effectivePosition !== null && effectivePosition !== undefined

  const handleModeChange = useCallback((nextMode: NavigationCameraMode) => {
    if (surface !== 'active') return
    onModeChange?.(nextMode)
  }, [onModeChange, surface])

  const handleToggleHeadingFollow = useCallback((enabled: boolean) => {
    if (surface !== 'active') return
    if (enabled && headingStatus === 'permission-required' && canRequestHeadingPermission) {
      onRequestHeadingPermission?.()
    }
    controllerRef.current?.setHeadingFollowEnabled(enabled, heading)
    onToggleHeadingFollow?.(enabled)
  }, [canRequestHeadingPermission, heading, headingStatus, onRequestHeadingPermission, onToggleHeadingFollow, surface])

  const handleRecenter = useCallback(() => {
    controllerRef.current?.recenter(effectivePosition, heading)
    onRecenter?.()
  }, [effectivePosition, heading, onRecenter])

  const handleResetCompass = useCallback(() => {
    controllerRef.current?.resetCompass()
    onResetCompass?.()
  }, [onResetCompass])

  const controlProps = useMemo<NavigationCameraControlsProps>(() => ({
    surface,
    mode: effectiveMode,
    className: controlsClassName,
    hasLocation,
    compassVisible,
    suspended: effectiveSuspended,
    headingStatus,
    canRequestHeadingPermission,
    headingFollowEnabled,
    reducedMotion,
    onModeChange: handleModeChange,
    onRecenter: handleRecenter,
    onResetCompass: handleResetCompass,
    onToggleHeadingFollow: handleToggleHeadingFollow,
    onRequestHeadingPermission,
  }), [
    canRequestHeadingPermission,
    compassVisible,
    effectiveMode,
    effectiveSuspended,
    handleToggleHeadingFollow,
    handleModeChange,
    handleRecenter,
    handleResetCompass,
    headingFollowEnabled,
    hasLocation,
    headingStatus,
    onRequestHeadingPermission,
    reducedMotion,
    surface,
    controlsClassName,
  ])

  if (!isReady || !map || !showControls) return null
  return <NavigationCameraControls {...controlProps} />
}
