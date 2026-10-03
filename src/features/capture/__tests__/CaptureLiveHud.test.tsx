import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CaptureLiveHud } from '../components/CaptureLiveHud'
import type { CaptureSession, RawGpsSample } from '../types'

function sample(overrides: Partial<RawGpsSample> = {}): RawGpsSample {
  return {
    sequence: 0,
    timestamp: '2026-09-01T00:00:00.000Z',
    latitude: 11.8000,
    longitude: 122.1000,
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    ...overrides,
  }
}

function session(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    schemaVersion: 1,
    id: 'capture-hud-1',
    title: 'HUD route',
    status: 'recording',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    startedAt: '2026-09-01T00:00:00.000Z',
    rawSamples: [sample(), sample({ sequence: 1, latitude: 11.8001, longitude: 122.1001 })],
    candidateRoute: null,
    markers: [],
    lastPosition: sample({ sequence: 1, latitude: 11.8001, longitude: 122.1001 }),
    lastError: null,
    ...overrides,
  }
}

describe('Capture Live HUD', () => {
  it('uses one compact bottom surface in Preparing with Marker and Start but no active route metrics', () => {
    render(<CaptureLiveHud session={session({
      status: 'preparing',
      startedAt: undefined,
      rawSamples: [],
      lastPosition: sample({ accuracy: 5 }),
    })} nowMs={Date.parse('2026-09-01T00:00:30.000Z')} onMarker={vi.fn()} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onFinish={vi.fn()} />)

    expect(screen.getByTestId('capture-bottom-hud')).toHaveAttribute('data-layout', 'merged-bottom')
    expect(screen.getByText('Preparing')).toBeInTheDocument()
    expect(screen.getByText('GPS ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument()
    expect(screen.queryByText('Active time')).not.toBeInTheDocument()
    expect(screen.queryByText('Distance')).not.toBeInTheDocument()
    expect(screen.queryByText('Samples')).not.toBeInTheDocument()
  })

  it('uses one compact bottom surface in Recording with all primary actions and metrics', () => {
    render(<CaptureLiveHud session={session()} nowMs={Date.parse('2026-09-01T00:00:01.000Z')} onMarker={vi.fn()} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onFinish={vi.fn()} />)

    expect(screen.getByRole('region', { name: 'Live Capture HUD' })).toBeInTheDocument()
    expect(screen.getByTestId('capture-bottom-hud')).toHaveAttribute('data-layout', 'merged-bottom')
    expect(screen.getByText('GPS ready')).toBeInTheDocument()
    expect(screen.getByText('±5 m')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('00:01')).toBeInTheDocument()
    expect(screen.getByText('Recording')).toBeInTheDocument()
    expect(screen.getByText('2 samples')).toBeInTheDocument()
    expect(screen.getByText('16 m')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add marker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish capture' })).toBeInTheDocument()
    expect(screen.getByTestId('capture-hud-actions')).toBeInTheDocument()
  })

  it('uses Resume and Finish in Paused without red pause treatment', () => {
    render(<CaptureLiveHud session={session({
      status: 'paused',
      pausedDurationMs: 0,
      pauseStartedAt: '2026-09-01T00:00:30.000Z',
    })} nowMs={Date.parse('2026-09-01T00:01:00.000Z')} onMarker={vi.fn()} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onFinish={vi.fn()} />)

    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('00:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause recording' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume recording' })).not.toHaveStyle({ background: 'var(--navi-error)' })
  })

  it('keeps every primary action at an outdoor-safe touch size', () => {
    render(<CaptureLiveHud session={session()} onMarker={vi.fn()} onStart={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onFinish={vi.fn()} />)

    for (const name of ['Add marker', 'Pause recording', 'Finish capture']) {
      expect(screen.getByRole('button', { name })).toHaveStyle({ minHeight: '48px' })
    }
  })

  it('shows direction permission only as a compact Preparing action', () => {
    const direction = { status: 'permission-required' as const, source: 'none' as const, heading: null }
    const onEnable = vi.fn()
    const { rerender } = render(<CaptureLiveHud session={session({ status: 'preparing', rawSamples: [], startedAt: undefined })} direction={direction} canRequestDirection onEnableDirection={onEnable} />)

    const enableButton = screen.getByRole('button', { name: 'Enable direction' })
    expect(enableButton).toBeInTheDocument()
    expect(enableButton).toHaveStyle({ minHeight: '32px' })

    rerender(<CaptureLiveHud session={session({ status: 'recording' })} direction={direction} canRequestDirection onEnableDirection={onEnable} />)
    expect(screen.queryByRole('button', { name: 'Enable direction' })).not.toBeInTheDocument()
  })

  it('shows a waiting/error GPS state when no current position is available', () => {
    const { rerender } = render(<CaptureLiveHud session={session({ rawSamples: [], lastPosition: null })} nowMs={Date.parse('2026-09-01T00:00:01.000Z')} />)

    expect(screen.getByText('Waiting for GPS')).toBeInTheDocument()
    rerender(<CaptureLiveHud session={session({ rawSamples: [], lastPosition: null, lastError: 'Permission denied' })} nowMs={Date.parse('2026-09-01T00:00:01.000Z')} />)
    expect(screen.getByText('GPS unavailable')).toBeInTheDocument()
  })

  it('does not show Good/Fair/Poor when accuracy is unavailable', () => {
    render(<CaptureLiveHud session={session({ lastPosition: sample({ accuracy: null }) })} nowMs={Date.parse('2026-09-01T00:00:01.000Z')} />)

    expect(screen.getByText('Accuracy unavailable')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Good')).not.toBeInTheDocument()
    expect(screen.queryByText('Fair')).not.toBeInTheDocument()
    expect(screen.queryByText('Poor')).not.toBeInTheDocument()
  })

  it('does not claim GPS readiness for a poor-accuracy fix', () => {
    render(<CaptureLiveHud session={session({ lastPosition: sample({ accuracy: 40 }) })} nowMs={Date.parse('2026-09-01T00:00:01.000Z')} />)

    expect(screen.getByText('Poor accuracy')).toBeInTheDocument()
    expect(screen.queryByText('GPS ready')).not.toBeInTheDocument()
  })
})
