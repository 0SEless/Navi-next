import { describe, it, expect, beforeEach } from 'vitest'
import { CommandDispatcher } from './dispatcher'
import { CommandRegistry } from './registry'
import { DocumentEventBus } from '../eventbus'
import type { CampusDocument } from '@navi/core'
import { buildingCreateHandler, buildingRenameHandler, buildingDeleteHandler } from './building-handlers'

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

describe('CommandDispatcher', () => {
  let registry: CommandRegistry
  let document: CampusDocument
  let eventBus: DocumentEventBus
  let dispatcher: CommandDispatcher

  beforeEach(() => {
    registry = new CommandRegistry()
    registry.register(buildingCreateHandler)
    registry.register(buildingRenameHandler)
    registry.register(buildingDeleteHandler)

    document = createDoc()
    eventBus = new DocumentEventBus()
    dispatcher = new CommandDispatcher(registry, document, eventBus)
  })

  it('executes building.create', () => {
    const result = dispatcher.execute({ id: 'building.create', label: 'Create Building', payload: { name: 'Main', code: 'M' } })
    expect(result.success).toBe(true)
    expect(document.buildings).toHaveLength(1)
    expect(document.buildings[0].name).toBe('Main')
  })

  it('executes building.rename', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'Old', code: 'O' } })
    const bldId = document.buildings[0].id
    const result = dispatcher.execute({ id: 'building.rename', label: 'Rename', payload: { buildingId: bldId, name: 'New' } })
    expect(result.success).toBe(true)
    expect(document.buildings[0].name).toBe('New')
  })

  it('executes building.delete', () => {
    dispatcher.execute({ id: 'building.create', label: 'Create', payload: { name: 'X', code: 'X' } })
    const bldId = document.buildings[0].id
    const result = dispatcher.execute({ id: 'building.delete', label: 'Delete', payload: { buildingId: bldId } })
    expect(result.success).toBe(true)
    expect(document.buildings).toHaveLength(0)
  })

  it('throws for unknown command', () => {
    expect(() => dispatcher.execute({ id: 'nope', label: '', payload: {} })).toThrow('Unknown command')
  })

  it('returns error when building not found for rename', () => {
    const result = dispatcher.execute({ id: 'building.rename', label: '', payload: { buildingId: 'none', name: 'X' } })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('runs pre-hooks', () => {
    const calls: string[] = []
    dispatcher.addPreHook({ id: 'log', before: () => { calls.push('pre') } })
    dispatcher.execute({ id: 'building.create', label: '', payload: { name: 'T', code: 'T' } })
    expect(calls).toEqual(['pre'])
  })

  it('runs post-hooks', () => {
    const calls: string[] = []
    dispatcher.addPostHook({ id: 'log', after: () => { calls.push('post') } })
    dispatcher.execute({ id: 'building.create', label: '', payload: { name: 'T', code: 'T' } })
    expect(calls).toEqual(['post'])
  })

  it('emits entity.created event', () => {
    const events: string[] = []
    eventBus.on('entity.created', (p) => events.push(p.entityId))
    const result = dispatcher.execute({ id: 'building.create', label: '', payload: { name: 'T', code: 'T' } })
    expect(events).toEqual([result.entityId])
  })

  it('generates inverse command for create', () => {
    const result = dispatcher.execute({ id: 'building.create', label: '', payload: { name: 'T', code: 'T' } })
    const inverse = buildingCreateHandler.inverse!({}, result)
    expect(inverse).not.toBeNull()
    expect(inverse!.id).toBe('building.delete')
  })

  it('skipHooks prevents hooks from running', () => {
    let hookRan = false
    dispatcher.addPostHook({ id: 'test', after: () => { hookRan = true } })
    dispatcher.execute({ id: 'building.create', label: '', payload: { name: 'T', code: 'T' } }, { skipHooks: true })
    expect(hookRan).toBe(false)
  })
})
