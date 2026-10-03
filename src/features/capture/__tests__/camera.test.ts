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

describe('Capture camera-follow policy', () => {
  it('defaults to following the live position', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)

    expect(controller.isFollowing()).toBe(true)
    expect(map.on).toHaveBeenCalledWith('dragstart', expect.any(Function))
  })

  it('turns Follow off after an intentional pan without changing recording data', () => {
    const { map, emit } = createMap()
    const onFollowChange = vi.fn()
    const controller = createCaptureCameraController(map, { onFollowChange })
    const rawSamples = [{ latitude: 11.8, longitude: 122.1 }]
    const markers = [{ latitude: 11.8, longitude: 122.1 }]

    emit('dragstart')

    expect(controller.isFollowing()).toBe(false)
    expect(onFollowChange).toHaveBeenCalledWith(false)
    expect(rawSamples).toEqual([{ latitude: 11.8, longitude: 122.1 }])
    expect(markers).toEqual([{ latitude: 11.8, longitude: 122.1 }])
  })

  it('recenters live position while Follow is on without overriding zoom', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map, { animationDurationMs: 220 })

    controller.updatePosition([122.1001, 11.8001])

    expect(map.easeTo).toHaveBeenCalledWith({ center: [122.1001, 11.8001], duration: 220 })
    expect(map.easeTo.mock.calls[0][0]).not.toHaveProperty('zoom')
  })

  it('does not recenter on GPS updates after Follow is turned off', () => {
    const { map, emit } = createMap()
    const controller = createCaptureCameraController(map)

    emit('dragstart')
    controller.updatePosition([122.1002, 11.8002])

    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('recenter explicitly returns to the current position and turns Follow on', () => {
    const { map, emit } = createMap()
    const onFollowChange = vi.fn()
    const controller = createCaptureCameraController(map, { onFollowChange })

    emit('dragstart')
    controller.recenter([122.1003, 11.8003])

    expect(controller.isFollowing()).toBe(true)
    expect(onFollowChange).toHaveBeenLastCalledWith(true)
    expect(map.easeTo).toHaveBeenLastCalledWith({ center: [122.1003, 11.8003], duration: 250 })
  })

  it('does not move the camera when recenter has no live position', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)

    controller.recenter()

    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('cleans up the manual-pan listener when the map is torn down', () => {
    const { map } = createMap()
    const controller = createCaptureCameraController(map)

    controller.destroy()

    expect(map.off).toHaveBeenCalledWith('dragstart', expect.any(Function))
  })
})
