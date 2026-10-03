'use client'

import { useEffect, useRef } from 'react'
import { LocateFixed } from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import { createCaptureCameraController, type CaptureCameraCenter, type CaptureCameraController, type CaptureOrientationMode } from '../camera'
import { useNavigationMap } from '@/components/map/NavigationMap'
import { CaptureOrientationControl } from './CaptureOrientationControl'

export interface CaptureMapCameraProps {
  center?: CaptureCameraCenter
  follow: boolean
  onFollowChange: (following: boolean) => void
  heading?: number | null
  orientationMode?: CaptureOrientationMode
  onOrientationChange?: (mode: CaptureOrientationMode) => void
  onHeadingChange?: (heading: number | null) => void
}

function asCaptureCameraMap(map: maplibregl.Map) {
  return map as unknown as Parameters<typeof createCaptureCameraController>[0]
}

export function CaptureMapCamera({ center, follow, onFollowChange, heading, orientationMode = 'north-up', onOrientationChange, onHeadingChange }: CaptureMapCameraProps) {
  const { map, isReady } = useNavigationMap()
  const controllerRef = useRef<CaptureCameraController | null>(null)
  const followRef = useRef(follow)
  const orientationModeRef = useRef(orientationMode)
  const headingRef = useRef(heading)
  const centerLongitude = center?.[0]
  const centerLatitude = center?.[1]

  useEffect(() => {
    followRef.current = follow
    orientationModeRef.current = orientationMode
    headingRef.current = heading
  }, [follow, heading, orientationMode])

  useEffect(() => {
    if (!map || !isReady) return undefined

    const controller = createCaptureCameraController(asCaptureCameraMap(map), {
      initialFollowing: followRef.current,
      initialOrientationMode: orientationModeRef.current,
      initialHeading: headingRef.current,
      onFollowChange,
      onHeadingChange,
    })
    controllerRef.current = controller

    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [isReady, map, onFollowChange, onHeadingChange])

  useEffect(() => {
    controllerRef.current?.setFollowing(follow)
  }, [follow])

  useEffect(() => {
    controllerRef.current?.setOrientationMode(orientationMode)
  }, [orientationMode])

  useEffect(() => {
    const nextCenter = centerLongitude === undefined || centerLatitude === undefined
      ? undefined
      : [centerLongitude, centerLatitude] as CaptureCameraCenter
    controllerRef.current?.updatePosition(nextCenter, heading)
  }, [centerLatitude, centerLongitude, heading])

  const headingAvailable = heading !== null && heading !== undefined

  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
      {onOrientationChange && (
        <CaptureOrientationControl
          orientationMode={orientationMode}
          headingAvailable={headingAvailable}
          onChange={onOrientationChange}
        />
      )}
      <button
        type="button"
        data-testid="capture-recenter"
        aria-label="Recenter map on live location"
        aria-pressed={follow}
        disabled={!center}
        onClick={() => controllerRef.current?.recenter(center, heading)}
        title={follow ? 'Following live location' : 'Recenter and follow live location'}
        style={{
          width: 44,
          height: 44,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--navi-border)',
          borderRadius: 999,
          color: follow ? 'var(--navi-primary)' : 'var(--navi-text)',
          background: 'var(--navi-card)',
          boxShadow: 'var(--navi-shadow-sm)',
          cursor: center ? 'pointer' : 'not-allowed',
          opacity: center ? 1 : 0.55,
        }}
      >
        <LocateFixed size={19} aria-hidden="true" />
      </button>
    </div>
  )
}
