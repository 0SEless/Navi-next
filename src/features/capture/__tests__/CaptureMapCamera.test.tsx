import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const map = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  easeTo: vi.fn(),
}))

vi.mock('@/components/map/NavigationMap', () => ({
  useNavigationMap: () => ({ map, isReady: true }),
}))

import { CaptureMapCamera } from '../components/CaptureMapCamera'

describe('Capture map camera control', () => {
  it('renders an accessible 44px recenter control with Follow state', () => {
    render(<CaptureMapCamera center={[122.1, 11.8]} follow={false} onFollowChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Recenter map on live location' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveStyle({ width: '44px', height: '44px' })
  })

  it('turns Follow off from a map pan and recenters explicitly without a zoom override', () => {
    const onFollowChange = vi.fn()
    map.on.mockImplementation((_type: string, listener: () => void) => listener())

    render(<CaptureMapCamera center={[122.1, 11.8]} follow onFollowChange={onFollowChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Recenter map on live location' }))

    expect(onFollowChange).toHaveBeenCalledWith(false)
    expect(onFollowChange).toHaveBeenCalledWith(true)
    expect(map.easeTo).toHaveBeenCalledWith({ center: [122.1, 11.8], duration: 250 })
    expect(map.easeTo.mock.calls.at(-1)?.[0]).not.toHaveProperty('zoom')
  })

  it('disables recenter until a live position exists', () => {
    render(<CaptureMapCamera follow onFollowChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Recenter map on live location' })).toBeDisabled()
  })
})
