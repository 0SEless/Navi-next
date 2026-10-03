import { describe, it, expect } from 'vitest'
import type { NavigationArtifacts } from '@navi/core'
import { build } from '../package-builder'

function makeArtifacts(overrides?: Partial<NavigationArtifacts>): NavigationArtifacts {
  return {
    graph: {
      version: '1.0.0',
      campusId: 'campus-1',
      createdAt: '2026-07-17T00:00:00Z',
      checksum: 'abc123',
      nodes: [
        { id: 'n1', label: 'Node 1', type: 'waypoint', position: { lat: 14.5, lng: 121.0 }, floor: 0, buildingId: 'b1', properties: {} },
        { id: 'n2', label: 'Node 2', type: 'poi', position: { lat: 14.6, lng: 121.1 }, floor: 1, buildingId: 'b1', properties: {} },
        { id: 'n3', label: '', type: 'entrance', position: { lat: 14.55, lng: 121.05 }, floor: 0, buildingId: 'b1', properties: {} },
        { id: 'n4', label: 'Outdoor', type: 'outdoor', position: { lat: 14.5, lng: 121.0 }, floor: 0, buildingId: '__outdoor__', properties: {} },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 100, weight: 100 },
        { id: 'e2', from: 'n2', to: 'n3', type: 'stairs', distance: 20, weight: 30 },
      ],
      metadata: {
        nodeCount: 4,
        edgeCount: 2,
        buildings: 2,
        floors: 2,
        boundingBox: { minLat: 14.5, maxLat: 14.6, minLng: 121.0, maxLng: 121.1 },
      },
    },
    searchIndex: {
      version: '1.0.0',
      entries: [
        { id: 's1', label: 'Building 1', type: 'building', nodeId: 'n1', position: { lat: 14.5, lng: 121.0 }, tags: ['b1'], buildingId: 'b1', floor: 0 },
        { id: 's2', label: 'Room A', type: 'room', nodeId: 'n2', position: { lat: 14.6, lng: 121.1 }, tags: ['room'], buildingId: 'b1', floor: 1 },
      ],
    },
    spatialIndex: {
      version: '1.0.0',
      cells: { '0:140:1210': ['n1', 'n3'], '1:146:1211': ['n2'] },
      cellSize: 0.001,
    },
    buildingIndex: {
      version: '1.0.0',
      buildings: [
        {
          id: 'b1',
          name: 'Building One',
          code: 'B1',
          category: 'academic',
          position: { lat: 14.5, lng: 121.0 },
          nodeId: 'n1',
          floors: [
            { level: 0, label: 'Ground', elevation: 0, rooms: [] },
            { level: 1, label: 'Second', elevation: 4, rooms: [] },
          ],
          entrances: [
            { id: 'ent-1', label: 'Main Entrance', position: { lat: 14.55, lng: 121.05 } },
          ],
        },
      ],
    },
    poiIndex: {
      version: '1.0.0',
      points: [
        { id: 'poi-1', label: 'Cafeteria', category: 'food', position: { lat: 14.6, lng: 121.1 }, nodeId: 'n2', buildingId: 'b1', floor: 1, properties: {} },
      ],
    },
    panoramaIndex: {
      version: '1.0.0',
      panoramas: [
        {
          id: 'pano-1',
          title: 'Lobby',
          imageAssetId: 'img-1',
          buildingId: 'b1',
          floor: 0,
          position: { lat: 14.5, lng: 121.0 },
          heading: 90,
          hotspots: [
            { id: 'h1', type: 'navigation', target: 'rm-1', yaw: 45, pitch: -10, label: 'Room 1' },
            { id: 'h2', type: 'link', target: 'https://x.com', yaw: 200, pitch: 0, label: 'Site' },
          ],
        },
      ],
    },
    metadata: {
      compilerVersion: '1.0.0',
      revision: 'rev-1',
      compiledAt: '2026-07-17T00:00:00Z',
    },
    extensions: {},
    ...overrides,
  }
}

describe('PackageBuilder', () => {
  it('flattens NavNode positions into lat/lng fields', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.graph.nodes[0]).toEqual(
      expect.objectContaining({ id: 'n1', lat: 14.5, lng: 121.0, floor: 0, buildingId: 'b1' }),
    )
    expect(pkg.graph.nodes[0]).not.toHaveProperty('position')
    // P2: label and properties are now serialized (previously dropped)
    expect(pkg.graph.nodes[0]).toHaveProperty('label')
    expect(pkg.graph.nodes[0]).toHaveProperty('properties')
  })

  it('maps NavNode types to published format types', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.graph.nodes.find(n => n.id === 'n1')?.type).toBe('waypoint')
    expect(pkg.graph.nodes.find(n => n.id === 'n2')?.type).toBe('poi')
    expect(pkg.graph.nodes.find(n => n.id === 'n3')?.type).toBe('entrance')
    expect(pkg.graph.nodes.find(n => n.id === 'n4')?.type).toBe('outdoor')
  })

  it('maps NavEdge types correctly', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.graph.edges.find(e => e.id === 'e1')?.type).toBe('walk')
    expect(pkg.graph.edges.find(e => e.id === 'e2')?.type).toBe('stairs')
  })

  it('flattens SearchEntry positions into lat/lng fields', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.search?.entries[0]).toEqual(
      expect.objectContaining({ id: 's1', lat: 14.5, lng: 121.0 }),
    )
    expect(pkg.search?.entries[0]).not.toHaveProperty('position')
  })

  it('flattens BuildingEntry positions into lat/lng fields', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.buildings?.buildings[0]?.position).toEqual({ lat: 14.5, lng: 121.0 })
  })

  it('flattens POI positions into lat/lng fields', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.poi?.points[0]).toEqual(
      expect.objectContaining({ id: 'poi-1', lat: 14.6, lng: 121.1 }),
    )
    expect(pkg.poi?.points[0]).not.toHaveProperty('position')
  })

  it('computes nodeIds per floor from graph nodes', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    const b1 = pkg.buildings?.buildings.find(b => b.id === 'b1')
    expect(b1?.floors).toBeDefined()
    expect(b1?.floors[0]?.nodeIds).toContain('n1')
    expect(b1?.floors[0]?.nodeIds).toContain('n3')
    expect(b1?.floors[1]?.nodeIds).toContain('n2')
  })

  it('maps entrances to nodeIds', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    const b1 = pkg.buildings?.buildings.find(b => b.id === 'b1')
    expect(b1?.entrances[0]?.nodeId).toBe('n3')
  })

  it('populates PackageMetadata correctly', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.metadata).toEqual({
      nodeCount: 4,
      edgeCount: 2,
      buildingCount: 2,
      floorCount: 3,
      boundingBox: { minLat: 14.5, maxLat: 14.6, minLng: 121.0, maxLng: 121.1 },
      routeable: true,
    })
  })

  it('copies provenance metadata verbatim', () => {
    const arts = makeArtifacts()
    arts.metadata = undefined
    const pkg = build(arts, { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(pkg.compilerVersion).toBe('')
    expect(pkg.revision).toBe('')
    expect(pkg.campusId).toBe('campus-1')
    expect(pkg.campusName).toBe('Test Campus')
  })

  it('copies ArtifactsMetadata when present', () => {
    const arts = makeArtifacts({
      metadata: {
        compilerVersion: '1.2.3',
        revision: 'rev-abc',
        compiledAt: '2026-07-17T00:00:00Z',
      },
    })

    const pkg = build(arts, { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })
    expect(pkg.compilerVersion).toBe('1.2.3')
    expect(pkg.revision).toBe('rev-abc')
  })

  it('accepts publishedAt from options', () => {
    const pkg = build(makeArtifacts(), {
      campusId: 'campus-1',
      campusName: 'Test Campus',
      outputDir: '/tmp',
      publishedAt: '2026-07-17T12:00:00Z',
    })

    expect(pkg.publishedAt).toBe('2026-07-17T12:00:00Z')
  })

  it('omits optional artifacts when absent', () => {
    const arts = makeArtifacts()
    arts.searchIndex = undefined as any
    arts.spatialIndex = undefined as any
    arts.buildingIndex = undefined as any
    arts.poiIndex = undefined as any

    const pkg = build(arts, { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })
    expect(pkg.search).toBeUndefined()
    expect(pkg.spatial).toBeUndefined()
    expect(pkg.buildings).toBeUndefined()
    expect(pkg.poi).toBeUndefined()
  })

  it('is deterministic — same input produces identical output', () => {
    const arts = makeArtifacts()
    const opts = { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp', publishedAt: '2026-07-17T12:00:00Z' }

    const a = build(arts, opts)
    const b = build(arts, opts)

    expect(a).toEqual(b)
  })

  it('is pure — no I/O or side effects', () => {
    const arts = makeArtifacts()
    const before = JSON.stringify(arts)

    build(arts, { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })

    expect(JSON.stringify(arts)).toBe(before)
  })

  it('uses default schema versions when not specified', () => {
    const pkg = build(makeArtifacts(), { campusId: 'c-1', campusName: 'C', outputDir: '/tmp' })

    expect(pkg.schemaVersions.graph).toBe('1.0.0')
    expect(pkg.schemaVersions.search).toBe('1.0.0')
    expect(pkg.schemaVersions.spatial).toBe('1.0.0')
    expect(pkg.schemaVersions.buildings).toBe('1.0.0')
    expect(pkg.schemaVersions.poi).toBe('1.0.0')
  })

  it('accepts custom schema versions', () => {
    const pkg = build(makeArtifacts(), {
      campusId: 'c-1',
      campusName: 'C',
      outputDir: '/tmp',
      schemaVersions: { graph: '2.0.0', search: '1.5.0' },
    })

    expect(pkg.schemaVersions.graph).toBe('2.0.0')
    expect(pkg.schemaVersions.search).toBe('1.5.0')
    expect(pkg.schemaVersions.spatial).toBe('1.0.0')
  })

  it('sets routeable to false when graph has fewer than 2 nodes', () => {
    const arts = makeArtifacts()
    arts.graph.nodes = [
      { id: 'n1', label: '', type: 'waypoint', position: { lat: 0, lng: 0 }, floor: 0, buildingId: 'b1', properties: {} },
    ]
    arts.graph.edges = []

    const pkg = build(arts, { campusId: 'c-1', campusName: 'C', outputDir: '/tmp' })
    expect(pkg.metadata.routeable).toBe(false)
  })
})

describe('Panorama artifact (M6.5a)', () => {
  it('builds a panorama file from panoramaIndex', () => {
    const pkg = build(makeArtifacts(), { campusId: 'c-1', campusName: 'C', outputDir: '/tmp' })
    expect(pkg.panorama).toBeDefined()
    expect(pkg.panorama!.panoramas).toHaveLength(1)
    expect(pkg.panorama!.panoramas[0].id).toBe('pano-1')
    expect(pkg.panorama!.panoramas[0].title).toBe('Lobby')
    expect(pkg.panorama!.panoramas[0].imageAssetId).toBe('img-1')
    expect(pkg.panorama!.panoramas[0].buildingId).toBe('b1')
    expect(pkg.panorama!.panoramas[0].floor).toBe(0)
    expect(pkg.panorama!.panoramas[0].lat).toBe(14.5)
    expect(pkg.panorama!.panoramas[0].lng).toBe(121.0)
    expect(pkg.panorama!.panoramas[0].heading).toBe(90)
    expect(pkg.panorama!.panoramas[0].hotspots).toHaveLength(2)
  })

  it('preserves hotspotType and content through the artifact mapping (R6.1/R6.2)', () => {
    const arts = makeArtifacts({
      panoramaIndex: {
        version: '1.0.0',
        panoramas: [
          {
            id: 'pano-1',
            title: 'Lobby',
            imageAssetId: 'img-1',
            buildingId: 'b1',
            floor: 0,
            position: { lat: 14.5, lng: 121.0 },
            heading: 90,
            hotspots: [
              { id: 'h-nav', type: 'navigation', target: 'rm-1', yaw: 45, pitch: -10, label: 'Room 1', hotspotType: 'navigation' },
              {
                id: 'h-info',
                type: 'information',
                target: '',
                yaw: 120,
                pitch: 5,
                label: 'About',
                hotspotType: 'information',
                content: {
                  title: 'Welcome',
                  description: 'Campus lobby',
                  imageUrl: 'https://cdn.example/img.webp',
                  linkUrl: 'https://example.com',
                  linkLabel: 'More',
                  entityId: 'poi-1',
                },
              },
            ],
          },
        ],
      },
    })

    const pkg = build(arts, { campusId: 'c-1', campusName: 'C', outputDir: '/tmp' })
    const hotspots = pkg.panorama!.panoramas[0].hotspots

    // Base mapping (pre-existing behavior)
    expect(hotspots[0]).toMatchObject({
      id: 'h-nav',
      type: 'navigation',
      target: 'rm-1',
      yaw: 45,
      pitch: -10,
      label: 'Room 1',
    })
    // hotspotType must survive the artifact mapping
    expect(hotspots[0].hotspotType).toBe('navigation')
    expect(hotspots[1].hotspotType).toBe('information')
    // Information-hotspot content must survive the artifact mapping
    expect(hotspots[1].content).toEqual({
      title: 'Welcome',
      description: 'Campus lobby',
      imageUrl: 'https://cdn.example/img.webp',
      linkUrl: 'https://example.com',
      linkLabel: 'More',
      entityId: 'poi-1',
    })
  })

  it('includes panorama in schemaVersions', () => {
    const pkg = build(makeArtifacts(), { campusId: 'c-1', campusName: 'C', outputDir: '/tmp' })
    expect(pkg.schemaVersions.panorama).toBe('1.0.0')
  })

  it('omits panorama file when panoramaIndex is absent', () => {
    const arts = makeArtifacts()
    arts.panoramaIndex = undefined
    const pkg = build(arts, { campusId: 'c-1', campusName: 'C', outputDir: '/tmp' })
    expect(pkg.panorama).toBeUndefined()
  })
})

describe('PackageBuilder — P1-T10 floor-geometry artifact', () => {
  it('emits a floor-geometry file with its schema version when the artifact is present', () => {
    const artifacts = makeArtifacts({
      floorGeometry: {
        schemaVersion: 1,
        formatVersion: 0,
        campusId: 'campus-1',
        buildings: [
          {
            id: 'b1',
            name: 'Building One',
            anchor: { origin: { lat: 14.5, lng: 121.0 }, rotation: 0 },
            floors: [
              {
                level: 0,
                label: 'Ground',
                elevation: 0,
                offset: { x: 0, y: 0 },
                rooms: [],
                hallways: [],
                staircases: [],
                elevators: [],
                doors: [],
                pois: [],
                qrCheckpoints: [],
              },
            ],
          },
        ],
      },
    })
    const pkg = build(artifacts, {
      campusId: 'campus-1',
      campusName: 'Test Campus',
      outputDir: '/tmp',
      schemaVersions: { floorGeometry: '1.0.0' },
    })
    expect(pkg.floorGeometry).toBeDefined()
    expect(pkg.floorGeometry!.schemaVersion).toBe('1.0.0')
    expect(pkg.floorGeometry!.formatVersion).toBe(0)
    expect(pkg.floorGeometry!.buildings[0].anchor.origin).toEqual({ lat: 14.5, lng: 121.0 })
    expect(pkg.schemaVersions.floorGeometry).toBe('1.0.0')
  })

  it('omits the floor-geometry file when the artifact is absent', () => {
    const pkg = build(makeArtifacts(), { campusId: 'campus-1', campusName: 'Test Campus', outputDir: '/tmp' })
    expect(pkg.floorGeometry).toBeUndefined()
  })
})

describe('PackageBuilder — P1-T13 QR index artifact', () => {
  it('emits qr-index.json with its schema version when the artifact is present', () => {
    const artifacts = makeArtifacts({
      qrIndex: {
        schemaVersion: 1,
        formatVersion: 0,
        campusId: 'campus-1',
        checkpoints: [
          { id: 'qr-1', label: 'A', buildingId: 'b1', floor: 0, position: { x: 1, y: 2 }, code: 'navi.app/q/qr-1' },
        ],
      },
    })
    const pkg = build(artifacts, {
      campusId: 'campus-1',
      campusName: 'Test Campus',
      outputDir: '/tmp',
      schemaVersions: { qrIndex: '1.0.0' },
    })
    expect(pkg.qrIndex).toBeDefined()
    expect(pkg.qrIndex!.schemaVersion).toBe('1.0.0')
    expect(pkg.qrIndex!.checkpoints[0].position).toEqual({ x: 1, y: 2 })
    expect(pkg.schemaVersions.qrIndex).toBe('1.0.0')
  })
})
