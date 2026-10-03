import { describe, it, expect } from 'vitest'
import { CoordinateTransformer } from '@navi/core'
import { buildingLocalToMapScreen, mapScreenToBuildingLocal } from '../geographic-bridge'

// ── Mock MapLibre map ──
function mockMap(zoom = 15) {
  const tileSize = 256
  const scale = Math.pow(2, zoom)
  const metersPerPixel = (2 * Math.PI * 6378137) / (tileSize * scale)

  return {
    project(lnglat: [number, number]): { x: number; y: number } {
      // Simplified projection: treat lng/lat as meters offset from origin
      return { x: lnglat[0] * 100000, y: lnglat[1] * 100000 }
    },
    unproject(point: [number, number]): { lng: number; lat: number } {
      return { lng: point[0] / 100000, lat: point[1] / 100000 }
    },
  }
}

function makeTransformer() {
  const t = new CoordinateTransformer()
  // Register a building at a known origin with no rotation
  t.registerBuilding({
    buildingId: 'b1',
    origin: { lat: 14.5995, lng: 120.9842 }, // Manila
    rotation: 0,
  })
  return t
}

// ── Forward: building-local → screen ──

describe('buildingLocalToMapScreen', () => {
  it('maps building-local (0,0) to screen origin', () => {
    const transformer = makeTransformer()
    const map = mockMap()
    const screen = buildingLocalToMapScreen({ x: 0, y: 0 }, 'b1', map, transformer)
    // (0,0) local → building origin latlng → projected
    expect(screen).toBeDefined()
    expect(typeof screen.x).toBe('number')
    expect(typeof screen.y).toBe('number')
  })

  it('offset in x increases screen x', () => {
    const transformer = makeTransformer()
    const map = mockMap()
    const origin = buildingLocalToMapScreen({ x: 0, y: 0 }, 'b1', map, transformer)
    const offset = buildingLocalToMapScreen({ x: 100, y: 0 }, 'b1', map, transformer)
    // 100m east should move screen x positively
    expect(offset.x).toBeGreaterThan(origin.x)
  })

  it('returns (0,0) for unregistered building', () => {
    const transformer = makeTransformer()
    const map = mockMap()
    const screen = buildingLocalToMapScreen({ x: 50, y: 50 }, 'unknown', map, transformer)
    expect(screen).toEqual({ x: 0, y: 0 })
  })
})

// ── Inverse: screen → building-local ──

describe('mapScreenToBuildingLocal', () => {
  it('round-trip: screen → building-local → screen ≈ original', () => {
    const transformer = makeTransformer()
    const map = mockMap()
    const originalLocal = { x: 10, y: 20 }

    const screen = buildingLocalToMapScreen(originalLocal, 'b1', map, transformer)
    const recovered = mapScreenToBuildingLocal(screen, 'b1', map, transformer)

    expect(recovered).not.toBeNull()
    expect(recovered!.x).toBeCloseTo(originalLocal.x, 6)
    expect(recovered!.y).toBeCloseTo(originalLocal.y, 6)
  })

  it('returns null for unregistered building', () => {
    const transformer = makeTransformer()
    const map = mockMap()
    const result = mapScreenToBuildingLocal({ x: 100, y: 100 }, 'unknown', map, transformer)
    expect(result).toBeNull()
  })

  it('inverse of origin (0,0) round-trips correctly', () => {
    const transformer = makeTransformer()
    const map = mockMap()
    const screen = buildingLocalToMapScreen({ x: 0, y: 0 }, 'b1', map, transformer)
    const back = mapScreenToBuildingLocal(screen, 'b1', map, transformer)
    expect(back).not.toBeNull()
    expect(back!.x).toBeCloseTo(0, 6)
    expect(back!.y).toBeCloseTo(0, 6)
  })
})
