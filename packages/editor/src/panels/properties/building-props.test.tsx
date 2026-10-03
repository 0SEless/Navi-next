import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../../context'
import { BuildingProperties } from './building-props'

afterEach(cleanup)

function createBuilding(overrides = {}) {
  return {
    id: 'bld-1',
    name: 'Main Building',
    code: 'MB',
    category: 'academic',
    description: 'The main campus building',
    color: '#4A90D9',
    baseElevation: 0,
    height: 20,
    floors: [],
    footprint: { points: [{ lat: 0, lng: 0 }] },
    ...overrides,
  }
}

const IDLE_SNAPSHOT = Object.freeze({
  version: 0,
  publishState: 'idle' as const,
  publishResult: null,
  publishError: null,
  currentStageStartedAt: 0,
  lastPublishedRevision: 0,
  lastPublishedAt: 0,
})

function createMockServices(execute = vi.fn()) {
  const publishStore = {
    subscribe: () => () => {},
    getSnapshot: () => IDLE_SNAPSHOT,
  }
  return {
    get: (name: string) => {
      if (name === 'dispatcher') return { execute }
      if (name === 'publishStore') return publishStore
      return undefined
    },
  }
}

function renderWithServices(building: any, execute = vi.fn()) {
  const services = createMockServices(execute)
  const doc = {
    buildings: [{ id: 'bld-1', floors: [] }],
    roads: [], panoramas: [], qrCheckpoints: [],
  } as any
  return { execute, ...render(
    <EditorProvider context={{ document: doc, services }}>
      <BuildingProperties building={building} />
    </EditorProvider>,
  ) }
}

describe('BuildingProperties', () => {
  it('renders section headers and form fields', () => {
    renderWithServices(createBuilding())
    expect(screen.getByText('Information')).toBeDefined()
    expect(screen.getByText('Physical')).toBeDefined()
    expect(screen.getByText('Status')).toBeDefined()
    expect(screen.getByText('Actions')).toBeDefined()
    expect(screen.getByText('Assets')).toBeDefined()
    expect(screen.getByText('Danger Zone')).toBeDefined()
    expect(screen.getByDisplayValue('Main Building')).toBeDefined()
    expect(screen.getByDisplayValue('MB')).toBeDefined()
    expect(screen.getByDisplayValue('The main campus building')).toBeDefined()
  })

  it('renders category select with academic selected', () => {
    renderWithServices(createBuilding({ category: 'residential' }))
    const select = screen.getByDisplayValue('residential') as HTMLSelectElement
    expect(select).toBeDefined()
    expect(select.tagName).toBe('SELECT')
  })

  it('dispatches entity.update when name changes', () => {
    const { execute } = renderWithServices(createBuilding())
    fireEvent.change(screen.getByDisplayValue('Main Building'), { target: { value: 'New Name' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Building',
      payload: { entityId: 'bld-1', changes: { name: 'New Name' } },
    })
  })

  it('dispatches entity.update when category changes', () => {
    const { execute } = renderWithServices(createBuilding())
    fireEvent.change(screen.getByDisplayValue('academic'), { target: { value: 'library' } })
    expect(execute).toHaveBeenCalledWith({
      id: 'entity.update',
      label: 'Edit Building',
      payload: { entityId: 'bld-1', changes: { category: 'library' } },
    })
  })

  it('renders Edit Interior button', () => {
    renderWithServices(createBuilding())
    expect(screen.getByText('Edit Interior')).toBeDefined()
  })

  it('renders Build Status', () => {
    renderWithServices(createBuilding())
    expect(screen.getByText(/Build Status/)).toBeDefined()
    expect(screen.getByText(/Last Published/)).toBeDefined()
  })
})
