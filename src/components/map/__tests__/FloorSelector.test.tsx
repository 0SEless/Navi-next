import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FloorSelector } from '../FloorSelector'

afterEach(cleanup)

describe('FloorSelector', () => {
  it('renders published floors top-down with accessible 44px controls', () => {
    render(<FloorSelector floors={[1, 3, -1]} activeFloor={1} onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Building floors' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['3F', '1F', 'B1'])
    expect(screen.getByRole('button', { name: 'Switch to 1F' })).toHaveAttribute('aria-pressed', 'true')
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveStyle({ minWidth: '44px', minHeight: '44px' })
    }
  })

  it('does not show a selector for a single published floor', () => {
    render(<FloorSelector floors={[2]} activeFloor={2} onChange={vi.fn()} />)

    expect(screen.queryByRole('group', { name: 'Building floors' })).toBeNull()
  })
})
