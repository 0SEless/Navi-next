import { describe, expect, it, vi } from 'vitest'
import { createCaptureCameraController, type CaptureCameraMap } from '../camera'

function createMap() {
  const listeners = new Map<string, () => void>()
  const map: CaptureCameraMap = {
    on: vi.fn((type, listener) => { listeners.set(type, listener) }),
    off: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    }),
    easeTo: vi.fn(),
  }

  return {
    map,
    emit(type: 'dragstart') { listeners.get(type)?.() },
  }
}

describe('Capture orientation camera policy', () => {
  it('keeps North-Up at a zero bearing', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map, { initialOrientationMode: 'heading-up' })

    controller.updateHeading(90)
    controller.setOrientationMode('north-up')

    expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 0, duration: 250 })
  })

  it('uses the verified MapLibre bearing convention for Heading-Up', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)

    controller.setOrientationMode('heading-up')
    controller.updateHeading(90)

    expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 90, duration: 250 })
  })

  it('preserves zoom because orientation updates provide no zoom override', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)

    controller.setOrientationMode('heading-up')
    controller.updateHeading(135)

    for (const call of map.easeTo.mock.calls) expect(call[0]).not.toHaveProperty('zoom')
  })

  it('composes Follow center and Heading-Up bearing in one update', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)
    controller.setOrientationMode('heading-up')
    map.easeTo.mockClear()

    controller.updatePosition([122.1002, 11.8002], 90)

    expect(map.easeTo).toHaveBeenCalledTimes(1)
    expect(map.easeTo).toHaveBeenCalledWith({ center: [122.1002, 11.8002], bearing: 90, duration: 250 })
  })

  it('updates bearing while Follow is OFF without moving the selected center', () => {
    const { map, emit } = createMap()
    const controller = createCaptureCameraController(map)
    emit('dragstart')
    controller.setOrientationMode('heading-up')
    map.easeTo.mockClear()

    controller.updateHeading(135)

    expect(controller.isFollowing()).toBe(false)
    expect(map.easeTo).toHaveBeenCalledWith({ bearing: 135, duration: 250 })
    expect(map.easeTo.mock.calls[0][0]).not.toHaveProperty('center')
  })

  it('preserves the current bearing through location updates', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)
    controller.setOrientationMode('heading-up')
    controller.updateHeading(180)
    map.easeTo.mockClear()

    controller.updatePosition([122.1003, 11.8003])

    expect(map.easeTo).toHaveBeenCalledWith({ center: [122.1003, 11.8003], duration: 250 })
    expect(map.easeTo.mock.calls[0][0]).not.toHaveProperty('zoom')
  })

  it('recenters and re-enables Follow without changing orientation mode', () => {
    const { map, emit } = createMap()
    const controller = createCaptureCameraController(map)
    controller.setOrientationMode('heading-up')
    controller.updateHeading(225)
    emit('dragstart')
    map.easeTo.mockClear()

    controller.recenter([122.1004, 11.8004])

    expect(controller.isFollowing()).toBe(true)
    expect(controller.getOrientationMode()).toBe('heading-up')
    expect(map.easeTo).toHaveBeenCalledWith({ center: [122.1004, 11.8004], bearing: 225, duration: 250 })
  })

  it('switches cleanly back to North-Up and falls back when heading is unavailable', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)
    controller.setOrientationMode('heading-up')
    controller.updateHeading(90)
    controller.updateHeading(Number.NaN)

    expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 0, duration: 250 })
    controller.setOrientationMode('north-up')
    expect(controller.getOrientationMode()).toBe('north-up')
    expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 0, duration: 250 })
  })
})
