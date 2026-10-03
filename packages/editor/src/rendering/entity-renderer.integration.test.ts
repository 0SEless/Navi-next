import { describe, it, expect } from 'vitest'
import { DocumentEventBus } from '../eventbus'
import { CommandRegistry } from '../commands/registry'
import { CommandDispatcher } from '../commands/dispatcher'
import { roadCreateHandler } from '../commands/road-handlers'
import { SelectionManager } from '../selection'
import { Viewport } from '../viewport'
import { EntityRenderer } from './entity-renderer'
import type { CampusDocument } from '@navi/core'

/**
 * Integration test for the canonical render path:
 *   CommandDispatcher → DocumentEventBus → EntityRenderer → MapLibre source
 *
 * Proves that executing `road.create` through the real dispatcher causes the
 * `navi-roads` GeoJSON source to be populated (the key mapping in syncAll
 * previously used singular keys and silently dropped roads/rooms/etc.).
 */
function mockMap() {
  const sources: Record<string, any> = {}
  return {
    on: () => {},
    loaded: () => true,
    getSource: (id: string) => sources[id] ?? null,
    addSource: (id: string, def: any) => {
      sources[id] = { ...def, setData: (d: any) => { sources[id].data = d } }
    },
    getLayer: () => null,
    addLayer: () => {},
    removeLayer: () => {},
    removeSource: (id: string) => { delete sources[id] },
  } as any
}

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  } as any
}

describe('EntityRenderer full pipeline', () => {
  it('road.create command populates the navi-roads source', () => {
    const document = makeDocument()
    const eventBus = new DocumentEventBus()
    const registry = new CommandRegistry()
    registry.register(roadCreateHandler)
    const dispatcher = new CommandDispatcher(registry, document, eventBus)
    const selection = new SelectionManager(document, eventBus)
    const viewport = new Viewport(eventBus)

    const map = mockMap()
    const renderer = new EntityRenderer({ map, document, eventBus, selection, viewport, transformer: undefined })
    renderer.init()

    expect(map.getSource('navi-roads').data.features).toHaveLength(0)

    const res = dispatcher.execute({ id: 'road.create', payload: { points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } })
    expect(res.success).toBe(true)

    const roadsSource = map.getSource('navi-roads')
    expect(roadsSource.data.features).toHaveLength(1)
    expect(roadsSource.data.features[0].geometry.type).toBe('LineString')
  })
})
