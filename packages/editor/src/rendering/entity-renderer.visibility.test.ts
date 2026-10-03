import { describe, it, expect } from 'vitest'
import { DocumentEventBus } from '../eventbus'
import { SelectionManager } from '../selection'
import { Viewport } from '../viewport'
import { EntityRenderer } from './entity-renderer'
import type { CampusDocument } from '@navi/core'

/**
 * Studio POI visibility contract.
 *
 * `visibility.showOnMap === false` POIs are hidden from the Studio POI source
 * by default (same as the public map). The Studio reveal toggle
 * (`EntityRenderer.setShowHiddenPois`) temporarily brings them back so they
 * can still be selected and re-enabled for editing.
 */

function mockMap() {
  const sources: Record<string, any> = {}
  return {
    on: () => {},
    once: () => {},
    off: () => {},
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
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
    pois: [
      {
        id: 'poi-visible',
        name: 'Visible',
        category: 'other',
        scope: 'outdoor',
        geometry: { type: 'polygon', points: [{ lat: 1, lng: 1 }, { lat: 1, lng: 1.001 }, { lat: 1.001, lng: 1 }] },
      },
      {
        id: 'poi-hidden',
        name: 'Hidden',
        category: 'other',
        scope: 'outdoor',
        geometry: { type: 'polygon', points: [{ lat: 2, lng: 2 }, { lat: 2, lng: 2.001 }, { lat: 2.001, lng: 2 }] },
        visibility: { showOnMap: false, searchable: true },
      },
    ],
  } as unknown as CampusDocument
}

function makeRenderer(map: any, document: CampusDocument): EntityRenderer {
  const eventBus = new DocumentEventBus()
  const selection = new SelectionManager(document, eventBus)
  const viewport = new Viewport(eventBus)
  return new EntityRenderer({ map, document, eventBus, selection, viewport, transformer: undefined })
}

const poiIds = (map: any): string[] =>
  (map.getSource('navi-pois')?.data?.features ?? []).map((feature: any) => feature.id)

describe('EntityRenderer POI visibility', () => {
  it('hides showOnMap=false POIs from the Studio POI source by default', () => {
    const map = mockMap()
    makeRenderer(map, makeDocument()).init()

    expect(poiIds(map)).toContain('poi-visible')
    expect(poiIds(map)).not.toContain('poi-hidden')
  })

  it('reveals hidden POIs while the Studio reveal toggle is enabled', () => {
    const map = mockMap()
    const renderer = makeRenderer(map, makeDocument())
    renderer.init()

    renderer.setShowHiddenPois(true)
    expect(poiIds(map)).toContain('poi-hidden')

    renderer.setShowHiddenPois(false)
    expect(poiIds(map)).not.toContain('poi-hidden')
  })
})
