import type maplibregl from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'
import {
  MapboxBrandControl,
  formatMapboxSatelliteError,
  getMapErrorDetails,
  reportMapError,
  syncMapboxBrandControl,
} from './satellite'

describe('Mapbox Satellite map support', () => {
  it('classifies Mapbox Satellite HTTP failures without retaining the request URL', () => {
    const details = getMapErrorDetails({
      sourceId: 'satellite',
      source: { tiles: ['https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90'] },
      error: {
        status: 429,
        url: 'https://api.mapbox.com/v4/mapbox.satellite/18/1/2.jpg90?access_token=redacted',
        message: 'rate limited',
      },
    })

    expect(details).toEqual({ isMapboxSatellite: true, status: 429, isTransient: false })
  })

  it('does not classify unrelated transient or OSM failures as Mapbox Satellite failures', () => {
    expect(getMapErrorDetails({ error: { status: 0, message: 'Failed to fetch' } })).toEqual({
      isMapboxSatellite: false,
      status: 0,
      isTransient: true,
    })
    expect(getMapErrorDetails({ sourceId: 'osm', error: { status: 404, message: 'not found' } })).toEqual({
      isMapboxSatellite: false,
      status: 404,
      isTransient: false,
    })
  })

  it('turns provider status codes into safe actionable messages', () => {
    expect(formatMapboxSatelliteError({ isMapboxSatellite: true, status: 401, isTransient: false })).toContain('authentication')
    expect(formatMapboxSatelliteError({ isMapboxSatellite: true, status: 403, isTransient: false })).toContain('authentication')
    expect(formatMapboxSatelliteError({ isMapboxSatellite: true, status: 404, isTransient: false })).toContain('unavailable')
    expect(formatMapboxSatelliteError({ isMapboxSatellite: true, status: 429, isTransient: false })).toContain('rate limit')
    expect(formatMapboxSatelliteError({ isMapboxSatellite: true, status: null, isTransient: false })).toContain('could not be loaded')
  })

  it('reports Mapbox failures by status without logging token-bearing URLs', () => {
    const logger = { warn: vi.fn(), error: vi.fn() }
    reportMapError(
      {
        sourceId: 'satellite',
        error: {
          status: 403,
          url: 'https://api.mapbox.com/v4/mapbox.satellite/18/1/2.jpg90?access_token=redacted',
          message: 'forbidden',
        },
      },
      logger,
    )

    expect(logger.warn).toHaveBeenCalledWith('[NAVI] Mapbox Satellite request failed', { status: 403 })
    expect(logger.error).not.toHaveBeenCalled()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('access_token')
  })

  it('does not report transient failures and still reports generic map errors', () => {
    const logger = { warn: vi.fn(), error: vi.fn() }
    reportMapError({ error: { status: 0, message: 'Failed to fetch' } }, logger)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()

    reportMapError({ error: { status: 500, message: 'style failed' } }, logger)
    expect(logger.error).toHaveBeenCalledWith('style failed')
  })

  it('renders Mapbox branding in the bottom-left control position', () => {
    const control = new MapboxBrandControl()
    const element = control.onAdd({} as maplibregl.Map)

    expect(element.tagName).toBe('A')
    expect(element.textContent).toBe('Mapbox')
    expect(element.getAttribute('href')).toBe('https://www.mapbox.com/about/maps/')
    expect(element.getAttribute('aria-label')).toBe('Mapbox attribution')
    expect(control.getDefaultPosition()).toBe('bottom-left')

    control.onRemove({} as maplibregl.Map)
  })

  it('adds branding only for the active satellite style and removes it on switch away', () => {
    const map = {
      addControl: vi.fn(),
      removeControl: vi.fn(),
    } as unknown as maplibregl.Map
    const controlRef: { current: MapboxBrandControl | null } = { current: null }

    syncMapboxBrandControl(map, true, controlRef)
    expect(map.addControl).toHaveBeenCalledWith(controlRef.current, 'bottom-left')
    expect(controlRef.current).toBeInstanceOf(MapboxBrandControl)

    const addedControl = controlRef.current
    syncMapboxBrandControl(map, false, controlRef)
    expect(map.removeControl).toHaveBeenCalledWith(addedControl)
    expect(controlRef.current).toBeNull()
  })
})
