// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { LayersPanel } from './LayersPanel'
import { createDocument } from '../../test-helpers'

afterEach(cleanup)

describe('LayersPanel', () => {
  it('shows no buildings message when empty', () => {
    const doc = createDocument({ buildings: [] })
    render(
      <LayersPanel document={doc} activeBuildingId={null} activeFloorId={null} />,
    )
    expect(screen.getByText('No buildings')).toBeDefined()
  })

  it('renders building names', () => {
    const doc = createDocument()
    render(
      <LayersPanel document={doc} activeBuildingId={null} activeFloorId={null} />,
    )
    expect(screen.getByText('Building A')).toBeDefined()
    expect(screen.getByText('Building B')).toBeDefined()
  })

  it('calls onSelectBuilding when building clicked', () => {
    const fn = vi.fn()
    const doc = createDocument()
    render(
      <LayersPanel document={doc} activeBuildingId={null} activeFloorId={null} onSelectBuilding={fn} />,
    )
    fireEvent.click(screen.getByText('Building A'))
    expect(fn).toHaveBeenCalledWith('bld-1')
  })
})
