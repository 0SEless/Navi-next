import { describe, it, expect, beforeEach } from 'vitest'
import { CommandRegistry } from './commands/registry'
import { CommandDispatcher } from './commands/dispatcher'
import { HistoryStack } from './history'
import { DocumentEventBus } from './eventbus'
import { DocumentStore } from './context/document-store'
import type { CampusDocument } from '@navi/core'
import { buildingCreateHandler, buildingRenameHandler, buildingDeleteHandler } from './commands/building-handlers'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('HistoryStack', () => {
  let registry: CommandRegistry
  let document: CampusDocument
  let documentStore: DocumentStore
  let eventBus: DocumentEventBus
  let dispatcher: CommandDispatcher
  let history: HistoryStack

  beforeEach(() => {
    registry = new CommandRegistry()
    registry.register(buildingCreateHandler)
    registry.register(buildingRenameHandler)
    registry.register(buildingDeleteHandler)

    document = createDoc()
    eventBus = new DocumentEventBus()
    documentStore = new DocumentStore(document, eventBus)
    dispatcher = new CommandDispatcher(registry, document, eventBus)
    history = new HistoryStack(dispatcher, document, registry, 200, documentStore)

    dispatcher.addPreHook(history)
    dispatcher.addPostHook(history)
  })

  it('starts with no undo/redo', () => {
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })

  it('records command in history after execute', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    expect(history.canUndo).toBe(true)
    expect(history.undoCount).toBe(1)
  })

  it('undo reverts building.create (via inverse delete)', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    expect(document.buildings).toHaveLength(1)

    history.undo()
    expect(document.buildings).toHaveLength(0)
    expect(history.canRedo).toBe(true)
  })

  it('redo replays building.create', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    history.undo()
    expect(document.buildings).toHaveLength(0)

    history.redo()
    expect(document.buildings).toHaveLength(1)
    expect(document.buildings[0].name).toBe('A')
  })

  it('undo/redo rename preserves old name', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    const bldId = document.buildings[0].id

    dispatcher.execute({ id: 'building.rename', label: 'Rename', payload: { buildingId: bldId, name: 'B' } })
    expect(document.buildings[0].name).toBe('B')

    history.undo()
    expect(document.buildings[0].name).toBe('A')

    history.redo()
    expect(document.buildings[0].name).toBe('B')
  })

  it('new command after undo clears future', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    history.undo()
    expect(history.canRedo).toBe(true)

    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'B', code: 'B' } })
    expect(history.canRedo).toBe(false)
  })

  it('multiple undos work in sequence', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'B', code: 'B' } })
    expect(document.buildings).toHaveLength(2)

    history.undo()
    expect(document.buildings).toHaveLength(1)
    expect(document.buildings[0].name).toBe('A')

    history.undo()
    expect(document.buildings).toHaveLength(0)
  })

  it('clear resets everything', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.memoryUsage).toBe(0)
  })

  it('delete uses snapshot fallback (inverse returns null)', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    const bldId = document.buildings[0].id
    const versionAfterCreate = documentStore.version

    dispatcher.execute({ id: 'building.delete', label: 'Delete', payload: { buildingId: bldId } })
    expect(document.buildings).toHaveLength(0)

    history.undo()
    expect(document.buildings).toHaveLength(1)
    expect(document.buildings[0].name).toBe('A')
    expect(documentStore.version).toBeGreaterThan(versionAfterCreate)
  })

  it('redo after delete restores snapshot and bumps version', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'A', code: 'A' } })
    const bldId = document.buildings[0].id
    dispatcher.execute({ id: 'building.delete', label: 'Delete', payload: { buildingId: bldId } })
    expect(document.buildings).toHaveLength(0)

    history.undo()
    expect(document.buildings).toHaveLength(1)
    const versionAfterUndo = documentStore.version

    history.redo()
    expect(document.buildings).toHaveLength(0)
    expect(documentStore.version).toBeGreaterThan(versionAfterUndo)
  })
})
