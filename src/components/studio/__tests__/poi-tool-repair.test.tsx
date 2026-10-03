import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, act, screen } from '@testing-library/react'
import type { CampusDocument, CoordinateTransformer, EditorContext } from '@navi/editor'
import {
  EditorProvider,
  EntityRenderer,
  GraphAdapter,
  NavigationCompiler,
  createEditorContext,
} from '@navi/editor'
import { Graph } from '@/engine/graph'
import { useStudioStore } from '@/store/studio-store'
import { InteractionController } from '../InteractionController'
import { ImportToast } from '../ImportToast'
import type { DrawingSessionValue } from '../useDrawingSession'
import type { CurrentToolStore } from '@navi/editor'

// ── External boundary mocks ──────────────────────────────────────────────
// The legacy graph store is only read by InteractionController for building
// drag bookkeeping; the editor document/dispatcher/history/selection under
// test are REAL instances created by createEditorContext.
vi.mock('@/store/graph-store', () => {
  const graph = { buildings: [], components: [], nodes: [], traces: [], areas: [] }
  const state = {
    graph,
    renderVersion: 0,
    addComponent: vi.fn(),
    addComponentWithPolygon: vi.fn(),
    updateBuilding: vi.fn(),
    removeNode: vi.fn(),
    save: vi.fn(),
  }
  return {
    useGraphStore: Object.assign(
      vi.fn(() => graph),
      {
        getState: () => state,
        setState: vi.fn((patch: Record<string, unknown>) => { Object.assign(state, patch) }),
        subscribe: vi.fn(() => () => {}),
      },
    ),
  }
})

const ORIGIN = { lat: 11.8185, lng: 122.1704 }

function footprint() {
  return [
    { lat: ORIGIN.lat, lng: ORIGIN.lng },
    { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.0008 },
    { lat: ORIGIN.lat + 0.0008, lng: ORIGIN.lng + 0.0008 },
    { lat: ORIGIN.lat + 0.0008, lng: ORIGIN.lng },
    { lat: ORIGIN.lat, lng: ORIGIN.lng },
  ]
}

function makeGraph() {
  return {
    campusId: 'campus-poi-repair',
    name: 'POI Repair Fixture',
    buildings: [
      {
        id: 'bld-1',
        name: 'Repair Hall',
        footprint: footprint(),
        rotation: 0,
        floors: [{ id: 'flr-0', level: 0 }],
        floorData: [
          {
            id: 'flr-0',
            level: 0,
            label: 'Ground',
            rooms: [],
            hallways: [],
            pois: [],
            routeNetwork: {
              nodes: [
                { id: 'rn-1', type: 'waypoint', position: { x: 1, y: 1 }, floor: 0 },
                { id: 'rn-2', type: 'waypoint', position: { x: 5, y: 1 }, floor: 0 },
              ],
              edges: [{ id: 're-1', from: 'rn-1', to: 'rn-2', type: 'walk', distance: 4 }],
            },
            entranceAccess: [
              { id: 'ea-1', entranceId: 'ent-1', outdoorNodeId: 'on-1', indoorRouteNodeId: 'rn-1' },
            ],
          },
        ],
      },
    ],
    roads: [
      {
        id: 'road-1',
        name: 'Main Road',
        polyline: { points: [{ lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng }, { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng + 0.002 }] },
        width: 5,
        surface: 'paved',
        type: 'arterial',
        metadata: {},
      },
      {
        id: 'road-2',
        name: 'Side Road',
        polyline: { points: [{ lat: ORIGIN.lat - 0.002, lng: ORIGIN.lng + 0.001 }, { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 }] },
        width: 3,
        surface: 'concrete',
        type: 'connector',
        metadata: {},
      },
    ],
    roadJunctions: [
      {
        id: 'jct-1',
        position: { lat: ORIGIN.lat - 0.001, lng: ORIGIN.lng + 0.001 },
        roadIds: ['road-1', 'road-2'],
        source: 'authored',
      },
    ],
    separatedCrossings: [
      {
        id: 'sep-1',
        roadIds: ['road-1', 'road-2'],
        position: { lat: ORIGIN.lat - 0.0015, lng: ORIGIN.lng + 0.0005 },
      },
    ],
    components: [],
  }
}

function makeMap() {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {}
  const sources: Record<string, any> = {}
  const layers: Record<string, any> = {}
  const canvas = { style: {} as CSSStyleDeclaration }
  const map: any = {
    on: vi.fn((event: string, layerOrHandler: any, maybeHandler?: any) => {
      const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler
      if (typeof handler === 'function') (handlers[event] ||= []).push(handler)
      return map
    }),
    off: vi.fn(() => map),
    once: vi.fn((event: string, handler: (...args: any[]) => void) => {
      ;(handlers[event] ||= []).push(handler)
      return map
    }),
    loaded: () => true,
    getCanvas: () => canvas,
    queryRenderedFeatures: vi.fn(() => []),
    getSource: (id: string) => sources[id] ?? null,
    addSource: (id: string, def: any) => {
      sources[id] = { ...def, setData: (data: any) => { sources[id].data = data } }
    },
    removeSource: (id: string) => { delete sources[id] },
    getLayer: (id: string) => layers[id] ?? null,
    addLayer: (def: any) => { layers[def.id] = def },
    removeLayer: (id: string) => { delete layers[id] },
    setLayoutProperty: vi.fn(),
    setFeatureState: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    handlers,
    sources,
    layers,
    canvas,
  }
  return map
}

function makeDrawing(): DrawingSessionValue {
  return {
    tracePoints: [],
    drawPoints: [],
    routeWidth: 8,
    roomDrag: null,
    pendingConfirm: null,
    pendingRoadConnection: null,
    setPendingRoadConnection: vi.fn(),
    resolveRoadConnection: vi.fn(),
    addSeparatePoint: vi.fn(),
    addTracePoint: vi.fn(),
    setTracePoints: vi.fn(),
    undoLastPoint: vi.fn(),
    clearTracePoints: vi.fn(),
    addDrawPoint: vi.fn(),
    setDrawPoints: vi.fn(),
    undoLastDrawPoint: vi.fn(),
    clearDrawPoints: vi.fn(),
    setRoomDrag: vi.fn(),
    requestConfirm: vi.fn(),
    confirm: vi.fn(() => []),
    cancel: vi.fn(),
    setRouteWidth: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  } as unknown as DrawingSessionValue
}

function compilerStub() {
  return new NavigationCompiler({
    getGraph: () => ({ nodes: [], edges: [] }),
    updateNode: vi.fn(),
    updateEdge: vi.fn(),
  } as any)
}

interface Harness {
  ctx: EditorContext
  map: any
  drawing: DrawingSessionValue
  dispatchClick: (world: { lat: number; lng: number }) => void
}

function renderHarness(): Harness {
  const ctx = createEditorContext(
    makeGraph(),
    { save: async () => {}, syncToSupabase: async () => {}, publish: async () => ({ success: true, version: '1.0.0' }) },
    compilerStub(),
  )
  const map = makeMap()
  const drawing = makeDrawing()
  render(
    <EditorProvider context={ctx}>
      <InteractionController map={map} drawing={drawing} />
      <ImportToast />
    </EditorProvider>,
  )
  return {
    ctx,
    map,
    drawing,
    dispatchClick: (world) => {
      const handlers = map.handlers.click ?? []
      for (const handler of handlers) {
        handler({ point: { x: 100, y: 120 }, lngLat: world, originalEvent: new MouseEvent('click') })
      }
    },
  }
}

function activatePoiTool(ctx: EditorContext): void {
  const registry = ctx.services.get('toolRegistry') as CurrentToolStore
  registry.activate('poi')
}

function setPlacementContext(buildingId: string | null, floor = 0): void {
  useStudioStore.setState({ activeBuildingId: buildingId, activeFloor: floor })
}

function poiFeatures(h: Harness): any[] {
  const floor = h.ctx.document.buildings[0]?.floors[0] as any
  return floor.pois ?? []
}

function topologySignature(document: CampusDocument): string {
  const floor = document.buildings[0]?.floors[0] as any
  return JSON.stringify({
    roads: document.roads,
    roadJunctions: document.roadJunctions,
    separatedCrossings: document.separatedCrossings,
    routeNetwork: floor?.routeNetwork,
    entranceAccess: floor?.entranceAccess,
  })
}

afterEach(cleanup)

beforeEach(() => {
  useStudioStore.setState({
    activeBuildingId: null,
    activeFloor: 0,
    selectedNodeId: null,
    selectedTraceId: null,
    pendingConfirm: null,
  })
})

describe('POI tool repair — end-to-end Studio pipeline (real editor context)', () => {
  it('activates the POI tool in the registry and applies the crosshair cursor', () => {
    const h = renderHarness()
    act(() => { activatePoiTool(h.ctx) })

    const registry = h.ctx.services.get('toolRegistry') as CurrentToolStore
    expect(registry.activeToolId).toBe('poi')
    expect(h.map.canvas.style.cursor).toBe('crosshair')
  })

  it('creates a floor-local point POI through the real dispatcher, history, and selection', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })

    const world = { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }
    act(() => { h.dispatchClick(world) })

    const pois = poiFeatures(h)
    expect(pois).toHaveLength(1)
    const poi = pois[0]
    expect(poi.id).toMatch(/^poi/) 
    expect(poi.name).toBe('')
    expect(poi.category).toBe('other')
    expect(Number.isFinite(poi.position.x)).toBe(true)
    expect(Number.isFinite(poi.position.y)).toBe(true)

    const transformer = h.ctx.transformer as CoordinateTransformer
    expect(poi.position).toEqual(transformer.worldToFloorLocal(world, 'bld-1', 0))
    expect('geometry' in poi).toBe(false)

    const selection = h.ctx.services.get('selection') as any
    expect(selection.lastSelectedSelector).toMatchObject({
      type: 'poi',
      id: poi.id,
      buildingId: 'bld-1',
      floorId: 'flr-0',
    })

    const history = h.ctx.services.get('history') as any
    expect(history.canUndo).toBe(true)
  })

  it('keeps the MapLibre POI source and marker layer in sync after creation', () => {
    const h = renderHarness()
    const eventBus = h.ctx.services.get('eventBus') as any
    const selection = h.ctx.services.get('selection') as any
    const viewport = h.ctx.services.get('viewport') as any
    const renderer = new EntityRenderer({
      map: h.map,
      document: h.ctx.document,
      eventBus,
      selection,
      viewport,
      transformer: h.ctx.transformer,
    })
    renderer.init()

    expect(h.map.getSource('navi-pois').data.features).toHaveLength(0)

    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    const features = h.map.getSource('navi-pois').data.features
    expect(features).toHaveLength(1)
    expect(features[0].properties).toMatchObject({
      id: poiFeatures(h)[0].id,
      buildingId: 'bld-1',
      floorId: 'flr-0',
      floor: 0,
      entityType: 'poi',
      appearanceMode: 'marker',
    })
    expect(features[0].geometry.type).toBe('Point')

    const iconLayer = h.map.getLayer('navi-poi-icon')
    expect(iconLayer).toBeTruthy()
    expect(JSON.stringify(iconLayer.filter)).toContain('marker')
  })

  it('updates the POI MapLibre source without a second POI collection after creation', () => {
    const h = renderHarness()
    const selection = h.ctx.services.get('selection') as any
    const viewport = h.ctx.services.get('viewport') as any
    const renderer = new EntityRenderer({
      map: h.map,
      document: h.ctx.document,
      eventBus: h.ctx.services.get('eventBus') as any,
      selection,
      viewport,
      transformer: h.ctx.transformer,
    })
    renderer.init()

    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng + 0.0001 }) })

    expect(poiFeatures(h)).toHaveLength(1)
    expect(h.map.sources['navi-pois'].data.features).toHaveLength(1)
    // No duplicate authored collection: POIs live only under Floor.pois.
    expect((h.ctx.document as any).pois).toBeUndefined()
  })

  it('undo removes the created POI and redo restores it', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0002 }) })
    expect(poiFeatures(h)).toHaveLength(1)

    const history = h.ctx.services.get('history') as any
    act(() => { history.undo() })
    expect(poiFeatures(h)).toHaveLength(0)

    act(() => { history.redo() })
    expect(poiFeatures(h)).toHaveLength(1)
  })

  it('round-trips the created POI through GraphAdapter save and createDocument reload', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    const created = structuredClone(poiFeatures(h)[0])
    const legacyGraph = new Graph()
    new GraphAdapter(legacyGraph, h.ctx.transformer).sync(h.ctx.document)
    const reloadedContext = createEditorContext(
      legacyGraph,
      { save: async () => {}, syncToSupabase: async () => {}, publish: async () => ({ success: true, version: '1.0.0' }) },
      compilerStub(),
    )

    expect(reloadedContext.document.buildings[0].floors[0].pois).toHaveLength(1)
    expect(reloadedContext.document.buildings[0].floors[0].pois![0]).toEqual(created)
  })

  it('does not mutate roads, junctions, separated crossings, EntranceAccess, or route networks', () => {
    const h = renderHarness()
    const before = topologySignature(h.ctx.document)

    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    const history = h.ctx.services.get('history') as any
    act(() => { history.undo() })
    act(() => { history.redo() })

    expect(topologySignature(h.ctx.document)).toBe(before)
  })

  it('creates an outdoor/campus point POI with world coordinates when no building is active', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext(null, 0)
      activatePoiTool(h.ctx)
    })

    const world = { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }
    act(() => { h.dispatchClick(world) })

    expect(screen.queryByText(/select a building before placing a poi/i)).toBeNull()
    expect(h.ctx.document.pois).toHaveLength(1)
    const poi = h.ctx.document.pois![0]
    expect(poi).toMatchObject({
      id: expect.stringMatching(/^poi/),
      name: '',
      category: 'other',
      scope: 'outdoor',
      geometry: { type: 'point', position: world },
    })
    // Indoor canonical collection is untouched.
    expect(poiFeatures(h)).toHaveLength(0)

    const selection = h.ctx.services.get('selection') as any
    expect(selection.lastSelectedSelector).toMatchObject({ type: 'poi', id: poi.id })
    expect(selection.lastSelectedSelector.buildingId).toBeUndefined()
    expect(selection.lastSelectedSelector.floorId).toBeUndefined()

    const history = h.ctx.services.get('history') as any
    expect(history.canUndo).toBe(true)
  })

  it('shows explicit feedback and creates nothing when the active building has no matching floor', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext('bld-1', 4)
      activatePoiTool(h.ctx)
    })

    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    expect(screen.getByText(/has no floor 4/i)).toBeTruthy()
    expect(poiFeatures(h)).toHaveLength(0)
    expect(h.ctx.document.pois ?? []).toHaveLength(0)
  })

  it('does not let an inactive road-connection pending decision swallow POI clicks', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext('bld-1', 0)
      activatePoiTool(h.ctx)
    })

    // Simulate a leftover pending decision payload on the drawing session. The
    // planned POI route must not consult it.
    ;(h.drawing as any).pendingRoadConnection = {
      point: { lat: ORIGIN.lat, lng: ORIGIN.lng },
      candidate: { id: 'cand-1', label: 'Main Road', position: { lat: ORIGIN.lat, lng: ORIGIN.lng } },
    }
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    expect(poiFeatures(h)).toHaveLength(1)
  })

  it('renders outdoor POIs in the MapLibre source on every active floor', () => {
    const h = renderHarness()
    const renderer = new EntityRenderer({
      map: h.map,
      document: h.ctx.document,
      eventBus: h.ctx.services.get('eventBus') as any,
      selection: h.ctx.services.get('selection') as any,
      viewport: h.ctx.services.get('viewport') as any,
      transformer: h.ctx.transformer,
    })
    renderer.init()

    act(() => {
      setPlacementContext(null, 0)
      activatePoiTool(h.ctx)
    })
    const world = { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }
    act(() => { h.dispatchClick(world) })

    const featuresAtZero = h.map.getSource('navi-pois').data.features
    expect(featuresAtZero).toHaveLength(1)
    expect(featuresAtZero[0].properties).toMatchObject({ scope: 'outdoor', appearanceMode: 'marker' })
    expect(featuresAtZero[0].geometry).toEqual({ type: 'Point', coordinates: [world.lng, world.lat] })

    // Outdoor features survive a floor switch; indoor floor filtering is unchanged.
    renderer.setActiveFloor(7)
    const featuresAtSeven = h.map.getSource('navi-pois').data.features
    expect(featuresAtSeven.map((feature: any) => feature.id)).toEqual([h.ctx.document.pois![0].id])
  })

  it('undo removes and redo restores a created outdoor POI', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext(null, 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0002 }) })
    expect(h.ctx.document.pois).toHaveLength(1)

    const history = h.ctx.services.get('history') as any
    act(() => { history.undo() })
    expect(h.ctx.document.pois ?? []).toHaveLength(0)

    act(() => { history.redo() })
    expect(h.ctx.document.pois).toHaveLength(1)
    expect(h.ctx.document.pois![0].geometry).toEqual({ type: 'point', position: { lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0002 } })
  })

  it('round-trips an outdoor POI through GraphAdapter save and reload', () => {
    const h = renderHarness()
    act(() => {
      setPlacementContext(null, 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    const created = structuredClone(h.ctx.document.pois![0])
    const legacyGraph = new Graph()
    new GraphAdapter(legacyGraph, h.ctx.transformer).sync(h.ctx.document)
    const reloadedContext = createEditorContext(
      legacyGraph,
      { save: async () => {}, syncToSupabase: async () => {}, publish: async () => ({ success: true, version: '1.0.0' }) },
      compilerStub(),
    )

    expect(reloadedContext.document.pois).toEqual([created])
    // Indoor collection remains untouched.
    expect(reloadedContext.document.buildings[0].floors[0].pois ?? []).toHaveLength(0)
  })

  it('does not mutate roads, junctions, crossings, EntranceAccess, or route networks for outdoor POIs', () => {
    const h = renderHarness()
    const before = topologySignature(h.ctx.document)

    act(() => {
      setPlacementContext(null, 0)
      activatePoiTool(h.ctx)
    })
    act(() => { h.dispatchClick({ lat: ORIGIN.lat + 0.0002, lng: ORIGIN.lng + 0.0003 }) })

    const history = h.ctx.services.get('history') as any
    act(() => { history.undo() })
    act(() => { history.redo() })

    expect(topologySignature(h.ctx.document)).toBe(before)
  })
})
