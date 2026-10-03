// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { computeCampusBounds } from '@/lib/campus-bounds'

// --- mocks ---
vi.mock('maplibre-gl', () => ({
  default: {
    LngLatBounds: class { sw: unknown; ne: unknown; constructor(sw: unknown, ne: unknown) { this.sw = sw; this.ne = ne } },
  },
}))
vi.mock('@navi/editor', () => ({
  useEditor: () => ({ services: { get: () => null } }),
}))
let CURRENT_GRAPH: Record<string, unknown> | null = null
vi.mock('@/store/graph-store', () => ({
  useGraphStore: (selector: (s: { graph: unknown }) => unknown) => selector({ graph: CURRENT_GRAPH }),
}))

import { ViewportController } from '../ViewportController'

const mapMock = () => ({ fitBounds: vi.fn(), flyTo: vi.fn() }) as unknown as maplibregl.Map & { fitBounds: ReturnType<typeof vi.fn>; flyTo: ReturnType<typeof vi.fn> }
const b = (lat1: number, lng1: number, lat2: number, lng2: number) => ({ minLat: lat1, maxLat: lat2, minLng: lng1, maxLng: lng2, points: 4 })
const campus = (id: string, extra: Record<string, unknown> = {}) => ({
  campusId: id,
  buildings: [{ id: 'b1', footprint: [{ lat: 10, lng: 20 }, { lat: 10.001, lng: 20.002 }] }],
  nodes: [{ id: 'n1', position: { lat: 10.0005, lng: 20.001 } }],
  ...extra,
})

afterEach(() => { CURRENT_GRAPH = null; vi.clearAllMocks() })

describe('campus-bounds helper (priority + safety)', () => {
  it('A: valid boundary wins over buildings/nodes', () => {
    const r = computeCampusBounds({ boundary: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], buildings: [{ footprint: [{ lat: 90, lng: 90 }] }] })
    expect(r).toMatchObject({ minLat: 1, maxLat: 2, minLng: 1, maxLng: 2 })
  })
  it('B: no boundary -> building outlines/footprints', () => {
    const r = computeCampusBounds({ buildings: [{ footprint: [{ lat: 10, lng: 20 }, { lat: 10.01, lng: 20.02 }] }] })
    expect(r).toMatchObject({ minLat: 10, maxLat: 10.01, minLng: 20, maxLng: 20.02 })
  })
  it('C: no boundary/buildings -> route nodes', () => {
    const r = computeCampusBounds({ nodes: [{ position: { lat: 11.8, lng: 122.17 } }, { position: { lat: 11.9, lng: 122.18 } }] })
    expect(r).toMatchObject({ minLat: 11.8, maxLat: 11.9 })
  })
  it('D: no usable geometry -> null (fallback behavior preserved)', () => {
    expect(computeCampusBounds({ buildings: [], nodes: [] })).toBeNull()
    expect(computeCampusBounds(null)).toBeNull()
  })
  it('F/M: single point + malformed coordinates handled safely', () => {
    const single = computeCampusBounds({ nodes: [{ position: { lat: 5, lng: 6 } }] })
    expect(single).toMatchObject({ minLat: 5, maxLat: 5, minLng: 6, maxLng: 6, points: 1 })
    const malformed = computeCampusBounds({ boundary: [{ lat: 'x', lng: null }, { lat: 999, lng: 0 }], nodes: [{ position: { lat: 7, lng: 8 } }] })
    expect(malformed).toMatchObject({ minLat: 7, maxLat: 7 })
  })
  it('N: 5cbc-like geometry contains all valid authored points', () => {
    const r = computeCampusBounds({ buildings: [{ footprint: [{ lat: 11.8167928, lng: 122.1686297 }, { lat: 11.819033083807753, lng: 122.17321138920147 }] }], nodes: [{ position: { lat: 11.8179, lng: 122.1709 } }] })
    expect(r!.minLat).toBeLessThanOrEqual(11.8167928)
    expect(r!.maxLat).toBeGreaterThanOrEqual(11.819033083807753)
    expect(r!.minLng).toBeLessThanOrEqual(122.1686297)
    expect(r!.maxLng).toBeGreaterThanOrEqual(122.17321138920147)
  })
})

describe('ViewportController one-shot campus auto-framing', () => {
  it('G/H/I/J: frames exactly once; rerenders and same-campus edits do not reset; no extra calls', () => {
    CURRENT_GRAPH = campus('map-A')
    const map = mapMock()
    const { rerender } = render(<ViewportController map={map} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    rerender(<ViewportController map={map} />)
    CURRENT_GRAPH = campus('map-A', { buildings: [{ id: 'b1', footprint: [{ lat: 10, lng: 20 }] }, { id: 'b2', footprint: [{ lat: 10.02, lng: 20.03 }] }] })
    rerender(<ViewportController map={map} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1) // no reset on edits/rerender
    expect(map.flyTo).not.toHaveBeenCalled()
  })
  it('K/L: switching campus re-frames once per selection (and again when switching back)', () => {
    CURRENT_GRAPH = campus('map-A')
    const map = mapMock()
    const { rerender } = render(<ViewportController map={map} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    CURRENT_GRAPH = campus('map-B')
    rerender(<ViewportController map={map} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
    CURRENT_GRAPH = campus('map-A')
    rerender(<ViewportController map={map} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(3)
  })
  it('E: campus geometry wins over initialCenter (fitBounds, no fallback flyTo)', () => {
    CURRENT_GRAPH = campus('map-A')
    const map = mapMock()
    render(<ViewportController map={map} initialCenter={{ lat: 1, lng: 2 }} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    expect(map.flyTo).not.toHaveBeenCalled()
  })
  it('D: no campus geometry -> existing initialCenter fallback still works', () => {
    CURRENT_GRAPH = { campusId: 'map-empty', buildings: [], nodes: [] }
    const map = mapMock()
    render(<ViewportController map={map} initialCenter={{ lat: 3, lng: 4 }} />)
    expect(map.flyTo).toHaveBeenCalledTimes(1)
    expect(map.fitBounds).not.toHaveBeenCalled()
  })
  it('F: single-point campus uses sensible center/zoom (no fitBounds)', () => {
    CURRENT_GRAPH = { campusId: 'map-point', nodes: [{ id: 'n1', position: { lat: 5, lng: 6 } }], buildings: [] }
    const map = mapMock()
    render(<ViewportController map={map} />)
    expect(map.fitBounds).not.toHaveBeenCalled()
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [6, 5] }))
  })
})
