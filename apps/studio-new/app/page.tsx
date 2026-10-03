'use client'

/**
 * Studio New — Stage 4.5: Editing Pipeline
 *
 * The only legal mutation path for CampusDocument:
 *
 *   Inspector (dumb view)
 *        │
 *        ▼
 *   InspectorController
 *        │
 *        ▼
 *   CommandBus
 *        │
 *        ▼
 *   CampusDocument  ◄── Handlers mutate in-place
 *        │
 *        ├──► EntityRenderer.sync()
 *        ├──► CompilerService → NavigationGraphRenderer.sync()
 *        └──► React re-render (Inspector, stats)
 *
 * Nothing bypasses CommandBus.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type maplibregl from 'maplibre-gl'
import { MapCanvas } from '../components/MapCanvas'
import { EntityRenderer } from '../lib/entity-renderer'
import { NavigationGraphRenderer } from '../lib/navigation-graph-renderer'
import { compileDocument } from '../lib/compiler-service'
import { loadOrCreateDocument } from '../lib/persistence'
import type { CampusDocument } from '@navi/core'
import { SelectionManager } from '../lib/selection/selection-manager'
import { hitTest } from '../lib/selection/hit-test'
import { HighlightOverlay } from '../lib/selection/highlight-overlay'
import { SnapOverlay } from '../lib/selection/snap-overlay'
import { Inspector } from '../components/Inspector'
import { CommandBus } from '../lib/commands/command-bus'
import { CommandHistory } from '../lib/commands/command-history'
import {
  entityUpdateHandler,
  entityCreateHandler,
  entityDeleteHandler,
} from '../lib/commands/entity-handlers'
import { InspectorController } from '../lib/commands/inspector-controller'

export default function StudioPage() {
  // ── Document state ──
  const [doc, setDoc] = useState<CampusDocument | null>(null)
  const docRef = useRef<CampusDocument | null>(null)
  const [docInfo, setDocInfo] = useState('Loading...')
  const [graphInfo, setGraphInfo] = useState('')

  // ─- Version counter (triggers React re-render after command execution) ──
  const [version, setVersion] = useState(0)

  // ── Renderer refs ──
  const entityRendererRef = useRef<EntityRenderer | null>(null)
  const graphRendererRef = useRef<NavigationGraphRenderer | null>(null)
  const highlightRef = useRef<HighlightOverlay | null>(null)
  const snapOverlayRef = useRef<SnapOverlay | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [showGraph, setShowGraph] = useState(true)

  // ─- Services (created once, live for page lifetime) ──
  const [selectionManager] = useState(() => new SelectionManager())
  const [commandBus] = useState(() => new CommandBus(null as unknown as CampusDocument))
  const [commandHistory] = useState(() => new CommandHistory())
  const [inspectorController] = useState(() => new InspectorController(commandBus))

  // Register command handlers once
  useEffect(() => {
    commandBus.register(entityUpdateHandler)
    commandBus.register(entityCreateHandler)
    commandBus.register(entityDeleteHandler)
  }, [commandBus])

  // ── Load document on mount ──
  useEffect(() => {
    const d = loadOrCreateDocument()
    if (!d || (d.buildings.length === 0 && d.roads.length === 0)) {
      const sample = createSampleDocument()
      setDoc(sample)
      docRef.current = sample
      commandBus.setDocument(sample)
      setDocInfo(`${sample.metadata.name} — ${sample.buildings.length} building(s)`)
    } else {
      setDoc(d)
      docRef.current = d
      commandBus.setDocument(d)
      setDocInfo(`${d.metadata.name} — ${d.buildings.length} building(s)`)
    }
  }, [commandBus])

  // ── Wire undo/redo history: snapshot before each command ──
  useEffect(() => {
    const unsub = commandBus.onBeforeExecute(() => {
      const d = docRef.current
      if (d) commandHistory.push(d)
    })
    return unsub
  }, [commandBus, commandHistory])

  // ── Subscribe to command execution: re-sync renderers ──
  useEffect(() => {
    const unsub = commandBus.onDidExecute(() => {
      const d = docRef.current
      if (!d) return

      // Re-sync EntityRenderer
      entityRendererRef.current?.sync(d)

      // Re-sync HighlightOverlay
      highlightRef.current?.setDocument(d)

      // Re-sync SnapOverlay
      snapOverlayRef.current?.sync(d)

      // Re-compile graph
      const result = compileDocument(d)
      graphRendererRef.current?.sync(result.graph)
      setGraphInfo(`${result.nodeCount} node(s), ${result.edgeCount} edge(s) — ${result.duration.toFixed(0)}ms`)

      // Trigger React re-render (Inspector reads updated doc props)
      setVersion(v => v + 1)
    })
    return unsub
  }, [commandBus])

  // ─- Initial graph compile when doc loads ──
  useEffect(() => {
    if (!doc) return
    const result = compileDocument(doc)
    setGraphInfo(`${result.nodeCount} node(s), ${result.edgeCount} edge(s) — ${result.duration.toFixed(0)}ms`)
  }, [doc])

  // ── Wire renderers when map is ready ──
  const handleMapReady = useCallback((map: maplibregl.Map) => {
    const d = docRef.current
    if (!d) return
    mapRef.current = map

    // Clean up previous renderers
    entityRendererRef.current?.destroy()
    graphRendererRef.current?.destroy()
    highlightRef.current?.destroy()

    // EntityRenderer — authored data (navi-*)
    const entityRenderer = new EntityRenderer(map)
    entityRenderer.init()
    entityRenderer.sync(d)
    entityRendererRef.current = entityRenderer

    // NavigationGraphRenderer — compiled data (navg-*)
    const result = compileDocument(d)
    const graphRenderer = new NavigationGraphRenderer(map)
    graphRenderer.init()
    graphRenderer.sync(result.graph)
    if (!showGraph) graphRenderer.setVisible(false)
    graphRendererRef.current = graphRenderer

    // Highlight overlay — observes SelectionManager
    const highlight = new HighlightOverlay(map, selectionManager, d)
    highlight.init()
    highlightRef.current = highlight

    // Snap overlay — visual snap indicator
    const snapOverlay = new SnapOverlay(map)
    snapOverlay.init()
    snapOverlay.sync(d)
    snapOverlayRef.current = snapOverlay

    // Canvas mousemove → snap indicator
    map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      snapOverlay.updateSnap({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    // Canvas click → hit-test → SelectionManager
    const handleClick = (e: maplibregl.MapMouseEvent & { originalEvent?: MouseEvent }) => {
      const hit = hitTest(map, e.point)
      if (!hit) {
        selectionManager.clear()
      } else if (e.originalEvent?.shiftKey) {
        selectionManager.toggle(hit)
      } else {
        selectionManager.select(hit)
      }
    }
    map.on('click', handleClick)

    return () => {
      map.off('click', handleClick)
    }
  }, [selectionManager, showGraph])

  // ── Toggle graph overlay ──
  const handleToggleGraph = useCallback(() => {
    setShowGraph(prev => {
      const next = !prev
      graphRendererRef.current?.setVisible(next)
      return next
    })
  }, [])

  // ── Clear selection (used by button + keyboard) ──
  const handleClearSelection = useCallback(() => {
    selectionManager.clear()
  }, [selectionManager])

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      const selected = selectionManager.selected

      switch (e.key) {
        case 'Delete':
        case 'Backspace': {
          if (selected) {
            e.preventDefault()
            inspectorController.deleteEntity(selected)
            selectionManager.clear()
          }
          break
        }
        case 'Escape': {
          selectionManager.clear()
          break
        }
        case 'z':
        case 'Z': {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const doc = docRef.current
            const changed = e.shiftKey ? commandHistory.redo(doc) : commandHistory.undo(doc)
            if (changed && doc) {
              entityRendererRef.current?.sync(doc)
              highlightRef.current?.setDocument(doc)
              snapOverlayRef.current?.sync(doc)
              const result = compileDocument(doc)
              graphRendererRef.current?.sync(result.graph)
              setGraphInfo(`${result.nodeCount} node(s), ${result.edgeCount} edge(s) — ${result.duration.toFixed(0)}ms`)
              setVersion(v => v + 1)
            }
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectionManager, inspectorController, commandHistory])

  const docForRender = docRef.current

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        height: 44, background: '#1e293b', color: '#94a3b8',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: 600,
        letterSpacing: '0.05em', flexShrink: 0, gap: 16,
      }}>
        <span>NAVI STUDIO — Stage 4.5</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#64748b' }}>{docInfo}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleClearSelection}
            style={{
              padding: '4px 10px', borderRadius: 4, border: '1px solid #475569',
              background: 'transparent', color: '#94a3b8', fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={handleToggleGraph}
            style={{
              padding: '4px 12px', borderRadius: 4, border: '1px solid',
              borderColor: showGraph ? '#3B82F6' : '#475569',
              background: showGraph ? '#1e3a5f' : 'transparent',
              color: showGraph ? '#93c5fd' : '#64748b',
              fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 14 }}>{showGraph ? '◉' : '○'}</span>
            Graph: {graphInfo}
          </button>
        </div>
      </div>

      {/* Main content: map + inspector */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <MapCanvas onMapReady={handleMapReady} />
        </div>
        {/* Inspector — passive observer of SelectionManager */}
        {docForRender && (
          <Inspector
            selectionManager={selectionManager}
            document={docForRender}
            controller={inspectorController}
            docVersion={version}
          />
        )}
      </div>
    </div>
  )
}

/** Sample document for demo purposes. */
function createSampleDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      name: 'Demo Campus',
      description: 'Sample campus for Stage 4 verification',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [
      {
        id: 'bldg-1',
        name: 'Engineering Building',
        code: 'ENG',
        category: 'academic',
        description: 'Main engineering facility',
        floors: [
          {
            id: 'flr-eng-0',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            height: 4,
            connectorStops: [],
            parametricComponents: [],
            rooms: [
              {
                id: 'room-101',
                name: 'Room 101',
                number: '101',
                category: 'classroom',
                polygon: { points: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 20 }, { x: 5, y: 20 }] },
                capacity: 40,
                roomDoors: [],
                metadata: {},
              },
              {
                id: 'room-102',
                name: 'Room 102',
                number: '102',
                category: 'lab',
                polygon: { points: [{ x: 30, y: 5 }, { x: 50, y: 5 }, { x: 50, y: 20 }, { x: 30, y: 20 }] },
                capacity: 30,
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [
              {
                id: 'hw-eng-main',
                name: 'Main Hallway',
                polyline: { points: [{ x: 0, y: 25 }, { x: 55, y: 25 }, { x: 55, y: 30 }, { x: 0, y: 30 }] },
                width: 3,
              },
            ],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'ent-eng-1', label: 'Main Entrance', position: { lat: 11.8199, lng: 122.0925 }, level: 0, type: 'main', hasQR: false, hasPanorama: false },
            ],
            metadata: {},
          },
          {
            id: 'flr-eng-1',
            level: 1,
            label: 'Second Floor',
            elevation: 4,
            height: 4,
            connectorStops: [],
            parametricComponents: [],
            rooms: [
              {
                id: 'room-201',
                name: 'Room 201',
                number: '201',
                category: 'classroom',
                polygon: { points: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 20 }, { x: 5, y: 20 }] },
                capacity: 40,
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
            metadata: {},
          },
        ],
        footprint: { points: [{ lat: 11.8195, lng: 122.0920 }, { lat: 11.8195, lng: 122.0930 }, { lat: 11.8205, lng: 122.0930 }, { lat: 11.8205, lng: 122.0920 }] },
        baseElevation: 0,
        height: 8,
        color: '#4A90D9',
        aliases: [],
        verticalConnectors: [],
        metadata: {},
      },
      {
        id: 'bldg-2',
        name: 'Library',
        code: 'LIB',
        category: 'library',
        description: 'Campus library',
        floors: [
          {
            id: 'flr-lib-0',
            level: 0,
            label: 'Ground Floor',
            elevation: 0,
            height: 4,
            connectorStops: [],
            parametricComponents: [],
            rooms: [],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
            metadata: {},
          },
        ],
        footprint: { points: [{ lat: 11.8190, lng: 122.0910 }, { lat: 11.8190, lng: 122.0918 }, { lat: 11.8196, lng: 122.0918 }, { lat: 11.8196, lng: 122.0910 }] },
        baseElevation: 0,
        height: 12,
        color: '#8B4513',
        aliases: [],
        verticalConnectors: [],
        metadata: {},
      },
    ],
    roads: [
      {
        id: 'road-main',
        name: 'Main Walkway',
        polyline: { points: [{ lat: 11.8190, lng: 122.0915 }, { lat: 11.8193, lng: 122.0920 }, { lat: 11.8198, lng: 122.0925 }, { lat: 11.8202, lng: 122.0930 }] },
        width: 4,
        surface: 'paved',
        type: 'connector',
        metadata: {},
      },
      {
        id: 'road-side',
        name: 'Side Path',
        polyline: { points: [{ lat: 11.8190, lng: 122.0910 }, { lat: 11.8195, lng: 122.0920 }] },
        width: 2,
        surface: 'gravel',
        type: 'service',
        metadata: {},
      },
    ],
    panoramas: [],
    qrCheckpoints: [],
  }
}
