import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { SelectionOverlay } from '../SelectionOverlay'

vi.mock('@navi/editor', () => ({
  useSelection: vi.fn(),
}))

import { useSelection } from '@navi/editor'

describe('SelectionOverlay', () => {
  const mockMap = {
    setFeatureState: vi.fn(),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing visible', () => {
    (useSelection as any).mockReturnValue({ lastSelected: null })
    const { container } = render(<SelectionOverlay map={mockMap} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls setFeatureState when selection is set', () => {
    (useSelection as any).mockReturnValue({
      lastSelected: { id: 'N001' },
    })
    render(<SelectionOverlay map={mockMap} />)
    expect(mockMap.setFeatureState).toHaveBeenCalledWith(
      { source: 's-nodes', id: 'N001' },
      { selected: true }
    )
    expect(mockMap.setFeatureState).toHaveBeenCalledWith(
      { source: 's-nodes-connection', id: 'N001' },
      { selected: true }
    )
  })

  it('clears previous highlight when selection changes', () => {
    const { rerender } = render(
      <SelectionOverlay map={mockMap} />
    )

    ;(useSelection as any).mockReturnValue({
      lastSelected: { id: 'N001' },
    })
    rerender(<SelectionOverlay map={mockMap} />)

    mockMap.setFeatureState.mockClear()

    ;(useSelection as any).mockReturnValue({
      lastSelected: { id: 'N002' },
    })
    rerender(<SelectionOverlay map={mockMap} />)

    expect(mockMap.setFeatureState).toHaveBeenCalledWith(
      { source: 's-nodes', id: 'N001' },
      { selected: false }
    )
    expect(mockMap.setFeatureState).toHaveBeenCalledWith(
      { source: 's-nodes', id: 'N002' },
      { selected: true }
    )
  })

  it('clears highlight when selection becomes null', () => {
    (useSelection as any).mockReturnValue({
      lastSelected: { id: 'N001' },
    })
    const { rerender } = render(<SelectionOverlay map={mockMap} />)

    mockMap.setFeatureState.mockClear()

    ;(useSelection as any).mockReturnValue({
      lastSelected: null,
    })
    rerender(<SelectionOverlay map={mockMap} />)

    expect(mockMap.setFeatureState).toHaveBeenCalledWith(
      { source: 's-nodes', id: 'N001' },
      { selected: false }
    )
  })

  it('highlights a selected point POI in the canonical POI source', () => {
    (useSelection as any).mockReturnValue({
      lastSelected: { id: 'poi-1', type: 'poi' },
    })

    render(<SelectionOverlay map={mockMap} />)

    expect(mockMap.setFeatureState).toHaveBeenCalledWith(
      { source: 'navi-pois', id: 'poi-1' },
      { selected: true },
    )
  })
})
