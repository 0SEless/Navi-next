import { Profiler } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioCanvas } from '../StudioCanvas'

const probe = vi.hoisted(() => ({
  map: null as MockMap | null,
  studioState: { tool: 'vertex', isVertexEditing: true, positionEditTarget: null },
  toolRegistry: {
    activeToolId: 'route',
    activate: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
  graphState: { graph: { buildings: [] }, rotateBuilding: vi.fn() },
}))

type MapListener = (event?: unknown) => void
type MockMap = {
  listeners: Map<string, Set<MapListener>>
  on: (event: string, handler: MapListener) => MockMap
  off: (event: string, handler: MapListener) => MockMap
  emit: (event: string, payload?: unknown) => void
  getCanvas: () => { style: { cursor: string } }
  remove: () => void
}

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class MockMap {
      listeners = new Map<string, Set<MapListener>>()

      constructor() {
        probe.map = this
      }

      on(event: string, handler: MapListener) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set())
        this.listeners.get(event)!.add(handler)
        if (event === 'load') handler({})
        return this
      }

      off(event: string, handler: MapListener) {
        this.listeners.get(event)?.delete(handler)
        return this
      }

      emit(event: string, payload?: unknown) {
        for (const handler of this.listeners.get(event) ?? []) handler(payload)
      }

      getCanvas() {
        return { style: { cursor: '' } }
      }

      remove() {}
    },
  },
}))

vi.mock('@navi/editor', () => {
  const dispatcher = { execute: vi.fn() }
  const toolRegistry = probe.toolRegistry
  const services = { get: (id: string) => id === 'dispatcher' ? dispatcher : id === 'toolRegistry' ? toolRegistry : undefined }
  return {
    CAMPUS_TOOL_GROUPS: [],
    useEditor: () => ({ document: { roads: [] }, services }),
    useToolDockShortcuts: vi.fn(),
  }
})

vi.mock('@/store/studio-store', () => ({
  useStudioStore: (selector: (state: typeof probe.studioState) => unknown) => selector(probe.studioState),
}))

vi.mock('@/store/graph-store', () => ({
  useGraphStore: Object.assign(
    (selector: (state: typeof probe.graphState) => unknown) => selector(probe.graphState),
    { getState: () => probe.graphState, setState: vi.fn() },
  ),
}))

vi.mock('../CampusBoundary', () => ({ useCampusBoundary: vi.fn() }))
vi.mock('../OsmImportTool', () => ({ useOsmImportTool: vi.fn(), ImportToast: () => null }))
vi.mock('../BuildingTracer', () => ({ useBuildingTracer: vi.fn() }))
vi.mock('../useVertexEditor', () => ({ useVertexEditor: vi.fn() }))
vi.mock('../useMarkerDrag', () => ({ useMarkerDrag: vi.fn() }))
vi.mock('../usePoiEditor', () => ({ usePoiEditor: vi.fn() }))
vi.mock('../ConfirmBar', () => ({ ConfirmBar: () => null }))
vi.mock('../ConfirmOverlayAdapter', () => ({ ConfirmOverlayAdapter: () => null }))
vi.mock('../ConnectionChoice', () => ({ ConnectionChoice: () => null }))
vi.mock('../SelectionOverlay', () => ({ SelectionOverlay: () => null }))
vi.mock('../ValidationIssueOverlay', () => ({ ValidationIssueOverlay: () => null }))
vi.mock('../DrawingOverlay', () => ({ DrawingOverlay: () => null }))
vi.mock('../PreviewOverlay', () => ({ PreviewOverlay: () => null }))
vi.mock('../SnapPreviewOverlay', () => ({ SnapPreviewOverlay: () => null }))
vi.mock('../useDrawingSession', () => ({
  DrawingSessionProvider: ({ children }: { children: unknown }) => children,
  useDrawingSession: () => ({}),
}))
vi.mock('../ViewportController', () => ({ ViewportController: () => null }))
vi.mock('../useToolController', () => ({ useToolController: vi.fn() }))
vi.mock('../InteractionController', () => ({ InteractionController: () => null }))
vi.mock('../POIGeometryAuthoring', () => ({ POIGeometryAuthoring: () => null }))
vi.mock('../rendering/EntityRendererBridge', () => ({ EntityRendererBridge: () => null }))
vi.mock('../rendering/NavigationGraphRenderer', () => ({
  NavigationGraphRenderer: () => null,
  getInitialMapStyle: () => ({}),
}))
vi.mock('../rendering/satellite', () => ({ reportMapError: vi.fn() }))
vi.mock('../StyleSelector', () => ({ StyleSelector: () => null }))
vi.mock('../RotationHandle', () => ({ RotationHandle: () => null }))
vi.mock('../PositionEditHint', () => ({ PositionEditHint: () => null }))

describe('StudioCanvas pointer-move work', () => {
  afterEach(() => {
    probe.map = null
    probe.studioState = { tool: 'vertex', isVertexEditing: true, positionEditTarget: null }
    probe.toolRegistry.activeToolId = 'route'
    vi.clearAllMocks()
  })

  it('does not commit StudioCanvas for map moves while editing a road vertex', async () => {
    const commits: Array<{ phase: string; actualDuration: number }> = []
    render(
      <Profiler id="studio-canvas" onRender={(_id, phase, actualDuration) => commits.push({ phase, actualDuration })}>
        <StudioCanvas />
      </Profiler>,
    )

    await waitFor(() => expect(probe.map).not.toBeNull())
    const map = probe.map
    if (!map) throw new Error('The StudioCanvas map double was not created')
    const commitCountBeforeMoves = commits.length
    const moveCount = 60

    for (let index = 1; index <= moveCount; index += 1) {
      act(() => {
        map.emit('mousemove', {
          point: { x: 10 + index, y: 20 - index },
          lngLat: { lat: 33.42 + index * 0.0000001, lng: -111.93 + index * 0.0000001 },
        })
      })
    }

    const moveCommits = commits.slice(commitCountBeforeMoves)
    const actualDurations = moveCommits.map((commit) => commit.actualDuration).sort((left, right) => left - right)
    const medianMs = actualDurations[Math.floor(actualDurations.length / 2)] ?? 0
    const worstMs = actualDurations.at(-1) ?? 0
    console.info('[studio canvas move probe]', JSON.stringify({
      moveCount,
      reactCommits: moveCommits.length,
      medianReactCommitMs: Number(medianMs.toFixed(4)),
      worstReactCommitMs: Number(worstMs.toFixed(4)),
      timingScope: 'React Profiler with editor child components stubbed; excludes browser and MapLibre rendering',
    }))

    expect(moveCommits).toHaveLength(0)
  })

  it('keeps route snap preview cursor updates active during route authoring', async () => {
    probe.studioState = { tool: 'route', isVertexEditing: false, positionEditTarget: null }
    probe.toolRegistry.activeToolId = 'route'
    const commits: Array<{ phase: string; actualDuration: number }> = []
    render(
      <Profiler id="studio-canvas-route" onRender={(_id, phase, actualDuration) => commits.push({ phase, actualDuration })}>
        <StudioCanvas />
      </Profiler>,
    )

    await waitFor(() => expect(probe.map).not.toBeNull())
    const map = probe.map
    if (!map) throw new Error('The StudioCanvas map double was not created')
    const commitCountBeforeMoves = commits.length
    const moveCount = 10
    for (let index = 1; index <= moveCount; index += 1) {
      act(() => map.emit('mousemove', {
        point: { x: index, y: index },
        lngLat: { lat: 33.42 + index * 0.000001, lng: -111.93 + index * 0.000001 },
      }))
    }

    expect(commits.slice(commitCountBeforeMoves)).toHaveLength(moveCount)
  })
})
