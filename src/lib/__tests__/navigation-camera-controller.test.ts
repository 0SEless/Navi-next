import { describe, expect, it, vi } from 'vitest'
import {
  createNavigationCameraController,
  type NavigationCameraMap,
} from '../navigation-camera-controller'

type Handler = {
  enable: ReturnType<typeof vi.fn>
  disable: ReturnType<typeof vi.fn>
  isEnabled: ReturnType<typeof vi.fn>
  enableRotation?: ReturnType<typeof vi.fn>
  disableRotation?: ReturnType<typeof vi.fn>
}

function createHandler(withRotation = false): Handler {
  return {
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(() => true),
    ...(withRotation
      ? { enableRotation: vi.fn(), disableRotation: vi.fn() }
      : {}),
  }
}

function createMap(initialBearing = 0, initialMaxPitch = 85) {
  let ready = true
  let bearing = initialBearing
  let pitch = 0
  let zoom = 15
  let maxZoom = 22
  const maxPitch = initialMaxPitch
  const listeners = new Map<string, (event?: { originalEvent?: unknown }) => void>()
  const stop = vi.fn()
  const map = {
    isStyleLoaded: vi.fn(() => ready),
    getBearing: vi.fn(() => bearing),
    getPitch: vi.fn(() => pitch),
    getZoom: vi.fn(() => zoom),
    getMaxZoom: vi.fn(() => maxZoom),
    getMaxPitch: vi.fn(() => maxPitch),
    setMaxZoom: vi.fn((value: number) => { maxZoom = value }),
    stop,
    easeTo: vi.fn((options) => {
      if (options.bearing !== undefined) bearing = options.bearing
      if (options.pitch !== undefined) pitch = options.pitch
      if (options.zoom !== undefined) zoom = options.zoom
    }),
    fitBounds: vi.fn(),
    on: vi.fn((type, listener) => { listeners.set(type, listener) }),
    off: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    }),
    dragPan: createHandler(),
    dragRotate: createHandler(),
    scrollZoom: createHandler(),
    doubleClickZoom: createHandler(),
    touchZoomRotate: createHandler(true),
    touchPitch: createHandler(),
  } as NavigationCameraMap & {
    getZoom: ReturnType<typeof vi.fn>
    getMaxZoom: ReturnType<typeof vi.fn>
    setMaxZoom: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  }

  return {
    map,
    setReady(value: boolean) { ready = value },
    emit(type: 'dragstart' | 'rotatestart' | 'zoomstart' | 'moveend' | 'styledata' | 'idle', event?: { originalEvent?: unknown }) { listeners.get(type)?.(event) },
    getBearing() { return bearing },
    getPitch() { return pitch },
    getZoom() { return zoom },
    getMaxZoom() { return maxZoom },
    getMaxPitch() { return maxPitch },
    setZoom(value: number) { zoom = value },
    setBearing(value: number) { bearing = value },
    setPitch(value: number) { pitch = value },
    stop,
  }
}

const routeBounds = { minLng: 122.1, maxLng: 122.11, minLat: 11.8, maxLat: 11.81 }

describe('public navigation camera controller', () => {
  it('frames the first valid setup position once even when TOP heading-follow is off', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'TOP',
      headingFollowEnabled: false,
      initialSetup: true,
      position: null,
    } as never)
    fixture.map.easeTo.mockClear()

    controller.update({
      surface: 'active',
      mode: 'TOP',
      headingFollowEnabled: false,
      initialSetup: true,
      position: [122.1001, 11.8001],
    } as never)

    expect(fixture.map.easeTo).toHaveBeenCalledWith({
      center: [122.1001, 11.8001],
      pitch: 0,
      bearing: 0,
      zoom: 16,
      duration: 220,
    })

    fixture.map.easeTo.mockClear()
    controller.update({
      surface: 'active',
      mode: 'TOP',
      headingFollowEnabled: false,
      initialSetup: true,
      position: [122.1002, 11.8002],
    } as never)
    expect(fixture.map.easeTo).not.toHaveBeenCalled()
  })

  it('frames a delayed setup position once unless the user gestures first', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'TOP',
      headingFollowEnabled: false,
      initialSetup: true,
      position: null,
    } as never)
    fixture.map.easeTo.mockClear()
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })

    controller.update({
      surface: 'active',
      mode: 'TOP',
      headingFollowEnabled: false,
      initialSetup: true,
      position: [122.1001, 11.8001],
    } as never)

    expect(fixture.map.easeTo).not.toHaveBeenCalled()
    expect(controller.getState().followSuspended).toBe(true)
  })

  it('does not call MapLibre before the style is ready', () => {
    const fixture = createMap()
    fixture.setReady(false)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })

    expect(fixture.map.easeTo).not.toHaveBeenCalled()
    expect(fixture.map.fitBounds).not.toHaveBeenCalled()
    expect(fixture.map.dragPan.enable).not.toHaveBeenCalled()
  })

  it('continues applying camera updates after a transient style reload', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'TOP', position: [122.1, 11.8] })
    fixture.map.easeTo.mockClear()
    fixture.setReady(false)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8] })

    expect(fixture.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      pitch: 55,
      bearing: 0,
      zoom: 18,
      offset: [0, 110],
      duration: 360,
    }))
    expect(controller.getState().mode).toBe('FOLLOW')
  })

  it('replays the latest camera update when the style becomes ready', () => {
    const fixture = createMap()
    fixture.setReady(false)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8] })
    expect(fixture.map.easeTo).not.toHaveBeenCalled()

    fixture.setReady(true)
    fixture.emit('idle')

    expect(fixture.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      pitch: 55,
      bearing: 0,
      zoom: 18,
      offset: [0, 110],
    }))
  })

  it('applies flat TOP/free camera, the TOP ceiling, and permissive overview gestures', () => {
    const fixture = createMap(137)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'explore', mode: 'TOP', topOrientation: 'free' })

    expect(fixture.map.easeTo).toHaveBeenCalledWith({ pitch: 0, bearing: 137, zoom: 16, duration: 360 })
    expect(fixture.getMaxZoom()).toBe(16)
    expect(fixture.map.dragPan.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.scrollZoom.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.doubleClickZoom.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.dragRotate.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.touchZoomRotate.enableRotation).toHaveBeenCalledTimes(1)
    expect(fixture.map.touchPitch.disable).toHaveBeenCalledTimes(1)
  })

  it('applies FOLLOW pitch, heading, forward offset, and the approved ceiling', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1001, 11.8001], heading: 90 })

    expect(fixture.map.easeTo).toHaveBeenCalledWith({
      center: [122.1001, 11.8001],
      pitch: 55,
      bearing: 90,
      zoom: 18,
      offset: [0, 110],
      duration: 360,
    })
    expect(fixture.getMaxZoom()).toBe(18)
    expect(fixture.map.dragPan.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.scrollZoom.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.dragRotate.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.touchZoomRotate.enableRotation).toHaveBeenCalledTimes(1)
    expect(fixture.map.touchPitch.disable).toHaveBeenCalledTimes(1)
  })

  it('applies distinct POV pitch, forward offset, and the POV ceiling', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'POV', position: [122.1001, 11.8001], heading: 180 })

    expect(fixture.map.easeTo).toHaveBeenCalledWith({
      center: [122.1001, 11.8001],
      pitch: 85,
      bearing: 180,
      zoom: 19,
      offset: [0, 150],
      duration: 360,
    })
    expect(fixture.getMaxZoom()).toBe(19)
    expect(fixture.map.dragPan.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.scrollZoom.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.dragRotate.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.touchZoomRotate.enable).toHaveBeenCalledTimes(1)
    expect(fixture.map.touchPitch.disable).toHaveBeenCalledTimes(1)
  })

  it('uses max zoom as a ceiling without forcing a user who is zoomed farther out to zoom in', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })
    fixture.map.easeTo.mockClear()
    fixture.setZoom(12)
    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1001, 11.8001], heading: 90 })

    expect(fixture.getMaxZoom()).toBe(18)
    expect(fixture.map.easeTo).toHaveBeenCalledWith(expect.not.objectContaining({ zoom: expect.anything() }))

    fixture.setZoom(20)
    fixture.map.easeTo.mockClear()
    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1002, 11.8002], heading: 90 })
    expect(fixture.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 18 }))
  })

  it('keeps heading-follow OFF independent from the live heading', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: false,
    })

    expect(fixture.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ bearing: 0 }))
  })

  it('smooths a live heading transition with Capture shortest-angle behavior', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 0,
      headingFollowEnabled: true,
    })
    fixture.map.easeTo.mockClear()

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: true,
    })

    expect(fixture.map.easeTo).toHaveBeenCalledTimes(1)
    expect(fixture.map.easeTo.mock.calls[0][0].bearing).toBeCloseTo(31.5)
  })

  it('keeps map bearing independent while heading-follow is OFF', () => {
    const fixture = createMap(12)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 0,
      headingFollowEnabled: false,
    })
    fixture.map.easeTo.mockClear()

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: false,
    })

    expect(fixture.getBearing()).toBe(12)
    expect(fixture.map.easeTo.mock.calls.every(([options]) => options.bearing === undefined || options.bearing === 12)).toBe(true)
  })

  it('aligns to the current heading when heading-follow is restored', () => {
    const fixture = createMap(12)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: false,
    })
    fixture.map.easeTo.mockClear()

    controller.setHeadingFollowEnabled(true, 90)

    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 90 }))
  })

  it('takes the short path across the 359-to-1 heading wrap', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 359,
      headingFollowEnabled: true,
    })
    fixture.map.easeTo.mockClear()

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 1,
      headingFollowEnabled: true,
    })

    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 359.7 }))
  })

  it('lets an explicit Recenter supersede an earlier route-fit transition', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: true,
    })
    fixture.stop.mockClear()
    fixture.map.easeTo.mockClear()

    controller.fitRoute(routeBounds)
    controller.recenter([122.1003, 11.8003], 90)

    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [122.1003, 11.8003],
      bearing: 90,
      pitch: 55,
    }))
  })

  it('stops the prior transition so rapid mode changes settle on the last selected mode', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })
    fixture.stop.mockClear()
    controller.update({ surface: 'active', mode: 'POV', position: [122.1, 11.8], heading: 180 })

    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(controller.getState().mode).toBe('POV')
    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 85, zoom: 19, bearing: 180 }))
  })

  it('fits route preview as a flat overview with overlay-aware padding', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map, { reducedMotion: false })

    controller.update({ surface: 'route-preview', mode: 'POV', routeBounds })

    expect(fixture.map.fitBounds).toHaveBeenCalledWith(
      [[routeBounds.minLng, routeBounds.minLat], [routeBounds.maxLng, routeBounds.maxLat]],
      {
        padding: { top: 184, right: 32, bottom: 168, left: 32 },
        duration: 400,
        maxZoom: 16,
      },
    )
    expect(fixture.map.easeTo).not.toHaveBeenCalled()
    expect(controller.getState().mode).toBe('TOP')
  })

  it('clamps pitch repair to the map-reported maximum', () => {
    const fixture = createMap(0, 60)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'POV', position: [122.1, 11.8], heading: 90 })
    fixture.map.easeTo.mockClear()
    fixture.emit('moveend')
    fixture.setPitch(0)
    fixture.emit('moveend')

    expect(fixture.map.easeTo).toHaveBeenCalledWith({ pitch: 60, duration: 200 })
  })

  it('does not enqueue another camera animation for an identical update', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const input = { surface: 'active' as const, mode: 'FOLLOW' as const, position: [122.1, 11.8] as [number, number], heading: 90 }

    controller.update(input)
    fixture.map.easeTo.mockClear()
    controller.update(input)

    expect(fixture.map.easeTo).not.toHaveBeenCalled()
  })

  it('suspends the full camera owner after any genuine pan, rotate, or zoom start', () => {
    for (const eventType of ['dragstart', 'rotatestart', 'zoomstart'] as const) {
      const fixture = createMap()
      const changes: boolean[] = []
      const controller = createNavigationCameraController(fixture.map, {
        onSuspensionChange: (suspended) => changes.push(suspended),
      })
      controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })
      fixture.map.easeTo.mockClear()

      fixture.emit(eventType, { originalEvent: { type: 'pointer' } })
      expect(controller.getState().followSuspended).toBe(true)

      controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1002, 11.8002], heading: 90 })
      expect(fixture.map.easeTo).not.toHaveBeenCalled()
      expect(changes).toEqual([true])
    }
  })

  it('suspends manual rotation even when heading follow is OFF', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: false,
    })

    fixture.emit('rotatestart')
    expect(controller.getState().followSuspended).toBe(false)

    fixture.emit('rotatestart', { originalEvent: { type: 'touchmove' } })
    expect(controller.getState()).toMatchObject({ followSuspended: true, headingFollowSuspended: false })
  })

  it('ignores synthetic drag, rotate, and zoom starts from the camera owner', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'FOLLOW',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: true,
    })

    fixture.emit('dragstart')
    fixture.emit('rotatestart')
    fixture.emit('zoomstart')

    expect(controller.getState()).toMatchObject({ followSuspended: false, headingFollowSuspended: false })
  })

  it('does not repair pitch at moveend after a genuine gesture', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'TOP', position: [122.1, 11.8], heading: 90 })
    fixture.map.easeTo.mockClear()
    fixture.setPitch(25)
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })
    fixture.emit('moveend')

    expect(fixture.map.easeTo).not.toHaveBeenCalled()
  })

  it('does not repair pitch from an interrupted mode transition', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })
    fixture.map.easeTo.mockClear()
    controller.update({ surface: 'active', mode: 'POV', position: [122.1, 11.8], heading: 180 })
    fixture.map.easeTo.mockClear()
    fixture.setPitch(0)
    fixture.emit('moveend')

    expect(fixture.map.easeTo).not.toHaveBeenCalled()
  })

  it('keeps TOP flat while suspended without rewriting bearing or zoom', () => {
    const fixture = createMap(137)
    const controller = createNavigationCameraController(fixture.map)

    controller.update({
      surface: 'active',
      mode: 'TOP',
      position: [122.1, 11.8],
      heading: 90,
      headingFollowEnabled: false,
    })
    fixture.map.easeTo.mockClear()
    fixture.setPitch(25)
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })
    fixture.map.easeTo.mockClear()

    controller.update({
      surface: 'active',
      mode: 'TOP',
      position: [122.1002, 11.8002],
      heading: 180,
      headingFollowEnabled: false,
    })

    expect(fixture.map.easeTo).toHaveBeenCalledWith({ pitch: 0, duration: 0 })
    expect(fixture.map.easeTo.mock.calls[0][0]).not.toHaveProperty('bearing')
    expect(fixture.map.easeTo.mock.calls[0][0]).not.toHaveProperty('zoom')
    expect(fixture.map.easeTo.mock.calls[0][0]).not.toHaveProperty('center')
  })

  it('recenters and resumes the selected mode without changing it', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })
    fixture.map.easeTo.mockClear()

    controller.recenter([122.1003, 11.8003], 90)

    expect(controller.getState()).toMatchObject({ mode: 'FOLLOW', followSuspended: false, headingFollowSuspended: false })
    expect(fixture.map.easeTo).toHaveBeenCalledWith({
      center: [122.1003, 11.8003],
      pitch: 55,
      bearing: 90,
      zoom: 18,
      offset: [0, 110],
      duration: 360,
    })
  })

  it('uses the latest supplied position and heading after manual suspension', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const p1: [number, number] = [122.1, 11.8]
    const p2: [number, number] = [122.1002, 11.8002]
    const p3: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'FOLLOW', position: p1, heading: 10, headingFollowEnabled: true })
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })
    controller.update({ surface: 'active', mode: 'FOLLOW', position: p2, heading: 20, headingFollowEnabled: true })
    fixture.map.easeTo.mockClear()

    controller.recenter(p3, 30)

    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: p3,
      bearing: 30,
      pitch: 55,
      zoom: 18,
    }))
    expect(controller.getState()).toMatchObject({ followSuspended: false, headingFollowSuspended: false })
  })

  it('does not let a same-input parent replay overwrite the canonical Recenter target', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'TOP', position, heading: 30, headingFollowEnabled: false })
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })
    fixture.map.easeTo.mockClear()

    controller.recenter(position, 300)
    controller.update({ surface: 'active', mode: 'TOP', position, heading: 300, headingFollowEnabled: false })

    expect(fixture.map.easeTo).toHaveBeenCalledTimes(1)
    expect(fixture.map.easeTo).toHaveBeenLastCalledWith({
      center: position,
      pitch: 0,
      bearing: 0,
      zoom: 16,
      duration: 360,
    })
  })

  it('restores TOP framing while preserving a manually chosen bearing when heading-follow is OFF', () => {
    const fixture = createMap(137)
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({
      surface: 'active',
      mode: 'TOP',
      position,
      heading: 10,
      headingFollowEnabled: false,
    })
    fixture.emit('rotatestart', { originalEvent: { type: 'touchmove' } })
    fixture.setBearing(47)
    fixture.setPitch(25)
    fixture.setZoom(12)
    fixture.map.easeTo.mockClear()

    controller.recenter(position, 300)

    expect(fixture.map.easeTo).toHaveBeenLastCalledWith({
      center: position,
      pitch: 0,
      bearing: 47,
      zoom: 16,
      duration: 360,
    })
  })

  it('restores TOP heading-follow bearing from the latest heading', () => {
    const fixture = createMap(137)
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({
      surface: 'active',
      mode: 'TOP',
      topOrientation: 'heading-follow',
      position,
      heading: 10,
      headingFollowEnabled: true,
    })
    fixture.emit('rotatestart', { originalEvent: { type: 'touchmove' } })
    fixture.setBearing(47)
    fixture.map.easeTo.mockClear()

    controller.recenter(position, 300)

    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: position,
      pitch: 0,
      bearing: 300,
      zoom: 16,
    }))
  })

  it('restores POV framing from the latest heading after zoom suspension', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'POV', position, heading: 10, headingFollowEnabled: true })
    fixture.emit('zoomstart', { originalEvent: { type: 'wheel' } })
    controller.update({ surface: 'active', mode: 'POV', position: [122.1005, 11.8005], heading: 20, headingFollowEnabled: true })
    fixture.map.easeTo.mockClear()

    controller.recenter(position, 300)

    expect(fixture.map.easeTo).toHaveBeenLastCalledWith({
      center: position,
      pitch: 85,
      bearing: 300,
      zoom: 19,
      offset: [0, 150],
      duration: 360,
    })
  })

  it('does not silently enable heading-follow while recovering a manually rotated FOLLOW camera', () => {
    const fixture = createMap(12)
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'FOLLOW', position, heading: 10, headingFollowEnabled: false })
    fixture.emit('rotatestart', { originalEvent: { type: 'touchmove' } })
    fixture.setBearing(47)
    fixture.map.easeTo.mockClear()

    controller.recenter(position, 300)

    expect(controller.getState().headingFollowEnabled).toBe(false)
    expect(fixture.getBearing()).toBe(47)
    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 47 }))
  })

  it('makes repeated identical Recenter calls idempotent after recovery', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'FOLLOW', position, heading: 30, headingFollowEnabled: true })
    fixture.emit('dragstart', { originalEvent: { type: 'pointerdown' } })
    fixture.map.easeTo.mockClear()
    fixture.stop.mockClear()

    controller.recenter(position, 300)
    controller.recenter(position, 300)

    expect(fixture.map.easeTo).toHaveBeenCalledTimes(1)
    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ followSuspended: false, mode: 'FOLLOW' })
  })

  it('makes Recenter win over an active transition and ignores its stale moveend', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'FOLLOW', position, heading: 30, headingFollowEnabled: true })
    controller.update({ surface: 'active', mode: 'POV', position, heading: 60, headingFollowEnabled: true })
    fixture.map.easeTo.mockClear()
    fixture.stop.mockClear()

    controller.recenter(position, 300)
    fixture.setPitch(0)
    fixture.emit('moveend')

    expect(fixture.stop).toHaveBeenCalledTimes(1)
    expect(fixture.map.easeTo).toHaveBeenCalledTimes(1)
    expect(fixture.map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 85, bearing: 300 }))
  })

  it('does not add listeners or acquisition work when Recenter is invoked repeatedly', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    const initialListenerCount = fixture.map.on.mock.calls.length
    const position: [number, number] = [122.1004, 11.8004]

    controller.update({ surface: 'active', mode: 'TOP', position, heading: 30 })
    controller.recenter(position, 300)
    controller.recenter(position, 300)

    expect(fixture.map.on).toHaveBeenCalledTimes(initialListenerCount)
  })

  it('makes Compass north reset functional and keeps position following until Recenter', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)
    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1, 11.8], heading: 90 })
    fixture.map.easeTo.mockClear()

    controller.resetCompass()

    expect(controller.getState().headingFollowSuspended).toBe(true)
    expect(fixture.getBearing()).toBe(0)
    expect(fixture.map.easeTo).toHaveBeenCalledWith({ pitch: 55, bearing: 0, duration: 360, offset: [0, 110] })

    fixture.map.easeTo.mockClear()
    controller.update({ surface: 'active', mode: 'FOLLOW', position: [122.1001, 11.8001], heading: 90 })
    expect(fixture.map.easeTo).toHaveBeenCalledWith({
      center: [122.1001, 11.8001],
      pitch: 55,
      bearing: 0,
      offset: [0, 110],
      duration: 220,
    })
  })

  it('removes camera transitions under reduced motion', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map, { reducedMotion: true })

    controller.update({ surface: 'active', mode: 'POV', position: [122.1, 11.8], heading: 90 })

    expect(fixture.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }))
  })

  it('removes event listeners on destroy', () => {
    const fixture = createMap()
    const controller = createNavigationCameraController(fixture.map)

    controller.destroy()

    expect(fixture.map.off).toHaveBeenCalledTimes(6)
  })
})
