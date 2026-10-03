import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { usePublicStore } from '@/store/public-store'
import { CampusBrowser } from '../CampusBrowser'

const originalFetchCampusData = usePublicStore.getState().fetchCampusData

const campusList = [
  {
    id: 'campus-a',
    campus_id: 'campus-a',
    name: 'North Campus',
    description: 'The main academic campus',
    address: 'North Road',
    version: '12',
    updated_at: '2026-09-01T00:00:00.000Z',
    building_count: 8,
  },
  {
    id: 'campus-b',
    campus_id: 'campus-b',
    name: 'South Campus',
    description: 'Health and science buildings',
    address: 'South Road',
    version: '9',
    updated_at: '2026-08-20T00:00:00.000Z',
    building_count: 3,
  },
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  usePublicStore.setState({
    currentCampusId: null,
    defaultCampusId: null,
    fetchCampusData: originalFetchCampusData,
  })
  localStorage.clear()
})

describe('CampusBrowser public current/default flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(campusList), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))
    usePublicStore.setState({
      currentCampusId: 'campus-a',
      defaultCampusId: 'campus-b',
    })
  })

  it('distinguishes the current campus from the saved default', async () => {
    render(<CampusBrowser />)

    expect(await screen.findByRole('button', { name: /Open North Campus map/i })).toBeInTheDocument()
    expect(screen.getByText('Current campus')).toBeInTheDocument()
    expect(screen.getAllByText('Default campus').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Open North Campus map/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open South Campus map/i })).toBeInTheDocument()
  })

  it('sets a default only through the explicit action and leaves current unchanged', async () => {
    render(<CampusBrowser />)
    await screen.findByRole('button', { name: /Open North Campus map/i })

    fireEvent.click(screen.getByRole('button', { name: 'Set as Default' }))

    expect(usePublicStore.getState().defaultCampusId).toBe('campus-a')
    expect(usePublicStore.getState().currentCampusId).toBe('campus-a')
    expect(localStorage.getItem('navi-default-campus')).toBe('campus-a')
  })

  it('uses the store hydration action for a temporary campus switch', async () => {
    const fetchCampusData = vi.fn().mockResolvedValue(undefined)
    usePublicStore.setState({ fetchCampusData })
    render(<CampusBrowser />)
    await screen.findByRole('button', { name: /Open North Campus map/i })

    fireEvent.click(screen.getByRole('button', { name: /Open South Campus map/i }))

    expect(fetchCampusData).toHaveBeenCalledWith('campus-b')
    expect(usePublicStore.getState().defaultCampusId).toBe('campus-b')
  })

  it('filters the catalog without changing the current/default state', async () => {
    render(<CampusBrowser />)
    await screen.findByRole('button', { name: /Open North Campus map/i })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search campuses' }), { target: { value: 'science' } })

    expect(screen.queryByRole('button', { name: /Open North Campus map/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Open South Campus map/i })).toBeInTheDocument()
    expect(usePublicStore.getState().currentCampusId).toBe('campus-a')
    expect(usePublicStore.getState().defaultCampusId).toBe('campus-b')
  })
})
