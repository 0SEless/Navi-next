'use client'

import { useMemo } from 'react'
import { useCaptureDirection, type UseCaptureDirectionResult } from '@/features/capture/hooks/useCaptureDirection'
import type { CaptureCoordinate } from '@/features/capture/types'
import type { CaptureGpsHeadingSample } from '@/features/capture/direction'

export interface NavigationHeadingPosition {
  lat: number
  lng: number
}

export interface UseNavigationHeadingOptions {
  position?: NavigationHeadingPosition | null
  heading?: number | null
  speed?: number | null
  timestamp?: number | null
  enabled?: boolean
  now?: () => number
}

export type UseNavigationHeadingResult = UseCaptureDirectionResult

function toCapturePosition(position: NavigationHeadingPosition | null | undefined): CaptureCoordinate | null {
  if (!position) return null
  return { latitude: position.lat, longitude: position.lng }
}

function toGpsSample(
  heading: number | null | undefined,
  speed: number | null | undefined,
  timestamp: number | null | undefined,
): CaptureGpsHeadingSample | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  return {
    heading: heading ?? null,
    speed: speed ?? null,
    timestamp: new Date(timestamp).toISOString(),
  }
}

/**
 * Navigation-only adapter for the tested Capture direction contract.
 * It keeps sensor data out of the public store and never changes route state.
 */
export function useNavigationHeading({
  position = null,
  heading = null,
  speed = null,
  timestamp = null,
  enabled = true,
  now,
}: UseNavigationHeadingOptions = {}): UseNavigationHeadingResult {
  const capturePosition = useMemo(() => toCapturePosition(position), [position])
  const gpsSample = useMemo(
    () => toGpsSample(heading, speed, timestamp),
    [heading, speed, timestamp],
  )

  return useCaptureDirection({
    position: capturePosition,
    gpsSample,
    enabled,
    now,
    allowPassiveOrientationObservation: true,
  })
}
