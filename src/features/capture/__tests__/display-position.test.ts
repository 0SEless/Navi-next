import { describe, expect, it, vi } from 'vitest'
import { createCaptureCameraController } from '../camera'
import { createCaptureDisplayPositionStabilizer } from '../display-position'
import type { CandidateRoute, RawGpsSample } from '../types'

const ORIGIN = { latitude: 11.8, longitude: 122.1 }
const EARTH_RADIUS_METERS = 6_371_008.8
const METERS_PER_DEGREE_LATITUDE = Math.PI * EARTH_RADIUS_METERS / 180
const METERS_PER_DEGREE_LONGITUDE = METERS_PER_DEGREE_LATITUDE * Math.cos(ORIGIN.latitude * Math.PI / 180)

function coordinate(xMeters: number, yMeters: number) {
  return {
    latitude: ORIGIN.latitude + yMeters / METERS_PER_DEGREE_LATITUDE,
    longitude: ORIGIN.longitude + xMeters / METERS_PER_DEGREE_LONGITUDE,
  }
}

function sample(
  sequence: number,
  xMeters: number,
  yMeters: number,
  options: { accuracy?: number | null; speed?: number | null } = {},
): RawGpsSample {
  return {
    sequence,
    timestamp: new Date(Date.parse('2026-09-02T00:00:00.000Z') + sequence * 1_000).toISOString(),
    ...coordinate(xMeters, yMeters),
    accuracy: options.accuracy ?? 5,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: options.speed ?? 0,
  }
}

describe('Capture display-position stabilizer', () => {
  it('holds small stationary jitter at the last accepted display coordinate', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    const initial = sample(0, 0, 0)
    const accepted = stabilizer.update(initial)

    expect(stabilizer.update(sample(1, 1, 1))).toEqual(accepted)
    expect(stabilizer.update(sample(2, -1.2, 0.5, { accuracy: 8 }))).toEqual(accepted)
    expect(stabilizer.update(sample(3, 2, -1))).toEqual(accepted)
  })

  it('keeps slightly varying stationary fixes bounded by their accuracy envelope', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    const accepted = stabilizer.update(sample(0, 0, 0, { accuracy: 6 }))

    for (const [sequence, xMeters, yMeters] of [[1, 2.5, -1], [2, -2, 1.5], [3, 3, 1]] as Array<[number, number, number]>) {
      expect(stabilizer.update(sample(sequence, xMeters, yMeters, { accuracy: 6 }))).toEqual(accepted)
    }
  })

  it('accepts good-quality genuine movement without replacing the movement transition', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    stabilizer.update(sample(0, 0, 0, { accuracy: 3 }))

    expect(stabilizer.update(sample(1, 0, 6, { accuracy: 3, speed: 1.1 }))).toEqual(coordinate(0, 6))
  })

  it('accepts sustained movement in either direction after a cautious first fix', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    stabilizer.update(sample(0, 0, 0, { accuracy: 18 }))

    expect(stabilizer.update(sample(1, -15, 0, { accuracy: 18, speed: 0.1 }))).toEqual(coordinate(-0, 0))
    expect(stabilizer.update(sample(2, -22, 0, { accuracy: 18, speed: 0.1 }))).toEqual(coordinate(-22, 0))
  })

  it('does not let one small backward jitter create visible reverse drift', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    stabilizer.update(sample(0, 0, 0, { accuracy: 3 }))
    const forward = stabilizer.update(sample(1, 8, 0, { accuracy: 3, speed: 1.1 }))

    expect(stabilizer.update(sample(2, 5, 0, { accuracy: 4, speed: 0 }))).toEqual(forward)
    expect(stabilizer.getCurrent()).toEqual(forward)
  })

  it('treats poor-accuracy displacement more cautiously than good-accuracy movement', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    const initial = stabilizer.update(sample(0, 0, 0, { accuracy: 30 }))

    expect(stabilizer.update(sample(1, 25, 0, { accuracy: 30, speed: 0.4 }))).toEqual(initial)
  })

  it('does not mutate the raw fix or candidate route while updating display state', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    const rawSample = sample(0, 0, 0)
    const candidate: CandidateRoute = {
      points: [coordinate(0, 0), coordinate(10, 0)],
      sourceSampleIndices: [0, 1],
      edgeCount: 1,
      derivedFromSampleCount: 2,
      derivedAt: '2026-09-02T00:00:00.000Z',
      algorithmVersion: 'test',
    }
    const rawBefore = structuredClone(rawSample)
    const candidateBefore = structuredClone(candidate)

    stabilizer.update(rawSample)
    stabilizer.update(sample(1, 6, 0, { accuracy: 3, speed: 1 }))

    expect(rawSample).toEqual(rawBefore)
    expect(candidate).toEqual(candidateBefore)
  })

  it('keeps Follow and Recenter on the stabilized target while heading updates omit center', () => {
    const stabilizer = createCaptureDisplayPositionStabilizer()
    const initial = stabilizer.update(sample(0, 0, 0))!
    const listeners = new Map<string, () => void>()
    const map = {
      on: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
      off: vi.fn(),
      easeTo: vi.fn(),
    }
    const controller = createCaptureCameraController(map, {
      initialOrientationMode: 'heading-up',
      headingSmoothing: { smoothingFactor: 1, deadbandDegrees: 0 },
    })
    const initialCenter: [number, number] = [initial.longitude, initial.latitude]

    controller.updatePosition(initialCenter, 0)
    map.easeTo.mockClear()

    const held = stabilizer.update(sample(1, 2, 1, { accuracy: 5, speed: 0 }))!
    controller.updatePosition([held.longitude, held.latitude], 180)

    expect(map.easeTo).toHaveBeenCalledWith({ bearing: 180, duration: 250 })
    expect(map.easeTo.mock.calls[0]?.[0]).not.toHaveProperty('center')

    map.easeTo.mockClear()
    controller.recenter([held.longitude, held.latitude], 180)
    expect(map.easeTo).toHaveBeenCalledWith({ center: initialCenter, bearing: 180, duration: 250 })
    controller.destroy()
  })
})
