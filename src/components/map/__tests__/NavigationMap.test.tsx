import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NavigationMap, {
  NavigationMapHost,
  NavigationMapProvider,
  type NavigationMapProps,
} from '../NavigationMap'

const mapInstances = vi.hoisted(() => [] as Array<{
  fitBounds: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  navigationControlOptions?: unknown
  mapOptions?: Record<string, unknown>
}>)

vi.mock('maplibre-gl', () => {
  class FakeMap {
    fitBounds = vi.fn()
    remove = vi.fn()
    resize = vi.fn()
    stop = vi.fn()
    navigationControlOptions?: unknown
    mapOptions: Record<string, unknown>

    constructor(options: Record<string, unknown>) {
      this.mapOptions = options
      mapInstances.push(this)
    }

    addControl(control: { options?: unknown }) {
      if (control.options) this.navigationControlOptions = control.options
    }

    setMaxPitch(value: number) { this.mapOptions.maxPitch = value }
    getMaxPitch() { return Number(this.mapOptions.maxPitch ?? 60) }
    off() { return this }

    on(type: string, listener: () => void) {
      if (type === 'load') queueMicrotask(listener)
      return this
    }
  }

  return {
    default: {
      Map: FakeMap,
      NavigationControl: class NavigationControl {
        constructor(public options?: unknown) {}
      },
      AttributionControl: class AttributionControl {},
    },
  }
})

const bounds = { minLat: 11.8, maxLat: 11.81, minLng: 122.1, maxLng: 122.11 }

function renderNavigationMap(props: NavigationMapProps) {
  return render(
    <NavigationMapProvider active surfaceKey="/map/explore">
      <div className="relative h-full w-full">
        <NavigationMapHost />
        <NavigationMap {...props} />
      </div>
    </NavigationMapProvider>,
  )
}

describe('NavigationMap scene adapter', () => {
  it('keeps a local MapLibre host for standalone consumers outside the map shell', async () => {
    mapInstances.length = 0
    render(<NavigationMap bounds={bounds} />)

    await waitFor(() => expect(mapInstances[0]?.fitBounds).toHaveBeenCalledTimes(1))
    expect(mapInstances).toHaveLength(1)
  })

  it('fits bounds once the shared map is ready', async () => {
    mapInstances.length = 0
    renderNavigationMap({ bounds })

    await waitFor(() => expect(mapInstances[0]?.fitBounds).toHaveBeenCalledTimes(1))
  })

  it('allows a route scene to opt out of campus bounds fitting', async () => {
    mapInstances.length = 0
    renderNavigationMap({ bounds, fitBoundsOnChange: false })

    await waitFor(() => expect(mapInstances[0]).toBeDefined())
    expect(mapInstances[0].fitBounds).not.toHaveBeenCalled()
  })

  it('configures the shared map with the requested zoom controls', async () => {
    mapInstances.length = 0
    renderNavigationMap({ showZoomControls: false })

    await waitFor(() => expect(mapInstances[0]).toBeDefined())
    expect(mapInstances[0].navigationControlOptions).toEqual({
      showCompass: false,
      showZoom: false,
    })
  })

  it('passes an explicit maximum pitch to the first MapLibre construction', async () => {
    mapInstances.length = 0
    renderNavigationMap({ maxPitch: 85 })

    await waitFor(() => expect(mapInstances[0]).toBeDefined())
    expect(mapInstances[0].mapOptions?.maxPitch).toBe(85)
  })
})
