import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NavigationDevPanel from '../NavigationDevPanel'
import { createNavigationDevSimulation } from '@/lib/navigation-dev-simulation'

describe('NavigationDevPanel', () => {
  it('exposes the simulated heading slider and isolated movement buttons', () => {
    const onHeadingChange = vi.fn()
    const onMove = vi.fn()
    const simulation = createNavigationDevSimulation(1234)

    render(
      <NavigationDevPanel
        simulation={simulation}
        onHeadingChange={onHeadingChange}
        onMove={onMove}
      />,
    )

    expect(screen.getByTestId('navigation-dev-panel')).toHaveTextContent('DEV simulated location')
    expect(screen.getByText('11.81830075, 122.17159818')).toBeInTheDocument()

    const slider = screen.getByRole('slider', { name: 'Simulated heading' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '359')
    fireEvent.change(slider, { target: { value: '359' } })
    expect(onHeadingChange).toHaveBeenCalledWith(359)

    fireEvent.click(screen.getByRole('button', { name: 'Move north' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move south' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move east' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move west' }))
    expect(onMove).toHaveBeenNthCalledWith(1, 'north')
    expect(onMove).toHaveBeenNthCalledWith(2, 'south')
    expect(onMove).toHaveBeenNthCalledWith(3, 'east')
    expect(onMove).toHaveBeenNthCalledWith(4, 'west')
  })
})
