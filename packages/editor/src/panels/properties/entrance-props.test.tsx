import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { EntranceProperties } from './entrance-props'

afterEach(cleanup)

function createEntrance(overrides = {}) {
  return {
    id: 'ent-1',
    label: 'Main Entrance',
    type: 'main',
    hasQR: true,
    hasPanorama: false,
    ...overrides,
  }
}

function renderWithDispatcher(entrance: any, execute = vi.fn()) {
  const services = {
    get: (name: string) => (name === 'dispatcher' ? { execute } : undefined),
  }
  return { execute, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <EntranceProperties entrance={entrance} />
    </EditorProvider>,
  ) }
}

describe('EntranceProperties', () => {
  it('renders Entrance header and fields', () => {
    renderWithDispatcher(createEntrance())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('Main Entrance')).toBeDefined()
    expect(screen.getByDisplayValue('main')).toBeDefined()
  })

  it('dispatches entity.update when label changes', () => {
    const { execute } = renderWithDispatcher(createEntrance())
    fireEvent.change(screen.getByDisplayValue('Main Entrance'), { target: { value: 'Side Door' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Entrance',
      payload: { entityId: 'ent-1', changes: { label: 'Side Door' } },
    })
  })
})
