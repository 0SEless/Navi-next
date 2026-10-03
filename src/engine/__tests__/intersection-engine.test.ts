import { describe, it, expect } from 'vitest'
import type { LatLng, TracePath } from '@/types/nav-types'
import {
  findLineIntersections,
  findEndpointNodes,
  findProximityConnections,
} from '../intersection-engine'

describe('findLineIntersections', () => {
  it('detects crossing lines', () => {
    const a: LatLng[] = [{ lat: 0, lng: -1 }, { lat: 0, lng: 1 }]
    const b: LatLng[] = [{ lat: -1, lng: 0 }, { lat: 1, lng: 0 }]
    const result = findLineIntersections(a, b)
    expect(result).toHaveLength(1)
    expect(result[0].lat).toBeCloseTo(0, 1)
    expect(result[0].lng).toBeCloseTo(0, 1)
  })

  it('returns empty for parallel lines', () => {
    const a: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }]
    const b: LatLng[] = [{ lat: 1, lng: 0 }, { lat: 1, lng: 2 }]
    expect(findLineIntersections(a, b)).toHaveLength(0)
  })

  it('detects T-junction', () => {
    const vertical: LatLng[] = [{ lat: -1, lng: 0 }, { lat: 1, lng: 0 }]
    const horizontal: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }]
    const result = findLineIntersections(vertical, horizontal)
    expect(result).toHaveLength(1)
  })

  it('returns empty for disjoint lines', () => {
    const a: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const b: LatLng[] = [{ lat: 2, lng: 0 }, { lat: 2, lng: 1 }]
    expect(findLineIntersections(a, b)).toHaveLength(0)
  })
})

describe('findEndpointNodes', () => {
  it('returns first and last point of trace', () => {
    const trace: TracePath = {
      id: 'T001',
      floor: 0,
      points: [
        { lat: 11.8195, lng: 122.0922 },
        { lat: 11.8196, lng: 122.0923 },
        { lat: 11.8197, lng: 122.0924 },
      ],
      type: 'connector',
    }
    const endpoints = findEndpointNodes(trace)
    expect(endpoints).toHaveLength(2)
    expect(endpoints[0]).toEqual({ lat: 11.8195, lng: 122.0922 })
    expect(endpoints[1]).toEqual({ lat: 11.8197, lng: 122.0924 })
  })
})

describe('findProximityConnections', () => {
  it('finds nearby room entrances', () => {
    const roomPositions: LatLng[] = [
      { lat: 11.8195, lng: 122.0922 },
      { lat: 11.8205, lng: 122.0930 },
    ]
    const tracePoint = { lat: 11.81955, lng: 122.09225 }
    const result = findProximityConnections(tracePoint, roomPositions, 50)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ lat: 11.8195, lng: 122.0922 })
  })

  it('returns empty when nothing is close enough', () => {
    const roomPositions: LatLng[] = [{ lat: 12.0, lng: 122.0 }]
    const tracePoint = { lat: 11.8195, lng: 122.0922 }
    const result = findProximityConnections(tracePoint, roomPositions, 50)
    expect(result).toHaveLength(0)
  })
})
