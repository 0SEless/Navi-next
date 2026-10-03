'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface GeolocationState {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  heading: number | null
  speed: number | null
  timestamp: number | null
  error: string | null
  loading: boolean
}

interface UseGeolocationOptions {
  /** When true, use watchPosition for continuous browser-delivered updates. */
  watch?: boolean
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function useGeolocation(options: UseGeolocationOptions = {}): GeolocationState {
  const { watch = false } = options

  const [state, setState] = useState<GeolocationState>(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { latitude: null, longitude: null, accuracy: null, heading: null, speed: null, timestamp: null, error: 'Geolocation is not supported by this browser', loading: false }
    }
    return { latitude: null, longitude: null, accuracy: null, heading: null, speed: null, timestamp: null, error: null, loading: true }
  })

  const watchIdRef = useRef<number | null>(null)

  const handlePosition = useCallback((position: GeolocationPosition) => {
    setState({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: finiteOrNull(position.coords.heading),
      speed: finiteOrNull(position.coords.speed),
      timestamp: finiteOrNull(position.timestamp),
      error: null,
      loading: false,
    })
  }, [])

  const handleError = useCallback((error: GeolocationPositionError) => {
    setState(prev => ({
      ...prev,
      error: error.message,
      loading: false,
    }))
  }, [])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return

    if (watch) {
      // Continuous mode: preserve every fix delivered by the browser watcher.
      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 },
      )

      return () => {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
      }
    } else {
      // One-shot mode: getCurrentPosition (backward-compat)
      navigator.geolocation.getCurrentPosition(
        handlePosition,
        handleError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
      )
    }
  }, [watch, handlePosition, handleError])

  return state
}
