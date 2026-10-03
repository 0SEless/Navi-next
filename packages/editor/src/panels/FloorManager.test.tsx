import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

afterEach(cleanup)
import { EditorProvider, serviceNames } from '../context'
import type { EditorContext } from '../context'
import type { CampusDocument } from '@navi/core'
import { DocumentEventBus } from '../eventbus'
import { CommandRegistry, CommandDispatcher } from '../commands'
import { floorCreateHandler, floorRenameHandler, floorDeleteHandler, floorDuplicateHandler } from '../commands'
import { Viewport } from '../viewport'
import { FloorManager } from './FloorManager'

function createMockContext(): EditorContext {
  const eventBus = new DocumentEventBus()
  const registry = new CommandRegistry()
  registry.register(floorCreateHandler)
  registry.register(floorRenameHandler)
  registry.register(floorDeleteHandler)
  registry.register(floorDuplicateHandler)
  const document: CampusDocument = {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Main', code: 'M', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 0, height: 20, color: '#4A90D9', aliases: [], metadata: {},
      floors: [
        { id: 'flr-1', level: 0, label: 'Ground', elevation: 0, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {} },
        { id: 'flr-2', level: 1, label: 'Second', elevation: 4, rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], metadata: {} },
      ],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
  const viewport = new Viewport(eventBus)
  viewport.setActiveBuilding('bld-1')
  viewport.setActiveFloor('flr-1')
  const dispatcher = new CommandDispatcher(registry, document, eventBus)
  const services = {
    get(name: string) {
      if (name === serviceNames.dispatcher) return dispatcher
      if (name === serviceNames.viewport) return viewport
      if (name === serviceNames.eventBus) return eventBus
    },
  }
  return { document, services }
}

describe('FloorManager', () => {
  it('renders floors for active building', () => {
    const ctx = createMockContext()
    render(
      <EditorProvider context={ctx}>
        <FloorManager />
      </EditorProvider>,
    )
    expect(screen.getByText(/Ground/)).toBeDefined()
    expect(screen.getByText(/Second/)).toBeDefined()
  })

  it('shows add button', () => {
    const ctx = createMockContext()
    render(
      <EditorProvider context={ctx}>
        <FloorManager />
      </EditorProvider>,
    )
    expect(screen.getByText('+ Add')).toBeDefined()
  })

  it('returns null when no building selected', () => {
    const ctx = createMockContext()
    const viewport = ctx.services.get(serviceNames.viewport) as any
    viewport.setActiveBuilding(null)
    const { container } = render(
      <EditorProvider context={ctx}>
        <FloorManager />
      </EditorProvider>,
    )
    expect(container.innerHTML).toBe('')
  })
})
