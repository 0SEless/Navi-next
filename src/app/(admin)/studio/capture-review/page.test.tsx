import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CaptureReviewPage from './page'

vi.mock('@/features/capture-review/components/CaptureReviewer', () => ({
  CaptureReviewer: () => <h1>Capture Reviewer route</h1>,
}))

describe('Capture Reviewer route', () => {
  it('renders the isolated Reviewer entry point', () => {
    render(<CaptureReviewPage />)
    expect(screen.getByRole('heading', { name: 'Capture Reviewer route' })).toBeInTheDocument()
  })
})

