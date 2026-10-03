import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExplorerItem } from '../ExplorerItem'
import type { ExplorerNode, EntityId } from '@navi/editor'

const asEntityId = (s: string) => s as unknown as EntityId

function makeNode(overrides: Partial<ExplorerNode> = {}): ExplorerNode {
  return {
    id: asEntityId('bld-1'),
    label: 'Library',
    type: 'building',
    entitySelector: { type: 'building', id: asEntityId('bld-1') },
    children: [],
    ...overrides,
  }
}

describe('ExplorerItem', () => {
  it('renders the label', () => {
    render(
      <ExplorerItem
        node={makeNode()}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery=""
        onSelect={() => {}}
        onToggle={() => {}}
      />
    )
    expect(screen.getByText('Library')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(
      <ExplorerItem
        node={makeNode()}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery=""
        onSelect={onSelect}
        onToggle={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Library'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('calls onToggle when chevron is clicked', () => {
    const onToggle = vi.fn()
    const node = makeNode({
      children: [{ id: 'c-1' as unknown as EntityId, label: 'Child', type: 'floor', entitySelector: { type: 'floor', id: 'c-1' as unknown as EntityId, buildingId: 'bld-1' as unknown as EntityId }, children: [] }],
    })
    render(
      <ExplorerItem
        node={node}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery=""
        onSelect={() => {}}
        onToggle={onToggle}
      />
    )
    fireEvent.click(screen.getByLabelText(/expand/i))
    expect(onToggle).toHaveBeenCalled()
  })

  it('shows chevron only when node has children', () => {
    const { rerender } = render(
      <ExplorerItem
        node={makeNode()}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery=""
        onSelect={() => {}}
        onToggle={() => {}}
      />
    )
    // No children — no chevron
    expect(screen.queryByLabelText(/expand/i)).not.toBeInTheDocument()

    const parent = makeNode({
      children: [{ id: 'c-1' as unknown as EntityId, label: 'Child', type: 'floor', entitySelector: { type: 'floor', id: 'c-1' as unknown as EntityId, buildingId: 'bld-1' as unknown as EntityId }, children: [] }],
    })
    rerender(
      <ExplorerItem
        node={parent}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery=""
        onSelect={() => {}}
        onToggle={() => {}}
      />
    )
    expect(screen.getByLabelText(/expand/i)).toBeInTheDocument()
  })

  it('hlmarks search matches', () => {
    render(
      <ExplorerItem
        node={makeNode()}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery="brar"
        onSelect={() => {}}
        onToggle={() => {}}
      />
    )
    const mark = screen.getByText('brar')
    expect(mark.tagName).toBe('MARK')
  })

  it('applies selected data attribute when selected', () => {
    const { rerender } = render(
      <ExplorerItem
        node={makeNode()}
        depth={0}
        expanded={false}
        selected={false}
        searchQuery=""
        onSelect={() => {}}
        onToggle={() => {}}
      />
    )
    expect(screen.getByText('Library').closest('[data-selected]')).toHaveAttribute('data-selected', 'false')

    rerender(
      <ExplorerItem
        node={makeNode()}
        depth={0}
        expanded={false}
        selected={true}
        searchQuery=""
        onSelect={() => {}}
        onToggle={() => {}}
      />
    )
    expect(screen.getByText('Library').closest('[data-selected]')).toHaveAttribute('data-selected', 'true')
  })
})
