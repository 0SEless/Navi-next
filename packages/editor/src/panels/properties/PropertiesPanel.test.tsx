import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EditorProvider } from '../../context'
import type { EditorContext } from '../../context'
import type { CampusDocument } from '@navi/core'
import { DocumentEventBus } from '../../eventbus'
import { CommandRegistry, CommandDispatcher, entityUpdateHandler } from '../../commands'
import { Viewport } from '../../viewport'
import { SelectionManager } from '../../selection'
import { PropertiesPanel } from './PropertiesPanel'

afterEach(cleanup)

function createContext(): EditorContext {
  const eventBus = new DocumentEventBus()
  const registry = new CommandRegistry()
  registry.register(entityUpdateHandler)
  const document: CampusDocument = {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      floors: [{
        id: 'flr-1', level: 0, label: 'Ground', elevation: 0,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {},
      }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
  const dispatcher = new CommandDispatcher(registry, document, eventBus)
  const selection = new SelectionManager(document, eventBus)
  const viewport = new Viewport(eventBus)
  const services = {
    get(name: string) {
      if (name === 'dispatcher') return dispatcher
      if (name === 'selection') return selection
      if (name === 'eventBus') return eventBus
      if (name === 'viewport') return viewport
    },
  }
  return { document, services }
}

describe('PropertiesPanel', () => {
  it('shows placeholder when nothing selected', () => {
    render(
      <EditorProvider context={createContext()}>
        <PropertiesPanel />
      </EditorProvider>,
    )
    expect(screen.queryByText('Workflow')).toBeNull()
  })

  it('shows building properties when building selected', () => {
    const ctx = createContext()
    const selection = ctx.services.get('selection') as SelectionManager
    selection.select('bld-1')
    render(
      <EditorProvider context={ctx}>
        <PropertiesPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('Information')).toBeDefined()
    expect(screen.getByText('Physical')).toBeDefined()
    expect(screen.getByText('Status')).toBeDefined()
    expect(screen.getByText('Actions')).toBeDefined()
    expect(screen.getByText('Assets')).toBeDefined()
    expect(screen.getByText('Danger Zone')).toBeDefined()
    expect(screen.getByDisplayValue('Main')).toBeDefined()
  })
})
