import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { CampusDocument } from '@navi/core'
import { useStudioStore } from '@/store/studio-store'
import { useVertexEditor } from '../useVertexEditor'

const mockUseEditor = vi.hoisted(() => vi.fn())
const mockUseEditingEngine = vi.hoisted(() => vi.fn())
const mockBuildRoadJunctionMovePlan = vi.hoisted(() => vi.fn())
const mockAutosave = vi.hoisted(() => ({
  setTransientInteractionActive: vi.fn(),
}))

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
    getCanvas: vi.fn(() => canvas),
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
    unproject: vi.fn((point: { x: number; y: number } | [number, number]) => {
      const x = Array.isArray(point) ? point[0] : point.x
      const y = Array.isArray(point) ? point[1] : point.y
      return {
        lat: 33.42 + y * 0.0000001,
        lng: -111.93 + x * 0.0000001,
      }
    }),
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
    emitCanvas(event: string, payload?: Event) {
      canvas.dispatchEvent(payload ?? new Event(event, { bubbles: true, cancelable: true }))
    },
    emitPointer(target: 'canvas' | 'window', type: string, x: number, y: number, pointerId = 1) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
      Object.defineProperties(event, {
        pointerId: { value: pointerId },
        isPrimary: { value: true },
      })
      ;(target === 'canvas' ? canvas : window).dispatchEvent(event)
    },
  } as unknown as VertexEditorMap & {
    canvas: HTMLCanvasElement & {
      setPointerCapture: ReturnType<typeof vi.fn>
      releasePointerCapture: ReturnType<typeof vi.fn>
      hasPointerCapture: ReturnType<typeof vi.fn>
    }
    sources: Map<string, Source>
    reloadStyle: () => void
    emit: (event: string, payload?: unknown) => void
    emitCanvas: (event: string, payload?: Event) => void
    emitPointer: (target: 'canvas' | 'window', type: string, x: number, y: number, pointerId?: number) => void
  }
}

let scheduledFrames = new Map<number, FrameRequestCallback>()
let nextFrameId = 0

function flushAnimationFrame() {
  const callbacks = [...scheduledFrames.values()]
  scheduledFrames.clear()
  act(() => callbacks.forEach((callback) => callback(performance.now())))
}
const road: CampusDocument['roads'][number] = {
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
    const serviceMap = new Map<string, unknown>([
      ['dispatcher', { execute: dispatcherExecute }],
      ['workflow', { save: workflowSave }],
      ['autosave', mockAutosave],
    ])
    mockUseEditor.mockReturnValue({
      document: { roads: [road] },
      services: {
        get: (id: string) => serviceMap.get(id),
      },
    })
    editEngineBegin = vi.fn()
    editEngineDoCommit = vi.fn()
    mockUseEditingEngine.mockImplementation(() => ({ begin: editEngineBegin, doCommit: editEngineDoCommit }))
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
    mockAutosave.setTransientInteractionActive.mockClear()
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

  it('keeps pointer capture and commits once across an unrelated rerender', () => {
    const harness = createMapDouble()
    const rendered = renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))

    const source = harness.sources.get('vertex-source')!
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 31))
    act(() => harness.emitPointer('window', 'pointermove', 40, 50, 31))
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(true)

    rendered.rerender()

    expect(harness.canvas.hasPointerCapture(31)).toBe(true)
    expect(dispatcherExecute).not.toHaveBeenCalled()
    act(() => harness.emitPointer('window', 'pointermove', 70, 90, 31))
    flushAnimationFrame()

    const release = harness.map.unproject({ x: 80, y: 100 })
    act(() => harness.emitPointer('window', 'pointerup', 80, 100, 31))

    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(workflowSave).toHaveBeenCalledTimes(1)
    expect(harness.canvas.releasePointerCapture).toHaveBeenCalledWith(31)
    expect(harness.map.dragPan.isEnabled()).toBe(true)
    expect(harness.map.boxZoom.isEnabled()).toBe(true)
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
    const finalVertex = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(finalVertex?.geometry).toEqual({ type: 'Point', coordinates: [release.lng, release.lat] })
  })
  it('persists the native pointer release coordinate through the road update command', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))

    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))

    const moved = harness.map.unproject({ x: 18, y: 10 })
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 10, 4))
    act(() => harness.emitPointer('window', 'pointermove', 18, 10, 4))
    flushAnimationFrame()
    act(() => harness.emitPointer('window', 'pointerup', 18, 10, 4))

    expect(dispatcherExecute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'entity.update',
      payload: {
        entityId: road.id,
        changes: { polyline: { points: [moved, road.polyline.points[1]] } },
      },
    }))
    expect(workflowSave).toHaveBeenCalledWith('manual')
  })

  it('gates autosave only while a route vertex is actually moving', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))

    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 10, 5))
    expect(mockAutosave.setTransientInteractionActive).not.toHaveBeenCalledWith(true)

    act(() => harness.emitPointer('window', 'pointermove', 18, 10, 5))
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(true)
    flushAnimationFrame()

    act(() => harness.emitPointer('window', 'pointerup', 18, 10, 5))
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
  })

  it('releases the autosave gate when a captured pointer is cancelled or unmounted', () => {
    const harness = createMapDouble()
    const rendered = renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))

    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 10, 6))
    act(() => harness.emitPointer('window', 'pointermove', 18, 10, 6))
    flushAnimationFrame()
    act(() => harness.emitPointer('window', 'pointercancel', 18, 10, 6))
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)

    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 10, 7))
    act(() => harness.emitPointer('window', 'pointermove', 18, 10, 7))
    flushAnimationFrame()
    rendered.unmount()
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
    expect(harness.canvas.releasePointerCapture).toHaveBeenCalledWith(7)
  })
  it('keeps map pan enabled while vertex editing is idle', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))

    expect(harness.map.dragPan.isEnabled()).toBe(true)
  })

  it('captures a burst of sixty pointer moves, frame-batches previews, and commits only the release coordinate', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))
    const graphProjectionRequests = vi.fn()
    dispatcherExecute.mockImplementation(() => graphProjectionRequests())

    const source = harness.sources.get('vertex-source')!
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 17))
    expect(harness.canvas.setPointerCapture).toHaveBeenCalledWith(17)
    expect(harness.map.dragPan.isEnabled()).toBe(false)
    expect(harness.map.boxZoom.isEnabled()).toBe(false)

    const callsAfterDown = source.setDataCalls
    act(() => {
      for (let index = 1; index <= 60; index += 1) {
        harness.emitPointer('window', 'pointermove', 120 + index * 3, 80 + index * 2, 17)
      }
    })
    expect(source.setDataCalls).toBe(callsAfterDown)
    expect(dispatcherExecute).not.toHaveBeenCalled()
    expect(graphProjectionRequests).not.toHaveBeenCalled()
    expect(editEngineBegin).not.toHaveBeenCalled()
    expect(editEngineDoCommit).not.toHaveBeenCalled()
    expect(workflowSave).not.toHaveBeenCalled()
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(true)

    flushAnimationFrame()
    expect(source.setDataCalls - callsAfterDown).toBe(1)
    const previewPosition = harness.map.unproject({ x: 300, y: 200 })
    const previewPoint = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(previewPoint?.geometry.type).toBe('Point')
    if (!previewPoint || previewPoint.geometry.type !== 'Point') throw new Error('Vertex preview is missing')
    expect(previewPoint.geometry.coordinates).toEqual([previewPosition.lng, previewPosition.lat])
    expect(dispatcherExecute).not.toHaveBeenCalled()
    expect(graphProjectionRequests).not.toHaveBeenCalled()

    const release = harness.map.unproject({ x: 321, y: 241 })
    act(() => harness.emitPointer('window', 'pointerup', 321, 241, 17))

    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(graphProjectionRequests).toHaveBeenCalledTimes(1)
    expect(editEngineBegin).toHaveBeenCalledTimes(1)
    expect(editEngineDoCommit).toHaveBeenCalledTimes(1)
    expect(workflowSave).toHaveBeenCalledTimes(1)
    expect(dispatcherExecute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'entity.update',
      payload: expect.objectContaining({
        entityId: road.id,
        changes: expect.objectContaining({
          polyline: expect.objectContaining({
            points: expect.arrayContaining([release]),
          }),
        }),
      }),
    }))
    expect(harness.canvas.releasePointerCapture).toHaveBeenCalledWith(17)
    expect(harness.map.dragPan.isEnabled()).toBe(true)
    expect(harness.map.boxZoom.isEnabled()).toBe(true)
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
    const sourceCallsAfterRelease = source.setDataCalls
    act(() => harness.emitPointer('window', 'pointermove', 350, 250, 17))
    expect(source.setDataCalls).toBe(sourceCallsAfterRelease)
    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
  })

  it('commits the last intended coordinate on pointercancel and restores map handlers', () => {
    const harness = createMapDouble()
    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', road.id))

    const source = harness.sources.get('vertex-source')!
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 23))
    act(() => harness.emitPointer('window', 'pointermove', 200, 160, 23))
    flushAnimationFrame()

    const canceledAt = harness.map.unproject({ x: 200, y: 160 })
    act(() => harness.emitPointer('window', 'pointercancel', 200, 160, 23))
    const selectedPoint = source.data.features.find((feature) => feature.geometry.type === 'Point' && feature.properties?.index === 0)
    expect(selectedPoint?.geometry).toEqual({ type: 'Point', coordinates: [canceledAt.lng, canceledAt.lat] })
    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(workflowSave).toHaveBeenCalledTimes(1)
    expect(harness.canvas.releasePointerCapture).toHaveBeenCalledWith(23)
    expect(harness.map.dragPan.isEnabled()).toBe(true)
    expect(harness.map.boxZoom.isEnabled()).toBe(true)
    expect(mockAutosave.setTransientInteractionActive).toHaveBeenLastCalledWith(false)
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

  it('keeps connected road geometry attached to an authored junction during preview and release', () => {
    const harness = createMapDouble()
    const junctionPosition = { lat: 33.42, lng: -111.93 }
    const roadA = {
      ...road,
      polyline: { points: [junctionPosition, { lat: 33.421, lng: -111.929 }] },
    }
    const roadB = {
      ...road,
      id: 'road-2',
      polyline: { points: [{ lat: 33.419, lng: -111.93 }, junctionPosition, { lat: 33.421, lng: -111.93 }] },
    }
    const nextPosition = harness.map.unproject({ x: 120, y: 180 })
    const junctions = [{ id: 'junction-ab', position: junctionPosition, roadIds: [roadA.id, roadB.id], source: 'authored' }]
    const document = { roads: [roadA, roadB], roadJunctions: junctions }
    const plan = (position: { lat: number; lng: number }) => ({
      junctionId: 'junction-ab',
      position,
      previousPosition: junctionPosition,
      roads: [
        {
          roadId: roadA.id,
          previousPoints: roadA.polyline.points,
          points: [position, roadA.polyline.points[1]],
        },
        {
          roadId: roadB.id,
          previousPoints: roadB.polyline.points,
          points: [roadB.polyline.points[0], position, roadB.polyline.points[2]],
        },
      ],
    })
    mockBuildRoadJunctionMovePlan.mockReturnValueOnce(plan(junctionPosition)).mockReturnValue(plan(nextPosition))
    mockUseEditor.mockReturnValue({
      document,
      services: {
        get: (id: string) => {
          if (id === 'dispatcher') return { execute: dispatcherExecute }
          if (id === 'workflow') return { save: workflowSave }
          if (id === 'autosave') return mockAutosave
          return undefined
        },
      },
    })

    renderHook(() => useVertexEditor(harness.map))
    act(() => useStudioStore.getState().setVertexEditing('trace', roadA.id))
    act(() => harness.emitPointer('canvas', 'pointerdown', 10, 20, 29))
    act(() => harness.emitPointer('window', 'pointermove', 120, 180, 29))
    flushAnimationFrame()

    const source = harness.sources.get('vertex-source')!
    const connectedLine = source.data.features.find((feature) =>
      feature.geometry.type === 'LineString' && feature.properties?.roadId === roadB.id,
    )
    expect(connectedLine?.geometry.type).toBe('LineString')
    if (!connectedLine || connectedLine.geometry.type !== 'LineString') throw new Error('Connected road preview is missing')
    expect(connectedLine.geometry.coordinates[1]).toEqual([nextPosition.lng, nextPosition.lat])
    expect(dispatcherExecute).not.toHaveBeenCalled()

    act(() => harness.emitPointer('window', 'pointerup', 120, 180, 29))
    expect(dispatcherExecute).toHaveBeenCalledTimes(1)
    expect(dispatcherExecute).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        junctionMove: expect.objectContaining({
          junctionId: 'junction-ab',
          position: nextPosition,
        }),
      }),
    }))
  })
})
