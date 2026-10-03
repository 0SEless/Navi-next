import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { RoomProperties } from './room-props'

afterEach(cleanup)

function createRoom(overrides = {}) {
  return {
    id: 'rm-1',
    name: 'Lecture Hall',
    number: '101',
    category: 'classroom',
    capacity: 50,
    polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    ...overrides,
  }
}

function renderWithDispatcher(room: any, execute = vi.fn()) {
  const services = {
    get: (name: string) => (name === 'dispatcher' ? { execute } : undefined),
  }
  return { execute, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <RoomProperties room={room} />
    </EditorProvider>,
  ) }
}

describe('RoomProperties', () => {
  it('renders Room header and form fields', () => {
    renderWithDispatcher(createRoom())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('Lecture Hall')).toBeDefined()
    expect(screen.getByDisplayValue('101')).toBeDefined()
  })

  it('shows vertex count', () => {
    renderWithDispatcher(createRoom())
    expect(screen.getByText(/4 vertices/)).toBeDefined()
  })

  it('renders category select with classroom selected', () => {
    renderWithDispatcher(createRoom({ category: 'lab' }))
    const select = screen.getByDisplayValue('lab') as HTMLSelectElement
    expect(select).toBeDefined()
    expect(select.tagName).toBe('SELECT')
  })

  it('dispatches entity.update when name changes', () => {
    const { execute } = renderWithDispatcher(createRoom())
    fireEvent.change(screen.getByDisplayValue('Lecture Hall'), { target: { value: 'New Room' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Room',
      payload: { entityId: 'rm-1', changes: { name: 'New Room' } },
    })
  })
})
