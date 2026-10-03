import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CaptureDirectionStatus } from '../components/CaptureDirectionStatus'
import type { CaptureDirectionResolution } from '../direction'

function direction(overrides: Partial<CaptureDirectionResolution> = {}): CaptureDirectionResolution {
  return {
    status: 'permission-required',
    source: 'none',
    heading: null,
    ...overrides,
  }
}

describe('Capture direction status', () => {
  it('offers explicit permission enablement without prompting on render', () => {
    const onEnable = vi.fn()
    render(<CaptureDirectionStatus direction={direction()} canRequestPermission onEnable={onEnable} />)

    expect(screen.getByText('Facing direction permission needed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enable direction' }))
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['available', 'Facing direction · Device'],
    ['gps-fallback', 'Movement direction · GPS'],
    ['denied', 'Facing direction unavailable · Permission denied'],
    ['unsupported', 'Facing direction unavailable · Not supported'],
    ['unreliable', 'Facing direction unavailable · Unreliable'],
    ['location-only', 'Location only'],
  ] as const)('renders the %s state', (status, label) => {
    render(<CaptureDirectionStatus direction={direction({ status, source: status === 'gps-fallback' ? 'gps' : status === 'available' ? 'device' : 'none', heading: status === 'available' || status === 'gps-fallback' ? 90 : null })} canRequestPermission={false} onEnable={vi.fn()} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
