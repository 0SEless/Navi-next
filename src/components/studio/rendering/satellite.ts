import type maplibregl from 'maplibre-gl'

const MAPBOX_SATELLITE_URL_MARKER = 'api.mapbox.com/v4/mapbox.satellite/'

type RecordLike = Record<string, unknown>

function asRecord(value: unknown): RecordLike {
  return typeof value === 'object' && value !== null ? value as RecordLike : {}
}

function hasMapboxSatelliteUrl(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MAPBOX_SATELLITE_URL_MARKER)
}

export interface MapErrorDetails {
  isMapboxSatellite: boolean
  status: number | null
  isTransient: boolean
}

export function getMapErrorDetails(event: unknown): MapErrorDetails {
  const eventRecord = asRecord(event)
  const error = asRecord(eventRecord.error)
  const source = asRecord(eventRecord.source)
  const status = typeof error.status === 'number' ? error.status : null
  const message = [error.message, error.url].filter((value): value is string => typeof value === 'string').join(' ')
  const sourceTiles = Array.isArray(source.tiles) ? source.tiles : []
  const isMapboxSatellite =
    hasMapboxSatelliteUrl(error.url) ||
    sourceTiles.some(hasMapboxSatelliteUrl) ||
    (eventRecord.sourceId === 'satellite' && sourceTiles.length === 0)

  return {
    isMapboxSatellite,
    status,
    isTransient: status === 0 || /failed to fetch|cors/i.test(message),
  }
}

export function formatMapboxSatelliteError(details: MapErrorDetails): string {
  switch (details.status) {
    case 401:
    case 403:
      return 'Mapbox Satellite authentication failed. Choose another basemap or check the local token configuration.'
    case 404:
      return 'Mapbox Satellite imagery is unavailable for this tile. Choose another basemap.'
    case 429:
      return 'Mapbox Satellite rate limit reached. Choose another basemap and try again later.'
    default:
      return 'Mapbox Satellite imagery could not be loaded. Choose another basemap.'
  }
}

export interface MapErrorLogger {
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function reportMapError(event: unknown, logger: MapErrorLogger = console): void {
  const details = getMapErrorDetails(event)
  if (details.isTransient) return

  if (details.isMapboxSatellite) {
    logger.warn('[NAVI] Mapbox Satellite request failed', { status: details.status })
    return
  }

  const error = asRecord(asRecord(event).error)
  logger.error(typeof error.message === 'string' ? error.message : 'Map rendering error')
}

export class MapboxBrandControl implements maplibregl.IControl {
  private container: HTMLAnchorElement | null = null

  onAdd(_map: maplibregl.Map): HTMLElement {
    const anchor = document.createElement('a')
    anchor.className = 'maplibregl-ctrl navi-mapbox-brand'
    anchor.href = 'https://www.mapbox.com/about/maps/'
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.textContent = 'Mapbox'
    anchor.setAttribute('aria-label', 'Mapbox attribution')
    anchor.title = 'Mapbox attribution'
    anchor.style.display = 'block'
    anchor.style.padding = '2px 5px'
    anchor.style.color = '#111'
    anchor.style.fontSize = '10px'
    anchor.style.fontWeight = '600'
    anchor.style.lineHeight = '14px'
    anchor.style.textDecoration = 'none'
    anchor.style.background = 'rgba(255, 255, 255, 0.9)'
    this.container = anchor
    return anchor
  }

  onRemove(_map: maplibregl.Map): void {
    this.container?.remove()
    this.container = null
  }

  getDefaultPosition(): 'bottom-left' {
    return 'bottom-left'
  }
}

export function syncMapboxBrandControl(
  map: maplibregl.Map,
  enabled: boolean,
  controlRef: { current: MapboxBrandControl | null },
): void {
  if (enabled && !controlRef.current) {
    const control = new MapboxBrandControl()
    map.addControl(control, 'bottom-left')
    controlRef.current = control
    return
  }

  if (!enabled && controlRef.current) {
    const control = controlRef.current
    controlRef.current = null
    try {
      map.removeControl(control)
    } catch {
      // The map may already be tearing down; there is no state to recover.
    }
  }
}
