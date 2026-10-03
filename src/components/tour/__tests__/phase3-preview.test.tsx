import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InformationCard } from '../InformationCard'
import { validateHotspot } from '@navi/core'

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
vi.mock('pannellum/build/pannellum.css', () => ({}))

describe('InformationCard', () => {
  it('should display title and description', () => {
    render(<InformationCard content={{ title: 'Building Info', description: 'This is a building.' }} onClose={vi.fn()} />)
    expect(screen.getByText('Building Info')).toBeInTheDocument()
    expect(screen.getByText('This is a building.')).toBeInTheDocument()
  })

  it('should display image when provided', () => {
    render(<InformationCard content={{ title: 'With Image', imageUrl: 'https://example.com/img.jpg' }} onClose={vi.fn()} />)
    expect(screen.getByAltText('With Image')).toBeInTheDocument()
  })

  it('should display link when provided', () => {
    render(<InformationCard content={{ title: 'With Link', linkUrl: 'https://example.com', linkLabel: 'Learn More' }} onClose={vi.fn()} />)
    expect(screen.getByText('Learn More')).toBeInTheDocument()
  })

  it('should call onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<InformationCard content={{ title: 'Test' }} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Hotspot validation in Phase 3 context', () => {
  it('should pass for valid navigation hotspot', () => {
    const issues = validateHotspot('pano-1', 0, {
      hotspotType: 'navigation',
      target: { type: 'panorama', targetId: 'pano-2' },
      position: { yaw: 90, pitch: 0 },
      label: 'Go to Library',
    }, ['pano-1', 'pano-2'])
    expect(issues).toHaveLength(0)
  })

  it('should pass for valid information hotspot with content', () => {
    const issues = validateHotspot('pano-1', 0, {
      hotspotType: 'information',
      target: { type: 'url', targetId: '' },
      position: { yaw: 0, pitch: -10 },
      label: 'Info',
      content: { title: 'Building Info', description: 'A building.' },
    }, ['pano-1'])
    expect(issues).toHaveLength(0)
  })

  it('should warn for navigation hotspot without target', () => {
    const issues = validateHotspot('pano-1', 0, {
      hotspotType: 'navigation',
      target: { type: 'panorama', targetId: '' },
      position: { yaw: 90, pitch: 0 },
      label: 'No target',
    }, ['pano-1'])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('HOTSPOT_MISSING_TARGET')
  })

  it('should warn for information hotspot without content', () => {
    const issues = validateHotspot('pano-1', 0, {
      hotspotType: 'information',
      target: { type: 'url', targetId: '' },
      position: { yaw: 0, pitch: 0 },
      label: 'Empty',
      content: {},
    }, ['pano-1'])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('HOTSPOT_EMPTY_CONTENT')
  })

  it('should error for invalid yaw', () => {
    const issues = validateHotspot('pano-1', 0, {
      hotspotType: 'navigation',
      target: { type: 'panorama', targetId: 'pano-2' },
      position: { yaw: 400, pitch: 0 },
      label: 'Bad yaw',
    }, ['pano-1', 'pano-2'])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('HOTSPOT_INVALID_YAW')
  })

  it('should error for invalid pitch', () => {
    const issues = validateHotspot('pano-1', 0, {
      hotspotType: 'navigation',
      target: { type: 'panorama', targetId: 'pano-2' },
      position: { yaw: 90, pitch: 100 },
      label: 'Bad pitch',
    }, ['pano-1', 'pano-2'])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('HOTSPOT_INVALID_PITCH')
  })
})
