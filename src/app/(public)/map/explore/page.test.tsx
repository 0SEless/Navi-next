import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Building, CampusBundle } from '@/types/nav-types'
import { usePublicStore } from '@/store/public-store'
import ExplorePage from './page'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('next/dynamic', () => ({
  default: () => function ExploreMapStub() {
    return <div data-testid="explore-map-stub" />
  },
}))

const library: Building = {
  id: 'b1',
  name: 'Library',
  campusId: 'campus-1',
  floors: [1, 2],
  footprint: [
    { lat: 11.82, lng: 122.168 },
    { lat: 11.821, lng: 122.168 },
    { lat: 11.821, lng: 122.169 },
  ],
  baseElevation: 0,
  height: 12,
  category: 'Academic',
}

const authoredPoiEntry = {
  id: 'poi-study-area',
  label: 'Student Study Area',
  type: 'poi',
  position: { lat: 11.8205, lng: 122.1685 },
  tags: ['student', 'study', 'area'],
  category: 'study_area',
  buildingId: 'b1',
  floor: 1,
  floorId: 'f1',
  source: 'authored',
  sourceId: 'poi-study-area',
} as unknown as CampusBundle['searchEntries'][number]

const bundle = {
  nodes: [],
  edges: [],
  searchEntries: [
    {
      id: 'building-b1',
      label: 'Library',
      type: 'building',
      nodeId: 'building-destination-b1',
      buildingId: 'b1',
    },
    {
      id: 'room-b1-201',
      label: 'Room 201',
      type: 'room',
      nodeId: 'room-node-201',
      buildingId: 'b1',
      floor: 2,
    },
    authoredPoiEntry,
  ],
  buildings: [library],
  components: [],
  poi: [],
  boundingBox: null,
} satisfies CampusBundle

function setReadyCampus() {
  usePublicStore.setState({
    campus: bundle,
    campusLoading: false,
    campusError: null,
    selectedBuilding: null,
    sheetState: 'hidden',
    indoorContext: { active: false },
  })
}

afterEach(() => {
  cleanup()
  mocks.routerPush.mockReset()
  mocks.searchParams = new URLSearchParams()
  usePublicStore.setState({
    campus: null,
    campusLoading: false,
    campusError: null,
    selectedBuilding: null,
    sheetState: 'hidden',
    indoorContext: { active: false },
    activeFloor: 0,
  })
})

describe('ExplorePage discovery surface', () => {
  it('searches published entries and renders only backed category filters', () => {
    setReadyCampus()
    render(<ExplorePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Search campus' }))
    const searchbox = screen.getByRole('searchbox', { name: 'Search campus places' })
    fireEvent.change(searchbox, { target: { value: 'library' } })

    expect(screen.getByRole('button', { name: 'Explore Library' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explore Room 201' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Buildings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rooms' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entrances' })).toBeNull()
  })

  it('selects the result’s published building without routing or choosing an entrance', () => {
    setReadyCampus()
    render(<ExplorePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Search campus' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search campus places' }), {
      target: { value: 'library' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Explore Library' }))

    expect(usePublicStore.getState().selectedBuilding?.id).toBe('b1')
    expect(usePublicStore.getState().sheetState).toBe('half')
    expect(usePublicStore.getState().toNode).toBeNull()
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('shows an authored POI in discovery and opens its building without routing', () => {
    setReadyCampus()
    render(<ExplorePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Search campus' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search campus places' }), {
      target: { value: 'study area' },
    })

    expect(screen.getByRole('button', { name: 'POIs' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Explore Student Study Area' }))

    expect(usePublicStore.getState().selectedBuilding?.id).toBe('b1')
    expect(usePublicStore.getState().sheetState).toBe('half')
    expect(usePublicStore.getState().toNode).toBeNull()
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('opens a stable building handoff from the Home building_id query', async () => {
    setReadyCampus()
    mocks.searchParams = new URLSearchParams('building_id=b1')

    render(<ExplorePage />)

    await waitFor(() => {
      expect(usePublicStore.getState().selectedBuilding?.id).toBe('b1')
    })
    expect(usePublicStore.getState().sheetState).toBe('half')
  })

  it('exposes the three presentation modes without mutating published buildings', () => {
    setReadyCampus()
    const before = structuredClone(bundle.buildings)
    render(<ExplorePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Search campus' }))

    expect(screen.getByRole('group', { name: 'Map presentation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Department' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'NAVI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uniform' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'NAVI' }))
    expect(usePublicStore.getState().preferences.mapAppearance).toBe('navi')
    expect(bundle.buildings).toEqual(before)
  })

  it('shows explicit loading, error, and no-building states', () => {
    usePublicStore.setState({ campus: null, campusLoading: true, campusError: null })
    const { unmount } = render(<ExplorePage />)
    expect(screen.getByLabelText('Loading campus map')).toBeInTheDocument()

    unmount()
    usePublicStore.setState({ campus: null, campusLoading: false, campusError: 'Network unavailable' })
    render(<ExplorePage />)
    expect(screen.getByText("Couldn't load the campus map.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry loading campus map' })).toBeInTheDocument()

    cleanup()
    usePublicStore.setState({ campus: { ...bundle, buildings: [] }, campusLoading: false, campusError: null })
    render(<ExplorePage />)
    expect(screen.getByText('No buildings available on this campus yet.')).toBeInTheDocument()
  })
})
