import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { HomeHeroSlide } from '@/lib/home-content'
import { HomeHeroCarousel } from '../HomeHeroCarousel'

const slides: HomeHeroSlide[] = [
  {
    id: 'welcome',
    title: 'Welcome to campus',
    subtitle: 'Start with the places students use most.',
    order: 0,
    active: true,
    action: { type: 'explore', label: 'Explore campus' },
  },
  {
    id: 'services',
    title: 'Find student services',
    subtitle: 'Search the campus map when you are ready to go.',
    order: 1,
    active: true,
  },
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HomeHeroCarousel', () => {
  it('exposes a labelled carousel with a stable slide region and 44px controls', () => {
    render(<HomeHeroCarousel slides={slides} />)

    expect(screen.getByRole('region', { name: 'Campus highlights' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Campus highlight 1 of 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous campus highlight' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Next campus highlight' }).className).toContain('min-w-11')
    expect(screen.getByRole('button', { name: 'Show campus highlight 1' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Explore campus' })).toBeInTheDocument()
  })

  it('supports next, previous, and indicator interactions', () => {
    render(<HomeHeroCarousel slides={slides} reducedMotion />)

    fireEvent.click(screen.getByRole('button', { name: 'Next campus highlight' }))
    expect(screen.getByRole('group', { name: 'Campus highlight 2 of 2' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous campus highlight' }))
    expect(screen.getByRole('group', { name: 'Campus highlight 1 of 2' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show campus highlight 2' }))
    expect(screen.getByRole('group', { name: 'Campus highlight 2 of 2' })).toBeInTheDocument()
  })

  it('advances after five seconds and resets that timer after interaction', () => {
    vi.useFakeTimers()
    render(<HomeHeroCarousel slides={slides} />)

    act(() => vi.advanceTimersByTime(4900))
    expect(screen.getByRole('group', { name: 'Campus highlight 1 of 2' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show campus highlight 1' }))
    act(() => vi.advanceTimersByTime(4900))
    expect(screen.getByRole('group', { name: 'Campus highlight 1 of 2' })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('group', { name: 'Campus highlight 2 of 2' })).toBeInTheDocument()
  })

  it('supports a touch swipe and disables auto motion when reduced motion is enabled', () => {
    vi.useFakeTimers()
    render(<HomeHeroCarousel slides={slides} reducedMotion />)
    const carousel = screen.getByRole('region', { name: 'Campus highlights' })

    fireEvent.touchStart(carousel, { touches: [{ clientX: 260 }] })
    fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 160 }] })

    expect(screen.getByRole('group', { name: 'Campus highlight 2 of 2' })).toBeInTheDocument()
    expect(carousel).toHaveAttribute('data-reduced-motion', 'true')
    expect(carousel.querySelector('[data-home-hero-track]')?.className).toContain('transition-none')

    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByRole('group', { name: 'Campus highlight 2 of 2' })).toBeInTheDocument()
  })

  it('reports editorial actions without owning a route', () => {
    const onAction = vi.fn()
    render(<HomeHeroCarousel slides={slides} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Explore campus' }))

    expect(onAction).toHaveBeenCalledWith(slides[0].action)
  })
})
