import { describe, expect, it } from 'vitest'
import type { NavigationGraphFile, POIEntryFile, POIIndexFile, SearchIndexFile } from '@navi/core'
import { ReferenceValidator } from '../reference-validator'
import { toRuntimePOI, toRuntimeSearch } from '../runtime-converter'

const graph: NavigationGraphFile = {
  schemaVersion: '1.0.0',
  campusId: 'campus-4a',
  checksum: 'fixture',
  nodes: [{ id: 'legacy-node', type: 'poi', lat: 14, lng: 121, floor: 0, buildingId: 'b1' }],
  edges: [],
}

const authoredEntry = {
  id: 'authored-circle',
  label: 'Circle POI',
  category: 'waiting_area',
  lat: 14.0001,
  lng: 121.0002,
  buildingId: 'b1',
  floor: 0,
  floorId: 'f1',
  source: 'authored',
  sourceId: 'authored-circle',
  geometry: {
    type: 'circle',
    center: { lat: 14.0001, lng: 121.0002 },
    radius: 3,
  },
  appearance: { mode: '2.5d', height: 4 },
  properties: { owner: 'studio' },
} as unknown as POIEntryFile

const authoredIndex: POIIndexFile = {
  schemaVersion: '1.0.0',
  points: [authoredEntry],
}

describe('Phase 4A runtime POI contract', () => {
  it('loads authored geometry and identity without requiring a navigation node', () => {
    const runtime = toRuntimePOI(authoredIndex)
    expect(runtime.points[0]).toMatchObject({
      id: 'authored-circle',
      buildingId: 'b1',
      floor: 0,
      floorId: 'f1',
      source: 'authored',
      sourceId: 'authored-circle',
      geometry: authoredEntry.geometry,
      appearance: authoredEntry.appearance,
      properties: { owner: 'studio' },
    })
    expect(runtime.points[0]!.nodeId).toBeUndefined()

    const result = new ReferenceValidator().validate({ graph, poi: authoredIndex })
    expect(result.success).toBe(true)
  })

  it('continues rejecting a graph-derived POI with a missing node reference', () => {
    const legacyEntry = {
      id: 'legacy-poi',
      label: 'Legacy POI',
      category: 'food',
      lat: 14,
      lng: 121,
      nodeId: 'missing-node',
      source: 'graph-derived',
      sourceId: 'missing-node',
      properties: {},
    } as unknown as POIEntryFile

    const result = new ReferenceValidator().validate({
      graph,
      poi: { schemaVersion: '1.0.0', points: [legacyEntry] },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.references).toEqual([
        { source: 'poi.points', field: 'nodeId', missingId: 'missing-node' },
      ])
    }
  })

  it('loads an authored search entry without inventing a navigation node', () => {
    const file = {
      schemaVersion: '1.0.0',
      entries: [{
        id: 'authored-circle',
        label: 'Circle POI',
        type: 'poi',
        lat: 14.0001,
        lng: 121.0002,
        tags: ['circle', 'waiting', 'area'],
        category: 'waiting_area',
        buildingId: 'b1',
        floor: 0,
        floorId: 'f1',
        source: 'authored',
        sourceId: 'authored-circle',
      }],
    } as unknown as SearchIndexFile

    const runtime = toRuntimeSearch(file)
    expect(runtime.entries[0]).toMatchObject({
      id: 'authored-circle',
      label: 'Circle POI',
      type: 'poi',
      position: { lat: 14.0001, lng: 121.0002 },
      category: 'waiting_area',
      buildingId: 'b1',
      floor: 0,
      floorId: 'f1',
      source: 'authored',
      sourceId: 'authored-circle',
    })
    expect(runtime.entries[0]!.nodeId).toBeUndefined()
  })

  it('loads an outdoor/campus POI with scope and without building/floor context', () => {
    const outdoorEntry = {
      id: 'outdoor-guard-post',
      label: 'Guard Post',
      category: 'other',
      lat: 14.05,
      lng: 121.05,
      source: 'authored',
      sourceId: 'outdoor-guard-post',
      scope: 'outdoor',
      geometry: { type: 'point', position: { lat: 14.05, lng: 121.05 } },
      properties: {},
    } as unknown as POIEntryFile

    const runtime = toRuntimePOI({ schemaVersion: '1.0.0', points: [outdoorEntry] })
    expect(runtime.points[0]).toMatchObject({
      id: 'outdoor-guard-post',
      label: 'Guard Post',
      scope: 'outdoor',
      source: 'authored',
      sourceId: 'outdoor-guard-post',
      position: { lat: 14.05, lng: 121.05 },
      geometry: { type: 'point', position: { lat: 14.05, lng: 121.05 } },
    })
    expect(runtime.points[0]!.nodeId).toBeUndefined()
    expect(runtime.points[0]!.buildingId).toBeUndefined()
    expect(runtime.points[0]!.floor).toBeUndefined()

    // Reference validation succeeds without a node reference.
    const result = new ReferenceValidator().validate({
      graph,
      poi: { schemaVersion: '1.0.0', points: [outdoorEntry] },
    })
    expect(result.success).toBe(true)

    const search = toRuntimeSearch({
      schemaVersion: '1.0.0',
      entries: [{
        id: 'outdoor-guard-post',
        label: 'Guard Post',
        type: 'poi',
        lat: 14.05,
        lng: 121.05,
        tags: ['guard', 'post'],
        category: 'other',
        source: 'authored',
        sourceId: 'outdoor-guard-post',
        scope: 'outdoor',
      }],
    } as unknown as SearchIndexFile)
    expect(search.entries[0]).toMatchObject({ id: 'outdoor-guard-post', type: 'poi', scope: 'outdoor' })
    expect(search.entries[0]!.nodeId).toBeUndefined()
    expect(search.entries[0]!.buildingId).toBeUndefined()
  })

  it('carries authored visibility into the runtime POI', () => {
    const hiddenEntry = {
      id: 'poi-hidden',
      label: 'Hidden Lobby',
      category: 'other',
      lat: 14.06,
      lng: 121.06,
      source: 'authored',
      sourceId: 'poi-hidden',
      visibility: { showOnMap: false, searchable: true },
      properties: {},
    } as unknown as POIEntryFile

    const runtime = toRuntimePOI({ schemaVersion: '1.0.0', points: [hiddenEntry] })
    expect(runtime.points[0]?.visibility).toEqual({ showOnMap: false, searchable: true })
  })

  it('loads a resolved preferred approach anchor into the runtime POI', () => {
    const anchoredEntry = {
      id: 'poi-anchored',
      label: 'Anchored',
      category: 'other',
      lat: 14.05,
      lng: 121.05,
      source: 'authored',
      sourceId: 'poi-anchored',
      approach: { mode: 'preferred', lat: 14.0501, lng: 121.0501 },
      properties: {},
    } as unknown as POIEntryFile

    const runtime = toRuntimePOI({ schemaVersion: '1.0.0', points: [anchoredEntry] })
    expect(runtime.points[0]?.approach).toEqual({ mode: 'preferred', position: { lat: 14.0501, lng: 121.0501 } })
  })
})
