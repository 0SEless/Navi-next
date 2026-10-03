import { describe, it, expect } from 'vitest'
import { buildArtifacts } from '../emitter/artifacts'
import type { ConnectivityGraph, NavigationGraph, WaypointNode, EntrancePortalNode, SkeletonEdge, PortalEdge, NavNode, NavEdge } from '../types'
import type { CampusDocument } from '@navi/core'

const emptyDoc: CampusDocument = {
  schemaVersion: 2,
  version: 0,
  metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '' },
  buildings: [],
  roads: [],
  panoramas: [],
  qrCheckpoints: [],
} as CampusDocument

function n(id: string, type: NavNode['type'], buildingId = 'b1', floor = 0, lat = 14.0, lng = 121.0): NavNode {
  return { id, label: '', type, position: { lat, lng }, floor, buildingId, properties: {} }
}

function e(id: string, from: string, to: string, type: NavEdge['type'] = 'walk', distance = 5): NavEdge {
  return { id, from, to, type, distance, weight: distance }
}

function makeNavGraph(overrides?: Partial<NavigationGraph>): NavigationGraph {
  return {
    version: '1.0.0',
    campusId: 'campus-1',
    createdAt: '',
    checksum: 'abc',
    nodes: [],
    edges: [],
    metadata: { nodeCount: 0, edgeCount: 0, buildings: 0, floors: 0, boundingBox: { minLng: 0, maxLng: 0, minLat: 0, maxLat: 0 } },
    ...overrides,
  }
}

function makeConnGraph(overrides?: Partial<ConnectivityGraph>): ConnectivityGraph {
  return {
    nodes: [],
    edges: [],
    metadata: { campusId: 'campus-1', buildingCount: 0, floorCount: 0, generatedAt: 0 },
    diagnostics: [],
    ...overrides,
  }
}

function makeWp(id: string, buildingId = 'b1', floor = 0): WaypointNode {
  return { id, kind: 'waypoint', position: { lat: 14.0, lng: 121.0 }, floor, buildingId, source: { entityId: id, entityType: 'waypoint', generatorId: 'test' } }
}

function makeEp(id: string, buildingId = 'b1', floor = 0): EntrancePortalNode {
  return { id, kind: 'entrance_portal', position: { lat: 14.0, lng: 121.0 }, outdoorPosition: { lat: 14.0, lng: 121.0 }, indoorPosition: { lat: 14.001, lng: 121.001 }, floor, buildingId, entranceId: `${id}_ent`, accessible: true, source: { entityId: `${id}_ent`, entityType: 'entrance', generatorId: 'test' } }
}

function makeSk(id: string, from: string, to: string, distance = 5): SkeletonEdge {
  return { id, kind: 'skeleton', from, to, distance, source: { entityId: id, entityType: 'skeleton', generatorId: 'test' } }
}

function makePe(id: string, nodeId: string, distance = 1): PortalEdge {
  return { id, kind: 'portal', nodeId, distance, source: { entityId: id, entityType: 'portal', generatorId: 'test' } }
}

describe('buildArtifacts', () => {
  it('returns all NavigationArtifacts fields', () => {
    const cg = makeConnGraph()
    const ng = makeNavGraph()
    const arts = buildArtifacts(cg, ng, emptyDoc)
    expect(arts).toHaveProperty('graph')
    expect(arts).toHaveProperty('searchIndex')
    expect(arts).toHaveProperty('spatialIndex')
    expect(arts).toHaveProperty('buildingIndex')
    expect(arts).toHaveProperty('poiIndex')
    expect(arts).toHaveProperty('extensions')
  })

  it('preserves extensions as an empty record by default', () => {
    const cg = makeConnGraph()
    const ng = makeNavGraph()
    const arts = buildArtifacts(cg, ng, emptyDoc)
    expect(arts.extensions).toEqual({})
  })

  it('emits an optional panoramaIndex', () => {
    const cg = makeConnGraph()
    const ng = makeNavGraph()
    const arts = buildArtifacts(cg, ng, emptyDoc)
    expect(arts).toHaveProperty('panoramaIndex')
    expect(arts.panoramaIndex).toBeDefined()
    expect(arts.panoramaIndex!.panoramas).toEqual([])
  })

  describe('PanoramaIndex (M6.5a)', () => {
    function docWithPanoramas(): CampusDocument {
      return {
        schemaVersion: 2,
        version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '' },
        buildings: [],
        roads: [],
        panoramas: [
          {
            id: 'pano-b1',
            label: 'Building 1 Lobby',
            position: { lat: 14.0, lng: 121.0 } as any,
            heading: 180,
            imageAssetId: 'img-b1',
            buildingId: 'b1',
            floor: 0,
            hotspots: [
              { target: { type: 'room', targetId: 'rm-101' }, position: { pitch: -10, yaw: 45 }, label: 'Room 101' },
              { target: { type: 'url', targetId: 'https://example.com' }, position: { pitch: 0, yaw: 200 }, label: 'Website' },
            ],
          },
          {
            id: 'pano-b2',
            label: 'Building 2 Entrance',
            position: { lat: 14.1, lng: 121.1 } as any,
            heading: 0,
            imageAssetId: 'img-b2',
            buildingId: 'b2',
            floor: 1,
            hotspots: [],
          },
        ],
        qrCheckpoints: [],
      } as CampusDocument
    }

    it('emits one panorama per document panorama', () => {
      const arts = buildArtifacts(makeConnGraph(), makeNavGraph(), docWithPanoramas())
      expect(arts.panoramaIndex!.panoramas).toHaveLength(2)
    })

    it('preserves panorama ids, title, building, floor, position', () => {
      const arts = buildArtifacts(makeConnGraph(), makeNavGraph(), docWithPanoramas())
      const p = arts.panoramaIndex!.panoramas.find(x => x.id === 'pano-b1')!
      expect(p.title).toBe('Building 1 Lobby')
      expect(p.buildingId).toBe('b1')
      expect(p.floor).toBe(0)
      expect(p.heading).toBe(180)
      expect(p.imageAssetId).toBe('img-b1')
      expect(p.position).toEqual({ lat: 14.0, lng: 121.0 })
    })

    it('preserves hotspots with normalized type', () => {
      const arts = buildArtifacts(makeConnGraph(), makeNavGraph(), docWithPanoramas())
      const p = arts.panoramaIndex!.panoramas.find(x => x.id === 'pano-b1')!
      expect(p.hotspots).toHaveLength(2)
      const nav = p.hotspots.find(h => h.label === 'Room 101')!
      expect(nav.type).toBe('navigation')
      expect(nav.target).toBe('rm-101')
      expect(nav.yaw).toBe(45)
      expect(nav.pitch).toBe(-10)
      const link = p.hotspots.find(h => h.label === 'Website')!
      expect(link.type).toBe('link')
      expect(link.target).toBe('https://example.com')
    })

    it('sorts panoramas by id for deterministic output', () => {
      const arts = buildArtifacts(makeConnGraph(), makeNavGraph(), docWithPanoramas())
      const ids = arts.panoramaIndex!.panoramas.map(p => p.id)
      expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    })

    it('produces identical output for identical documents', () => {
      const a = buildArtifacts(makeConnGraph(), makeNavGraph(), docWithPanoramas())
      const b = buildArtifacts(makeConnGraph(), makeNavGraph(), docWithPanoramas())
      expect(JSON.stringify(a.panoramaIndex)).toBe(JSON.stringify(b.panoramaIndex))
    })
  })

  describe('SearchIndex', () => {
    it('indexes outdoor and entrance nodes', () => {
      const ng = makeNavGraph({
        nodes: [n('n1', 'outdoor', 'b1'), n('n2', 'entrance', 'b1'), n('n3', 'waypoint', 'b1')],
      })
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      expect(arts.searchIndex.entries.length).toBe(2)
      expect(arts.searchIndex.entries.every(e => e.type === 'entrance')).toBe(true)
    })

    it('indexes POI nodes', () => {
      const ng = makeNavGraph({
        nodes: [n('n1', 'poi', 'b1')],
      })
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      expect(arts.searchIndex.entries.length).toBe(1)
      expect(arts.searchIndex.entries[0]!.type).toBe('poi')
    })

    it('skips waypoint and transition nodes', () => {
      const ng = makeNavGraph({
        nodes: [n('n1', 'waypoint', 'b1'), n('n2', 'transition', 'b1'), n('n3', 'outdoor', 'b1')],
      })
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      expect(arts.searchIndex.entries.length).toBe(1) // only outdoor
    })

    it('tokenizes labels into tags', () => {
      const ng = makeNavGraph({
        nodes: [n('n1', 'outdoor', 'b1', 0, 14.0, 121.0)],
      })
      ng.nodes[0]!.label = 'Main Entrance - North'
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      const entry = arts.searchIndex.entries[0]!
      expect(entry.tags).toContain('main')
      expect(entry.tags).toContain('entrance')
      expect(entry.tags).toContain('north')
    })

    it('sets label and buildingId on search entries', () => {
      const ng = makeNavGraph({
        nodes: [n('n1', 'poi', 'b2', 2, 14.5, 121.5)],
      })
      ng.nodes[0]!.label = 'Library'
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      const entry = arts.searchIndex.entries[0]!
      expect(entry.label).toBe('Library')
      expect(entry.buildingId).toBe('b2')
      expect(entry.floor).toBe(2)
    })
  })

  describe('SpatialIndex', () => {
    it('groups nodes by grid cell', () => {
      const ng = makeNavGraph({
        nodes: [
          n('n1', 'waypoint', 'b1', 0, 14.0, 121.0),
          n('n2', 'waypoint', 'b1', 0, 14.0005, 121.0005),
          n('n3', 'waypoint', 'b1', 0, 14.5, 121.5),
        ],
      })
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      const cellKeys = Object.keys(arts.spatialIndex.cells)
      expect(cellKeys.length).toBe(2) // two different grid cells
    })

    it('uses cellSize of 0.001', () => {
      const ng = makeNavGraph()
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      expect(arts.spatialIndex.cellSize).toBe(0.001)
    })
  })

  describe('BuildingIndex', () => {
    it('includes each building from connectivity graph', () => {
      const cg = makeConnGraph({
        nodes: [makeWp('wp1', 'b1'), makeWp('wp2', 'b2')],
        metadata: { campusId: 'c1', buildingCount: 2, floorCount: 1, generatedAt: 0 },
      })
      const ng = makeNavGraph({
        nodes: [n('n1', 'waypoint', 'b1'), n('n2', 'waypoint', 'b2')],
      })
      const arts = buildArtifacts(cg, ng, emptyDoc)
      expect(arts.buildingIndex.buildings.length).toBe(2)
      const ids = arts.buildingIndex.buildings.map(b => b.id)
      expect(ids).toContain('b1')
      expect(ids).toContain('b2')
    })

    it('includes entrance nodes in building entries', () => {
      const cg = makeConnGraph({
        nodes: [makeWp('wp1', 'b1')],
      })
      const ng = makeNavGraph({
        nodes: [n('n1', 'waypoint', 'b1'), n('n2', 'entrance', 'b1')],
      })
      const arts = buildArtifacts(cg, ng, emptyDoc)
      const bld = arts.buildingIndex.buildings.find(b => b.id === 'b1')!
      expect(bld.entrances.length).toBe(1)
      expect(bld.entrances[0]!.id).toBe('n2')
    })

    it('publishes optional floor-plan visuals without graph metadata', () => {
      const alignment = { offset: { x: 2, y: -1 }, scaleX: 1.2, scaleY: 0.8, rotation: 18, opacity: 0.6, locked: true }
      const doc = {
        ...emptyDoc,
        buildings: [{
          id: 'b1',
          name: 'Visual Building',
          code: 'VB',
          category: 'academic',
          description: '',
          footprint: { points: [{ lat: 14, lng: 121 }, { lat: 14, lng: 121.001 }, { lat: 14.001, lng: 121.001 }] },
          baseElevation: 0,
          height: 10,
          floors: [{
            id: 'f0',
            level: 0,
            label: 'GF',
            elevation: 0,
            planImageId: 'plan.png',
            planAlignment: alignment,
            rooms: [],
            hallways: [],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [],
            parametricComponents: [],
            metadata: {},
          }],
          aliases: [],
          verticalConnectors: [],
          color: '#fff',
          metadata: {},
        }],
      } as CampusDocument
      const arts = buildArtifacts(
        makeConnGraph({ nodes: [makeWp('wp1', 'b1', 0)] }),
        makeNavGraph({ nodes: [n('n1', 'waypoint', 'b1', 0)] }),
        doc,
      )
      const visual = arts.buildingIndex.buildings.find(b => b.id === 'b1')!.floorPlanVisuals?.[0]

      expect(visual).toEqual({ imageUrl: 'plan.png', alignment })
      expect(arts.graph.nodes.map(node => node.id)).toEqual(['n1'])
      expect(arts.graph.edges).toEqual([])
    })

    it('emits footprint, color, height, baseElevation from document buildings', () => {
      const doc: CampusDocument = {
        schemaVersion: 2,
        version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '' },
        buildings: [
          {
            id: 'b1',
            name: 'Main Building',
            code: 'MAIN',
            category: 'administrative',
            description: '',
            footprint: {
              points: [
                { lat: 14.0, lng: 121.0 },
                { lat: 14.0, lng: 121.001 },
                { lat: 14.001, lng: 121.001 },
                { lat: 14.001, lng: 121.0 },
                { lat: 14.0, lng: 121.0 }, // closed ring
              ],
            },
            baseElevation: 5,
            height: 15,
            color: '#FF0000',
            floors: [],
            verticalConnectors: [],
            aliases: [],
            metadata: { source: 'osm' },
          },
        ],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      } as CampusDocument

      const cg = makeConnGraph({ nodes: [makeWp('wp1', 'b1')] })
      const ng = makeNavGraph({
        nodes: [n('n1', 'waypoint', 'b1')],
      })
      const arts = buildArtifacts(cg, ng, doc)
      const bld = arts.buildingIndex.buildings.find(b => b.id === 'b1')!

      expect(bld.name).toBe('Main Building')
      expect(bld.code).toBe('MAIN')
      expect(bld.category).toBe('administrative')
      expect(bld.footprint).toHaveLength(5)
      expect(bld.footprint![0]).toEqual({ lat: 14.0, lng: 121.0 })
      expect(bld.height).toBe(15)
      expect(bld.baseElevation).toBe(5)
      expect(bld.color).toBe('#FF0000')
      expect(bld.metadata).toEqual({ source: 'osm' })
    })

    it('omits footprint when document building has fewer than 3 points', () => {
      const doc: CampusDocument = {
        schemaVersion: 2,
        version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '' },
        buildings: [
          {
            id: 'b1',
            name: 'Tiny',
            code: 'T',
            category: 'other',
            description: '',
            footprint: { points: [{ lat: 14.0, lng: 121.0 }] },
            baseElevation: 0,
            height: 0,
            color: '',
            floors: [],
            verticalConnectors: [],
            aliases: [],
            metadata: {},
          },
        ],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      } as CampusDocument

      const cg = makeConnGraph({ nodes: [makeWp('wp1', 'b1')] })
      const ng = makeNavGraph({ nodes: [n('n1', 'waypoint', 'b1')] })
      const arts = buildArtifacts(cg, ng, doc)
      const bld = arts.buildingIndex.buildings.find(b => b.id === 'b1')!
      expect(bld.footprint).toBeUndefined()
    })

    it('uses document building name when available', () => {
      const doc: CampusDocument = {
        schemaVersion: 2,
        version: 0,
        metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '' },
        buildings: [
          {
            id: 'b1',
            name: 'Library',
            code: 'LIB',
            category: 'library',
            description: '',
            footprint: { points: [] },
            baseElevation: 0,
            height: 0,
            color: '',
            floors: [],
            verticalConnectors: [],
            aliases: [],
            metadata: {},
          },
        ],
        roads: [],
        panoramas: [],
        qrCheckpoints: [],
      } as CampusDocument

      const cg = makeConnGraph({ nodes: [makeWp('wp1', 'b1')] })
      const ng = makeNavGraph({ nodes: [n('n1', 'waypoint', 'b1')] })
      const arts = buildArtifacts(cg, ng, doc)
      const bld = arts.buildingIndex.buildings.find(b => b.id === 'b1')!
      expect(bld.name).toBe('Library')
      expect(bld.code).toBe('LIB')
      expect(bld.category).toBe('library')
    })
  })

  describe('POIIndex', () => {
    it('indexes POI nav nodes', () => {
      const ng = makeNavGraph({
        nodes: [
          n('n1', 'poi', 'b1', 0, 14.0, 121.0),
          n('n2', 'waypoint', 'b1'),
        ],
      })
      ng.nodes[0]!.label = 'Cafeteria'
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      expect(arts.poiIndex.points.length).toBe(1)
      expect(arts.poiIndex.points[0]!.label).toBe('Cafeteria')
      expect(arts.poiIndex.points[0]!.nodeId).toBe('n1')
    })

    it('skips non-POI nodes', () => {
      const ng = makeNavGraph({
        nodes: [n('n1', 'waypoint', 'b1'), n('n2', 'outdoor', 'b1'), n('n3', 'entrance', 'b1')],
      })
      const arts = buildArtifacts(makeConnGraph(), ng, emptyDoc)
      expect(arts.poiIndex.points.length).toBe(0)
    })
  })
})
