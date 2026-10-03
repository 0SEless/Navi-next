import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConnectionChoice } from '../ConnectionChoice'
import type { DrawingSessionValue } from '../useDrawingSession'
import type { ConnectivityCandidate } from '@navi/editor'

const candidate: ConnectivityCandidate = {
  kind: 'road-endpoint',
  targetRoadId: 'road-a',
  position: { lat: 0, lng: 0 },
  distanceMeters: 0.3,
  label: 'Road endpoint: Road A',
}

function makeDrawing(overrides: Partial<DrawingSessionValue> = {}): DrawingSessionValue {
  return {
    pendingRoadConnection: { point: { lat: 0.000003, lng: 0 }, candidate },
    resolveRoadConnection: vi.fn(),
    ...overrides,
  } as unknown as DrawingSessionValue
}

describe('ConnectionChoice (non-modal decision chip)', () => {
  it('renders the candidate label and both actions', () => {
    render(<ConnectionChoice drawing={makeDrawing()} />)
    expect(screen.getByText(/Connect to Road endpoint: Road A\?/)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Keep Separate' })).not.toBeNull()
  })

  it('calls resolveRoadConnection with connect / separate', () => {
    const resolve = vi.fn()
    render(<ConnectionChoice drawing={makeDrawing({ resolveRoadConnection: resolve })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(resolve).toHaveBeenCalledWith('connect')
    fireEvent.click(screen.getByRole('button', { name: 'Keep Separate' }))
    expect(resolve).toHaveBeenCalledWith('separate')
  })

  it('renders nothing when no decision is pending', () => {
    const { container } = render(<ConnectionChoice drawing={makeDrawing({ pendingRoadConnection: null })} />)
    expect(container.firstChild).toBeNull()
  })
})
