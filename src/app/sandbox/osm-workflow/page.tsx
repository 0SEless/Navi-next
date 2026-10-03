'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useCampusMapStore } from '@/store/campus-map-store'
import { useGraphStore } from '@/store/graph-store'
import { Search, Check, X, MapPin, Download, Loader2, Eye, EyeOff, Building2, Trash2 } from 'lucide-react'
import type { Building } from '@/types/nav-types'

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

const BLDG_SRC = 'workflow-buildings'

const COLOR_SWATCHES = [
  '#1C6BEB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316',
  '#6366F1', '#84CC16', '#0EA5E9', '#D946EF', '#FB923C',
]

interface NominatimResult {
  display_name: string; lat: string; lon: string
}

type WorkflowStep = 'info' | 'map' | 'imported'

interface OsmBuilding {
  id: string; name: string; footprint: { lat: number; lng: number }[]
  height: number; color: string; center: { lat: number; lng: number }
}

export default function OsmWorkflowSandbox() {
  const createMap = useCampusMapStore((s) => s.createMap)
  const addBuilding = useGraphStore((s) => s.addBuilding)
  const removeBuilding = useGraphStore((s) => s.removeBuilding)
  const updateBuilding = useGraphStore((s) => s.updateBuilding)
  const save = useGraphStore((s) => s.save)
  const graph = useGraphStore((s) => s.graph)
  const graphBuildings = graph.buildings

  const [step, setStep] = useState<WorkflowStep>('info')
  const [name, setName] = useState('')
  const [schoolName, setSchoolName] = useState('')
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
  const boundarySrcId = 'workflow-boundary'

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
      map.addSource(boundarySrcId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({ id: 'b-fill', type: 'fill', source: boundarySrcId, paint: { 'fill-color': '#F97316', 'fill-opacity': 0.15 } })
      map.addLayer({ id: 'b-line', type: 'line', source: boundarySrcId, paint: { 'line-color': '#F97316', 'line-width': 3, 'line-dasharray': [4, 4] } })
      map.addLayer({ id: 'b-verts', type: 'circle', source: boundarySrcId, paint: { 'circle-radius': 6, 'circle-color': '#F97316', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' } })

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
    return () => { map.off('click', handleClick) }
  }, [mapReady, step])

  // Boundary render
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource(boundarySrcId) as maplibregl.GeoJSONSource
    if (!src) return
    const pts = boundaryPoints
    const features: GeoJSON.Feature[] = []
    if (pts.length >= 1) {
      for (const p of pts) {
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {} })
      }
    }
    if (pts.length >= 2) {
      const coords = pts.map((p) => [p.lng, p.lat])
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.length >= 3 ? [...coords, coords[0]] : coords }, properties: {} })
    }
    if (pts.length >= 3) {
      const coords = pts.map((p) => [p.lng, p.lat])
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }, properties: {} })
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
    return () => { map.off('click', handleClick) }
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
    return () => { map.off('mousemove', handleMove) }
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
  }, [buildingsSeed, mapReady])

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
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'NAVI/1.0' } })
      setSearchResults(await res.json())
    } catch { setSearchResults([]) }
    finally { setSearching(false) }
  }

  const handleSelectLocation = (result: NominatimResult) => {
    const lat = parseFloat(result.lat); const lon = parseFloat(result.lon)
    mapRef.current?.flyTo({ center: [lon, lat], zoom: 17 })
    setSearchResults([]); setSearchQuery('')
  }

  const handleConfirmAndImport = async () => {
    if (boundaryPoints.length < 3) return
    const centroid = {
      lat: boundaryPoints.reduce((s, p) => s + p.lat, 0) / boundaryPoints.length,
      lng: boundaryPoints.reduce((s, p) => s + p.lng, 0) / boundaryPoints.length,
    }
    const id = createMap({ name, schoolName, boundary: boundaryPoints, center: centroid })
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
      if (bldgs.length === 0) {
        setImportState('success')
        setImportResult('No buildings found in this area')
        setStep('imported')
        return
      }

      let added = 0
      for (const b of bldgs) {
        const building: Building = {
          id: b.id, name: b.name, campusId: id, floors: [0],
          footprint: b.footprint, baseElevation: 0,
          height: b.height, color: b.color, center: b.center,
        }
        addBuilding(building)
        added++
      }


      setImportedCount(added)
      setImportState('success')
      setImportResult(`Imported ${added} buildings from OSM`)
      setBuildingsSeed((v) => v + 1)
      setStep('imported')
    } catch (err) {
      setImportState('error')
      setImportResult(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleCancelBoundary = () => setBoundaryPoints([])

  const handleStartOver = () => {
    mapRef.current?.remove()
    mapRef.current = null
    setMapReady(false)
    setBoundaryPoints([])
    setImportState('idle')
    setImportResult('')
    setShowBuildings(true)
    setSelectedBuildingId(null)
    setBuildingsSeed(0)
    setStep('info')
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
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', fontFamily: 'monospace' }}>
      {/* Info overlay */}
      {step === 'info' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A' }}>
          <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F1F5F9', margin: 0 }}>OSM Workflow Prototype</h2>
              <p style={{ color: '#94A3B8', fontSize: 12, margin: '4px 0 0' }}>
                Create a campus map, draw boundary, auto-import buildings from OSM
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>Map Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Main Campus"
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #334155', background: '#1E293B', color: '#F1F5F9', fontSize: 13, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>School Name *</label>
              <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g., Aklan State University"
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #334155', background: '#1E293B', color: '#F1F5F9', fontSize: 13, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setStep('map')} disabled={!canSubmitInfo}
                style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: canSubmitInfo ? '#1C6BEB' : '#334155', color: canSubmitInfo ? '#fff' : '#64748B', fontSize: 12, fontWeight: 600, cursor: canSubmitInfo ? 'pointer' : 'default' }}>
                Next — Set Boundary
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map overlay UI */}
      {step !== 'info' && (
        <>
          {/* Imported step top bar */}
          {step === 'imported' && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#1E293B', padding: '8px 16px', borderRadius: 8, border: '1px solid #334155', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
                <span style={{ fontSize: 11, color: '#94A3B8' }}>
                  <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  <strong style={{ color: '#6EE7B7' }}>{importedCount || graphBuildings.length}</strong> buildings imported
                </span>
                <span style={{ color: '#334155' }}>|</span>
                <button onClick={() => setShowBuildings(!showBuildings)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 4, border: 'none', background: showBuildings ? '#1C6BEB' : '#334155', color: '#fff', fontSize: 10, cursor: 'pointer' }}>
                  {showBuildings ? <Eye size={12} /> : <EyeOff size={12} />}
                  {showBuildings ? 'Visible' : 'Hidden'}
                </button>
                <span style={{ color: '#334155' }}>|</span>
                <button onClick={handleStartOver}
                  style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: '#334155', color: '#94A3B8', fontSize: 10, cursor: 'pointer' }}>
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* Imported step bottom bar */}
          {step === 'imported' && (
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
              <div style={{ display: 'flex', gap: 8, background: '#1E293B', padding: '10px 20px', borderRadius: 8, border: '1px solid #334155', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', fontSize: 11, color: '#94A3B8', alignItems: 'center' }}>
                <Check size={14} style={{ color: '#10B981' }} />
                Campus map &quot;{name}&quot; created with {importedCount || graphBuildings.length} building{importedCount !== 1 ? 's' : ''}
                {mapId && <span style={{ color: '#475569' }}> — ID: {mapId}</span>}
              </div>
            </div>
          )}

          {/* Map step search bar */}
          {step === 'map' && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: 12, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', gap: 8, maxWidth: 520, margin: '0 auto' }}>
                <div style={{ flex: 1, display: 'flex', background: '#1E293B', borderRadius: 8, border: '1px solid #334155', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
                  <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search location & fly to..."
                    style={{ flex: 1, padding: '8px 12px', border: 'none', background: 'transparent', color: '#F1F5F9', fontSize: 12, outline: 'none' }} />
                  <button onClick={handleSearch} disabled={searching}
                    style={{ padding: '8px 12px', border: 'none', background: '#1C6BEB', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Search size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search results dropdown */}
          {step === 'map' && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 420, background: '#1E293B', border: '1px solid #334155', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => handleSelectLocation(r)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', padding: '8px 12px', border: 'none', borderBottom: i < searchResults.length - 1 ? '1px solid #334155' : 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11, color: '#F1F5F9' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#334155' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
                  <MapPin size={12} style={{ flexShrink: 0, marginTop: 1, color: '#1C6BEB' }} />
                  <span>{r.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Boundary step status */}
          {step === 'map' && (
            <div style={{ position: 'absolute', top: 52, left: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ background: '#1E293B', padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', fontSize: 10, color: '#94A3B8', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                Click on the map to add boundary points
              </div>
              {boundaryPoints.length > 0 && (
                <div style={{ background: '#1E293B', padding: '6px 10px', borderRadius: 6, border: '1px solid #334155', fontSize: 10, color: '#F97316', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                  {boundaryPoints.length} point{boundaryPoints.length !== 1 ? 's' : ''} placed
                  {boundaryPoints.length < 3 ? ` — need ${3 - boundaryPoints.length} more` : ' — boundary ready'}
                </div>
              )}
            </div>
          )}

          {/* Import buttons */}
          {step === 'map' && (
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: 8 }}>
              <button onClick={handleCancelBoundary} disabled={boundaryPoints.length === 0}
                style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #334155', background: boundaryPoints.length === 0 ? '#0F172A' : '#1E293B', color: boundaryPoints.length === 0 ? '#475569' : '#EF4444', cursor: boundaryPoints.length === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, boxShadow: '0 2px 12px rgba(0,0,0,0.3)', opacity: boundaryPoints.length === 0 ? 0.5 : 1 }}>
                <X size={16} /> Clear Points
              </button>
              <button onClick={handleConfirmAndImport} disabled={boundaryPoints.length < 3 || importState === 'loading'}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: boundaryPoints.length >= 3 && importState !== 'loading' ? '#10B981' : '#334155', color: boundaryPoints.length >= 3 && importState !== 'loading' ? '#fff' : '#64748B', cursor: boundaryPoints.length >= 3 && importState !== 'loading' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, boxShadow: boundaryPoints.length >= 3 ? '0 2px 12px rgba(16,185,129,0.3)' : 'none', opacity: importState === 'loading' ? 0.7 : 1 }}>
                {importState === 'loading' ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={16} />}
                {importState === 'loading' ? 'Importing from OSM...' : 'Confirm & Import Buildings'}
              </button>
            </div>
          )}

          {/* Import status toast */}
          {importState !== 'idle' && (
            <div style={{ position: 'absolute', top: 52, right: 12, zIndex: 10, maxWidth: 300 }}>
              <div style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #334155', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, background: importState === 'error' ? '#450A0A' : '#064E3B', color: importState === 'error' ? '#FCA5A5' : '#6EE7B7' }}>
                {importState === 'error' ? <X size={14} /> : <Check size={14} />}
                {importResult}
              </div>
            </div>
          )}
        </>
      )}

      {/* Map + Panel row */}
      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        {/* Map container — always mounted */}
        <div ref={mapContainerRef} style={{ flex: 1 }} />

        {/* Metadata panel — appears on right when imported */}
        {step === 'imported' && (
          <div style={{ width: 300, borderLeft: '1px solid #334155', background: '#0F172A', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #334155' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Building Properties</div>
            </div>
            {selectedBuilding ? (
              <MetadataForm building={selectedBuilding} onUpdate={handleUpdateBuilding} onDelete={handleDeleteBuilding} />
            ) : (
              <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 11, color: '#475569' }}>
                Click a building on the map to edit its properties
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function MetadataForm({ building, onUpdate, onDelete }: {
  building: Building
  onUpdate: (partial: Partial<Building>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(building.name)
  const [height, setHeight] = useState(building.height)
  const [floors, setFloors] = useState(building.floors.length)
  const [color, setColor] = useState(building.color || '#1C6BEB')

  useEffect(() => {
    setName(building.name)
    setHeight(building.height)
    setFloors(building.floors.length)
    setColor(building.color || '#1C6BEB')
  }, [building.id, building.name, building.height, building.floors.length, building.color])

  const handleSave = () => {
    onUpdate({ name, height, floors: Array.from({ length: floors }, (_, i) => i), color })
  }

  return (
    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="NAME">
        <input value={name} onChange={(e) => setName(e.target.value)}
          style={INPUT_STYLE} />
      </Field>

      <Field label="HEIGHT">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StepBtn onClick={() => setHeight(Math.max(1, height - 1))}>-</StepBtn>
          <input value={height} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setHeight(v) }}
            style={{ ...INPUT_STYLE, width: 44, textAlign: 'center' }} />
          <span style={{ fontSize: 10, color: '#64748B' }}>m</span>
          <StepBtn onClick={() => setHeight(height + 1)}>+</StepBtn>
        </div>
      </Field>

      <Field label="FLOORS">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StepBtn onClick={() => setFloors(Math.max(1, floors - 1))}>-</StepBtn>
          <input value={floors} onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setFloors(v) }}
            style={{ ...INPUT_STYLE, width: 44, textAlign: 'center' }} />
          <StepBtn onClick={() => setFloors(floors + 1)}>+</StepBtn>
        </div>
      </Field>

      <Field label="COLOR">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {COLOR_SWATCHES.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 24, height: 24, borderRadius: 4, background: c, border: color === c ? '2px solid #F1F5F9' : '1px solid #334155', cursor: 'pointer' }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
            style={{ width: 24, height: 24, padding: 0, border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', background: 'none' }} />
        </div>
      </Field>

      <Field label="ID">
        <div style={{ fontSize: 10, color: '#475569', wordBreak: 'break-all' }}>{building.id}</div>
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={handleSave}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', background: '#1C6BEB', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Save Changes
        </button>
        <button onClick={onDelete}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 6, border: '1px solid #EF4444', background: 'transparent', color: '#EF4444', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#64748B', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function StepBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #334155', background: '#1E293B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F1F5F9', fontSize: 14 }}>
      {children}
    </button>
  )
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '5px 8px', borderRadius: 4, border: '1px solid #334155',
  background: '#1E293B', color: '#F1F5F9', fontSize: 12, outline: 'none', width: '100%',
}
