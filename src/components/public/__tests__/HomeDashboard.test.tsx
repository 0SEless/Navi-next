import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CampusBundle, NavNode } from '@/types/nav-types'
import { usePublicStore } from '@/store/public-store'
import { HomeDashboard } from '../HomeDashboard'

const router = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('@/hooks/useHydrated', () => ({
  useHydrated: () => true,
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}))

const nodes: NavNode[] = [
  {
    id: 'node-101',
    label: 'Room 101',
    position: { lat: 11, lng: 122 },
    floor: 1,
    buildingId: 'bld-library',
    campusId: 'asu-ibajay',
    type: 'room',
  },
]

const campus: CampusBundle = {
  campusName: 'North Campus',
  nodes,
  edges: [],
  searchEntries: [
    {
      id: 'entry-101',
      label: 'Registrar Office',
      type: 'room',
      nodeId: 'node-101',
      buildingId: 'bld-library',
      floor: 1,
    },
  ],
  buildings: [
    {
      id: 'bld-library',
      name: 'Library',
      code: 'LIB',
      category: 'Services',
      description: 'Study and research spaces.',
      campusId: 'asu-ibajay',
      floors: [0, 1],
      footprint: [],
      baseElevation: 0,
      height: 0,
    },
    {
      id: 'bld-science',
      name: 'Science Hall',
      category: 'Academic',
      campusId: 'asu-ibajay',
      floors: [0],
      footprint: [],
      baseElevation: 0,
      height: 0,
    },
  ],
  poi: [],
  boundingBox: null,
}

afterEach(() => {
  cleanup()
  router.push.mockReset()
})

beforeEach(() => {
  usePublicStore.setState({
    campus,
    recentDestinations: ['node-101'],
    toNode: null,
    currentCampusId: 'asu-ibajay',
    campusData: null,
  })
})

describe('HomeDashboard student home experience', () => {
  it('renders the approved hierarchy in order without the legacy quick-action grid', () => {
    const { container } = render(<HomeDashboard />)

    expect(screen.getByRole('heading', { name: 'Welcome to North Campus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Search campus buildings, rooms, or services/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Campus highlights' })).toBeInTheDocument()

    const sections = [...container.querySelectorAll<HTMLElement>('[data-home-section]')]
      .map((section) => section.dataset.homeSection)
    expect(sections).toEqual([
      'welcome',
      'search',
      'hero',
      'explore',
      'recent',
      'announcements',
    ])

    expect(screen.queryByRole('button', { name: 'Navigate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Explore Campus' })).toBeNull()
    expect(screen.queryByText('360 Panorama')).toBeNull()
    expect(screen.queryByText('Emergency')).toBeNull()
  })

  it('hands campus search to the existing Search route', () => {
    render(<HomeDashboard />)

    fireEvent.click(screen.getByRole('button', { name: /Search campus buildings, rooms, or services/i }))

    expect(router.push).toHaveBeenCalledWith('/map/search')
  })

  it('renders real building cards and hands off with the stable Explore building ID', () => {
    render(<HomeDashboard />)

    expect(screen.getByRole('button', { name: 'Open Library in Explore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Science Hall in Explore' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Library in Explore' }))

    expect(router.push).toHaveBeenCalledWith('/map/explore?building_id=bld-library')
  })

  it('renders recent destination context and hands off to Navigate without starting a session', () => {
    render(<HomeDashboard />)

    const recent = screen.getByRole('button', { name: /Navigate to Registrar Office/i })
    expect(recent).toHaveTextContent('Library')
    expect(recent).toHaveTextContent('Floor 1')

    fireEvent.click(recent)

    expect(usePublicStore.getState().toNode).toBe('node-101')
    expect(router.push).toHaveBeenCalledWith('/map/navigate?to=node-101')
  })

  it('does not render a recent destination that is absent from the active campus bundle', () => {
    usePublicStore.setState({ recentDestinations: ['stale-node', 'node-101'] })

    render(<HomeDashboard />)

    expect(screen.queryByRole('button', { name: /Navigate to Stale node/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Navigate to Registrar Office/i })).toBeInTheDocument()
  })

  it('shows the small empty recent state and semantic announcement priorities', () => {
    usePublicStore.setState({
      recentDestinations: [],
    })
    render(<HomeDashboard />)

    expect(screen.getByText('No recent destinations yet.')).toBeInTheDocument()
    expect(screen.getByText('Campus information')).toBeInTheDocument()
    expect(screen.getByText('Information')).toBeInTheDocument()
    expect(screen.queryByText('Emergency')).toBeNull()
  })

  it('keeps the fallback hero image-free and delegates its action to Explore', () => {
    render(<HomeDashboard />)

    const hero = screen.getByRole('region', { name: 'Campus highlights' })
    expect(hero.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Explore campus' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Explore campus' }))

    expect(router.push).toHaveBeenCalledWith('/map/explore')
  })

  it('keeps Home surfaces width-safe with stable carousel geometry and touch-sized cards', () => {
    const { container } = render(<HomeDashboard />)
    const root = container.firstElementChild

    expect(root).not.toBeNull()
    expect(root?.className).toContain('min-w-0')
    expect(root?.className).toContain('overflow-x-hidden')
    expect(screen.getByRole('button', { name: /Search campus buildings/i }).className).toContain('min-h-14')
    expect(container.querySelector('[data-home-hero-track]')).toHaveClass('aspect-[16/9]')
    expect(screen.getByRole('button', { name: 'Open Library in Explore' }).className).toContain('min-h-36')
    expect(screen.getByRole('button', { name: /Navigate to Registrar Office/i }).className).toContain('min-h-16')
  })
})
