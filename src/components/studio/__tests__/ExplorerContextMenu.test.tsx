import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExplorerContextMenu } from '../ExplorerContextMenu'

describe('ExplorerContextMenu', () => {
  const actions = [
    { id: 'rename', label: 'Rename', action: vi.fn() },
    { id: 'delete', label: 'Delete', action: vi.fn() },
  ]

  it('renders all action items', () => {
    render(<ExplorerContextMenu actions={actions} position={{ x: 100, y: 200 }} onClose={() => {}} />)
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls action and closes on click', () => {
    const onClose = vi.fn()
    render(<ExplorerContextMenu actions={actions} position={{ x: 100, y: 200 }} onClose={onClose} />)
    fireEvent.click(screen.getByText('Rename'))
    expect(actions[0].action).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when clicking outside', () => {
    const onClose = vi.fn()
    render(<ExplorerContextMenu actions={actions} position={{ x: 100, y: 200 }} onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })
})
