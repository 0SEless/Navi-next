'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildCaptureDirectionGeoJson,
  getReliableCaptureGpsHeading,
  readCaptureDeviceFacingHeading,
  resolveCaptureDirection,
  type CaptureDeviceFacingSignal,
  type CaptureDeviceOrientationPermission,
  type CaptureDeviceOrientationSupport,
  type CaptureDirectionGeoJson,
  type CaptureDirectionResolution,
  type CaptureOrientationEventLike,
  type CaptureGpsHeadingSample,
} from '../direction'
import type { CaptureCoordinate } from '../types'

interface DeviceOrientationEventConstructorLike {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export interface UseCaptureDirectionOptions {
  position?: CaptureCoordinate | null
  gpsSample?: CaptureGpsHeadingSample | null
  enabled?: boolean
  now?: () => number
  /** Allow a caller such as Navigate to observe an event before explicit permission is resolved. */
  allowPassiveOrientationObservation?: boolean
}

export interface UseCaptureDirectionResult {
  direction: CaptureDirectionResolution
  directionGeoJson: CaptureDirectionGeoJson
  canRequestPermission: boolean
  enableDirection: () => Promise<void>
}

function getOrientationConstructor(): DeviceOrientationEventConstructorLike | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { DeviceOrientationEvent?: DeviceOrientationEventConstructorLike }).DeviceOrientationEvent
}

function detectOrientationSupport(): CaptureDeviceOrientationSupport {
  const constructor = getOrientationConstructor()
  if (!constructor) return 'unsupported'
  return typeof constructor.requestPermission === 'function' ? 'permission-required' : 'supported'
}

export function useCaptureDirection(options: UseCaptureDirectionOptions = {}): UseCaptureDirectionResult {
  const {
    position = null,
    gpsSample = null,
    enabled = true,
    now,
    allowPassiveOrientationObservation = false,
  } = options
  const [support] = useState<CaptureDeviceOrientationSupport>(detectOrientationSupport)
  const [permission, setPermission] = useState<CaptureDeviceOrientationPermission>(support === 'permission-required' ? 'unknown' : support === 'supported' ? 'granted' : 'unknown')
  const [deviceHeading, setDeviceHeading] = useState<CaptureDeviceFacingSignal | null>(null)
  const [orientationEventSeen, setOrientationEventSeen] = useState(false)
  const nowRef = useRef(now ?? (() => Date.now()))

  useEffect(() => {
    nowRef.current = now ?? (() => Date.now())
  }, [now])

  const shouldObserveOrientation = enabled
    && (support === 'supported' || support === 'permission-required')
    && (permission === 'granted' || (allowPassiveOrientationObservation && permission === 'unknown'))

  useEffect(() => {
    if (!shouldObserveOrientation) return undefined

    const onOrientation = (event: Event) => {
      setOrientationEventSeen(true)
      const rawHeading = readCaptureDeviceFacingHeading(event as Event & CaptureOrientationEventLike)
      if (rawHeading === null) return
      if (allowPassiveOrientationObservation) {
        setPermission(current => current === 'unknown' ? 'granted' : current)
      }
      setDeviceHeading({ heading: rawHeading, timestampMs: nowRef.current() })
    }

    window.addEventListener('deviceorientationabsolute', onOrientation)
    window.addEventListener('deviceorientation', onOrientation)

    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation)
      window.removeEventListener('deviceorientation', onOrientation)
    }
  }, [allowPassiveOrientationObservation, shouldObserveOrientation])

  const enableDirection = useCallback(async () => {
    if (support === 'unsupported') return
    if (permission === 'granted') return

    const constructor = getOrientationConstructor()
    if (typeof constructor?.requestPermission !== 'function') {
      setPermission('granted')
      return
    }

    try {
      const result = await constructor.requestPermission()
      setPermission(result === 'granted' ? 'granted' : 'denied')
    } catch {
      setPermission('denied')
    }
  }, [permission, support])

  const nowMs = (now ?? (() => Date.now()))()
  const gpsHeading = gpsSample ? getReliableCaptureGpsHeading(gpsSample, nowMs) : null
  const direction = resolveCaptureDirection({
    deviceSupport: support,
    permission,
    deviceHeading,
    gpsHeading,
    nowMs,
    orientationEventSeen,
  })

  return {
    direction,
    directionGeoJson: buildCaptureDirectionGeoJson(position ?? { latitude: Number.NaN, longitude: Number.NaN }, direction.heading),
    canRequestPermission: support === 'permission-required' && permission === 'unknown',
    enableDirection,
  }
}
