import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Building, CampusBundle } from '@/types/nav-types'
import { usePublicStore } from '@/store/public-store'
import { BuildingSheet } from '../BuildingSheet'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

const building: Building = {
  id: 'b1',
  name: 'Library',
  campusId: 'campus-1',
  floors: [1, 3],
  footprint: [
    { lat: 11.82, lng: 122.168 },
    { lat: 11.821, lng: 122.168 },
    { lat: 11.821, lng: 122.169 },
  ],
  baseElevation: 0,
  height: 12,
  category: 'Academic',
  description: 'A quiet place to study.',
  entrances: [{
    id: 'entrance-north',
    label: 'North Entrance',
    floor: 1,
    position: { lat: 11.82, lng: 122.168 },
  }],
  metadata: {
    status: 'Open',
    imageUrl: '/campus/library.jpg',
    facilities: ['Wi-Fi', 'Study lounge'],
  },
}

const bundle = {
  nodes: [{
    id: 'entrance-node',
    label: 'North Entrance',
    position: { lat: 11.82, lng: 122.168 },
    floor: 1,
    buildingId: 'b1',
    campusId: 'campus-1',
    type: 'entrance',
  }],
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
      id: 'room-201',
      label: 'Room 201',
      type: 'room',
      nodeId: 'room-201-node',
      buildingId: 'b1',
      floor: 3,
    },
    {
      id: 'facility-wifi',
      label: 'Wi-Fi',
      type: 'facility',
      nodeId: 'wifi-node',
      buildingId: 'b1',
      floor: 1,
    },
    {
      id: 'entrance-north-index',
      label: 'North Entrance',
      type: 'entrance',
      nodeId: 'entrance-node',
      buildingId: 'b1',
      floor: 1,
    },
  ],
  buildings: [building],
  components: [],
  poi: [],
  boundingBox: null,
  panoramaIndex: {
    version: '1',
    panoramas: [{
      id: 'pano-b1',
      title: 'Library lobby',
      imageAssetId: 'asset-library-lobby',
      buildingId: 'b1',
      floor: 1,
      position: { lat: 11.82, lng: 122.168 },
      hotspots: [],
    }],
  },
} satisfies CampusBundle

function setSelectedBuilding(overrides: Partial<CampusBundle> = {}) {
  usePublicStore.setState({
    campus: { ...bundle, ...overrides },
    selectedBuilding: building,
    sheetState: 'half',
    indoorContext: { active: true, buildingId: 'b1', floorId: 1 },
    activeFloor: 1,
    toNode: null,
  })
}

afterEach(() => {
  cleanup()
  routerPush.mockReset()
  usePublicStore.setState({
    campus: null,
    selectedBuilding: null,
    sheetState: 'hidden',
    indoorContext: { active: false },
    activeFloor: 0,
    toNode: null,
  })
})

describe('BuildingSheet', () => {
  it('renders published overview metadata and the responsive details surface', () => {
    setSelectedBuilding()
    render(<BuildingSheet bundle={bundle} />)

    expect(screen.getByRole('dialog', { name: 'Library details' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Library' })).toHaveAttribute('src', '/campus/library.jpg')
    expect(screen.getByText('Academic')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('A quiet place to study.')).toBeInTheDocument()
    expect(screen.getByText('Wi-Fi')).toBeInTheDocument()
  })

  it('shows actual floors, rooms, and named entrances without inventing GF', () => {
    setSelectedBuilding()
    render(<BuildingSheet bundle={bundle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Floors' }))
    expect(screen.getByText('3F')).toBeInTheDocument()
    expect(screen.getByText('1F')).toBeInTheDocument()
    expect(screen.queryByText('GF')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rooms' }))
    expect(screen.getByText('Room 201')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Entrances' }))
    expect(screen.getByText('North Entrance')).toBeInTheDocument()
  })

  it('uses a stable indexed building destination for Directions', () => {
    setSelectedBuilding()
    render(<BuildingSheet bundle={bundle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Directions' }))

    expect(usePublicStore.getState().toNode).toBe('building-destination-b1')
    expect(routerPush).toHaveBeenCalledWith('/map/navigate?to=building-destination-b1')
    expect(usePublicStore.getState().toNode).not.toBe('entrance-node')
  })

  it('does not offer arbitrary Directions when no stable building destination is published', () => {
    setSelectedBuilding({
      searchEntries: bundle.searchEntries.filter(entry => entry.type !== 'building'),
    })
    render(<BuildingSheet bundle={{ ...bundle, searchEntries: bundle.searchEntries.filter(entry => entry.type !== 'building') }} />)

    const directions = screen.getByRole('button', { name: 'Directions unavailable' })
    expect(directions).toBeDisabled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('offers 360 only for a real panorama and opens the existing tour route lazily', () => {
    setSelectedBuilding()
    render(<BuildingSheet bundle={bundle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open 360 Virtual Tour' }))
    expect(routerPush).toHaveBeenCalledWith('/map/panoramas?building_id=b1&panorama_id=pano-b1')
    expect(screen.queryByTestId('tour-viewer')).toBeNull()
  })

  it('closes by clearing selection, sheet state, and indoor context', () => {
    setSelectedBuilding()
    render(<BuildingSheet bundle={bundle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close building details' }))

    expect(usePublicStore.getState().selectedBuilding).toBeNull()
    expect(usePublicStore.getState().sheetState).toBe('hidden')
    expect(usePublicStore.getState().indoorContext.active).toBe(false)
  })
})
