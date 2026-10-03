import { describe, expect, it } from 'vitest'
import type { CampusDocument } from '@navi/core'
import type { Command } from '../types'
import { CommandDispatcher } from '../dispatcher'
import { CommandRegistry } from '../registry'
import { poiCreateHandler, poiDeleteHandler, poiUpdateHandler } from '../feature-handlers'
import { DocumentEventBus } from '../../eventbus'
import { HistoryStack } from '../../history'
import { DocumentStore } from '../../context/document-store'

function makeDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'poi-appearance', name: 'POI appearance', description: '', lastModified: '', editorVersion: 'test' },
    buildings: [{
      id: 'building-1', name: 'Main', code: 'MAIN', category: 'academic', description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }] },
      baseElevation: 10, height: 20, color: '#4A90D9', aliases: [], metadata: {}, verticalConnectors: [],
      floors: [{
        id: 'floor-1', level: 0, label: 'Ground', elevation: 2, height: 3.5,
        rooms: [], hallways: [], staircases: [], elevators: [], entrances: [], connectorStops: [],
        routeNetwork: {
          nodes: [
            { id: 'route-a', type: 'waypoint', position: { x: 0, y: 0 }, floor: 0 },
            { id: 'route-b', type: 'waypoint', position: { x: 10, y: 0 }, floor: 0 },
          ],
          edges: [{ id: 'route-edge', from: 'route-a', to: 'route-b', type: 'walk', distance: 10 }],
        },
        pois: [], parametricComponents: [], metadata: {},
      }],
    }],
    roads: [], panoramas: [], qrCheckpoints: [], areas: [], roadJunctions: [], separatedCrossings: [],
  } as CampusDocument
}

function makeHistory(document: CampusDocument): { dispatcher: CommandDispatcher; history: HistoryStack } {
  const eventBus = new DocumentEventBus()
  const documentStore = new DocumentStore(document, eventBus)
  const registry = new CommandRegistry()
  registry.register(poiCreateHandler)
  registry.register(poiUpdateHandler)
  registry.register(poiDeleteHandler)
  const dispatcher = new CommandDispatcher(registry, document, eventBus)
  const history = new HistoryStack(dispatcher, document, registry, 20, documentStore)
  dispatcher.addPreHook(history)
  dispatcher.addPostHook(history)
  return { dispatcher, history }
}

function topologySnapshot(document: CampusDocument): string {
  const floor = document.buildings[0].floors[0]
  return JSON.stringify({
    roads: document.roads,
    junctions: document.roadJunctions,
    routeNetwork: floor.routeNetwork,
    areas: document.areas,
  })
}

describe('Phase 3D POI appearance commands', () => {
  it('rejects invalid appearance before changing the POI or its geometry', () => {
    const document = makeDocument()
    const { dispatcher } = makeHistory(document)
    expect(dispatcher.execute({
      id: 'poi.create', label: 'Create POI',
      payload: {
        id: 'poi-invalid', buildingId: 'building-1', floorId: 'floor-1', name: 'Invalid', category: 'other',
        geometry: { type: 'rectangle', min: { x: 1, y: 2 }, max: { x: 5, y: 6 } },
        appearance: { mode: '2.5d', height: 0 },
      },
    } satisfies Command).success).toBe(false)
    expect(document.buildings[0].floors[0].pois).toEqual([])
  })

  it('keeps appearance mutations on poi commands and preserves them through history', () => {
    const document = makeDocument()
    const { dispatcher, history } = makeHistory(document)
    const topologyBefore = topologySnapshot(document)

    expect(dispatcher.execute({
      id: 'poi.create',
      label: 'Create 2.5D POI',
      payload: {
        id: 'poi-rectangle', buildingId: 'building-1', floorId: 'floor-1', name: 'Block', category: 'other',
        geometry: { type: 'rectangle', min: { x: 1, y: 2 }, max: { x: 5, y: 6 } },
        appearance: { mode: '2.5d', height: 4.5 },
      },
    } satisfies Command).success).toBe(true)

    const created = document.buildings[0].floors[0].pois![0]
    expect(created.appearance).toEqual({ mode: '2.5d', height: 4.5 })
    expect(topologySnapshot(document)).toBe(topologyBefore)

    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois).toEqual([])
    expect(history.redo()).toBe(true)
    expect(document.buildings[0].floors[0].pois![0].appearance).toEqual({ mode: '2.5d', height: 4.5 })

    expect(dispatcher.execute({
      id: 'poi.update', label: 'Set 2D POI',
      payload: { poiId: 'poi-rectangle', patch: { appearance: { mode: '2d' } } },
    } satisfies Command).success).toBe(true)
    expect(document.buildings[0].floors[0].pois![0].appearance).toEqual({ mode: '2d' })
    expect(topologySnapshot(document)).toBe(topologyBefore)
    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois![0].appearance).toEqual({ mode: '2.5d', height: 4.5 })
    expect(history.redo()).toBe(true)

    expect(dispatcher.execute({
      id: 'poi.delete', label: 'Delete POI', payload: { poiId: 'poi-rectangle' },
    } satisfies Command).success).toBe(true)
    expect(history.undo()).toBe(true)
    expect(document.buildings[0].floors[0].pois![0].appearance).toEqual({ mode: '2d' })
    expect(topologySnapshot(document)).toBe(topologyBefore)
  })
})
