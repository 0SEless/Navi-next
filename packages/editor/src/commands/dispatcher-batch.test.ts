import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import { DocumentEventBus } from '../eventbus'
import { DocumentStore } from '../context/document-store'
import { CommandDispatcher } from './dispatcher'
import { CommandRegistry } from './registry'
import { roadCreateHandler } from './road-handlers'
import type { CommandHandler } from './types'

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 3,
    metadata: { campusId: 'campus-1', name: 'Demo', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

const failingHandler: CommandHandler = {
  id: 'test.fail-after-mutation',
  execute(document) {
    document.roads.push({
      id: 'should-rollback',
      name: 'Temporary',
      polyline: { points: [{ lat: 11.8, lng: 122.1 }, { lat: 11.801, lng: 122.101 }] },
      width: 3,
      surface: 'paved',
      type: 'pedestrian',
      displayMode: 'visible',
      metadata: {},
    })
    return { success: false, error: 'Injected command failure' }
  },
}

describe('CommandDispatcher.executeBatch', () => {
  it('rolls back document content/version and events when a command fails', async () => {
    const document = createDocument()
    const snapshot = structuredClone(document)
    const eventBus = new DocumentEventBus()
    const documentStore = new DocumentStore(document, eventBus)
    const registry = new CommandRegistry()
    registry.register(roadCreateHandler)
    registry.register(failingHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    await dispatcher.init({
      document,
      get(id) {
        if (id === 'eventBus') return eventBus
        if (id === 'documentStore') return documentStore
        throw new Error(`Unexpected service: ${id}`)
      },
    } as never)
    let documentChanged = 0
    eventBus.on('document.changed', () => { documentChanged += 1 })

    const result = dispatcher.executeBatch([
      { id: 'road.create', label: 'Create Road', payload: { name: 'Imported', points: [{ lat: 11.8, lng: 122.1 }, { lat: 11.801, lng: 122.101 }], type: 'pedestrian', width: 3 } },
      { id: 'test.fail-after-mutation', label: 'Fail', payload: {} },
    ])

    expect(result.success).toBe(false)
    expect(document).toEqual(snapshot)
    expect(documentStore.version).toBe(0)
    expect(documentChanged).toBe(0)
  })

  it('commits a successful batch once and keeps normal execute behavior available', async () => {
    const document = createDocument()
    const eventBus = new DocumentEventBus()
    const documentStore = new DocumentStore(document, eventBus)
    const registry = new CommandRegistry()
    registry.register(roadCreateHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    await dispatcher.init({
      document,
      get(id) {
        if (id === 'eventBus') return eventBus
        if (id === 'documentStore') return documentStore
        throw new Error(`Unexpected service: ${id}`)
      },
    } as never)
    let documentChanged = 0
    eventBus.on('document.changed', () => { documentChanged += 1 })

    const result = dispatcher.executeBatch([
      { id: 'road.create', label: 'Create Road A', payload: { name: 'A', points: [{ lat: 11.8, lng: 122.1 }, { lat: 11.801, lng: 122.101 }], type: 'pedestrian', width: 3 } },
      { id: 'road.create', label: 'Create Road B', payload: { name: 'B', points: [{ lat: 11.802, lng: 122.102 }, { lat: 11.803, lng: 122.103 }], type: 'pedestrian', width: 3 } },
    ])

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(2)
    expect(document.roads.map((road) => road.name)).toEqual(['A', 'B'])
    expect(documentStore.version).toBe(1)
    expect(documentChanged).toBe(1)

    const single = dispatcher.execute({ id: 'road.create', label: 'Create Road C', payload: { name: 'C', points: [{ lat: 11.804, lng: 122.104 }, { lat: 11.805, lng: 122.105 }], type: 'pedestrian', width: 3 } })
    expect(single.success).toBe(true)
    expect(document.roads).toHaveLength(3)
    expect(documentStore.version).toBe(2)
  })
})
