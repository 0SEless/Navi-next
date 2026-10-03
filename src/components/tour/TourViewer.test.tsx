import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TourViewer } from './TourViewer'
import { mockPanoramas } from './mock-data'

// Mock Pannellum
vi.mock('pannellum', () => ({
  default: {
    viewer: vi.fn(() => ({
      destroy: vi.fn(),
      getYaw: vi.fn(() => 0),
      getPitch: vi.fn(() => 0),
      setYaw: vi.fn(),
      setPitch: vi.fn(),
      addHotspot: vi.fn(),
      removeHotspot: vi.fn(),
      on: vi.fn(),
    })),
  },
}))

// Mock CSS import
vi.mock('pannellum/build/pannellum.css', () => ({}))

describe('TourViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock window.pannellum
    Object.defineProperty(window, 'pannellum', {
      value: {
        viewer: vi.fn(() => ({
          destroy: vi.fn(),
          getYaw: vi.fn(() => 0),
          getPitch: vi.fn(() => 0),
          setYaw: vi.fn(),
          setPitch: vi.fn(),
          addHotspot: vi.fn(),
          removeHotspot: vi.fn(),
          on: vi.fn(),
        })),
      },
      writable: true,
    })
  })

  it('renders empty state when no panoramas provided', () => {
    render(<TourViewer panoramas={[]} />)
    expect(screen.getByText('No panoramas available')).toBeInTheDocument()
  })

  it('renders loading state when pannellum not yet loaded', () => {
    // Set to undefined to simulate script not yet loaded
    const originalPannellum = window.pannellum
    window.pannellum = undefined as any
    
    render(<TourViewer panoramas={mockPanoramas} />)
    expect(screen.getByText('Loading panorama...')).toBeInTheDocument()
    
    // Restore
    window.pannellum = originalPannellum
  })

  it('displays panorama counter', () => {
    render(<TourViewer panoramas={mockPanoramas} />)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('displays panorama title', () => {
    render(<TourViewer panoramas={mockPanoramas} />)
    expect(screen.getByText('Campus Main Entrance')).toBeInTheDocument()
  })

  it('calls onPanoramaChange when navigating', () => {
    const onPanoramaChange = vi.fn()
    render(
      <TourViewer
        panoramas={mockPanoramas}
        onPanoramaChange={onPanoramaChange}
      />
    )

    // Click next button
    const nextButton = screen.getByLabelText('Next panorama')
    fireEvent.click(nextButton)

    expect(onPanoramaChange).toHaveBeenCalledWith(1)
  })

  it('disables previous button on first panorama', () => {
    render(<TourViewer panoramas={mockPanoramas} />)
    const prevButton = screen.getByLabelText('Previous panorama')
    expect(prevButton).toBeDisabled()
  })

  it('disables next button on last panorama', () => {
    render(
      <TourViewer
        panoramas={mockPanoramas}
        initialIndex={mockPanoramas.length - 1}
      />
    )
    const nextButton = screen.getByLabelText('Next panorama')
    expect(nextButton).toBeDisabled()
  })

  it('toggles fullscreen on button click', async () => {
    render(<TourViewer panoramas={mockPanoramas} />)
    const fullscreenButton = screen.getByLabelText('Enter fullscreen')
    
    // Mock requestFullscreen
    const mockRequestFullscreen = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      value: mockRequestFullscreen,
      writable: true,
    })

    fireEvent.click(fullscreenButton)
    expect(mockRequestFullscreen).toHaveBeenCalled()
  })
})
