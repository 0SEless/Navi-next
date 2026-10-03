import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Road } from '@navi/core'
import { EditorProvider } from '../../context'
import { RoadProperties } from './road-props'

afterEach(cleanup)

function createRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'rd-1',
    name: 'Main Road',
    polyline: {
      points: [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
      ],
    },
    width: 6,
    surface: 'paved',
    type: 'arterial',
    metadata: {},
    ...overrides,
  }
}

function renderWithDispatcher(road: any, execute = vi.fn(), emit = vi.fn(), workflowSave = vi.fn()) {
  const services = {
    get: (name: string) => {
      if (name === 'dispatcher') return { execute }
      if (name === 'eventBus') return { emit }
      if (name === 'workflow') return { save: workflowSave }
      return undefined
    },
  }
  return { execute, emit, workflowSave, ...render(
    <EditorProvider context={{ document: {} as any, services }}>
      <RoadProperties road={road} />
    </EditorProvider>,
  ) }
}

describe('RoadProperties', () => {
  it('renders Road header and fields', () => {
    renderWithDispatcher(createRoad())
    expect(screen.getByText('Details')).toBeDefined()
    expect(screen.getByDisplayValue('Main Road')).toBeDefined()
    expect(screen.getByText('6px')).toBeDefined()
  })

  it('dispatches entity.update when name changes', () => {
    const { execute } = renderWithDispatcher(createRoad())
    fireEvent.change(screen.getByDisplayValue('Main Road'), { target: { value: 'Side Road' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { name: 'Side Road' } },
    })
  })

  it('calls update with correct color on swatch click', () => {
    const { execute } = renderWithDispatcher(createRoad({ metadata: { color: '#1C6BEB' } }))
    const swatches = screen.getAllByRole('button')
    const greenSwatch = swatches.find(b => b.getAttribute('title') === '#22C55E')
    expect(greenSwatch).toBeDefined()
    fireEvent.click(greenSwatch!)
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { metadata: { color: '#22C55E' } } },
    })
  })

  it('emits road.edit event when Edit Road button is clicked', () => {
    const { emit } = renderWithDispatcher(createRoad())
    fireEvent.click(screen.getByText('Edit Road'))
    expect(emit).toHaveBeenCalledWith('road.edit', { roadId: 'rd-1' })
  })

  it('dispatches entity.update when width slider changes', () => {
    const { execute } = renderWithDispatcher(createRoad())
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '12' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { width: 12 } },
    })
  })

  it('dispatches navigation-only display mode changes', () => {
    const { execute } = renderWithDispatcher(createRoad())
    fireEvent.click(screen.getByRole('button', { name: 'Navigation-only route' }))
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Road',
      payload: { entityId: 'rd-1', changes: { displayMode: 'navigation-only' } },
    })
  })

  it('flushes road changes with the Save changes button and Enter', () => {
    const workflowSave = vi.fn().mockResolvedValue(undefined)
    renderWithDispatcher(createRoad(), vi.fn(), vi.fn(), workflowSave)

    fireEvent.keyDown(screen.getByDisplayValue('Main Road'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(workflowSave).toHaveBeenCalledTimes(2)
    expect(workflowSave).toHaveBeenCalledWith('manual')
  })
})
