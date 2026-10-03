import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FloorEditorCanvas } from '../FloorEditorCanvas'
import type { Building } from '@/types/nav-types'
import type { LayerVisibility } from '@/types/studio-types'

let mockDispatcherExecute = vi.fn()
let mockGraphComponents: unknown[] = []
let mockFloorComponentsById: Record<string, unknown[]> = {}
let mockRemoveComponent = vi.fn()
let mockUpdateComponent = vi.fn()
let mockSaveGraph = vi.fn()
let mockMoveLayer = vi.fn()

interface MockMapLike {
  getSource: (id: string) => { setData: ReturnType<typeof vi.fn> } | null
}
interface MockEditorValue {
  document: unknown
  services: { get: () => { execute: ReturnType<typeof vi.fn> } | null }
  transformer: {
    buildingLocalToWorld: (point: { x: number; y: number }) => { lat: number; lng: number }
    worldToBuildingLocal: () => null
  }
}
let mockMapInstance: MockMapLike | null = null
function makeEditorValue(document: unknown): MockEditorValue {
  return {
    document,
    services: { get: () => (mockDispatcherExecute ? { execute: mockDispatcherExecute } : null) },
    transformer: { buildingLocalToWorld: () => ({ lat: 0, lng: 0 }), worldToBuildingLocal: () => null },
  }
}
let mockEditorValue: MockEditorValue = makeEditorValue({ buildings: [] })

vi.mock('maplibre-gl', () => {
  class MockLngLatBounds {
    private _ne: [number, number]
    private _sw: [number, number]
    constructor(sw?: [number, number], ne?: [number, number]) {
      this._sw = sw ?? [0, 0]
      this._ne = ne ?? [0, 0]
    }
    extend() { return this }
    getNorthEast() { return { lng: this._ne[0], lat: this._ne[1] } }
    getSouthWest() { return { lng: this._sw[0], lat: this._sw[1] } }
  }

  class MockEvented {
    private _handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    private _sources: Record<string, Record<string, unknown>> = {}
    private _layers: Record<string, Record<string, unknown>> = {}
    private _layoutProps: Record<string, Record<string, unknown>> = {}
    private _canvas: HTMLCanvasElement

    style: Record<string, unknown> = {}
    loaded = () => true
    fitBounds = () => {}
    once = () => {}
    getCenter = () => ({ lng: 0, lat: 0 })
    getZoom = () => 15
    getPitch = () => 0
    getBearing = () => 0
    easeTo = () => {}
    setCenter = () => {}
    setZoom = () => {}

    constructor() {
      this._canvas = document.createElement('canvas')
    }

    on(event: string, layer?: unknown, handler?: (...args: unknown[]) => void) {
      const fn = (typeof layer === 'function' ? layer : handler!) as (...args: unknown[]) => void
      if (!this._handlers[event]) this._handlers[event] = []
      this._handlers[event].push(fn)
    }

    off(event: string, layer?: unknown, handler?: (...args: unknown[]) => void) {
      const fn = (typeof layer === 'function' ? layer : handler!) as (...args: unknown[]) => void
      if (!this._handlers[event]) return
      this._handlers[event] = this._handlers[event].filter((h) => h !== fn)
    }

    fire(event: string, ...args: unknown[]) {
      for (const h of this._handlers[event] ?? []) h(...args)
    }

    getSource(id: string) { return this._sources[id] ?? null }
    addSource(id: string, options?: Record<string, unknown>) {
      this._sources[id] = { setData: vi.fn(), updateImage: vi.fn(), type: options?.type ?? 'geojson' }
    }
    addLayer(layer: Record<string, unknown>) { this._layers[layer.id as string] = layer }
    moveLayer(layerId: string) { mockMoveLayer(layerId) }
    getLayer(id: string) { return this._layers[id] ?? null }
    setLayoutProperty(layer: string, prop: string, value: unknown) {
      if (!this._layoutProps[layer]) this._layoutProps[layer] = {}
      this._layoutProps[layer][prop] = value
    }
    getCanvas() { return this._canvas }
    queryRenderedFeatures() { return [] }
    getContainer() { return document.createElement('div') }
    remove() {}
    resize() {}
  }

  function MapCtor() {
    const m = new MockEvented()
    mockMapInstance = m as unknown as MockMapLike
    setTimeout(() => m.fire('load'), 0)
    return m
  }

  return {
    default: { Map: MapCtor as unknown, LngLatBounds: MockLngLatBounds as unknown },
    Map: MapCtor as unknown,
    LngLatBounds: MockLngLatBounds as unknown,
  }
})

vi.mock('@/hooks/floor-graph-selectors', () => ({
  useFloorComponents: (_buildingId: string, _level: number, floorId?: string) =>
    (floorId ? mockFloorComponentsById[floorId] ?? [] : mockGraphComponents) as any[],
  useFloorComponent: (id: string | null) => mockGraphComponents.find((component: any) => component.id === id)
    ?? (id === 'C001' ? { id: 'C001', type: 'room', name: 'Room 1', buildingId: 'BLD01', floor: 0 } : null),
  isSemanticRoomComponent: (component: any) => component?.metadata?.source === 'derived-face' && component?.metadata?.semanticRoom === true,
  useFloorRenderVersion: () => 0,
  useFloorCampusId: () => 'asu-ibajay',
  useFloorComponentsAll: () => [],
  resolveFloorScope: (floors: Array<{ id: string; level: number }>, floorId?: string, level?: number) =>
    floorId ? floors.find((floor) => floor.id === floorId) : floors.find((floor) => floor.level === level),
  useFloorSyncStatus: () => 'synced',
  useFloorSyncError: () => null,
  useLegacyBuilding: () => null,
  useGraphBuilding: () => null,
  useFloorPlanUrls: () => undefined,
  countFloorComponents: () => 0,
  findGraphBuilding: () => null,
}))

vi.mock('@navi/editor', () => ({
  ENABLE_CANVAS_EDITOR: false,
  useEditor: () => mockEditorValue,
  findBuilding: () => null,
  useEditingEngine: () => ({
    snapshot: { operation: null, preview: null, state: 'idle', isDirty: false, geometryDirty: false, metadataDirty: false, compilerDirty: false, assetDirty: false },
    session: { subscribe: () => () => {}, get version() { return 0 } },
    begin: vi.fn(),
    doCommit: vi.fn().mockReturnValue({ committed: true, operation: { kind: 'delete', entityIds: ['test'] }, validationResult: { passed: true, issues: [] } }),
    execute: vi.fn(),
    cancel: vi.fn(),
    clickEmptySpace: vi.fn(),
    escape: vi.fn(),
    reset: vi.fn(),
    preview: vi.fn(),
    validate: vi.fn().mockReturnValue({ passed: true, issues: [] }),
  }),
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      graph: { components: mockGraphComponents, buildings: [{ campusId: 'test' }] },
      removeComponent: mockRemoveComponent,
      updateComponent: mockUpdateComponent,
      save: mockSaveGraph,
    }),
}))

// Stub the gesture-heavy FloorPlanAlignment overlay so tests can drive its
// commit path (onChange) directly. Only rendered when alignMode is set —
// existing tests never render it, so this mock is inert for them.
vi.mock('../FloorPlanAlignment', () => ({
  FloorPlanAlignment: ({ onChange }: { onChange: (align: Record<string, number>) => void }) => (
    <button data-testid="fpa-commit-stub" onClick={() => onChange({ rotation: 45 })} />
  ),
}))

const building: Building = {
  id: 'BLD01',
  name: 'Test Building',
  campusId: 'asu-ibajay',
  floors: [0],
  footprint: [{ lat: 11.8195, lng: 122.0922 }],
  baseElevation: 0,
  height: 10,
}

const layers: LayerVisibility = {
  osm: false, satellite: false, floor_plan: true, buildings: false,
  rooms: true, hallways: true, assets: true, nodes: false, edges: false, labels: true, walls3d: true,
}

describe('FloorEditorCanvas', () => {
  beforeEach(() => {
    mockDispatcherExecute = vi.fn()
    mockMoveLayer = vi.fn()
    mockMapInstance = null
    mockGraphComponents = []
    mockFloorComponentsById = {}
    mockEditorValue = makeEditorValue({ buildings: [] })
  })

  afterEach(cleanup)

  it('renders without crashing', () => {
    expect(() =>
      render(
        <FloorEditorCanvas
          building={building}
          floor={0}
          tool="select"
          layers={layers}
          selectedId={null}
          onSelect={vi.fn()}
        />
      )
    ).not.toThrow()
  })

  it('commits alignment gestures through the onAlignmentChange prop (regression: undeclared callback identifier)', async () => {
    const onAlignmentChange = vi.fn()
    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId={null}
        onSelect={vi.fn()}
        alignMode
        floorPlanUrl="https://example.com/floor-plan.png"
        planAlignment={{ scaleX: 1, scaleY: 1 }}
        onAlignmentChange={onAlignmentChange}
      />
    )

    // FloorPlanAlignment renders only after map 'load' (mapReady); the stub
    // button invokes the canvas's onChange lambda — the exact path that threw
    // "ReferenceError: onAlignmentChange is not defined" when the prop was
    // declared in FloorEditorCanvasProps but missing from the destructuring.
    const commitStub = await screen.findByTestId('fpa-commit-stub')
    await userEvent.click(commitStub)

    expect(onAlignmentChange).toHaveBeenCalledTimes(1)
    expect(onAlignmentChange).toHaveBeenCalledWith({ scaleX: 1, scaleY: 1, rotation: 45 })
  })

  it('promotes wall editing layers above room overlays for reliable endpoint dragging', async () => {
    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId={null}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => expect(mockMoveLayer).toHaveBeenCalledWith('floor-walls-line'))
    expect(mockMoveLayer.mock.calls.map(([layerId]) => layerId)).toEqual([
      'floor-selection-fill',
      'floor-selection-outline',
      'floor-selection-circle',
      'floor-walls-line',
      'floor-wall-edit-preview-line',
      'floor-wall-junctions-layer',
    ])
  })

  it('does not show delete button when no component selected', () => {
    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId={null}
        onSelect={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('shows delete button when a component is selected', () => {
    mockGraphComponents = [{ id: 'C001', type: 'room', name: 'Room 1', buildingId: 'BLD01', floor: 0 }]
    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId="C001"
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('dispatches room.delete command on delete click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mockGraphComponents = [{ id: 'C001', type: 'room', name: 'Room 1', buildingId: 'BLD01', floor: 0 }]
    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId="C001"
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(mockDispatcherExecute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'room.delete', payload: { roomId: 'C001' } })
    )
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('calls onSelect(null) on delete click', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    mockGraphComponents = [{ id: 'C001', type: 'room', name: 'Room 1', buildingId: 'BLD01', floor: 0 }]
    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId="C001"
        onSelect={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('populates red wall geometry after map readiness when the floor already has authored walls (reload case)', async () => {
    mockEditorValue = makeEditorValue({
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
      buildings: [
        {
          id: 'BLD01', name: 'Test Building', code: 'TB', category: 'academic', description: '',
          footprint: { points: [] }, baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
          floors: [
            {
              id: 'flr-bld01-0', level: 0, label: 'Ground', elevation: 0, height: 3.5,
              walls: [
                { id: 'wall-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 },
              ],
              rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
          ],
          verticalConnectors: [],
        },
      ],
      roads: [], panoramas: [], qrCheckpoints: [],
    })

    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId={null}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => {
      const wallSource = mockMapInstance?.getSource('floor-walls')
      expect(wallSource?.setData).toHaveBeenCalled()
    })
  })

  it('populates authored walls and derived enclosure after map readiness when the floor already contains a closed wall shell', async () => {
    const shellWalls = [
      { id: 'shell-w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.15, height: 3.5 },
      { id: 'shell-w2', start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, thickness: 0.15, height: 3.5 },
      { id: 'shell-w3', start: { x: 10, y: 10 }, end: { x: 0, y: 10 }, thickness: 0.15, height: 3.5 },
      { id: 'shell-w4', start: { x: 0, y: 10 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 3.5 },
    ]
    const shellDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
      buildings: [
        {
          id: 'BLD01', name: 'Test Building', code: 'TB', category: 'academic', description: '',
          footprint: { points: [] }, baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
          floors: [
            {
              id: 'flr-bld01-0', level: 0, label: 'Ground', elevation: 0, height: 3.5,
              walls: shellWalls,
              rooms: [], roomAttributes: [],
              hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
          ],
          verticalConnectors: [],
        },
      ],
      roads: [], panoramas: [], qrCheckpoints: [],
    }
    const documentBefore = JSON.stringify(shellDocument)
    mockEditorValue = makeEditorValue(shellDocument)
    mockEditorValue.transformer = {
      buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y * 1e-5, lng: point.x * 1e-5 }),
      worldToBuildingLocal: () => null,
    }

    render(
      <FloorEditorCanvas
        building={building}
        floor={0}
        tool="select"
        layers={layers}
        selectedId={null}
        onSelect={vi.fn()}
      />
    )

    // At mount the mocked map is not ready yet: no populated sources may exist.
    expect(mockMapInstance?.getSource('floor-walls')).toBeNull()
    expect(mockMapInstance?.getSource('floor-derived-rooms')).toBeNull()

    await waitFor(() => {
      expect(mockMapInstance?.getSource('floor-walls')?.setData).toHaveBeenCalled()
      expect(mockMapInstance?.getSource('floor-derived-rooms')?.setData).toHaveBeenCalled()
    })

    const wallSource = mockMapInstance?.getSource('floor-walls')
    const wallCalls = wallSource?.setData.mock.calls ?? []
    const wallData = wallCalls[wallCalls.length - 1][0] as { features: Array<{ properties: { id: string } }> }
    expect(wallData.features).toHaveLength(4)
    expect(wallData.features.map((f) => f.properties.id).sort()).toEqual(['shell-w1', 'shell-w2', 'shell-w3', 'shell-w4'])

    const derivedSource = mockMapInstance?.getSource('floor-derived-rooms')
    const derivedCalls = derivedSource?.setData.mock.calls ?? []
    const derivedData = derivedCalls[derivedCalls.length - 1][0] as {
      features: Array<{ geometry: { type: string; coordinates: Array<Array<[number, number]>> } }>
    }
    expect(derivedData.features).toHaveLength(1)
    expect(derivedData.features[0].geometry.type).toBe('Polygon')
    const ring = derivedData.features[0].geometry.coordinates[0]
    expect(ring.length).toBeGreaterThanOrEqual(4)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    let area = 0
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    }
    expect(Math.abs(area / 2)).toBeGreaterThan(0)

    // No document mutation, no Room designation, no explicit sync calls were required.
    expect(JSON.stringify(shellDocument)).toBe(documentBefore)
    expect(shellDocument.buildings[0].floors[0].rooms).toHaveLength(0)
    expect(shellDocument.buildings[0].floors[0].roomAttributes).toHaveLength(0)
  })

  it('Phase A vertical contract: elevated-floor walls extrude on the single-floor presentation datum', async () => {
    // Root-cause repro (spec/FLOOR-ELEVATION-ACTIVE-FLOW.md, Phase 0 classification B):
    // a floor with elevation > 0 must present its walls on the same datum as every
    // other renderable in the single-floor view (rooms base 0, derived rooms base 0.1,
    // route edges base 0, floor-plan raster at ground plane) — NOT on the stacking datum.
    const elevatedDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
      buildings: [
        {
          id: 'BLD01', name: 'Test Building', code: 'TB', category: 'academic', description: '',
          footprint: { points: [] }, baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
          floors: [
            {
              id: 'flr-bld01-0', level: 0, label: 'Ground', elevation: 0, height: 3.5,
              walls: [],
              rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
            {
              id: 'flr-bld01-1', level: 1, label: 'Floor 2', elevation: 3.5, height: 3.5,
              walls: [
                { id: 'wall-up-1', start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, thickness: 0.15, height: 3.5 },
              ],
              rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
          ],
          verticalConnectors: [],
        },
      ],
      roads: [], panoramas: [], qrCheckpoints: [],
    }
    const documentBefore = JSON.stringify(elevatedDocument)
    mockEditorValue = makeEditorValue(elevatedDocument)
    mockEditorValue.transformer = {
      buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y * 1e-5, lng: point.x * 1e-5 }),
      worldToBuildingLocal: () => null,
    }

    render(
      <FloorEditorCanvas
        building={{ ...building, floors: [0, 1] }}
        floor={1}
        tool="select"
        layers={layers}
        selectedId={null}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => expect(mockMapInstance?.getSource('floor-walls-3d')?.setData).toHaveBeenCalled())
    const calls = mockMapInstance?.getSource('floor-walls-3d')?.setData.mock.calls ?? []
    const data = calls[calls.length - 1][0] as {
      features: Array<{ properties: { id: string; base: number; height: number } }>
    }
    expect(data.features).toHaveLength(1)
    expect(data.features[0].properties.id).toBe('wall-up-1')

    // Wall extrusion sits on the view's floor plane (presentation datum), so wall
    // bases align with the floor representation; formula height = base + wall.height
    // is unchanged (0 + 3.5).
    expect(data.features[0].properties.base).toBe(0)
    expect(data.features[0].properties.height).toBe(3.5)

    // The authoritative stacking elevation stays intact in the document and the
    // render path never mutates authored data.
    expect(elevatedDocument.buildings[0].floors[1].elevation).toBe(3.5)
    expect(JSON.stringify(elevatedDocument)).toBe(documentBefore)
  })

  it('Phase A vertical contract: ground-floor (elevation 0) wall extrusion behavior is unchanged', async () => {
    const groundDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
      buildings: [
        {
          id: 'BLD01', name: 'Test Building', code: 'TB', category: 'academic', description: '',
          footprint: { points: [] }, baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
          floors: [
            {
              id: 'flr-bld01-0', level: 0, label: 'Ground', elevation: 0, height: 3.5,
              walls: [
                { id: 'wall-g-1', start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: 0.15, height: 3.5 },
              ],
              rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
          ],
          verticalConnectors: [],
        },
      ],
      roads: [], panoramas: [], qrCheckpoints: [],
    }
    mockEditorValue = makeEditorValue(groundDocument)
    mockEditorValue.transformer = {
      buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y * 1e-5, lng: point.x * 1e-5 }),
      worldToBuildingLocal: () => null,
    }

    render(
      <FloorEditorCanvas building={building} floor={0} tool="select" layers={layers} selectedId={null} onSelect={vi.fn()} />
    )

    await waitFor(() => expect(mockMapInstance?.getSource('floor-walls-3d')?.setData).toHaveBeenCalled())
    const calls = mockMapInstance?.getSource('floor-walls-3d')?.setData.mock.calls ?? []
    const data = calls[calls.length - 1][0] as {
      features: Array<{ properties: { id: string; base: number; height: number } }>
    }
    expect(data.features).toHaveLength(1)
    expect(data.features[0].properties.id).toBe('wall-g-1')
    expect(data.features[0].properties.base).toBe(0)
    expect(data.features[0].properties.height).toBe(3.5)
  })

  it('isolates every floor-scoped source by canonical floor ID across GF → 1F → 2F → GF', async () => {
    const multiFloorDocument = {
      schemaVersion: 1,
      version: 1,
      metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
      buildings: [
        {
          id: 'BLD01', name: 'Test Building', code: 'TB', category: 'academic', description: '',
          footprint: { points: [] }, baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
          floors: [
            {
              id: 'floor-ground', level: -1, label: 'Ground', elevation: 0, height: 3.5,
              walls: [{ id: 'wall-g', start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, thickness: 0.15, height: 3.5 }],
              routeNetwork: {
                nodes: [{ id: 'rn-g', type: 'room', position: { x: 1, y: 1 }, floor: -1 }],
                edges: [],
              },
              rooms: [{ id: 'room-g', name: 'Room-G', polygon: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } }], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
            {
              id: 'floor-one', level: 2, label: '1F', elevation: 3.5, height: 3.5,
              walls: [{ id: 'wall-1', start: { x: 0, y: 0 }, end: { x: 0, y: 7 }, thickness: 0.15, height: 3.5 }],
              routeNetwork: {
                nodes: [{ id: 'rn-1', type: 'room', position: { x: 2, y: 2 }, floor: 2 }],
                edges: [],
              },
              rooms: [{ id: 'room-1', name: 'Room-1', polygon: { points: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }] } }], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
            {
              id: 'floor-two', level: 7, label: '2F', elevation: 7, height: 3.5,
              walls: [{ id: 'wall-2', start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, thickness: 0.15, height: 3.5 }],
              routeNetwork: {
                nodes: [{ id: 'rn-2', type: 'room', position: { x: 4, y: 4 }, floor: 7 }],
                edges: [],
              },
              rooms: [{ id: 'room-2', name: 'Room-2', polygon: { points: [{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }] } }], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], parametricComponents: [], metadata: {},
            },
          ],
          verticalConnectors: [],
        },
      ],
      roads: [], panoramas: [], qrCheckpoints: [],
    }
    const documentBefore = JSON.stringify(multiFloorDocument)
    mockEditorValue = makeEditorValue(multiFloorDocument)
    mockEditorValue.transformer = {
      buildingLocalToWorld: (point: { x: number; y: number }) => ({ lat: point.y * 1e-5, lng: point.x * 1e-5 }),
      worldToBuildingLocal: () => null,
    }
    const roomComponent = (id: string, name: string, x: number) => ({
      id, type: 'room', name, buildingId: 'BLD01', floor: 0,
      position: { lat: 0, lng: 0 },
      polygon: [{ lat: 0, lng: x }, { lat: 0, lng: x + 0.00001 }, { lat: 0.00001, lng: x + 0.00001 }],
    })
    mockFloorComponentsById = {
      'floor-ground': [roomComponent('room-g', 'Room-G', 0)],
      'floor-one': [roomComponent('room-1', 'Room-1', 1)],
      'floor-two': [roomComponent('room-2', 'Room-2', 2)],
    }

    const canvasProps = {
      building: { ...building, floors: [-1, 2, 7] },
      tool: 'select' as const,
      layers,
      selectedId: null,
      onSelect: vi.fn(),
    }

    const { rerender } = render(<FloorEditorCanvas {...canvasProps} floor={-1} activeFloorId="floor-ground" />)

    // Ground floor selected: only ground-floor content is live.
    await waitFor(() => {
      const walls = mockMapInstance?.getSource('floor-walls')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string } }>
      }
      expect(walls.features.map((f) => f.properties.id)).toEqual(['wall-g'])
    })
    await waitFor(() => {
      const nodes = mockMapInstance?.getSource('floor-route-nodes')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string } }>
      }
      expect(nodes.features.map((f) => f.properties.id)).toEqual(['rn-g'])
    })
    await waitFor(() => {
      const rooms = mockMapInstance?.getSource('floor-rooms')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string } }>
      }
      expect(rooms.features.map((f) => f.properties.id)).toEqual(['room-g'])
    })

    // 1F: index 1 is deliberately not its level (2).
    rerender(<FloorEditorCanvas {...canvasProps} floor={2} activeFloorId="floor-one" />)

    await waitFor(() => {
      const walls = mockMapInstance?.getSource('floor-walls')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string } }>
      }
      expect(walls.features.map((f) => f.properties.id)).toEqual(['wall-1'])
    })
    await waitFor(() => {
      const walls3d = mockMapInstance?.getSource('floor-walls-3d')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string; base: number } }>
      }
      expect(walls3d.features.map((f) => f.properties.id)).toEqual(['wall-1'])
      // Upper-floor consistency (Phase A contract holds on switch, too).
      expect(walls3d.features[0].properties.base).toBe(0)
    })
    await waitFor(() => {
      const nodes = mockMapInstance?.getSource('floor-route-nodes')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string; floor: number } }>
      }
      expect(nodes.features.map((f) => f.properties.id)).toEqual(['rn-1'])
      expect(nodes.features[0].properties.floor).toBe(2)
    })
    await waitFor(() => {
      const rooms = mockMapInstance?.getSource('floor-rooms')?.setData.mock.calls.at(-1)?.[0] as {
        features: Array<{ properties: { id: string } }>
      }
      expect(rooms.features.map((f) => f.properties.id)).toEqual(['room-1'])
    })

    // An old GF selection has no active-floor component and must produce no selection overlay.
    rerender(<FloorEditorCanvas {...canvasProps} floor={2} activeFloorId="floor-one" selectedId="room-g" />)
    await waitFor(() => {
      const selection = mockMapInstance?.getSource('floor-selection')?.setData.mock.calls.at(-1)?.[0] as { features: unknown[] }
      expect(selection.features).toEqual([])
    })

    // 2F then back to GF, with sources cleared/replaced on each transition.
    rerender(<FloorEditorCanvas {...canvasProps} floor={7} activeFloorId="floor-two" />)
    await waitFor(() => {
      const walls = mockMapInstance?.getSource('floor-walls')?.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { id: string } }> }
      expect(walls.features.map((f) => f.properties.id)).toEqual(['wall-2'])
    })
    await waitFor(() => {
      const rooms = mockMapInstance?.getSource('floor-rooms')?.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { id: string } }> }
      expect(rooms.features.map((f) => f.properties.id)).toEqual(['room-2'])
    })
    await waitFor(() => {
      const nodes = mockMapInstance?.getSource('floor-route-nodes')?.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { id: string } }> }
      expect(nodes.features.map((f) => f.properties.id)).toEqual(['rn-2'])
    })
    rerender(<FloorEditorCanvas {...canvasProps} floor={-1} activeFloorId="floor-ground" />)
    await waitFor(() => {
      const rooms = mockMapInstance?.getSource('floor-rooms')?.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { id: string } }> }
      expect(rooms.features.map((f) => f.properties.id)).toEqual(['room-g'])
    })

    // Visibility/floor switching is presentation-only: authored walls, route
    // graphs and the document itself are byte-identical.
    expect(JSON.stringify(multiFloorDocument)).toBe(documentBefore)
  })

  it('populates a spatial Door footprint after map readiness for 2D and 2.5D rendering', async () => {
    mockGraphComponents = [{
      id: 'door-1', type: 'door', name: 'Door', buildingId: 'BLD01', floor: 0,
      position: { lat: 0, lng: 0 },
      polygon: [
        { lat: 0, lng: 0 }, { lat: 0, lng: 0.00001 },
        { lat: 0.000002, lng: 0.00001 }, { lat: 0.000002, lng: 0 },
      ],
      metadata: { ownershipStatus: 'unassigned' },
    }]

    render(
      <FloorEditorCanvas building={building} floor={0} tool="select" layers={layers} selectedId={null} onSelect={vi.fn()} />
    )

    await waitFor(() => expect(mockMapInstance?.getSource('floor-door-areas')?.setData).toHaveBeenCalled())
    const calls = mockMapInstance?.getSource('floor-door-areas')?.setData.mock.calls ?? []
    const data = calls[calls.length - 1][0] as { features: Array<{ properties: Record<string, unknown> }> }
    expect(data.features).toHaveLength(1)
    expect(data.features[0].properties).toMatchObject({ id: 'door-1', type: 'door', height: 2.1 })
  })

  it('marks the selected route-source Entrance as active in its always-visible point source', async () => {
    mockGraphComponents = [{ id: 'entrance-1', type: 'entrance', name: 'Main Entrance', buildingId: 'BLD01', floor: 0, position: { lat: 1, lng: 2 } }]
    render(
      <FloorEditorCanvas
        building={building} floor={0} tool="hallway" layers={layers} selectedId="entrance-1" onSelect={vi.fn()}
        viewMode="2.5d" pendingRouteAnchor={{ entranceId: 'entrance-1', outdoorNodeId: 'outside-1', position: { lat: 1, lng: 2 } }}
      />
    )

    await waitFor(() => expect(mockMapInstance?.getSource('floor-point-items')?.setData).toHaveBeenCalled())
    const calls = mockMapInstance?.getSource('floor-point-items')?.setData.mock.calls ?? []
    const data = calls[calls.length - 1][0] as { features: Array<{ properties: Record<string, unknown> }> }
    expect(data.features[0].properties).toMatchObject({ id: 'entrance-1', selected: true, activeRouteSource: true })
  })
})
