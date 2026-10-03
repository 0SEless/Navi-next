import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Building, Component, NavEdge, NavNode } from '@/types/nav-types'
import { OutdoorRoutePicker } from '../OutdoorRoutePicker'

const mapMocks = vi.hoisted(() => ({
  lastMap: null as any,
}))

vi.mock('maplibre-gl', () => {
  class MockMap {
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    sources = new Map<string, any>()
    layers = new Map<string, any>()
    fitBounds = vi.fn()
    remove = vi.fn()
    isStyleLoaded = vi.fn(() => true)
    loaded = vi.fn(() => true)

    constructor() {
      mapMocks.lastMap = this
      setTimeout(() => this.fire('load'), 0)
    }

    on(event: string, layerOrHandler: unknown, maybeHandler?: (...args: any[]) => void) {
      const handler = (typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler) as (...args: any[]) => void
      const key = typeof layerOrHandler === 'string' ? `${event}:${layerOrHandler}` : event
      this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler])
      return this
    }

    off(event: string, layerOrHandler: unknown, maybeHandler?: (...args: any[]) => void) {
      const handler = (typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler) as (...args: any[]) => void
      const key = typeof layerOrHandler === 'string' ? `${event}:${layerOrHandler}` : event
      this.handlers.set(key, (this.handlers.get(key) ?? []).filter((candidate) => candidate !== handler))
      return this
    }

    fire(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }

    addSource(id: string, definition: Record<string, unknown>) {
      const source = { ...definition, setData: vi.fn((data: unknown) => { source.data = data }), data: definition.data }
      this.sources.set(id, source)
    }

    getSource(id: string) {
      return this.sources.get(id) ?? null
    }

    addLayer(layer: Record<string, unknown>) {
      this.layers.set(layer.id as string, layer)
    }

    getLayer(id: string) {
      return this.layers.get(id) ?? null
    }

    getCanvas() {
      return { style: {} }
    }
  }

  return { default: { Map: MockMap }, Map: MockMap }
})

const building = {
  id: 'building-1',
  name: 'Library',
  campusId: 'campus-1',
  floors: [0],
  footprint: [
    { lat: 14.5990, lng: 120.9840 },
    { lat: 14.5990, lng: 120.9850 },
    { lat: 14.6000, lng: 120.9850 },
    { lat: 14.6000, lng: 120.9840 },
  ],
  baseElevation: 0,
  height: 10,
} as Building

const entrance = {
  id: 'entrance-1',
  name: 'Main Entrance',
  position: { lat: 14.5995, lng: 120.9845 },
} as Pick<Component, 'id' | 'name' | 'position'>

const nodes: NavNode[] = [
  {
    id: 'outdoor-1', label: 'Walkway A', name: undefined,
    position: { lat: 14.59955, lng: 120.9845 }, floor: 0, buildingId: '__outdoor__', campusId: 'campus-1', type: 'outdoor',
  },
  {
    id: 'entrance-2', label: 'Gate B', name: undefined,
    position: { lat: 14.5999, lng: 120.9845 }, floor: 0, buildingId: '__outdoor__', campusId: 'campus-1', type: 'outdoor', metadata: { traceId: 'road-1' },
  },
  {
    id: 'room-1', label: 'Room 101', name: undefined,
    position: { lat: 14.5996, lng: 120.9845 }, floor: 0, buildingId: 'building-1', campusId: 'campus-1', type: 'room',
  },
]

const edges: NavEdge[] = [{
  id: 'outdoor-edge-1', from: 'outdoor-1', to: 'entrance-2', distance: 40, type: 'outdoor', campusId: 'campus-1',
}]

const campusNodes: NavNode[] = [
  {
    id: 'campus-start', label: 'Campus path', name: undefined,
    position: { lat: 14.5985, lng: 120.9835 }, floor: 0, buildingId: '__outdoor__', campusId: 'campus-1', type: 'outdoor',
  },
  {
    id: 'campus-junction-a', label: 'Junction A', name: undefined,
    position: { lat: 14.5988, lng: 120.9838 }, floor: 0, buildingId: '__outdoor__', campusId: 'campus-1', type: 'intersection', metadata: { traceId: 'campus-road-1' },
  },
  {
    id: 'campus-junction-b', label: 'Junction B', name: undefined,
    position: { lat: 14.5992, lng: 120.9841 }, floor: 0, buildingId: '__outdoor__', campusId: 'campus-1', type: 'intersection', metadata: { traceId: 'campus-road-1' },
  },
  {
    id: 'campus-entrance', label: 'Library Gate', name: undefined,
    position: { lat: 14.5999, lng: 120.9845 }, floor: 0, buildingId: '__outdoor__', campusId: 'campus-1', type: 'building_entrance',
  },
  {
    id: 'indoor-node', label: 'Indoor only', name: undefined,
    position: { lat: 14.5996, lng: 120.9845 }, floor: 0, buildingId: 'building-1', campusId: 'campus-1', type: 'room',
  },
]

const campusEdges: NavEdge[] = [
  { id: 'campus-segment-1', from: 'campus-start', to: 'campus-junction-a', distance: 30, type: 'outdoor', campusId: 'campus-1' },
  { id: 'campus-segment-2', from: 'campus-junction-a', to: 'campus-junction-b', distance: 30, type: 'outdoor', campusId: 'campus-1' },
  { id: 'campus-segment-3', from: 'campus-junction-b', to: 'campus-entrance', distance: 30, type: 'walkway', campusId: 'campus-1' },
]

const campusRoads = [{
  id: 'campus-road-1', name: 'Main Campus Road', width: 8, surface: 'paved', type: 'arterial', metadata: {},
  polyline: { points: [{ lat: 14.5982, lng: 120.9832 }, { lat: 14.6002, lng: 120.9852 }] },
}]

afterEach(() => {
  cleanup()
  mapMocks.lastMap = null
})

describe('OutdoorRoutePicker', () => {
  it('centers on the current building and shows eligible outdoor candidates', async () => {
    render(
      <OutdoorRoutePicker
        open
        building={building}
        entrance={entrance}
        nodes={nodes}
        edges={edges}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Choose outdoor route' })).toBeInTheDocument()
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Main Entrance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Walkway A/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gate B/ })).toBeInTheDocument()

    await waitFor(() => expect(mapMocks.lastMap.fitBounds).toHaveBeenCalled())
    expect(mapMocks.lastMap.fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxZoom: 20 }))
    expect(mapMocks.lastMap.getSource('picker-building')).not.toBeNull()
    expect(mapMocks.lastMap.getLayer('picker-outdoor-edges')).not.toBeNull()
  })

  it('selects a candidate and confirms the stable outdoor node without exposing an ID', async () => {
    const onConfirm = vi.fn()
    render(<OutdoorRoutePicker open building={building} entrance={entrance} nodes={nodes} edges={edges} onCancel={vi.fn()} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: /Walkway A/ }))
    expect(screen.getByText('Selected outdoor target')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Walkway A/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('outdoor-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm outdoor connection' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'outdoor-1', label: 'Walkway A' }))
  })

  it('resolves a route-line click to a new exact-position junction', async () => {
    render(<OutdoorRoutePicker open building={building} entrance={entrance} nodes={nodes} edges={edges} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    await waitFor(() => expect(mapMocks.lastMap.getLayer('picker-outdoor-edges-hit')).not.toBeNull())

    mapMocks.lastMap.fire('click:picker-outdoor-edges-hit', {
      features: [{ properties: { id: 'outdoor-edge-1' } }],
      lngLat: { lat: 14.59988, lng: 120.9845 },
    })

    await waitFor(() => expect(screen.getByText('Selected outdoor target')).toBeInTheDocument())
    expect(screen.getAllByText(/New junction on road-1/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Confirm outdoor connection' })).toBeEnabled()
  })

  it('selects a route node through the enlarged map hit surface and previews the pending link', async () => {
    render(<OutdoorRoutePicker open building={building} entrance={entrance} nodes={nodes} edges={edges} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    await waitFor(() => expect(mapMocks.lastMap.getLayer('picker-outdoor-nodes-hit')).not.toBeNull())

    mapMocks.lastMap.fire('click:picker-outdoor-nodes-hit', {
      features: [{ properties: { id: 'outdoor-1' } }],
    })

    await waitFor(() => expect(screen.getByText('Selected outdoor target')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Walkway A/ })).toHaveAttribute('aria-pressed', 'true')
    expect(mapMocks.lastMap.getSource('picker-pending-access').data.features).toHaveLength(1)
    expect(mapMocks.lastMap.getSource('picker-pending-access').data.features[0].properties).toEqual(expect.objectContaining({
      sourceId: 'entrance-1',
      targetId: 'outdoor-1',
    }))
  })

  it('opens on the actual campus map and renders every outdoor graph segment, including intermediate junctions', async () => {
    render(
      <OutdoorRoutePicker
        open
        building={building}
        entrance={entrance}
        nodes={campusNodes}
        edges={campusEdges}
        campusBuildings={[building, { ...building, id: 'building-2', name: 'Science Hall' }]}
        campusRoads={campusRoads}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    await waitFor(() => expect(mapMocks.lastMap.getSource('picker-campus-buildings')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'View full campus' }))

    expect(mapMocks.lastMap.getSource('picker-campus-buildings').data.features).toHaveLength(2)
    expect(mapMocks.lastMap.getSource('picker-campus-roads').data.features).toHaveLength(1)
    expect(mapMocks.lastMap.getSource('picker-outdoor-edges').data.features.map((feature: GeoJSON.Feature) => feature.properties?.id)).toEqual([
      'campus-segment-1',
      'campus-segment-2',
      'campus-segment-3',
    ])
    expect(mapMocks.lastMap.getSource('picker-campus-graph-nodes').data.features).toHaveLength(4)
    expect(mapMocks.lastMap.getSource('picker-outdoor-nodes').data.features).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Focus on current building' })).toBeInTheDocument()
    expect(mapMocks.lastMap.fitBounds).toHaveBeenCalled()
  })

  it('cancels without confirming a document mutation', () => {
    const onCancel = vi.fn()
    render(<OutdoorRoutePicker open building={building} entrance={entrance} nodes={nodes} edges={edges} onCancel={onCancel} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledOnce()
  })
})
