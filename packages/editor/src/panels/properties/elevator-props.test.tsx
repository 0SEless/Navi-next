import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { ElevatorProperties } from './elevator-props'

afterEach(cleanup)

function createElevator(overrides = {}) {
  return {
    id: 'el-1',
    name: 'Elevator 1',
    fromLevel: 0,
    toLevel: 5,
    ...overrides,
  }
}

function renderWithDispatcher(elevator: any, execute = vi.fn()) {
  const services = {
    get: (name: string) => (name === 'dispatcher' ? { execute } : undefined),
  }
  return { execute, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <ElevatorProperties elevator={elevator} />
    </EditorProvider>,
  ) }
}

describe('ElevatorProperties', () => {
  it('renders Elevator header and fields', () => {
    renderWithDispatcher(createElevator())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('Elevator 1')).toBeDefined()
  })

  it('dispatches entity.update when name changes', () => {
    const { execute } = renderWithDispatcher(createElevator())
    fireEvent.change(screen.getByDisplayValue('Elevator 1'), { target: { value: 'Elevator 2' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Elevator',
      payload: { entityId: 'el-1', changes: { name: 'Elevator 2' } },
    })
  })
})
