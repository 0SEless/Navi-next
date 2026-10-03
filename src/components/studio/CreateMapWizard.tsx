'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCampusMapStore } from '@/store/campus-map-store'
import { useGraphStore } from '@/store/graph-store'
import { Search, ArrowLeft, Check, X, MapPin, Download, Loader2, Eye, EyeOff, Building2 } from 'lucide-react'
import type { Building } from '@/types/nav-types'
import { BuildingMetadataForm } from '@/components/shared/BuildingMetadataForm'

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}

const BLDG_SRC = 'wizard-buildings'

const COLOR_SWATCHES = [
  '#1C6BEB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316',
  '#6366F1', '#84CC16', '#0EA5E9', '#D946EF', '#FB923C',
]

type WizardStep = 'info' | 'map' | 'imported'

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  boundingbox: string[]
}

interface OsmBuilding {
  id: string; name: string; footprint: { lat: number; lng: number }[]
  height: number; color: string; center: { lat: number; lng: number }
}

export function CreateMapWizard() {
  const router = useRouter()
  const createMap = useCampusMapStore((s) => s.createMap)
  const updateMapStats = useCampusMapStore((s) => s.updateMapStats)
  const addBuilding = useGraphStore((s) => s.addBuilding)
  const removeBuilding = useGraphStore((s) => s.removeBuilding)
  const updateBuilding = useGraphStore((s) => s.updateBuilding)
  const save = useGraphStore((s) => s.save)
  const graph = useGraphStore((s) => s.graph)
  const graphBuildings = graph.buildings

  const [step, setStep] = useState<WizardStep>('info')
  const [name, setName] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [campusName, setCampusName] = useState('')
  const [mapId, setMapId] = useState<string | null>(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const [buildingsSeed, setBuildingsSeed] = useState(0)

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [searching, setSearching] = useState(false)

  const [boundaryPoints, setBoundaryPoints] = useState<{ lat: number; lng: number }[]>([])
  const boundarySourceRef = useRef<string>('boundary-drawing')
  const markerRef = useRef<maplibregl.Marker | null>(null)

  const [importState, setImportState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [importResult, setImportResult] = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const [showBuildings, setShowBuildings] = useState(true)

  const selectedBuilding = selectedBuildingId ? graphBuildings.find((b) => b.id === selectedBuildingId) : null

  const initMap = useCallback((center?: { lat: number; lng: number }) => {
    if (mapRef.current || !mapContainerRef.current) return
    const c = center ?? { lat: 11.8195, lng: 122.0922 }
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OSM_STYLE,
      center: [c.lng, c.lat],
      zoom: center ? 17 : 4,
    })
    map.on('error', (e) => {
      if (e.error?.status === 0 || `${e.error}`.includes('Failed to fetch') || `${e.error}`.includes('CORS')) return
      console.error(e.error)
    })
    map.on('load', () => {
      map.addSource(boundarySourceRef.current, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: boundarySourceRef.current,
        paint: { 'fill-color': '#F97316', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: boundarySourceRef.current,
        paint: { 'line-color': '#F97316', 'line-width': 3, 'line-dasharray': [4, 4] },
      })
      map.addLayer({
        id: 'boundary-vertices',
        type: 'circle',
        source: boundarySourceRef.current,
        paint: {
          'circle-radius': 6,
          'circle-color': '#F97316',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        },
      })

      map.addSource(BLDG_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'bldg-fill', type: 'fill', source: BLDG_SRC, paint: { 'fill-color': '#1C6BEB', 'fill-opacity': 0.08 } })
      map.addLayer({ id: 'bldg-extrusion', type: 'fill-extrusion', source: BLDG_SRC, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.65, 'fill-extrusion-base': 0 } })
      map.addLayer({ id: 'bldg-outline', type: 'line', source: BLDG_SRC, paint: { 'line-color': ['get', 'color'], 'line-width': 2 } })

      setMapReady(true)
    })
    mapRef.current = map
  }, [])

  const initIfNeeded = useCallback(() => {
    if (!mapRef.current && step !== 'info') {
      initMap()
    }
  }, [step, initMap])

  useEffect(() => {
    initIfNeeded()
  }, [initIfNeeded])

  // Boundary draw click handler
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || step !== 'map') return
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      setBoundaryPoints((prev) => [...prev, { lat: e.lngLat.lat, lng: e.lngLat.lng }])
    }
    map.on('click', handleClick)
    return () => { try { map.off('click', handleClick) } catch {} }
  }, [mapReady, step])

  // Boundary render
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource(boundarySourceRef.current) as maplibregl.GeoJSONSource
    if (!src) return

    const points = boundaryPoints
    const features: GeoJSON.Feature[] = []

    if (points.length >= 1) {
      for (const p of points) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: {},
        })
      }
    }
    if (points.length >= 2) {
      const coords = points.map((p) => [p.lng, p.lat])
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points.length >= 3 ? [...coords, coords[0]] : coords,
        },
        properties: {},
      })
    }
    if (points.length >= 3) {
      const coords = points.map((p) => [p.lng, p.lat])
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
        properties: {},
      })
    }

    src.setData({ type: 'FeatureCollection', features })
  }, [boundaryPoints, mapReady])

  // Select building on click (imported step)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || step !== 'imported') return
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['bldg-extrusion'] })
      if (features.length > 0) {
        const id = features[0].properties?.id
        if (id) setSelectedBuildingId(id)
      } else {
        setSelectedBuildingId(null)
      }
    }
    map.on('click', handleClick)
    return () => { try { map.off('click', handleClick) } catch {} }
  }, [mapReady, step])

  // Cursor change on hover
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || step !== 'imported') return
    const canvas = map.getCanvas()
    const handleMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['bldg-extrusion'] })
      canvas.style.cursor = features.length > 0 ? 'pointer' : ''
    }
    map.on('mousemove', handleMove)
    return () => { try { map.off('mousemove', handleMove) } catch {} }
  }, [mapReady, step])

  // Zoom to selected building, preserving current pitch/bearing
  useEffect(() => {
    if (!selectedBuilding || !mapRef.current || !mapReady) return
    const map = mapRef.current
    const b = selectedBuilding
    const opts = { pitch: map.getPitch(), bearing: map.getBearing(), duration: 500 }
    if (b.footprint.length >= 2) {
      const bounds = new maplibregl.LngLatBounds()
      b.footprint.forEach((p) => bounds.extend([p.lng, p.lat]))
      map.fitBounds(bounds, { padding: 120, ...opts })
    } else if (b.center) {
      map.flyTo({ center: [b.center.lng, b.center.lat], zoom: 18, ...opts })
    }
  }, [selectedBuilding, mapReady])

  // Highlight layer
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    try { if (map.getLayer('bldg-highlight')) map.removeLayer('bldg-highlight') } catch {}
    try { if (map.getLayer('bldg-highlight-outline')) map.removeLayer('bldg-highlight-outline') } catch {}
    if (!selectedBuildingId) return
    map.addLayer({
      id: 'bldg-highlight',
      type: 'fill-extrusion',
      source: BLDG_SRC,
      filter: ['==', 'id', selectedBuildingId],
      paint: {
        'fill-extrusion-color': '#FFFFFF',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-opacity': 0.4,
        'fill-extrusion-base': 0,
      },
    })
    map.addLayer({
      id: 'bldg-highlight-outline',
      type: 'line',
      source: BLDG_SRC,
      filter: ['==', 'id', selectedBuildingId],
      paint: { 'line-color': '#FFFFFF', 'line-width': 3 },
    })
  }, [selectedBuildingId, mapReady])

  // Reactive buildings sync
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const buildings = graphBuildings
    if (buildings.length === 0) {
      try {
        const src = map.getSource(BLDG_SRC) as maplibregl.GeoJSONSource
        if (src) src.setData({ type: 'FeatureCollection', features: [] })
      } catch {}
      return
    }
    const features: GeoJSON.Feature[] = buildings.map((b) => ({
      type: 'Feature',
      properties: { id: b.id, name: b.name, color: b.color || '#1C6BEB', height: b.height || 15 },
      geometry: {
        type: 'Polygon',
        coordinates: b.footprint.length >= 3
          ? [[...b.footprint.map((p) => [p.lng, p.lat] as [number, number]), [b.footprint[0].lng, b.footprint[0].lat] as [number, number]]]
          : (() => {
              const avg = { lat: b.footprint.reduce((s, p) => s + p.lat, 0) / b.footprint.length, lng: b.footprint.reduce((s, p) => s + p.lng, 0) / b.footprint.length }
              return [[[avg.lng - 0.0003, avg.lat - 0.0003], [avg.lng + 0.0003, avg.lat - 0.0003], [avg.lng + 0.0003, avg.lat + 0.0003], [avg.lng - 0.0003, avg.lat + 0.0003], [avg.lng - 0.0003, avg.lat - 0.0003]]]
            })(),
      },
    }))
    try {
      const src = map.getSource(BLDG_SRC) as maplibregl.GeoJSONSource
      if (src) src.setData({ type: 'FeatureCollection', features })
    } catch {}
  }, [buildingsSeed, graphBuildings, mapReady])

  // Show/hide buildings toggle
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || step !== 'imported') return
    const vis = showBuildings ? 'visible' : 'none'
    ;['bldg-fill', 'bldg-extrusion', 'bldg-outline'].forEach((id) => {
      const l = map.getLayer(id)
      if (l) map.setLayoutProperty(id, 'visibility', vis)
    })
  }, [showBuildings, mapReady, step])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'NAVI/1.0 (campus navigation)' } }
      )
      const data: NominatimResult[] = await res.json()
      setSearchResults(data)
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleSelectLocation = (result: NominatimResult) => {
    const lat = parseFloat(result.lat)
    const lon = parseFloat(result.lon)
    const map = mapRef.current
    if (!map) return

    map.flyTo({ center: [lon, lat], zoom: 17 })

    if (markerRef.current) markerRef.current.remove()
    markerRef.current = new maplibregl.Marker({ color: '#1C6BEB' })
      .setLngLat([lon, lat])
      .addTo(map)

    setSearchResults([])
    setSearchQuery('')
  }

  const handleConfirmAndImport = async () => {
    if (boundaryPoints.length < 3) return
    const centroid = {
      lat: boundaryPoints.reduce((s, p) => s + p.lat, 0) / boundaryPoints.length,
      lng: boundaryPoints.reduce((s, p) => s + p.lng, 0) / boundaryPoints.length,
    }
    const id = createMap({ name, schoolName, campusName: campusName || undefined, boundary: boundaryPoints, center: centroid })
    setMapId(id)

    setImportState('loading')
    setImportResult('')
    try {
      const res = await fetch('/api/osm-buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boundary: boundaryPoints }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Import failed' }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      const bldgs: OsmBuilding[] = data.buildings ?? []

      bldgs.forEach((b, i) => {
        const building: Building = {
          id: b.id, name: `Bldg No. ${i + 1}`, campusId: id, floors: [0],
          footprint: b.footprint, baseElevation: 0,
          height: b.height, color: b.color, center: b.center,
        }
        addBuilding(building)
      })
      const added = bldgs.length

      useGraphStore.getState().setCurrentMapId(id)
      save()
      updateMapStats(id, { buildings: added })
      setImportedCount(added)
      setImportState('success')
      setImportResult(added > 0 ? `Imported ${added} buildings from OSM` : 'No buildings found in this area')
      setBuildingsSeed((v) => v + 1)
      setStep('imported')
    } catch (err) {
      setImportState('error')
      setImportResult(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleCancelBoundary = () => {
    setBoundaryPoints([])
  }

  const handleDeleteBuilding = () => {
    if (!selectedBuildingId) return
    removeBuilding(selectedBuildingId)
    setSelectedBuildingId(null)
    save()
    setBuildingsSeed((v) => v + 1)
  }

  const handleUpdateBuilding = (partial: Partial<Building>) => {
    if (!selectedBuildingId) return
    updateBuilding(selectedBuildingId, partial)
    save()
    setBuildingsSeed((v) => v + 1)
  }

  const canSubmitInfo = name.trim() && schoolName.trim()

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {step === 'info' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navi-text)', margin: 0 }}>Create New Map</h2>
              <p style={{ color: 'var(--navi-text-secondary)', fontSize: 12, margin: '4px 0 0' }}>
                Enter the details of your campus map
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)' }}>Map Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Main Campus"
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--navi-border)',
                  background: 'var(--navi-card)',
                  color: 'var(--navi-text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)' }}>School Name *</label>
              <input
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="e.g., Aklan State University"
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--navi-border)',
                  background: 'var(--navi-card)',
                  color: 'var(--navi-text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)' }}>Campus (optional)</label>
              <input
                value={campusName}
                onChange={(e) => setCampusName(e.target.value)}
                placeholder="e.g., Ibajay Campus"
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--navi-border)',
                  background: 'var(--navi-card)',
                  color: 'var(--navi-text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => router.push('/studio')}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--navi-border)',
                  background: 'var(--navi-card)',
                  color: 'var(--navi-text-secondary)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('map')}
                disabled={!canSubmitInfo}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6,
                  border: 'none',
                  background: canSubmitInfo ? 'var(--navi-primary)' : 'var(--navi-border)',
                  color: canSubmitInfo ? '#fff' : 'var(--navi-text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: canSubmitInfo ? 'pointer' : 'default',
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* Imported step top bar */}
          {step === 'imported' && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--navi-card)', padding: '8px 16px', borderRadius: 8, border: '1px solid var(--navi-border)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
                <span style={{ fontSize: 11, color: 'var(--navi-text-secondary)' }}>
                  <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  <strong style={{ color: '#10B981' }}>{importedCount || graphBuildings.length}</strong> buildings imported
                </span>
                <span style={{ color: 'var(--navi-border)' }}>|</span>
                <button onClick={() => setShowBuildings(!showBuildings)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 4, border: 'none', background: showBuildings ? 'var(--navi-primary)' : 'var(--navi-content)', color: showBuildings ? '#fff' : 'var(--navi-text-secondary)', fontSize: 10, cursor: 'pointer' }}>
                  {showBuildings ? <Eye size={12} /> : <EyeOff size={12} />}
                  {showBuildings ? 'Visible' : 'Hidden'}
                </button>
              </div>
            </div>
          )}

          {/* Map step search bar */}
          {step === 'map' && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: 12, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', gap: 8, maxWidth: 480, margin: '0 auto' }}>
                <div style={{ flex: 1, display: 'flex', background: 'var(--navi-card)', borderRadius: 8, border: '1px solid var(--navi-border)', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search location..."
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--navi-text)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    style={{
                      padding: '8px 12px',
                      border: 'none',
                      background: 'var(--navi-primary)',
                      color: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Search size={14} />
                  </button>
                </div>
                <button
                  onClick={() => { if (mapRef.current) mapRef.current.remove(); router.push('/studio') }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--navi-border)',
                    background: 'var(--navi-card)',
                    color: 'var(--navi-text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  <ArrowLeft size={14} /> Back
                </button>
              </div>
            </div>
          )}

          {/* Search results dropdown */}
          {step === 'map' && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 400, background: 'var(--navi-card)', border: '1px solid var(--navi-border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
              {searchResults.map((result, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectLocation(result)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    borderBottom: i < searchResults.length - 1 ? '1px solid var(--navi-content)' : 'none',
                    background: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 11,
                    color: 'var(--navi-text)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--navi-content)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                >
                  <MapPin size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--navi-primary)' }} />
                  <span>{result.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Boundary status */}
          {step === 'map' && (
            <div style={{ position: 'absolute', top: 52, left: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ background: 'var(--navi-card)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--navi-border)', fontSize: 10, color: 'var(--navi-text-secondary)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                Click on the map to add boundary points
              </div>
              {boundaryPoints.length > 0 && (
                <div style={{ background: 'var(--navi-card)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--navi-border)', fontSize: 10, color: '#F97316', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                  {boundaryPoints.length} point{boundaryPoints.length !== 1 ? 's' : ''} placed
                  {boundaryPoints.length < 3 ? ` — need ${3 - boundaryPoints.length} more` : ' — boundary ready'}
                </div>
              )}
            </div>
          )}

          {/* Import status toast */}
          {importState !== 'idle' && (
            <div style={{ position: 'absolute', top: 52, right: 12, zIndex: 10, maxWidth: 300 }}>
              <div style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--navi-border)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, background: importState === 'error' ? '#FEF2F2' : '#F0FDF4', color: importState === 'error' ? '#EF4444' : '#10B981' }}>
                {importState === 'error' ? <X size={14} /> : <Check size={14} />}
                {importResult}
              </div>
            </div>
          )}

          {/* Import buttons */}
          {step === 'map' && (
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: 8 }}>
              <button
                onClick={handleCancelBoundary}
                disabled={boundaryPoints.length === 0}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: '1px solid var(--navi-border)',
                  background: boundaryPoints.length === 0 ? 'var(--navi-content)' : 'var(--navi-card)',
                  color: boundaryPoints.length === 0 ? 'var(--navi-text-secondary)' : '#EF4444',
                  cursor: boundaryPoints.length === 0 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  opacity: boundaryPoints.length === 0 ? 0.5 : 1,
                }}
              >
                <X size={16} /> Clear Points
              </button>
              <button
                onClick={handleConfirmAndImport}
                disabled={boundaryPoints.length < 3 || importState === 'loading'}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: 'none',
                  background: boundaryPoints.length >= 3 && importState !== 'loading' ? '#10B981' : 'var(--navi-border)',
                  color: boundaryPoints.length >= 3 && importState !== 'loading' ? '#fff' : 'var(--navi-text-secondary)',
                  cursor: boundaryPoints.length >= 3 && importState !== 'loading' ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow: boundaryPoints.length >= 3 ? '0 2px 8px rgba(16,185,129,0.3)' : 'none',
                  opacity: importState === 'loading' ? 0.7 : 1,
                }}
              >
                {importState === 'loading' ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={16} />}
                {importState === 'loading' ? 'Importing from OSM...' : 'Confirm & Import Buildings'}
              </button>
            </div>
          )}

          {/* Map + metadata panel row */}
          <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
            <div ref={mapContainerRef} style={{ flex: 1 }} />

            {/* Metadata panel — appears on right when imported */}
            {step === 'imported' && (
              <div style={{ width: 280, borderLeft: '1px solid var(--navi-border)', background: 'var(--navi-card)', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--navi-border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Building Properties</div>
                </div>
                {selectedBuilding ? (
                  <BuildingMetadataForm building={selectedBuilding} onUpdate={handleUpdateBuilding} onDelete={handleDeleteBuilding} />
                ) : (
                  <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 11, color: 'var(--navi-text-secondary)' }}>
                    Click a building on the map to edit its properties
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Imported bottom bar */}
          {step === 'imported' && mapId && (
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
              <div style={{ display: 'flex', gap: 8, background: 'var(--navi-card)', padding: '10px 20px', borderRadius: 8, border: '1px solid var(--navi-border)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', fontSize: 11, color: 'var(--navi-text-secondary)', alignItems: 'center' }}>
                <Check size={14} style={{ color: '#10B981' }} />
                Campus map &quot;{name}&quot; created with {importedCount || graphBuildings.length} building{importedCount !== 1 ? 's' : ''}
                <button onClick={() => { if (mapRef.current) mapRef.current.remove(); router.push(`/studio/${mapId}/edit`) }}
                  style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}>
                  Continue to Editor →
                </button>
              </div>
            </div>
          )}

          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}
    </div>
  )
}


