import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CapturePage from './page'

vi.mock('./CapturePageClient', () => ({
  CapturePageClient: () => <div>Capture shell mounted</div>,
}))

describe('/capture route', () => {
  it('renders the isolated Capture shell', () => {
    render(<CapturePage />)
    expect(screen.getByText('Capture shell mounted')).toBeInTheDocument()
  })
})
