import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { StaircaseProperties } from './staircase-props'

afterEach(cleanup)

function createStaircase(overrides = {}) {
  return {
    id: 'st-1',
    name: 'Stair A',
    fromLevel: 0,
    toLevel: 1,
    type: 'open',
    ...overrides,
  }
}

function renderWithDispatcher(staircase: any, execute = vi.fn()) {
  const services = {
    get: (name: string) => (name === 'dispatcher' ? { execute } : undefined),
  }
  return { execute, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <StaircaseProperties staircase={staircase} />
    </EditorProvider>,
  ) }
}

describe('StaircaseProperties', () => {
  it('renders Staircase header and fields', () => {
    renderWithDispatcher(createStaircase())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('Stair A')).toBeDefined()
    expect(screen.getByDisplayValue('open')).toBeDefined()
  })

  it('dispatches entity.update when name changes', () => {
    const { execute } = renderWithDispatcher(createStaircase())
    fireEvent.change(screen.getByDisplayValue('Stair A'), { target: { value: 'Stair B' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Staircase',
      payload: { entityId: 'st-1', changes: { name: 'Stair B' } },
    })
  })
})
