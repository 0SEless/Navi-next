import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExplorerTree } from '../ExplorerTree'
import type { ExplorerNode, EntityId } from '@navi/editor'

const asEntityId = (s: string) => s as unknown as EntityId

const nodes: ExplorerNode[] = [{
  id: asEntityId('root'),
  label: 'Campus',
  type: 'campus',
  entitySelector: { type: 'building', id: asEntityId('root') },
  children: [
    {
      id: asEntityId('bld-1'),
      label: 'Library',
      type: 'building',
      entitySelector: { type: 'building', id: asEntityId('bld-1') },
      children: [
        {
          id: asEntityId('flr-1'),
          label: 'Floor 1',
          type: 'floor',
          entitySelector: { type: 'floor', id: asEntityId('flr-1'), buildingId: asEntityId('bld-1') },
          children: [],
        },
      ],
    },
  ],
}]

describe('ExplorerTree', () => {
  it('renders root node label', () => {
    render(<ExplorerTree nodes={nodes} expandedIds={new Set()} selectedId={null} onSelect={() => {}} onToggle={() => {}} />)
    expect(screen.getByText('Campus')).toBeInTheDocument()
  })

  it('shows children when parent is expanded', () => {
    render(<ExplorerTree nodes={nodes} expandedIds={new Set([asEntityId('root')])} selectedId={null} onSelect={() => {}} onToggle={() => {}} />)
    expect(screen.getByText('Library')).toBeVisible()
  })

  it('hides children when parent is collapsed', () => {
    render(<ExplorerTree nodes={nodes} expandedIds={new Set()} selectedId={null} onSelect={() => {}} onToggle={() => {}} />)
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })

  it('passes onSelect to items', () => {
    const onSelect = vi.fn()
    render(<ExplorerTree nodes={nodes} expandedIds={new Set()} selectedId={null} onSelect={onSelect} onToggle={() => {}} />)
    fireEvent.click(screen.getByText('Campus'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('passes onToggle to items', () => {
    const onToggle = vi.fn()
    render(<ExplorerTree nodes={nodes} expandedIds={new Set()} selectedId={null} onSelect={() => {}} onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText(/expand/i))
    expect(onToggle).toHaveBeenCalled()
  })

  it('renders nested children at correct depth', () => {
    render(<ExplorerTree nodes={nodes} expandedIds={new Set([asEntityId('root'), asEntityId('bld-1')])} selectedId={null} onSelect={() => {}} onToggle={() => {}} />)
    expect(screen.getByText('Floor 1')).toBeVisible()
    expect(screen.getByText('Library')).toBeVisible()
    expect(screen.getByText('Campus')).toBeVisible()
  })
})
