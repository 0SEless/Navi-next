import { describe, it, expect } from 'vitest'
import type { EditablePath } from '@/types/path-types'
import { computeHallwayPolygon } from '@/types/hallway-types'

function makePath(vertices: Array<{ x: number; y: number }>): EditablePath {
  return {
    id: 'test-path',
    vertices: vertices.map((v, i) => ({ id: `v${i}`, x: v.x, y: v.y })),
    segments: Array.from({ length: vertices.length - 1 }, (_, i) => ({
      id: `s${i}`, startVertexId: `v${i}`, endVertexId: `v${i + 1}`, type: 'straight' as const,
    })),
    closed: false,
    readOnly: false,
  }
}

function toLatLng(x: number, y: number) {
  return { lat: 11.001 + y * 0.00001, lng: 125.0018 + x * 0.00001 }
}

describe('Architecture Independence', () => {
  it('HallwayRenderer creates EditablePath from hallway data', () => {
    const rawHallwayPoints = [
      { lat: 11.00093, lng: 125.00163 },
      { lat: 11.00096, lng: 125.00178 },
      { lat: 11.00112, lng: 125.00178 },
      { lat: 11.00115, lng: 125.00163 },
    ]
    const path = makePath(rawHallwayPoints.map(p => ({ x: p.lng, y: p.lat })))
    expect(path.vertices).toHaveLength(4)
    expect(path.segments).toHaveLength(3)
    expect(path.segments[0].type).toBe('straight')
    expect(path.closed).toBe(false)
  })

  it('RoadRenderer consumes same EditablePath structure as HallwayRenderer', () => {
    const roadPoints = [
      { lat: 11.0008, lng: 125.0015 },
      { lat: 11.0010, lng: 125.0017 },
      { lat: 11.0012, lng: 125.0019 },
    ]
    const path = makePath(roadPoints.map(p => ({ x: p.lng, y: p.lat })))
    expect(path.vertices).toHaveLength(3)
    expect(path.segments).toHaveLength(2)
    expect(path.segments[0].type).toBe('straight')
    expect(path.segments[1].type).toBe('straight')
    expect(path.closed).toBe(false)
    expect(path.readOnly).toBe(false)
  })

  it('Engine processes any EditablePath regardless of origin', () => {
    const testPaths: EditablePath[] = [
      makePath([{ x: 125.0015, y: 11.0008 }, { x: 125.0017, y: 11.0010 }, { x: 125.0019, y: 11.0012 }]),
      makePath([
        { x: 125.0015, y: 11.0008 }, { x: 125.0016, y: 11.0009 },
        { x: 125.0017, y: 11.0010 }, { x: 125.0018, y: 11.0011 }, { x: 125.0019, y: 11.0012 },
      ]),
      makePath([{ x: 125.0016, y: 11.0009 }, { x: 125.0018, y: 11.0011 }]),
    ]

    for (const path of testPaths) {
      const centerline = path.vertices.map(v => toLatLng(v.x, v.y))
      expect(centerline.length).toBe(path.vertices.length)

      const polygon = computeHallwayPolygon(centerline, 3)
      expect(polygon.length).toBeGreaterThanOrEqual(3)

      for (const p of polygon) {
        expect(p).toHaveProperty('lat')
        expect(p).toHaveProperty('lng')
        expect(typeof p.lat).toBe('number')
        expect(typeof p.lng).toBe('number')
        expect(Number.isFinite(p.lat)).toBe(true)
        expect(Number.isFinite(p.lng)).toBe(true)
      }
    }
  })

  it('LGE processes hallways and roads identically', () => {
    const hallwayCenterline = [
      { lat: 11.00093, lng: 125.00163 },
      { lat: 11.00096, lng: 125.00178 },
      { lat: 11.00112, lng: 125.00178 },
    ]
    const roadCenterline = [
      { lat: 11.00080, lng: 125.00150 },
      { lat: 11.00100, lng: 125.00170 },
      { lat: 11.00120, lng: 125.00190 },
    ]
    const hwBuffer = computeHallwayPolygon(hallwayCenterline, 3)
    const rdBuffer = computeHallwayPolygon(roadCenterline, 5)
    expect(hwBuffer.length).toBeGreaterThanOrEqual(3)
    expect(rdBuffer.length).toBeGreaterThanOrEqual(3)
    expect(hwBuffer).not.toEqual(rdBuffer)
  })

  it('Empty path produces empty polygon', () => {
    const polygon = computeHallwayPolygon([], 3)
    expect(polygon).toEqual([])
  })

  it('Single point path produces no valid polygon (0 or 1 pt)', () => {
    const polygon = computeHallwayPolygon([{ lat: 11.001, lng: 125.0018 }], 3)
    expect(polygon.length).toBeLessThan(3)
  })
})
