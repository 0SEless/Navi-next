import { cleanup, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type maplibregl from 'maplibre-gl'
import { RouteLine } from '../RouteLine'

function createMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const layers = new Map<string, { id: string }>()
  return {
    sources,
    layers,
    getLayer: vi.fn((id: string) => layers.get(id)),
    getSource: vi.fn((id: string) => sources.get(id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    addLayer: vi.fn((layer: { id: string }) => layers.set(layer.id, layer)),
    fitBounds: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as maplibregl.Map & {
    sources: Map<string, { setData: ReturnType<typeof vi.fn> }>
    layers: Map<string, { id: string }>
    fitBounds: ReturnType<typeof vi.fn>
    addSource: ReturnType<typeof vi.fn>
    addLayer: ReturnType<typeof vi.fn>
    removeSource: ReturnType<typeof vi.fn>
    removeLayer: ReturnType<typeof vi.fn>
  }
}

const route = { path: ['start', 'end'], cost: 10 }

describe('RouteLine camera ownership seam', () => {
  it('keeps rendering route layers without fitting when the canonical camera opts out', () => {
    const map = createMap()

    render(
      <RouteLine
        map={map}
        route={route}
        getNodePosition={(nodeId) => nodeId === 'start'
          ? { lat: 11.82, lng: 122.168 }
          : { lat: 11.821, lng: 122.169 }}
        fitCamera={false}
      />,
    )

    expect(map.addSource).toHaveBeenCalledWith('route', expect.anything())
    expect(map.addLayer).toHaveBeenCalledTimes(3)
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('keeps route source/layers registered when route wrapper identity changes', () => {
    const map = createMap()
    const getNodePosition = (nodeId: string) => nodeId === 'start'
      ? { lat: 11.82, lng: 122.168 }
      : { lat: 11.821, lng: 122.169 }
    const view = render(
      <RouteLine map={map} route={route} getNodePosition={getNodePosition} fitCamera={false} />,
    )
    const source = map.sources.get('route')
    const initialDataCalls = source?.setData.mock.calls.length ?? 0

    view.rerender(
      <RouteLine
        map={map}
        route={{ path: [...route.path], cost: route.cost + 1 }}
        getNodePosition={getNodePosition}
        fitCamera={false}
      />,
    )

    expect(map.addSource).toHaveBeenCalledTimes(1)
    expect(map.addLayer).toHaveBeenCalledTimes(3)
    expect(map.removeSource).not.toHaveBeenCalled()
    expect(map.removeLayer).not.toHaveBeenCalled()
    expect(source?.setData).toHaveBeenCalledTimes(initialDataCalls)
  })

  it('updates route data through the existing source when the path changes', () => {
    const map = createMap()
    const getNodePosition = (nodeId: string) => ({
      lat: nodeId === 'next' ? 11.822 : 11.82,
      lng: nodeId === 'next' ? 122.17 : 122.168,
    })
    const view = render(
      <RouteLine map={map} route={route} getNodePosition={getNodePosition} fitCamera={false} />,
    )
    const source = map.sources.get('route')
    const initialDataCalls = source?.setData.mock.calls.length ?? 0

    view.rerender(
      <RouteLine
        map={map}
        route={{ path: ['start', 'next'], cost: 12 }}
        getNodePosition={getNodePosition}
        fitCamera={false}
      />,
    )

    expect(map.addSource).toHaveBeenCalledTimes(1)
    expect(map.addLayer).toHaveBeenCalledTimes(3)
    expect(map.removeSource).not.toHaveBeenCalled()
    expect(map.removeLayer).not.toHaveBeenCalled()
    expect(source?.setData).toHaveBeenCalledTimes(initialDataCalls + 1)
    expect(source?.setData.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'FeatureCollection',
      features: [expect.objectContaining({ geometry: { type: 'LineString', coordinates: expect.any(Array) } })],
    })
  })

  it('does not refit the same route when style rehydration remounts the resources', () => {
    const map = createMap()
    const props = {
      map,
      route,
      getNodePosition: (nodeId: string) => nodeId === 'start'
        ? { lat: 11.82, lng: 122.168 }
        : { lat: 11.821, lng: 122.169 },
      fitCamera: true,
    }
    const first = render(<RouteLine {...props} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<RouteLine {...props} />)

    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
