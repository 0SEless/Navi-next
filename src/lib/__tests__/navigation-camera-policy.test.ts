import { describe, expect, it } from 'vitest'
import {
  getNavigationCameraMode,
  getNavigationCameraPolicy,
  getNavigationTransitionDuration,
  isNavigationCompassVisible,
  recenterNavigationCamera,
  resetNavigationCompass,
  suspendFollowAfterPan,
} from '../navigation-camera-policy'

describe('public navigation camera policy', () => {
  it('keeps TOP flat while allowing free pan, zoom, and rotate', () => {
    const policy = getNavigationCameraPolicy({ mode: 'TOP', currentBearing: 137 })

    expect(policy).toMatchObject({
      mode: 'TOP',
      pitch: 0,
      bearing: 137,
      allowPan: true,
      allowZoom: true,
      allowRotate: true,
      allowPitch: false,
      followsPosition: false,
      followsHeading: false,
      preferredZoom: 16,
      maxZoom: 16,
    })
  })

  it('supports flat TOP heading-follow without losing heading normalization', () => {
    const policy = getNavigationCameraPolicy({
      mode: 'TOP',
      topOrientation: 'heading-follow',
      heading: 370,
      currentBearing: 137,
    })

    expect(policy.pitch).toBe(0)
    expect(policy.bearing).toBe(10)
    expect(policy.allowRotate).toBe(true)
    expect(policy.followsPosition).toBe(true)
    expect(policy.followsHeading).toBe(true)
    expect(policy.maxZoom).toBe(16)
  })

  it('keeps TOP heading-follow transiently suspended without changing the mode', () => {
    const policy = getNavigationCameraPolicy({
      mode: 'TOP',
      topOrientation: 'heading-follow',
      heading: 90,
      currentBearing: 137,
      followSuspended: true,
    })

    expect(policy).toMatchObject({
      mode: 'TOP',
      pitch: 0,
      bearing: 137,
      followsPosition: false,
      followsHeading: false,
    })
  })

  it('uses the approved 55-degree FOLLOW preset and suspends position following after pan', () => {
    const following = getNavigationCameraPolicy({
      mode: 'FOLLOW',
      heading: 90,
      followSuspended: false,
    })
    const suspended = getNavigationCameraPolicy({
      mode: 'FOLLOW',
      heading: 90,
      followSuspended: true,
    })

    expect(following).toMatchObject({
      pitch: 55,
      bearing: 90,
      allowPan: true,
      allowZoom: true,
      allowRotate: true,
      allowPitch: false,
      followsPosition: true,
      preferredZoom: 18,
      maxZoom: 18,
    })
    expect(suspended.followsPosition).toBe(false)
    expect(suspended.followsHeading).toBe(false)
    expect(suspendFollowAfterPan('FOLLOW')).toBe(true)
  })

  it('keeps the beam heading live while heading-follow OFF leaves map bearing independent', () => {
    const policy = getNavigationCameraPolicy({
      mode: 'FOLLOW',
      heading: 90,
      currentBearing: 12,
      headingFollowEnabled: false,
    })

    expect(policy).toMatchObject({
      bearing: 12,
      followsPosition: true,
      followsHeading: false,
      maxZoom: 18,
    })
  })

  it('allows position follow while Compass temporarily suspends heading alignment', () => {
    const policy = getNavigationCameraPolicy({
      mode: 'FOLLOW',
      heading: 90,
      currentBearing: 0,
      headingFollowSuspended: true,
    })

    expect(policy).toMatchObject({
      bearing: 0,
      followsPosition: true,
      followsHeading: false,
    })
  })

  it('preserves the existing POV pitch while allowing all gesture families', () => {
    const policy = getNavigationCameraPolicy({ mode: 'POV', heading: 225 })

    expect(policy).toMatchObject({
      pitch: 85,
      bearing: 225,
      allowPan: true,
      allowZoom: true,
      allowRotate: true,
      allowPitch: false,
      followsPosition: true,
      preferredZoom: 19,
      maxZoom: 19,
    })
    expect(suspendFollowAfterPan('POV')).toBe(true)
  })

  it('preserves TOP free bearing on recenter while follow modes resume heading follow', () => {
    expect(recenterNavigationCamera({
      mode: 'TOP',
      currentBearing: 137,
      heading: 90,
    })).toEqual({ bearing: 137, followSuspended: false })
    expect(recenterNavigationCamera({
      mode: 'FOLLOW',
      currentBearing: 137,
      heading: 90,
    })).toEqual({ bearing: 90, followSuspended: false })
    expect(recenterNavigationCamera({
      mode: 'FOLLOW',
      currentBearing: 137,
      heading: 90,
      headingFollowEnabled: false,
    })).toEqual({ bearing: 137, followSuspended: false })
  })

  it('resets the compass north and makes the heading suspension explicit', () => {
    expect(resetNavigationCompass({ mode: 'TOP', topOrientation: 'free', currentBearing: 137, heading: 90 })).toEqual({
      bearing: 0,
      followSuspended: false,
      headingFollowSuspended: false,
    })
    expect(resetNavigationCompass({ mode: 'TOP', topOrientation: 'heading-follow', currentBearing: 137, heading: 90 })).toEqual({
      bearing: 0,
      followSuspended: false,
      headingFollowSuspended: true,
    })
    expect(resetNavigationCompass({ mode: 'FOLLOW', currentBearing: 137, heading: 90 })).toEqual({
      bearing: 0,
      followSuspended: false,
      headingFollowSuspended: true,
    })
  })

  it('falls back to the current bearing when heading is unavailable', () => {
    expect(getNavigationCameraPolicy({ mode: 'FOLLOW', currentBearing: 240 })).toMatchObject({
      bearing: 240,
      followsHeading: false,
    })
  })

  it('forces route preview to a flat TOP overview and uses stored view only when active', () => {
    expect(getNavigationCameraMode({
      surface: 'route-preview',
      temporaryMode: 'POV',
      storedDefaultMapView: 'follow',
    })).toBe('TOP')

    expect(getNavigationCameraMode({
      surface: 'active',
      temporaryMode: 'POV',
      storedDefaultMapView: 'follow',
    })).toBe('POV')
    expect(getNavigationCameraMode({
      surface: 'active',
      storedDefaultMapView: 'pov',
    })).toBe('POV')
    expect(getNavigationCameraMode({ surface: 'active' })).toBe('FOLLOW')
  })

  it('shows the Compass only when bearing is meaningfully away from north', () => {
    expect(isNavigationCompassVisible(0)).toBe(false)
    expect(isNavigationCompassVisible(2)).toBe(false)
    expect(isNavigationCompassVisible(5)).toBe(true)
    expect(isNavigationCompassVisible(355)).toBe(true)
  })

  it('uses restrained mode transitions and removes them for reduced motion', () => {
    expect(getNavigationTransitionDuration(false)).toBeGreaterThanOrEqual(300)
    expect(getNavigationTransitionDuration(false)).toBeLessThanOrEqual(500)
    expect(getNavigationTransitionDuration(true)).toBe(0)
  })
})
