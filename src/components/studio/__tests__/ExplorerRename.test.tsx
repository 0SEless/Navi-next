import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExplorerItem } from '../ExplorerItem'
import type { ExplorerNode, EntityId } from '@navi/editor'

const asEntityId = (s: string) => s as unknown as EntityId

const node: ExplorerNode = {
  id: asEntityId('bld-1'),
  label: 'Library',
  type: 'building',
  entitySelector: { type: 'building', id: asEntityId('bld-1') },
}

describe('ExplorerItem rename', () => {
  it('enters edit mode on double-click', () => {
    render(<ExplorerItem node={node} depth={0} expanded={false} selected={false} searchQuery="" onSelect={() => {}} onToggle={() => {}} onRename={() => {}} />)
    fireEvent.doubleClick(screen.getByText('Library'))
    expect(screen.getByDisplayValue('Library')).toBeInTheDocument()
  })

  it('calls onRename with new value on Enter', () => {
    const onRename = vi.fn()
    render(<ExplorerItem node={node} depth={0} expanded={false} selected={false} searchQuery="" onSelect={() => {}} onToggle={() => {}} onRename={onRename} />)
    fireEvent.doubleClick(screen.getByText('Library'))
    const input = screen.getByDisplayValue('Library')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('bld-1', 'New Name')
  })

  it('cancels edit on Escape', () => {
    const onRename = vi.fn()
    render(<ExplorerItem node={node} depth={0} expanded={false} selected={false} searchQuery="" onSelect={() => {}} onToggle={() => {}} onRename={onRename} />)
    fireEvent.doubleClick(screen.getByText('Library'))
    const input = screen.getByDisplayValue('Library')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByDisplayValue('Library')).not.toBeInTheDocument()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('does not call onRename if value is unchanged', () => {
    const onRename = vi.fn()
    render(<ExplorerItem node={node} depth={0} expanded={false} selected={false} searchQuery="" onSelect={() => {}} onToggle={() => {}} onRename={onRename} />)
    fireEvent.doubleClick(screen.getByText('Library'))
    const input = screen.getByDisplayValue('Library')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
  })

  it('does not call onRename on empty value', () => {
    const onRename = vi.fn()
    render(<ExplorerItem node={node} depth={0} expanded={false} selected={false} searchQuery="" onSelect={() => {}} onToggle={() => {}} onRename={onRename} />)
    fireEvent.doubleClick(screen.getByText('Library'))
    const input = screen.getByDisplayValue('Library')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
  })
})
