import { describe, expect, it } from 'vitest'
import type { NavigationArtifacts, POI, SearchEntry } from '@navi/core'
import { build } from '../package-builder'

function authoredPoi(): POI {
  return {
    id: 'authored-rectangle',
    label: 'Rectangle POI',
    category: 'food',
    position: { lat: 14.1, lng: 121.2 },
    buildingId: 'b1',
    floor: 1,
    properties: { owner: 'studio' },
    source: 'authored',
    sourceId: 'authored-rectangle',
    floorId: 'f1',
    geometry: {
      type: 'rectangle',
      points: [
        { lat: 14.1, lng: 121.2 },
        { lat: 14.1, lng: 121.21 },
        { lat: 14.11, lng: 121.21 },
        { lat: 14.11, lng: 121.2 },
      ],
    },
    appearance: { mode: '2.5d', height: 5 },
  } as unknown as POI
}

function artifacts(): NavigationArtifacts {
  const authoredSearch = {
    id: 'authored-rectangle',
    label: 'Rectangle POI',
    type: 'poi',
    position: { lat: 14.1, lng: 121.2 },
    tags: ['rectangle', 'food', 'owner', 'studio'],
    category: 'food',
    buildingId: 'b1',
    floor: 1,
    floorId: 'f1',
    source: 'authored',
    sourceId: 'authored-rectangle',
  } as unknown as SearchEntry

  return {
    graph: {
      version: '1.0.0',
      campusId: 'campus-4a',
      createdAt: '2026-09-12T00:00:00.000Z',
      checksum: 'fixture',
      nodes: [],
      edges: [],
      metadata: {
        nodeCount: 0,
        edgeCount: 0,
        buildings: 0,
        floors: 0,
        boundingBox: { minLng: 121, maxLng: 121.2, minLat: 14, maxLat: 14.2 },
      },
    },
    searchIndex: { version: '1.0.0', entries: [authoredSearch] },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 0.001 },
    buildingIndex: { version: '1.0.0', buildings: [] },
    poiIndex: { version: '1.0.0', points: [authoredPoi()] },
    metadata: { compilerVersion: '4a-test', revision: '7', compiledAt: '2026-09-12T00:00:00.000Z' },
    extensions: {},
  }
}

describe('Phase 4A publisher POI contract', () => {
  it('serializes additive authored identity and geometry while omitting nodeId', () => {
    const pkg = build(artifacts(), {
      campusId: 'campus-4a',
      campusName: 'Phase 4A',
      outputDir: 'unused',
      publishedAt: '2026-09-12T00:00:00.000Z',
    })

    expect(pkg.poi?.points[0]).toMatchObject({
      id: 'authored-rectangle',
      source: 'authored',
      sourceId: 'authored-rectangle',
      floorId: 'f1',
      geometry: artifacts().poiIndex.points[0]!.geometry,
      appearance: { mode: '2.5d', height: 5 },
    })
    expect(pkg.poi?.points[0]?.nodeId).toBeUndefined()
  })

  it('serializes authored search context while omitting nodeId', () => {
    const pkg = build(artifacts(), {
      campusId: 'campus-4a',
      campusName: 'Phase 4A',
      outputDir: 'unused',
      publishedAt: '2026-09-12T00:00:00.000Z',
    })

    expect(pkg.search?.entries[0]).toMatchObject({
      id: 'authored-rectangle',
      label: 'Rectangle POI',
      type: 'poi',
      category: 'food',
      lat: 14.1,
      lng: 121.2,
      tags: ['rectangle', 'food', 'owner', 'studio'],
      buildingId: 'b1',
      floor: 1,
      floorId: 'f1',
      source: 'authored',
      sourceId: 'authored-rectangle',
    })
    expect(pkg.search?.entries[0]?.nodeId).toBeUndefined()
  })

  it('serializes outdoor/campus POIs with scope and world geometry, omitting building/floor', () => {
    const base = artifacts()
    const outdoorPoi = {
      id: 'outdoor-guard-post',
      label: 'Guard Post',
      category: 'other',
      position: { lat: 14.05, lng: 121.05 },
      properties: {},
      source: 'authored',
      sourceId: 'outdoor-guard-post',
      scope: 'outdoor',
      geometry: { type: 'point', position: { lat: 14.05, lng: 121.05 } },
    } as unknown as POI
    base.poiIndex = { version: '1.0.0', points: [outdoorPoi] }
    base.searchIndex = {
      version: '1.0.0',
      entries: [{
        id: 'outdoor-guard-post',
        label: 'Guard Post',
        type: 'poi',
        position: { lat: 14.05, lng: 121.05 },
        tags: ['guard', 'post'],
        category: 'other',
        source: 'authored',
        sourceId: 'outdoor-guard-post',
        scope: 'outdoor',
      } as unknown as SearchEntry],
    }

    const pkg = build(base, {
      campusId: 'campus-4a',
      campusName: 'Phase 4A',
      outputDir: 'unused',
      publishedAt: '2026-09-12T00:00:00.000Z',
    })

    expect(pkg.poi?.points[0]).toMatchObject({
      id: 'outdoor-guard-post',
      scope: 'outdoor',
      source: 'authored',
      sourceId: 'outdoor-guard-post',
      geometry: { type: 'point', position: { lat: 14.05, lng: 121.05 } },
    })
    expect(pkg.poi?.points[0]?.nodeId).toBeUndefined()
    expect(pkg.poi?.points[0]?.buildingId).toBeUndefined()
    expect(pkg.poi?.points[0]?.floor).toBeUndefined()

    expect(pkg.search?.entries[0]).toMatchObject({
      id: 'outdoor-guard-post',
      type: 'poi',
      scope: 'outdoor',
      sourceId: 'outdoor-guard-post',
      lat: 14.05,
      lng: 121.05,
    })
    expect(pkg.search?.entries[0]?.nodeId).toBeUndefined()
    expect(pkg.search?.entries[0]?.buildingId).toBeUndefined()
    expect(pkg.search?.entries[0]?.floor).toBeUndefined()
  })

  it('carries authored visibility through poi.json', () => {
    const base = artifacts()
    base.poiIndex = {
      version: '1.0.0',
      points: [{
        ...authoredPoi(),
        id: 'poi-hidden',
        visibility: { showOnMap: false, searchable: true },
      } as unknown as POI],
    }

    const pkg = build(base, {
      campusId: 'campus-4a',
      campusName: 'Phase 4A',
      outputDir: 'unused',
      publishedAt: '2026-09-12T00:00:00.000Z',
    })

    expect(pkg.poi?.points[0]?.visibility).toEqual({ showOnMap: false, searchable: true })
  })

  it('carries a resolved preferred approach anchor through poi.json', () => {
    const base = artifacts()
    base.poiIndex = {
      version: '1.0.0',
      points: [{
        ...authoredPoi(),
        id: 'poi-anchored',
        approach: { mode: 'preferred', position: { lat: 14.05, lng: 121.05 } },
      } as unknown as POI],
    }

    const pkg = build(base, {
      campusId: 'campus-4a',
      campusName: 'Phase 4A',
      outputDir: 'unused',
      publishedAt: '2026-09-12T00:00:00.000Z',
    })

    expect(pkg.poi?.points[0]?.approach).toEqual({ mode: 'preferred', lat: 14.05, lng: 121.05 })
  })
})
