import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdaptiveNav } from '../AdaptiveNav'
import { PRIMARY_NAV_ITEMS } from '@/lib/public-app-contracts'
import { usePublicStore } from '@/store/public-store'

const router = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

afterEach(() => {
  cleanup()
  router.push.mockReset()
})

describe('AdaptiveNav public shell boundary', () => {
  beforeEach(() => {
    usePublicStore.setState({ activeTab: 'home' })
  })

  it('renders exactly the four approved primary destinations', () => {
    render(<AdaptiveNav />)

    for (const item of PRIMARY_NAV_ITEMS) {
      expect(screen.getAllByRole('button', { name: item.label })).toHaveLength(2)
    }
    expect(screen.queryByRole('button', { name: 'Maps' })).toBeNull()
    expect(screen.queryByText('Campuses')).toBeNull()
  })

  it('keeps phone safe-area navigation and desktop sidebar touch targets', () => {
    render(<AdaptiveNav />)

    const bottomNav = screen.getByRole('navigation')
    const sidebar = screen.getByRole('complementary')
    expect(bottomNav.className).toContain('pb-[env(safe-area-inset-bottom)]')
    expect(bottomNav.className).toContain('lg:hidden')
    expect(sidebar.className).toContain('lg:flex')
    expect(screen.getAllByRole('button', { name: 'Profile' })[0].className).toContain('min-h-[44px]')
  })

  it('updates the public tab contract when a destination is selected', () => {
    render(<AdaptiveNav />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Profile' })[0])

    expect(usePublicStore.getState().activeTab).toBe('profile')
  })

  it('navigates to the canonical path even when the selected primary tab is already active', () => {
    render(<AdaptiveNav />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Home' })[0])

    expect(router.push).toHaveBeenCalledWith('/map/home')
  })
})
