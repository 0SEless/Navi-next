import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { CampusMap } from '@/types/campus-map'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

let mockState: any = { maps: [], load: vi.fn(), deleteMap: vi.fn() }

vi.mock('@/store/campus-map-store', () => ({
  useCampusMapStore: Object.assign(
    (selector: any) => selector(mockState),
    { getState: vi.fn(() => mockState), subscribe: vi.fn(), setState: vi.fn() }
  ),
}))

import { StudioDashboard } from '../StudioDashboard'

const mockMap = (overrides: Partial<CampusMap> = {}): CampusMap => ({
  id: 'map-1',
  name: 'Test Map',
  schoolName: 'Test School',
  campusName: 'Test Campus',
  center: { lat: 10, lng: 20 },
  boundary: [],
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  stats: { buildings: 2, nodes: 5, edges: 3 },
  ...overrides,
})

describe('StudioDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerPush.mockClear()
    mockState = { maps: [], load: vi.fn(), deleteMap: vi.fn() }
  })

  it('renders empty state when no maps', () => {
    render(<StudioDashboard />)
    expect(screen.getByText('No maps yet')).toBeDefined()
  })

  it('renders map count with stats', () => {
    mockState.maps = [mockMap()]
    render(<StudioDashboard />)
    expect(screen.getByText(/1 map/)).toBeDefined()
    expect(screen.getByText(/2 buildings/)).toBeDefined()
  })

  it('handles maps with null stats', () => {
    mockState.maps = [mockMap({ stats: null as any })]
    expect(() => render(<StudioDashboard />)).not.toThrow()
    expect(screen.getByText(/0 buildings/)).toBeDefined()
  })

  it('handles maps with undefined stats', () => {
    mockState.maps = [mockMap({ stats: undefined as any })]
    expect(() => render(<StudioDashboard />)).not.toThrow()
    expect(screen.getByText(/0 buildings/)).toBeDefined()
  })

  it('handles multiple maps with mixed stats', () => {
    mockState.maps = [
      mockMap({ id: 'map-1', stats: { buildings: 3, nodes: 5, edges: 3 } }),
      mockMap({ id: 'map-2', stats: null as any }),
      mockMap({ id: 'map-3', stats: undefined as any }),
    ]
    expect(() => render(<StudioDashboard />)).not.toThrow()
    expect(screen.getByText(/3 maps/)).toBeDefined()
    expect(screen.getByText(/3 buildings/)).toBeDefined()
  })

  it('navigates from a campus card to its Capture Library', () => {
    mockState.maps = [mockMap()]
    render(<StudioDashboard />)

    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Test Map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture Library' }))

    expect(routerPush).toHaveBeenCalledWith('/studio/map-1/edit/capture-library')
  })
})
