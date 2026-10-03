import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Explorer } from '../Explorer'
import type { ExplorerNode, EntityId } from '@navi/editor'

const asEntityId = (s: string) => s as unknown as EntityId

const nodes: ExplorerNode[] = [{
  id: asEntityId('root'),
  label: 'Campus',
  type: 'campus',
  entitySelector: { type: 'building', id: asEntityId('root') },
  children: [{
    id: asEntityId('bld-1'),
    label: 'Library',
    type: 'building',
    entitySelector: { type: 'building', id: asEntityId('bld-1') },
    children: [],
  }],
}]

describe('Explorer', () => {
  it('renders tree nodes', () => {
    render(<Explorer nodes={nodes} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText('Campus')).toBeInTheDocument()
  })

  it('filters when search is typed', () => {
    render(<Explorer nodes={nodes} selectedId={null} onSelect={() => {}} />)
    const input = screen.getByPlaceholderText('Search entities...')
    fireEvent.change(input, { target: { value: 'Library' } })
    expect(screen.getByText('Library')).toBeVisible()
  })

  it('shows match count after search', () => {
    render(<Explorer nodes={nodes} selectedId={null} onSelect={() => {}} />)
    const input = screen.getByPlaceholderText('Search entities...')
    fireEvent.change(input, { target: { value: 'Library' } })
    expect(screen.getByText('1')).toBeVisible()
  })

  it('calls onSelect when item clicked', () => {
    const onSelect = vi.fn()
    render(<Explorer nodes={nodes} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Campus'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('shows empty state when nodes array is empty', () => {
    render(<Explorer nodes={[]} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText(/no entities/i)).toBeInTheDocument()
  })

  it('shows no results state when search yields nothing', () => {
    render(<Explorer nodes={nodes} selectedId={null} onSelect={() => {}} />)
    const input = screen.getByPlaceholderText('Search entities...')
    fireEvent.change(input, { target: { value: 'ZZZZNOTFOUND' } })
    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })
})
