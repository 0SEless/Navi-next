import { describe, it, expect } from 'vitest'
import { wgs84ToWebMercator, webMercatorToWgs84, haversine, EARTH_RADIUS } from './crs'

describe('CRS projections', () => {
  it('WGS84 → Web Mercator is invertible', () => {
    const original = { lat: 33.42, lng: -111.93 }
    const merc = wgs84ToWebMercator(original)
    const back = webMercatorToWgs84(merc.x, merc.y)
    expect(back.lat).toBeCloseTo(original.lat, 8)
    expect(back.lng).toBeCloseTo(original.lng, 8)
  })

  it('equator maps to origin', () => {
    const merc = wgs84ToWebMercator({ lat: 0, lng: 0 })
    expect(merc.x).toBeCloseTo(0, 5)
    expect(merc.y).toBeCloseTo(0, 5)
  })

  it('1 degree longitude at equator is ~111km', () => {
    const a = wgs84ToWebMercator({ lat: 0, lng: 0 })
    const b = wgs84ToWebMercator({ lat: 0, lng: 1 })
    const dist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
    expect(dist).toBeCloseTo(111319, -2)  // ~111km
  })

  it('clamps latitude to Web Mercator max', () => {
    const merc = wgs84ToWebMercator({ lat: 90, lng: 0 })
    expect(isFinite(merc.y)).toBe(true)
  })
})

describe('haversine', () => {
  it('zero distance for same point', () => {
    expect(haversine({ lat: 33.42, lng: -111.93 }, { lat: 33.42, lng: -111.93 })).toBeCloseTo(0, 3)
  })

  it('distance between two known points', () => {
    const nyc = { lat: 40.7128, lng: -74.006 }
    const la = { lat: 34.0522, lng: -118.244 }
    const dist = haversine(nyc, la)
    expect(dist).toBeGreaterThan(3900000)  // ~3944 km
    expect(dist).toBeLessThan(4000000)
  })
})
