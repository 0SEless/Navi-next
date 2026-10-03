import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStudioStore } from '@/store/studio-store'
import { useVertexEditor } from '../useVertexEditor'

const mockUseEditor = vi.hoisted(() => vi.fn())
const mockUseEditingEngine = vi.hoisted(() => vi.fn())
const mockBuildRoadJunctionMovePlan = vi.hoisted(() => vi.fn())

vi.mock('@navi/editor', () => ({
  useEditor: mockUseEditor,
  useEditingEngine: mockUseEditingEngine,
  buildRoadJunctionMovePlan: mockBuildRoadJunctionMovePlan,
}))

type Source = {
  data: GeoJSON.FeatureCollection
  setDataCalls: number
  setData: (data: GeoJSON.FeatureCollection) => void
}
type MapListener = (event?: unknown) => void
type VertexEditorMap = NonNullable<Parameters<typeof useVertexEditor>[0]>

function createMapDouble() {
  const sources = new Map<string, Source>()
  const layers = new Set<string>()
  const listeners = new Map<string, Set<MapListener>>()
  const capturedPointers = new Set<number>()
  const canvas = document.createElement('canvas')
  Object.assign(canvas, {
    getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, x: 0, y: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) })),
    setPointerCapture: vi.fn((pointerId: number) => capturedPointers.add(pointerId)),
    releasePointerCapture: vi.fn((pointerId: number) => capturedPointers.delete(pointerId)),
    hasPointerCapture: vi.fn((pointerId: number) => capturedPointers.has(pointerId)),
  })

  function createHandler() {
    let enabled = true
    return {
      enable: vi.fn(() => { enabled = true }),
      disable: vi.fn(() => { enabled = false }),
      isEnabled: vi.fn(() => enabled),
    }
  }

  function listenersFor(event: string) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    return listeners.get(event)!
  }

  const map = {
    getSource: vi.fn((id: string) => sources.get(id) ?? null),
    addSource: vi.fn((id: string, definition: { data: GeoJSON.FeatureCollection }) => {
      const source: Source = {
        data: definition.data,
        setDataCalls: 0,
        setData(data) {
          source.setDataCalls += 1
          source.data = data
        },
      }
      sources.set(id, source)
    }),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : null),
    addLayer: vi.fn((definition: { id: string }) => { layers.add(definition.id) }),
    moveLayer: vi.fn(),
    queryRenderedFeatures: vi.fn(() => [{ properties: { index: 0 } }]),
    on: vi.fn((event: string, handler: MapListener) => {
      listenersFor(event).add(handler)
    }),
    off: vi.fn((event: string, handler: MapListener) => {
      listeners.get(event)?.delete(handler)
    }),
    getCanvas: vi.fn(() => canvas),
    unproject: vi.fn((point: { x: number; y: number }) => ({
      lat: 33.42 + point.y * 0.0000001,
      lng: -111.93 + point.x * 0.0000001,
    })),
    dragPan: createHandler(),
    boxZoom: createHandler(),
    doubleClickZoom: createHandler(),
  }

  return {
    map,
    canvas,
    sources,
    reloadStyle() {
      sources.clear()
      layers.clear()
      for (const listener of listenersFor('style.load')) listener()
    },
    emit(event: string, payload?: unknown) {
      for (const listener of listenersFor(event)) listener(payload)
    },
    emitPointer(target: 'canvas' | 'window', type: string, x: number, y: number, pointerId = 1) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
      Object.defineProperties(event, {
        pointerId: { value: pointerId },
        isPrimary: { value: true },
      })
      ;(target === 'canvas' ? canvas : window).dispatchEvent(event)
    },
  } as unknown as VertexEditorMap
}

const road = {
  id: 'road-1',
  name: 'Main Road',
  polyline: {
    points: [
      { lat: 33.42, lng: -111.93 },
      { lat: 33.421, lng: -111.929 },
    ],
  },
  width: 6,
  surface: 'paved',
  type: 'arterial',
  metadata: {},
}

let dispatcherExecute = vi.fn()
let workflowSave = vi.fn()
let editEngineBegin = vi.fn()
let editEngineDoCommit = vi.fn()
let scheduledFrames = new Map<number, FrameRequestCallback>()
let nextFrameId = 0

function flushAnimationFrame() {
  const callbacks = [...scheduledFrames.values()]
  scheduledFrames.clear()
  act(() => callbacks.forEach((callback) => callback(performance.now())))
}

describe('useVertexEditor', () => {
  beforeEach(() => {
    scheduledFrames = new Map()
    nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      scheduledFrames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { scheduledFrames.delete(id) })
    dispatcherExecute = vi.fn()
    workflowSave = vi.fn()
    editEngineBegin = vi.fn()
    editEngineDoCommit = vi.fn()
    mockUseEditor.mockReturnValue({
      document: { roads: [road] },
      services: {
        get: (id: string) => {
          if (id === 'dispatcher') return { execute: dispatcherExecute }
          if (id === 'workflow') return { save: workflowSave }
          return undefined
        },
      },
    })
    mockUseEditingEngine.mockReturnValue({ begin: editEngineBegin, doCommit: editEngineDoCommit })
    mockBuildRoadJunctionMovePlan.mockReset()
    useStudioStore.setState({
      isVertexEditing: false,
      editTargetType: null,
      editTargetId: null,
      tool: 'select',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    useStudioStore.setState({
      isVertexEditing: false,
      editTargetType: null,
      editTargetId: null,
      tool: 'select',
    })
  })

  it('repaints the selected road vertices after a MapLibre style reload', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))

    act(() => {
      useStudioStore.getState().setVertexEditing('trace', road.id)
    })

    expect(harness.sources.get('vertex-source')?.data.features).toHaveLength(4)

    act(() => {
      harness.reloadStyle()
    })

    const features = harness.sources.get('vertex-source')?.data.features ?? []
    expect(features.filter((feature) => feature.geometry.type === 'Point')).toHaveLength(3)
    expect(features.some((feature) => feature.geometry.type === 'LineString')).toBe(true)
  })

  it('persists a dragged route vertex through the road update command', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))

    act(() => {
      useStudioStore.getState().setVertexEditing('trace', road.id)
    })

    const moved = { lat: 33.42 + 10 * 0.0000001, lng: -111.93 + 18 * 0.0000001 }
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 10))
    act(() => harness.emitPointer('window', 'pointermove', 18, 10))
    flushAnimationFrame()
    act(() => harness.emitPointer('window', 'pointerup', 18, 10))

    expect(dispatcherExecute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'entity.update',
      payload: {
        entityId: road.id,
        changes: { polyline: { points: [moved, road.polyline.points[1]] } },
      },
    }))
    expect(workflowSave).toHaveBeenCalledWith('manual')
  })

  it('moves freely near a road and remains free after moving away from it', () => {
    const harness = createMapDouble()
    const nearbyRoad = {
      ...road,
      id: 'road-nearby',
      polyline: { points: [{ lat: 33.42, lng: -111.92999 }, { lat: 33.421, lng: -111.92999 }] },
    }
    mockUseEditor.mockReturnValue({
      document: { roads: [road, nearbyRoad], roadJunctions: [] },
      services: {
        get: (id: string) => id === 'dispatcher' ? { execute: dispatcherExecute } : id === 'workflow' ? { save: workflowSave } : undefined,
      },
    })
    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 5))

    act(() => harness.emitPointer('window', 'pointermove', 110, 0, 5))
    flushAnimationFrame()
    const source = harness.sources.get('vertex-source')!
    const nearPoint = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(nearPoint?.geometry.type).toBe('Point')
    if (!nearPoint || nearPoint.geometry.type !== 'Point') return
    expect(nearPoint.geometry.coordinates[0]).toBeCloseTo(-111.929989, 10)
    expect(nearPoint.geometry.coordinates[1]).toBeCloseTo(33.42, 10)
    expect(dispatcherExecute).not.toHaveBeenCalled()

    act(() => harness.emitPointer('window', 'pointermove', 220, 0, 5))
    flushAnimationFrame()
    const awayPoint = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(awayPoint?.geometry.type).toBe('Point')
    if (!awayPoint || awayPoint.geometry.type !== 'Point') return
    expect(awayPoint.geometry.coordinates[0]).toBeCloseTo(-111.929978, 10)
    expect(awayPoint.geometry.coordinates[1]).toBeCloseTo(33.42, 10)

    act(() => harness.emitPointer('window', 'pointerup', 220, 0, 5))
    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(dispatcherExecute.mock.calls[0][0].payload.junctionMove).toBeUndefined()
    expect(dispatcherExecute.mock.calls[0][0].payload.changes.polyline.points[0].lat).toBeCloseTo(33.42, 10)
    expect(dispatcherExecute.mock.calls[0][0].payload.changes.polyline.points[0].lng).toBeCloseTo(-111.929978, 10)
  })

  it('traces pointer-to-overlay updates and keeps authored writes until release', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))

    act(() => {
      useStudioStore.getState().setVertexEditing('trace', road.id)
    })

    const source = harness.sources.get('vertex-source')!
    const storeWritesDuringMoves = vi.fn()
    const unsubscribe = useStudioStore.subscribe(() => storeWritesDuringMoves())
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20))
    const sourceWritesAfterPointerDown = source.setDataCalls

    const moveDurations: number[] = []
    const frameTrace: Array<Record<string, unknown>> = []
    const moveCount = 60
    for (let index = 1; index <= moveCount; index += 1) {
      const screen = { x: 10 + index, y: 20 - index }
      const projected = {
        lat: 33.42 + (20 - index) * 0.0000001,
        lng: -111.93 + (10 + index) * 0.0000001,
      }
      const startedAt = performance.now()
      const writesBeforeMove = source.setDataCalls
      const featureQueriesBeforeMove = harness.map.queryRenderedFeatures.mock.calls.length
      const storeWritesBeforeMove = storeWritesDuringMoves.mock.calls.length
      act(() => harness.emitPointer('window', 'pointermove', screen.x, screen.y))
      flushAnimationFrame()
      moveDurations.push(performance.now() - startedAt)

      const rendered = source.data.features.find((feature) =>
        feature.geometry.type === 'Point' && feature.properties?.index === 0,
      )
      expect(rendered?.geometry).toEqual({ type: 'Point', coordinates: [projected.lng, projected.lat] })
      if (rendered?.geometry.type === 'Point') {
        frameTrace.push({
          pointer: [screen.x, screen.y],
          projected: [projected.lng, projected.lat],
          requested: [projected.lng, projected.lat],
          overlaySource: rendered.geometry.coordinates,
          snap: 'none',
          documentWrite: dispatcherExecute.mock.calls.length > 0,
          graphProjection: 'not instrumented in this hook harness; no Document command before release',
          sourceSetData: source.setDataCalls > writesBeforeMove,
          storeUpdate: storeWritesDuringMoves.mock.calls.length > storeWritesBeforeMove,
          featureQuery: harness.map.queryRenderedFeatures.mock.calls.length > featureQueriesBeforeMove,
        })
      }
      expect(dispatcherExecute).not.toHaveBeenCalled()
      expect(editEngineBegin).not.toHaveBeenCalled()
      expect(editEngineDoCommit).not.toHaveBeenCalled()
      expect(workflowSave).not.toHaveBeenCalled()
    }

    unsubscribe()
    console.info('[road drag pointer frame trace]', JSON.stringify(frameTrace))
    const orderedDurations = [...moveDurations].sort((left, right) => left - right)
    const medianMs = orderedDurations[Math.floor(orderedDurations.length / 2)] ?? 0
    const worstMs = orderedDurations.at(-1) ?? 0
    console.info('[road drag probe]', JSON.stringify({
      moveCount,
      sourceSetDataCalls: source.setDataCalls - sourceWritesAfterPointerDown,
      mapFeatureQueriesDuringMoves: harness.map.queryRenderedFeatures.mock.calls.length - 1,
      documentCommandsBeforeRelease: dispatcherExecute.mock.calls.length,
      graphProjectionBeforeRelease: 'not instrumented in this hook harness; Document command count is zero',
      storeWritesDuringMoves: storeWritesDuringMoves.mock.calls.length,
      snap: 'none (no snap helper on this move path)',
      handlerMedianMs: Number(medianMs.toFixed(4)),
      handlerWorstMs: Number(worstMs.toFixed(4)),
      timingScope: 'hook callback with a synchronous MapLibre source double; excludes browser rendering and MapLibre worker work',
    }))

    expect(source.setDataCalls - sourceWritesAfterPointerDown).toBe(moveCount)
    expect(harness.map.queryRenderedFeatures).toHaveBeenCalledTimes(1)
    expect(storeWritesDuringMoves).not.toHaveBeenCalled()

    act(() => harness.emitPointer('window', 'pointerup', 70, -40))

    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(editEngineBegin).toHaveBeenCalledTimes(1)
    expect(editEngineDoCommit).toHaveBeenCalledTimes(1)
    expect(workflowSave).toHaveBeenCalledTimes(1)
  })

  it('captures the pointer outside the handle, batches visual updates, and commits the release coordinate', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))

    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))
    expect(harness.map.dragPan.isEnabled()).toBe(true)

    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 7))
    expect(harness.canvas.setPointerCapture).toHaveBeenCalledWith(7)
    expect(harness.map.dragPan.isEnabled()).toBe(false)
    expect(harness.map.boxZoom.isEnabled()).toBe(false)
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(false)

    const source = harness.sources.get('vertex-source')!
    const callsAfterPointerDown = source.setDataCalls
    act(() => {
      for (let index = 1; index <= 60; index += 1) {
        harness.emitPointer('window', 'pointermove', 120 + index * 3, 80 + index * 2, 7)
      }
    })
    expect(source.setDataCalls).toBe(callsAfterPointerDown)
    flushAnimationFrame()
    expect(source.setDataCalls - callsAfterPointerDown).toBe(1)

    const release = { lat: 33.42 + 241 * 0.0000001, lng: -111.93 + 321 * 0.0000001 }
    act(() => harness.emitPointer('window', 'pointerup', 321, 241, 7))

    const rendered = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(rendered?.geometry).toEqual({ type: 'Point', coordinates: [release.lng, release.lat] })
    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(dispatcherExecute.mock.calls[0][0].payload.changes.polyline.points[0]).toEqual(release)
    expect(harness.canvas.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(harness.map.dragPan.isEnabled()).toBe(true)
    expect(harness.map.boxZoom.isEnabled()).toBe(true)
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(false)

    act(() => useStudioStore.getState().setVertexEditing(null, null))
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(true)
  })

  it('cancels a captured drag without committing and restores the original overlay and map handlers', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))

    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 3))
    act(() => harness.emitPointer('window', 'pointermove', 200, 160, 3))
    flushAnimationFrame()
    act(() => harness.emitPointer('window', 'pointercancel', 200, 160, 3))

    const source = harness.sources.get('vertex-source')!
    const rendered = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(rendered?.geometry).toEqual({ type: 'Point', coordinates: [-111.93, 33.42] })
    expect(dispatcherExecute).not.toHaveBeenCalled()
    expect(workflowSave).not.toHaveBeenCalled()
    expect(harness.canvas.releasePointerCapture).toHaveBeenCalledWith(3)
    expect(harness.map.dragPan.isEnabled()).toBe(true)
    expect(harness.map.boxZoom.isEnabled()).toBe(true)
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(false)

    act(() => useStudioStore.getState().setVertexEditing(null, null))
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(true)
  })

  it('preserves a pre-disabled double-click zoom handler when vertex editing ends', () => {
    const harness = createMapDouble()
    harness.map.doubleClickZoom.disable()
    renderHook(() => useVertexEditor(harness.map))

    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(false)

    act(() => useStudioStore.getState().setVertexEditing(null, null))
    expect(harness.map.doubleClickZoom.isEnabled()).toBe(false)
  })

  it('keeps all authored roads at a junction attached to the transient dragged point', () => {
    const harness = createMapDouble()
    const junctionPosition = { lat: 0, lng: 0 }
    const roadA = { ...road, id: 'road-a', polyline: { points: [junctionPosition, { lat: 0, lng: -0.001 }] } }
    const roadB = { ...road, id: 'road-b', polyline: { points: [{ lat: -0.001, lng: 0 }, junctionPosition, { lat: 0.001, lng: 0 }] } }
    mockBuildRoadJunctionMovePlan.mockImplementation((document, request) => {
      const junction = document.roadJunctions.find((candidate: { id: string }) => candidate.id === request.junctionId)
      if (!junction) return null
      return {
        junctionId: junction.id,
        position: request.position,
        previousPosition: junction.position,
        roads: document.roads.map((candidate: typeof roadA | typeof roadB) => ({
          roadId: candidate.id,
          previousPoints: candidate.polyline.points,
          points: candidate.polyline.points.map((point) =>
            point.lat === junction.position.lat && point.lng === junction.position.lng ? request.position : point,
          ),
        })),
      }
    })
    mockUseEditor.mockReturnValue({
      document: {
        roads: [roadA, roadB],
        roadJunctions: [{ id: 'junction-ab', position: junctionPosition, roadIds: ['road-a', 'road-b'], source: 'authored' }],
      },
      services: {
        get: (id: string) => id === 'dispatcher' ? { execute: dispatcherExecute } : id === 'workflow' ? { save: workflowSave } : undefined,
      },
    })
    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', roadA.id))

    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 11))
    act(() => harness.emitPointer('window', 'pointermove', 120, 180, 11))
    flushAnimationFrame()

    const source = harness.sources.get('vertex-source')!
    const connectedLine = source.data.features.find((feature) => feature.properties?.roadId === 'road-b')
    expect(connectedLine?.geometry.type).toBe('LineString')
    if (!connectedLine || connectedLine.geometry.type !== 'LineString') return
    expect(connectedLine.geometry.coordinates[0]).toEqual([0, -0.001])
    expect(connectedLine.geometry.coordinates[1][0]).toBeCloseTo(-111.929988, 10)
    expect(connectedLine.geometry.coordinates[1][1]).toBeCloseTo(33.420018, 10)
    expect(connectedLine.geometry.coordinates[2]).toEqual([0, 0.001])
    expect(dispatcherExecute).not.toHaveBeenCalled()

    act(() => harness.emitPointer('window', 'pointerup', 120, 180, 11))
    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    const junctionMove = dispatcherExecute.mock.calls[0][0].payload.junctionMove
    expect(junctionMove.junctionId).toBe('junction-ab')
    expect(junctionMove.position.lat).toBeCloseTo(33.420018, 10)
    expect(junctionMove.position.lng).toBeCloseTo(-111.929988, 10)
  })
})
