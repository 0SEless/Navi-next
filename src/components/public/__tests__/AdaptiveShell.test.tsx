import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_PUBLIC_PREFERENCES } from '@/lib/public-preferences'
import { usePublicStore } from '@/store/public-store'
import { AdaptiveShell } from '../AdaptiveShell'
import { PublicPreferencesSync } from '../PublicPreferencesSync'

const navigation = vi.hoisted(() => ({ pathname: '/map/profile', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}))

vi.mock('../AdaptiveNav', () => ({
  AdaptiveNav: () => <div data-testid="adaptive-nav" />,
}))

vi.mock('../SplashOnboarding', () => ({
  SplashOnboarding: () => null,
}))

afterEach(() => {
  cleanup()
  navigation.push.mockReset()
  document.documentElement.classList.remove('dark')
})

describe('PublicPreferencesSync', () => {
  beforeEach(() => {
    usePublicStore.setState({ preferences: structuredClone(DEFAULT_PUBLIC_PREFERENCES) })
  })

  it('applies the selected public theme and reduced-motion preference to the shell', async () => {
    usePublicStore.setState({
      preferences: {
        ...structuredClone(DEFAULT_PUBLIC_PREFERENCES),
        theme: 'dark',
        accessibility: { reducedMotion: true },
      },
    })

    render(<PublicPreferencesSync><span>settings</span></PublicPreferencesSync>)

    const shell = screen.getByTestId('public-shell')
    await waitFor(() => expect(shell).toHaveAttribute('data-theme', 'dark'))
    await waitFor(() => expect(shell).toHaveAttribute('data-reduced-motion', 'true'))
    expect(shell).toHaveTextContent('settings')
  })

  it('resolves System from the browser media preference without changing document-global admin state', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(<PublicPreferencesSync><span>system</span></PublicPreferencesSync>)

    await waitFor(() => expect(screen.getByTestId('public-shell')).toHaveAttribute('data-theme', 'dark'))
    expect(document.documentElement).not.toHaveClass('dark')
  })
})

describe('AdaptiveShell', () => {
  beforeEach(() => {
    usePublicStore.setState({
      activeTab: 'home',
      preferences: structuredClone(DEFAULT_PUBLIC_PREFERENCES),
    })
  })

  it('reserves the phone navigation area while preserving the adaptive desktop layout', async () => {
    render(<AdaptiveShell><div>profile content</div></AdaptiveShell>)

    const shell = screen.getByTestId('public-shell')
    const main = screen.getByRole('main')
    expect(shell).toHaveClass('navi-public-shell')
    expect(main.parentElement?.className).toContain('pb-[calc(4rem+env(safe-area-inset-bottom))]')
    expect(main.parentElement?.className).toContain('lg:pl-56')
    expect(screen.getByTestId('adaptive-nav')).toBeInTheDocument()
    await waitFor(() => expect(usePublicStore.getState().activeTab).toBe('profile'))
  })

  it('does not reclaim a secondary Campuses route when the primary tab state changes', async () => {
    navigation.pathname = '/map/maps'
    usePublicStore.setState({ activeTab: 'home' })

    render(<AdaptiveShell><div>campuses content</div></AdaptiveShell>)

    act(() => {
      usePublicStore.setState({ activeTab: 'profile' })
    })

    await waitFor(() => expect(usePublicStore.getState().activeTab).toBe('profile'))
    expect(navigation.push).not.toHaveBeenCalled()
  })
})
