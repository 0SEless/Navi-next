import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PUBLIC_PREFERENCES } from '@/lib/public-preferences'
import { usePublicStore } from '@/store/public-store'
import { ProfileDashboard } from '../ProfileDashboard'

const router = vi.hoisted(() => ({ push: vi.fn() }))
const auth = vi.hoisted(() => ({
  user: null as null | {
    id: string
    name: string
    email: string
    role: 'viewer'
    campus_id: string | null
  },
  isAuthenticated: false,
  logout: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('@/hooks/useHydrated', () => ({
  useHydrated: () => true,
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}))

afterEach(() => {
  cleanup()
  router.push.mockReset()
  auth.user = null
  auth.isAuthenticated = false
  usePublicStore.setState({
    currentCampusId: null,
    defaultCampusId: null,
    recentSearches: [],
    recentDestinations: [],
    preferences: structuredClone(DEFAULT_PUBLIC_PREFERENCES),
  })
  localStorage.clear()
})

describe('ProfileDashboard public settings hub', () => {
  beforeEach(() => {
    usePublicStore.setState({
      currentCampusId: 'campus-current',
      defaultCampusId: 'campus-default',
      preferences: structuredClone(DEFAULT_PUBLIC_PREFERENCES),
    })
  })

  it('shows honest guest identity, current/default campus context, and settings hierarchy', () => {
    render(<ProfileDashboard />)

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByText('Guest account')).toBeInTheDocument()
    expect(screen.getByText('Current campus')).toBeInTheDocument()
    expect(screen.getByText('campus-current')).toBeInTheDocument()
    expect(screen.getByText('Default campus')).toBeInTheDocument()
    expect(screen.getByText('campus-default')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change campus/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Appearance/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Navigation Preferences/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Accessibility/i })).toBeInTheDocument()
    expect(screen.getByText('Help & Feedback')).toBeInTheDocument()
    expect(screen.getByText('About NAVI')).toBeInTheDocument()
  })

  it('sends guest users to the existing login route and sends campus changes to Campuses', () => {
    render(<ProfileDashboard />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    fireEvent.click(screen.getByRole('button', { name: /Change campus/i }))

    expect(router.push).toHaveBeenNthCalledWith(1, '/login')
    expect(router.push).toHaveBeenNthCalledWith(2, '/map/maps')
  })

  it('exposes and persists appearance, navigation, notifications, and accessibility controls', () => {
    render(<ProfileDashboard />)

    fireEvent.click(screen.getByRole('button', { name: /Appearance/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    fireEvent.click(screen.getByRole('radio', { name: 'NAVI Theme' }))

    fireEvent.click(screen.getByRole('button', { name: /Navigation Preferences/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Follow' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Voice guidance' }))

    fireEvent.click(screen.getByRole('button', { name: /Accessibility/i }))
    fireEvent.click(screen.getByRole('switch', { name: 'Reduced Motion' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }))

    const preferences = usePublicStore.getState().preferences
    expect(preferences.theme).toBe('dark')
    expect(preferences.mapAppearance).toBe('navi')
    expect(preferences.navigation.defaultMapView).toBe('follow')
    expect(preferences.navigation.voiceGuidance).toBe(false)
    expect(preferences.accessibility.reducedMotion).toBe(true)
    expect(preferences.notifications).toBe(false)
    expect(JSON.parse(localStorage.getItem('navi-public-preferences') ?? '{}')).toMatchObject({
      theme: 'dark',
      mapAppearance: 'navi',
      notifications: false,
    })
  })

  it('renders signed-in identity from the auth contract', () => {
    auth.user = {
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'viewer',
      campus_id: 'campus-current',
    }
    auth.isAuthenticated = true

    render(<ProfileDashboard />)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument()
  })
})
