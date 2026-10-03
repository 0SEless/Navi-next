import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { PanoramaProperties } from './panorama-props'

afterEach(cleanup)

function createPanorama(overrides = {}) {
  return {
    id: 'pan-1',
    label: 'Entrance View',
    heading: 90,
    imageAssetId: 'img-abc',
    hotspots: [{ x: 0.5, y: 0.5, targetPanoramaId: 'pan-2' }],
    ...overrides,
  }
}

function renderWithDispatcher(panorama: any, execute = vi.fn()) {
  const services = {
    get: (name: string) => (name === 'dispatcher' ? { execute } : undefined),
  }
  return { execute, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <PanoramaProperties panorama={panorama} />
    </EditorProvider>,
  ) }
}

describe('PanoramaProperties', () => {
  it('renders Panorama header and fields', () => {
    renderWithDispatcher(createPanorama())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('Entrance View')).toBeDefined()
    expect(screen.getByDisplayValue('img-abc')).toBeDefined()
  })

  it('shows hotspot count', () => {
    renderWithDispatcher(createPanorama())
    expect(screen.getByText(/Hotspots/)).toBeDefined()
  })

  it('dispatches entity.update when label changes', () => {
    const { execute } = renderWithDispatcher(createPanorama())
    fireEvent.change(screen.getByDisplayValue('Entrance View'), { target: { value: 'Updated View' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Panorama',
      payload: { entityId: 'pan-1', changes: { label: 'Updated View' } },
    })
  })
})
