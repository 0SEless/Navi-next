import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CaptureOrientationControl } from '../components/CaptureOrientationControl'

describe('Capture orientation control', () => {
  it('offers an accessible mobile-safe Heading-Up action from North-Up', () => {
    const onChange = vi.fn()
    render(<CaptureOrientationControl orientationMode="north-up" headingAvailable onChange={onChange} />)

    const button = screen.getByRole('button', { name: 'Use Heading-Up' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveStyle({ width: '44px', height: '44px' })

    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith('heading-up')
  })

  it('offers North-Up and explains an unavailable Heading-Up signal', () => {
    render(<CaptureOrientationControl orientationMode="heading-up" headingAvailable={false} onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Use North-Up' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', 'Heading-Up selected; waiting for a reliable heading')
  })
})
