import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { CommandDispatcher } from '../commands/dispatcher'
import { CommandRegistry } from '../commands/registry'
import { entityUpdateHandler } from '../commands/entity-update-handler'
import { DocumentEventBus } from '../eventbus'
import { DocumentStore } from '../context/document-store'
import { HistoryStack } from '../history'
import { commitFloorPlanAlignment } from '@/lib/floor-plan-commit'

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'map', name: 'Map', description: '', lastModified: '', editorVersion: '1' },
    buildings: [{
      id: 'building-1', name: 'Building', code: 'B', category: 'academic', description: '',
      footprint: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }, { lat: 14.001, lng: 121.001 }, { lat: 14.001, lng: 121 }] },
      baseElevation: 0, height: 10, color: '#fff', aliases: [], metadata: {},
      floors: [{
        id: 'floor-1', level: 0, label: 'Ground', elevation: 0, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [], metadata: {},
        planAlignment: { offset: { x: 3, y: -2 }, scaleX: 1.4, scaleY: 0.8, rotation: 21, opacity: 0.35, locked: false },
      }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  } as CampusDocument
}

describe('floor-plan alignment history', () => {
  it.each([
    ['width', { scaleX: 1.8, scaleY: 0.8 }],
    ['height', { scaleX: 1.4, scaleY: 1.2 }],
    ['x/y', { offset: { x: 8, y: 5 } }],
    ['rotation', { rotation: -45 }],
    ['reset', { offset: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotation: 0 }],
    ['lock', { locked: true }],
  ])('records one command and restores %s through undo/redo', (_label, changes) => {
    const document = createDocument()
    const eventBus = new DocumentEventBus()
    const store = new DocumentStore(document, eventBus)
    const registry = new CommandRegistry()
    registry.register(entityUpdateHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    const history = new HistoryStack(dispatcher, document, registry, 20, store)
    dispatcher.addPreHook(history)
    dispatcher.addPostHook(history)

    const before = structuredClone(document.buildings[0].floors[0].planAlignment)
    const candidate = { ...before, ...changes, offset: { ...(before?.offset ?? { x: 0, y: 0 }), ...(changes.offset ?? {}) } }
    const committed = commitFloorPlanAlignment(dispatcher, 'floor-1', candidate)

    expect(committed).toBeTruthy()
    expect(history.undoCount).toBe(1)
    expect(document.buildings[0].floors[0].planAlignment).toEqual(committed)

    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].planAlignment).toEqual(before)
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].planAlignment).toEqual(committed)
  })

  it('keeps overlay lock separate from the authored Floor.locked field', () => {
    const document = createDocument()
    const eventBus = new DocumentEventBus()
    const store = new DocumentStore(document, eventBus)
    const registry = new CommandRegistry()
    registry.register(entityUpdateHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    const history = new HistoryStack(dispatcher, document, registry, 20, store)
    dispatcher.addPreHook(history)
    dispatcher.addPostHook(history)

    commitFloorPlanAlignment(dispatcher, 'floor-1', { ...document.buildings[0].floors[0].planAlignment!, locked: true })
    expect(document.buildings[0].floors[0].planAlignment?.locked).toBe(true)
    expect(document.buildings[0].floors[0].locked).toBeUndefined()
  })

  it('undoes and redoes the remove lifecycle as one metadata command', () => {
    const document = createDocument()
    const eventBus = new DocumentEventBus()
    const store = new DocumentStore(document, eventBus)
    const registry = new CommandRegistry()
    registry.register(entityUpdateHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    const history = new HistoryStack(dispatcher, document, registry, 20, store)
    dispatcher.addPreHook(history)
    dispatcher.addPostHook(history)

    const before = structuredClone(document.buildings[0].floors[0].planAlignment)
    dispatcher.execute({
      id: 'entity.update',
      label: 'Remove Floor Plan',
      payload: { entityId: 'floor-1', changes: { planImageId: null, floorPlanState: 'none', planAlignment: null } },
    })

    expect(history.undoCount).toBe(1)
    expect(document.buildings[0].floors[0].planAlignment).toBeNull()
    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].planAlignment).toEqual(before)
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].planAlignment).toBeNull()
  })
})
