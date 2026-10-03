import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FloorPlanTransformInspector } from '../FloorPlanTransformInspector'

const frame = { width: 30, height: 12 }

describe('FloorPlanTransformInspector', () => {
  it('renders derived administrator-facing values and controls', () => {
    render(<FloorPlanTransformInspector frame={frame} alignment={{ scaleX: 1.5, scaleY: 0.75 }} onCommit={vi.fn()} />)
    expect(screen.getByLabelText('X (m)')).toHaveValue(0)
    expect(screen.getByLabelText('Y (m)')).toHaveValue(0)
    expect(screen.getByLabelText('Width (m)')).toHaveValue(45)
    expect(screen.getByLabelText('Height (m)')).toHaveValue(9)
    expect(screen.getByLabelText('Rotation (°)')).toHaveValue(0)
    expect(screen.getByLabelText('Opacity (%)')).toHaveValue(70)
    expect(screen.getByRole('button', { name: 'Fit to Building Bounds' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock Overlay' })).toBeInTheDocument()
  })

  it('commits a numeric width edit through the canonical callback', () => {
    const onCommit = vi.fn()
    render(<FloorPlanTransformInspector frame={frame} alignment={{ scaleX: 1, scaleY: 1 }} onCommit={onCommit} />)
    const input = screen.getByLabelText('Width (m)')
    fireEvent.change(input, { target: { value: '35' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ scaleX: expect.closeTo(35 / 30, 8), scaleY: expect.closeTo(14 / 12, 8) }))
  })

  it('does not commit placement or dimension fields while the overlay is locked', () => {
    const onCommit = vi.fn()
    render(<FloorPlanTransformInspector frame={frame} alignment={{ scaleX: 1, scaleY: 1, locked: true }} onCommit={onCommit} />)
    expect(screen.getByLabelText('X (m)')).toBeDisabled()
    expect(screen.getByLabelText('Width (m)')).toBeDisabled()
    expect(screen.getByLabelText('Height (m)')).toBeDisabled()
    expect(screen.getByLabelText('Opacity (%)')).not.toBeDisabled()
  })

  it('keeps opacity editable while placement remains locked', () => {
    const onCommit = vi.fn()
    render(<FloorPlanTransformInspector frame={frame} alignment={{ scaleX: 1, scaleY: 1, locked: true }} onCommit={onCommit} />)
    const opacity = screen.getByLabelText('Opacity (%)')
    fireEvent.change(opacity, { target: { value: '25' } })
    fireEvent.blur(opacity)
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.25, locked: true }))
  })
})
