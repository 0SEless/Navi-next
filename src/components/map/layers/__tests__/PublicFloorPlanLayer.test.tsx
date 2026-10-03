import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type maplibregl from 'maplibre-gl'
import type { Building } from '@/types/nav-types'

const sync = vi.fn()
vi.mock('@/lib/floor-plan-map-source', () => ({ syncFloorPlanImageLayer: (...args: unknown[]) => sync(...args) }))
import { PublicFloorPlanLayer } from '../PublicFloorPlanLayer'

const building: Building = {
  id: 'hall', name: 'Hall', campusId: 'campus', floors: [0, 1, 2],
  footprint: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }],
  baseElevation: 0, height: 12,
  floorData: [0, 1, 2].map(level => ({ level, planImageId: `floor-${level}`, planAlignment: { opacity: level / 4 } })),
}

describe('PublicFloorPlanLayer', () => {
  it('synchronizes the selected floor when the map becomes idle after mount', () => {
    sync.mockClear()
    let styleLoaded = false
    const listeners = new Map<string, () => void>()
    const map = {
      isStyleLoaded: () => styleLoaded,
      on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
      off: vi.fn(),
    } as unknown as maplibregl.Map

    render(<PublicFloorPlanLayer map={map} building={building} level={0} />)
    expect(sync).not.toHaveBeenCalled()

    styleLoaded = true
    listeners.get('idle')?.()

    expect(sync).toHaveBeenCalledWith(map, expect.objectContaining({ imageUrl: 'floor-0' }))
  })

  it('sends the selected floor to the map source and clears it outside indoor context', () => {
    sync.mockClear()
    const map = {
      isStyleLoaded: () => true,
      on: vi.fn(), off: vi.fn(),
    } as unknown as maplibregl.Map
    const view = render(<PublicFloorPlanLayer map={map} building={building} level={0} />)
    expect(sync.mock.lastCall?.[1]).toMatchObject({ imageUrl: 'floor-0', opacity: 0 })
    view.rerender(<PublicFloorPlanLayer map={map} building={building} level={1} />)
    expect(sync.mock.lastCall?.[1]).toMatchObject({ imageUrl: 'floor-1', opacity: 0.25 })
    view.rerender(<PublicFloorPlanLayer map={map} building={building} level={2} />)
    expect(sync.mock.lastCall?.[1]).toMatchObject({ imageUrl: 'floor-2', opacity: 0.5 })
    view.rerender(<PublicFloorPlanLayer map={map} building={undefined} level={2} />)
    expect(sync.mock.lastCall?.[1]).toMatchObject({ imageUrl: undefined, footprint: [] })
  })
})
