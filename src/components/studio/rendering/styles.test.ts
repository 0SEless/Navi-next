import { describe, expect, it } from 'vitest'
import {
  BASE_STYLES,
  BASE_STYLE_NAMES,
  DEFAULT_BASE_STYLE,
  getLegacySatelliteStyle,
  getMapboxSatelliteTileUrl,
} from './styles'

describe('studio basemap registry', () => {
  it('uses the official Mapbox Satellite raster endpoint and required attribution', () => {
    const satellite = BASE_STYLES.satellite.style
    const source = satellite.sources.satellite

    expect(source.type).toBe('raster')
    expect(source.tiles).toEqual([getMapboxSatelliteTileUrl(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN)])
    expect(source.tiles?.[0]).toContain('https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90')
    expect(source.tileSize).toBe(256)
    expect(source.maxzoom).toBe(22)
    expect(source.attribution).toContain('Mapbox')
    expect(source.attribution).toContain('Maxar')
    expect(BASE_STYLE_NAMES.satellite).toBe('Satellite')
  })

  it('keeps OSM as the default and the legacy satellite provider out of the selector', () => {
    expect(DEFAULT_BASE_STYLE).toBe('osm')
    expect(Object.keys(BASE_STYLE_NAMES)).toEqual(['osm', 'satellite', 'positron', 'dark', 'streets'])

    const legacySource = getLegacySatelliteStyle().style.sources.satellite
    expect(legacySource.type).toBe('raster')
    expect(legacySource.tiles?.[0]).toContain('server.arcgisonline.com')
  })

  it('reads the Mapbox token from the caller without exposing a fallback token', () => {
    expect(getMapboxSatelliteTileUrl('test-mapbox-token')).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=test-mapbox-token',
    )
    expect(getMapboxSatelliteTileUrl(undefined)).toBe(
      'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=',
    )
  })
})
