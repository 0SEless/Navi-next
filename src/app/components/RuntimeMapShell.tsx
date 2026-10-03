'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { RuntimeEngine } from '@navi/runtime/engine'
import type { LoadedPackage, Route, CurrentPosition } from '@navi/runtime'
import { BlueDot } from './RuntimeMap/BlueDot'
import { RouteOverlay } from './RuntimeMap/RouteOverlay'
import { InstructionPanel } from './RuntimeMap/InstructionPanel'
import { BuildingSelector } from './RuntimeMap/BuildingSelector'

interface Props {
  baseUrl: string
}

async function fetcher(base: string, file: string) {
  const res = await fetch(`${base}${file}`)
  if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`)
  return res.json()
}

export function RuntimeMapShell({ baseUrl }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<RuntimeEngine | null>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [position, setPosition] = useState<CurrentPosition | null>(null)
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null)
  const mapContainer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    (async () => {
      try {
        const [graph, searchIndex, buildingIndex, poiIndex] = await Promise.all([
          fetcher(baseUrl, 'navigation.graph.json'), fetcher(baseUrl, 'search.index.json'),
          fetcher(baseUrl, 'building-index.json'), fetcher(baseUrl, 'poi.json'),
        ])
        const pkg: LoadedPackage = {
          manifest: {
            schemaVersion: '1.0.0', formatVersion: '0', campusId: '', campusName: '',
            publishedAt: '', compilerVersion: '', revision: '',
            artifacts: {}, metadata: { nodeCount: 0, edgeCount: 0, buildingCount: 0, floorCount: 0, boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 }, routeable: false },
          },
          graph, searchIndex, buildingIndex, poiIndex, reports: [], warnings: [],
        }
        setEngine(new RuntimeEngine(pkg))
      } catch (e: unknown) {
        setError((e as Error).message)
      }
    })()
  }, [baseUrl])

  useEffect(() => {
    if (!engine || !mapContainer.current) return
    const bb = engine.data.getBoundingBox()
    const center: [number, number] = [(bb.minLng + bb.maxLng) / 2, (bb.minLat + bb.maxLat) / 2]
    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center,
      zoom: 15,
    })
    m.addControl(new maplibregl.NavigationControl())
    m.fitBounds([[bb.minLng, bb.minLat], [bb.maxLng, bb.maxLat]], { padding: 50 })
    setMap(m)
    const centerLatLng = { lng: (bb.minLng + bb.maxLng) / 2, lat: (bb.minLat + bb.maxLat) / 2 }
    const snap = engine.location.snapToNode(centerLatLng)
    setPosition({
      latlng: centerLatLng,
      nodeId: snap?.node.id ?? '',
      floor: snap?.node.floor ?? 0,
      buildingId: snap?.node.buildingId ?? '',
      heading: 0,
      accuracy: 10,
    })
    return () => { try { m.remove() } catch {} }
  }, [engine])

  const findRoute = useCallback((from: string, to: string) => {
    if (!engine) return
    setRoute(engine.navigation.findRoute(from, to))
  }, [engine])

  const clearRoute = useCallback(() => setRoute(null), [])

  if (error) {
    return <div style={{ padding: 24, color: 'red' }}>Failed to load campus: {error}</div>
  }

  if (!engine) {
    return <div style={{ padding: 24 }}>Loading campus...</div>
  }

  const buildings = engine.data.getBuildings()?.buildings ?? []

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <BuildingSelector
          buildings={buildings}
          selected={selectedBuilding}
          onSelect={setSelectedBuilding}
        />
        {position && (
          <button
            onClick={() => {
              const dest = engine.navigation.nearestEntrance(position.latlng) ?? engine.navigation.nearestNode(position.latlng)
              findRoute(position.nodeId, dest?.nodeId ?? '')
            }}
            style={{
              padding: '8px 12px', borderRadius: 6, border: '1px solid var(--navi-border)',
              fontSize: 14, background: 'var(--navi-card)', color: 'var(--navi-text)', cursor: 'pointer',
            }}
          >
            Route from here
          </button>
        )}
      </div>
      <InstructionPanel route={route} onClose={clearRoute} />
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {map && <BlueDot map={map} position={position} />}
      {map && <RouteOverlay map={map} route={route} />}
    </div>
  )
}
