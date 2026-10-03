import type { StyleSpecification } from 'maplibre-gl'

export type BaseStyleKey = 'osm' | 'satellite' | 'positron' | 'dark' | 'streets'

export interface BaseMapStyle {
  id: BaseStyleKey
  name: string
  attribution: string
  style: StyleSpecification
}

export const MAPBOX_SATELLITE_TILE_URL_TEMPLATE =
  'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token='

// Phase 2 browser gate: all sampled ASU–Ibajay tiles were usable through z22.
export const MAPBOX_SATELLITE_SOURCE_MAX_ZOOM = 22

export const MAPBOX_SATELLITE_ATTRIBUTION =
  '<a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">&copy; Mapbox</a> | <a href="https://www.maxar.com/" target="_blank" rel="noopener noreferrer">&copy; Maxar</a>'

export function getMapboxSatelliteTileUrl(accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN): string {
  return `${MAPBOX_SATELLITE_TILE_URL_TEMPLATE}${accessToken ? encodeURIComponent(accessToken) : ''}`
}

const LEGACY_SATELLITE_STYLE: BaseMapStyle = {
  id: 'satellite',
  name: 'Satellite (legacy fallback)',
  attribution:
    '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  style: {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution:
          '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
    },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
  },
}

export function getLegacySatelliteStyle(): BaseMapStyle {
  return LEGACY_SATELLITE_STYLE
}

export const BASE_STYLES: Record<BaseStyleKey, BaseMapStyle> = {
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    attribution: '&copy; OpenStreetMap contributors',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    attribution: MAPBOX_SATELLITE_ATTRIBUTION,
    style: {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: [getMapboxSatelliteTileUrl()],
          tileSize: 256,
          maxzoom: MAPBOX_SATELLITE_SOURCE_MAX_ZOOM,
          attribution: MAPBOX_SATELLITE_ATTRIBUTION,
        },
      },
      layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
    },
  },
  positron: {
    id: 'positron',
    name: 'CartoDB Positron',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    style: {
      version: 8,
      sources: {
        positron: {
          type: 'raster',
          tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        },
      },
      layers: [{ id: 'positron', type: 'raster', source: 'positron' }],
    },
  },
  dark: {
    id: 'dark',
    name: 'CartoDB Dark',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    style: {
      version: 8,
      sources: {
        dark: {
          type: 'raster',
          tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        },
      },
      layers: [{ id: 'dark', type: 'raster', source: 'dark' }],
    },
  },
  streets: {
    id: 'streets',
    name: 'Esri Streets',
    attribution:
      '&copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012',
    style: {
      version: 8,
      sources: {
        streets: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution:
            '&copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012',
        },
      },
      layers: [{ id: 'streets', type: 'raster', source: 'streets' }],
    },
  },
}

export const BASE_STYLE_NAMES: Record<BaseStyleKey, string> = {
  osm: 'OpenStreetMap',
  satellite: 'Satellite',
  positron: 'CartoDB Positron',
  dark: 'CartoDB Dark',
  streets: 'Esri Streets',
}

export const DEFAULT_BASE_STYLE: BaseStyleKey = 'osm'
