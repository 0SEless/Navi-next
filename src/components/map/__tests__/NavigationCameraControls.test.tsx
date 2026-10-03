import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NavigationCameraControls from '../NavigationCameraControls'

describe('NavigationCameraControls', () => {
  it('exposes an accessible active View menu with three camera modes', () => {
    const onModeChange = vi.fn()

    render(
      <NavigationCameraControls
        surface="active"
        mode="FOLLOW"
        hasLocation
        compassVisible
        headingStatus="device"
        onModeChange={onModeChange}
        onRecenter={vi.fn()}
        onResetCompass={vi.fn()}
      />,
    )

    const viewButton = screen.getByRole('button', { name: /^Camera view: Follow\./ })
    expect(viewButton).toHaveClass('min-h-11', 'min-w-11', 'rounded-xl')
    fireEvent.click(viewButton)
    expect(onModeChange).toHaveBeenCalledWith('POV')

    fireEvent.contextMenu(viewButton)
    expect(screen.getByRole('button', { name: 'Top view' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Follow view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'POV view' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'POV view' }))
    expect(onModeChange).toHaveBeenCalledWith('POV')
  })

  it('keeps route preview in TOP and disables Follow/POV choices', () => {
    render(
      <NavigationCameraControls
        surface="route-preview"
        mode="TOP"
        hasLocation={false}
        compassVisible={false}
        headingStatus="none"
        onModeChange={vi.fn()}
        onRecenter={vi.fn()}
        onResetCompass={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Camera view: Top\./ }))

    expect(screen.queryByRole('button', { name: 'Top view' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Follow view' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'POV view' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Recenter' })).toBeDisabled()
  })

  it('does not show heading follow ON when the state is not supplied', () => {
    render(
      <NavigationCameraControls
        surface="active"
        mode="FOLLOW"
        hasLocation
        compassVisible
        headingStatus="none"
        onModeChange={vi.fn()}
        onRecenter={vi.fn()}
        onResetCompass={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Turn heading follow on' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Heading unavailable')).toBeNull()
  })

  it('keeps quick actions in a vertical touch-sized stack without unavailable status copy', () => {
    render(
      <NavigationCameraControls
        surface="active"
        mode="TOP"
        hasLocation
        compassVisible={false}
        headingStatus="none"
        onModeChange={vi.fn()}
        onRecenter={vi.fn()}
        onResetCompass={vi.fn()}
      />,
    )

    const controls = screen.getByTestId('navigation-camera-controls')
    const buttons = within(controls).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveAccessibleName(/^Camera view: Top\./)
    expect(buttons[1]).toHaveAccessibleName('Recenter')
    expect(buttons[2]).toHaveAccessibleName('Turn heading follow on')
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-11', 'min-w-11')
    }
    expect(buttons[1].parentElement).toBe(controls)
    expect(buttons[2].parentElement).toBe(controls)
    expect(screen.queryByText('Heading unavailable')).toBeNull()
  })

  it('cycles from the latest local selection when clicks arrive before React rerenders', () => {
    const onModeChange = vi.fn()

    render(
      <NavigationCameraControls
        surface="active"
        mode="TOP"
        hasLocation
        compassVisible={false}
        headingStatus="none"
        onModeChange={onModeChange}
        onRecenter={vi.fn()}
        onResetCompass={vi.fn()}
      />,
    )

    const viewButton = screen.getByRole('button', { name: /^Camera view: Top\./ })
    fireEvent.click(viewButton)
    fireEvent.click(viewButton)

    expect(onModeChange).toHaveBeenNthCalledWith(1, 'FOLLOW')
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'POV')
  })

  it('supports Recenter, Compass, orientation permission, and reduced-motion status', () => {
    const onRecenter = vi.fn()
    const onToggleHeadingFollow = vi.fn()
    const onRequestHeadingPermission = vi.fn()

    render(
      <NavigationCameraControls
        surface="active"
        mode="FOLLOW"
        hasLocation
        compassVisible
        headingStatus="permission-required"
        canRequestHeadingPermission
        reducedMotion
        onModeChange={vi.fn()}
        onRecenter={onRecenter}
        onResetCompass={vi.fn()}
        headingFollowEnabled
        onToggleHeadingFollow={onToggleHeadingFollow}
        onRequestHeadingPermission={onRequestHeadingPermission}
      />,
    )

    const controls = screen.getByTestId('navigation-camera-controls')
    expect(controls).toHaveAttribute('data-reduced-motion', 'true')
    expect(screen.getByRole('button', { name: 'Enable compass' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recenter' }))
    const compassButton = screen.getByRole('button', { name: 'Turn heading follow off' })
    expect(compassButton).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(compassButton)
    fireEvent.click(screen.getByRole('button', { name: 'Enable compass' }))

    expect(onRecenter).toHaveBeenCalledTimes(1)
    expect(onToggleHeadingFollow).toHaveBeenCalledTimes(1)
    expect(onToggleHeadingFollow).toHaveBeenCalledWith(false)
    expect(onRequestHeadingPermission).toHaveBeenCalledTimes(1)
  })

  it('reports transient follow suspension without changing the selected mode', () => {
    render(
      <NavigationCameraControls
        surface="active"
        mode="FOLLOW"
        hasLocation
        compassVisible={false}
        suspended
        headingStatus="gps"
        onModeChange={vi.fn()}
        onRecenter={vi.fn()}
        onResetCompass={vi.fn()}
      />,
    )

    expect(screen.getByText('Following paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Camera view: Follow\./ })).toBeInTheDocument()
  })
})
