import { describe, it, expect } from 'vitest'
import type { FloorGeometryFile, FloorGeometryArtifact, NavigationPackageManifest } from '@navi/core'
import type { PackageReader } from '../loader/package-reader'
import type { ChecksumVerifier } from '../loader/checksum-verifier'
import { PackageLoader } from '../loader/package-loader'
import { ArtifactHydrator } from '../loader/artifact-hydrator'
import { ReferenceValidator } from '../loader/reference-validator'
import { toRuntimeFloorGeometry } from '../loader/runtime-converter'

function minimalGraphJson(): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    campusId: 'campus-1',
    checksum: 'abc',
    nodes: [
      { id: 'n1', type: 'waypoint', lat: 14.5, lng: 121.0, floor: 0, buildingId: 'b1' },
      { id: 'n2', type: 'waypoint', lat: 14.501, lng: 121.001, floor: 0, buildingId: 'b1' },
    ],
    edges: [{ id: 'e1', from: 'n1', to: 'n2', type: 'walk', distance: 15, weight: 1 }],
  })
}

function minimalFloorGeometry(): FloorGeometryFile {
  return {
    schemaVersion: '1.0.0',
    formatVersion: 0,
    campusId: 'campus-1',
    buildings: [
      {
        id: 'b1',
        name: 'Building A',
        anchor: { origin: { lat: 14.5, lng: 121.0 }, rotation: 45 },
        floors: [
          {
            level: 0, label: 'Ground Floor', elevation: 0,
            offset: { x: 10, y: 20 },
            rooms: [
              { id: 'r1', name: 'Room 101', number: '101', polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] } },
              { id: 'r2', name: 'Room 102', number: '102', polygon: { points: [{ x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 6, y: 4 }] } },
            ],
            hallways: [{ id: 'h1', name: 'Main Corridor', polyline: { points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] } }],
            staircases: [{ id: 's1', name: 'Stair A', position: { x: 0, y: 6 }, rotation: 0 }],
            elevators: [{ id: 'el1', name: 'Elevator 1', position: { x: 10, y: 6 }, rotation: 90 }],
            doors: [{ id: 'd1', roomId: 'r1', doorType: 'entry', position: { x: 2.5, y: 0 }, width: 0.9 }],
            pois: [{ id: 'po1', name: 'Water Fountain', category: 'amenity', position: { x: 5, y: 5.5 } }],
            qrCheckpoints: [{ id: 'qr1', label: 'Lobby QR', code: 'CHK-001', position: { x: 5, y: 2 } }],
          },
          {
            level: 1, label: 'First Floor', elevation: 3.5,
            offset: { x: 10, y: 20 },
            rooms: [{ id: 'r3', name: 'Room 201', number: '201', polygon: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }] } }],
            hallways: [], staircases: [], elevators: [], doors: [], pois: [], qrCheckpoints: [],
          },
        ],
      },
      {
        id: 'b2', name: 'Building B',
        anchor: { origin: { lat: 14.502, lng: 121.002 }, rotation: 0 },
        floors: [{
          level: 0, label: 'Lobby', elevation: 0,
          offset: { x: 0, y: 0 },
          rooms: [], hallways: [], staircases: [], elevators: [], doors: [], pois: [], qrCheckpoints: [],
        }],
      },
    ],
  }
}

function minimalFloorGeometryJson(): string {
  return JSON.stringify(minimalFloorGeometry())
}

function buildManifest(
  extraArtifacts: Record<string, { path: string; checksum: string; size: number; schemaVersion: string; formatVersion: string }> = {},
): NavigationPackageManifest {
  return {
    schemaVersion: '1.0.0', formatVersion: '0',
    campusId: 'campus-1', campusName: 'Test Campus',
    publishedAt: '2025-01-01T00:00:00Z', compilerVersion: '0.1.0', revision: 'test',
    artifacts: {
      graph: { path: 'graph.json', checksum: 'abc', size: 100, schemaVersion: '1.0.0', formatVersion: '0' },
      ...extraArtifacts,
    },
    metadata: {
      nodeCount: 2, edgeCount: 1, buildingCount: 1, floorCount: 1,
      boundingBox: { minLat: 14.5, maxLat: 14.501, minLng: 121.0, maxLng: 121.001 },
      routeable: true,
    },
  }
}

function createMockReader(files: Record<string, string>): PackageReader {
  return {
    async readFile(relativePath: string): Promise<string> {
      const content = files[relativePath]
      if (content === undefined) throw new Error('File not found: ' + relativePath)
      return content
    },
    async readBytes(relativePath: string): Promise<Uint8Array> {
      return Buffer.from(await this.readFile(relativePath), 'utf-8')
    },
  }
}

function createMockChecksumVerifier(): ChecksumVerifier {
  return {
    hash(): string { return 'abc' },
    verify(): boolean { return true },
  }
}

function loadWithFloorGeometry() {
  const manifest = buildManifest({
    floorGeometry: { path: 'floor-geometry.json', checksum: 'abc', size: 200, schemaVersion: '1.0.0', formatVersion: '0' },
  })
  const reader = createMockReader({
    'manifest.json': JSON.stringify(manifest),
    'graph.json': minimalGraphJson(),
    'floor-geometry.json': minimalFloorGeometryJson(),
  })
  return new PackageLoader(reader, createMockChecksumVerifier(), new ArtifactHydrator(), new ReferenceValidator())
}

describe('PackageLoader loads floorGeometry', () => {
  it('loads floorGeometry from a bundle with floor-geometry artifact', async () => {
    const loader = loadWithFloorGeometry()
    const result = await loader.load()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Load failed')

    const pkg = result.package
    expect(pkg.floorGeometry).toBeDefined()
    expect(pkg.floorGeometry).not.toBeNull()

    const fg = pkg.floorGeometry as FloorGeometryArtifact
    expect(fg.campusId).toBe('campus-1')
    expect(fg.buildings).toHaveLength(2)
    expect(fg.buildings[0].id).toBe('b1')
    expect(fg.buildings[0].name).toBe('Building A')
    expect(fg.buildings[1].id).toBe('b2')
  })

  it('returns undefined floorGeometry when artifact not in manifest', async () => {
    const manifest = buildManifest()
    const reader = createMockReader({
      'manifest.json': JSON.stringify(manifest),
      'graph.json': minimalGraphJson(),
    })
    const loader = new PackageLoader(reader, createMockChecksumVerifier(), new ArtifactHydrator(), new ReferenceValidator())
    const result = await loader.load()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Load failed')
    expect(result.package.floorGeometry).toBeUndefined()
  })

  it('populates floorGeometry report as LOADED', async () => {
    const loader = loadWithFloorGeometry()
    const result = await loader.load()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Load failed')

    const fgReport = result.package.reports.find(r => r.artifactType === 'floorGeometry')
    expect(fgReport).toBeDefined()
    expect(fgReport!.status).toBe('LOADED')
  })
})

describe('floorGeometry contains expected structures', () => {
  it('preserves buildings, floors, rooms, hallways, stairs, elevators, doors, pois, qrCheckpoints', async () => {
    const loader = loadWithFloorGeometry()
    const result = await loader.load()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Load failed')

    const fg = result.package.floorGeometry!
    const building = fg.buildings[0]
    expect(building.floors).toHaveLength(2)

    const groundFloor = building.floors[0]
    expect(groundFloor.label).toBe('Ground Floor')
    expect(groundFloor.rooms).toHaveLength(2)
    expect(groundFloor.hallways).toHaveLength(1)
    expect(groundFloor.staircases).toHaveLength(1)
    expect(groundFloor.elevators).toHaveLength(1)
    expect(groundFloor.doors).toHaveLength(1)
    expect(groundFloor.pois).toHaveLength(1)
    expect(groundFloor.qrCheckpoints).toHaveLength(1)

    const firstFloor = building.floors[1]
    expect(firstFloor.label).toBe('First Floor')
    expect(firstFloor.elevation).toBe(3.5)
    expect(firstFloor.rooms).toHaveLength(1)
  })

  it('preserves building IDs matching expected compiler output', async () => {
    const loader = loadWithFloorGeometry()
    const result = await loader.load()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Load failed')

    const fg = result.package.floorGeometry!
    const buildingIds = fg.buildings.map(b => b.id)
    expect(buildingIds).toEqual(['b1', 'b2'])

    const roomIds = fg.buildings[0].floors[0].rooms.map(r => r.id)
    expect(roomIds).toEqual(['r1', 'r2'])
  })
})

describe('toRuntimeFloorGeometry preserves fields', () => {
  it('converts FloorGeometryFile to FloorGeometryArtifact with all fields', () => {
    const file = minimalFloorGeometry()
    const artifact = toRuntimeFloorGeometry(file)

    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.formatVersion).toBe(0)
    expect(artifact.campusId).toBe('campus-1')
    expect(artifact.buildings).toHaveLength(2)
  })

  it('preserves building-local coordinates (anchor, offset, positions)', () => {
    const file = minimalFloorGeometry()
    const artifact = toRuntimeFloorGeometry(file)

    const b = artifact.buildings[0]
    expect(b.anchor.origin).toEqual({ lat: 14.5, lng: 121.0 })
    expect(b.anchor.rotation).toBe(45)

    const floor = b.floors[0]
    expect(floor.offset).toEqual({ x: 10, y: 20 })

    const room = floor.rooms[0]
    expect(room.polygon.points).toEqual([
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 },
    ])

    expect(floor.staircases[0].position).toEqual({ x: 0, y: 6 })
    expect(floor.elevators[0].position).toEqual({ x: 10, y: 6 })
    expect(floor.doors[0].position).toEqual({ x: 2.5, y: 0 })
    expect(floor.pois[0].position).toEqual({ x: 5, y: 5.5 })
    expect(floor.qrCheckpoints[0].position).toEqual({ x: 5, y: 2 })
  })

  it('parses schemaVersion string to number', () => {
    const file = minimalFloorGeometry()
    file.schemaVersion = '3.1'
    const artifact = toRuntimeFloorGeometry(file)
    expect(artifact.schemaVersion).toBe(3)
  })

  it('defaults to 1 for unparseable schemaVersion', () => {
    const file = minimalFloorGeometry()
    file.schemaVersion = 'abc'
    const artifact = toRuntimeFloorGeometry(file)
    expect(artifact.schemaVersion).toBe(1)
  })
})

describe('round-trip: compile-like bundle -> load -> floorGeometry accessible', () => {
  it('produces a valid FloorGeometryArtifact after loading a complete bundle', async () => {
    const file = minimalFloorGeometry()
    const manifest = buildManifest({
      floorGeometry: { path: 'floor-geometry.json', checksum: 'abc', size: 200, schemaVersion: '1.0.0', formatVersion: '0' },
    })
    const reader = createMockReader({
      'manifest.json': JSON.stringify(manifest),
      'graph.json': minimalGraphJson(),
      'floor-geometry.json': JSON.stringify(file),
    })

    const loader = new PackageLoader(reader, createMockChecksumVerifier(), new ArtifactHydrator(), new ReferenceValidator())
    const result = await loader.load()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('Load failed')

    const pkg = result.package
    const fg = pkg.floorGeometry!

    expect(fg).toBeDefined()
    expect(fg.campusId).toBe(file.campusId)
    expect(fg.buildings).toHaveLength(file.buildings.length)

    for (let i = 0; i < file.buildings.length; i++) {
      expect(fg.buildings[i].id).toBe(file.buildings[i].id)
      expect(fg.buildings[i].name).toBe(file.buildings[i].name)
      for (let j = 0; j < file.buildings[i].floors.length; j++) {
        expect(fg.buildings[i].floors[j].level).toBe(file.buildings[i].floors[j].level)
        expect(fg.buildings[i].floors[j].rooms).toHaveLength(file.buildings[i].floors[j].rooms.length)
      }
    }

    expect(fg.buildings[0].anchor.origin).toEqual({ lat: 14.5, lng: 121.0 })
    expect(fg.buildings[0].anchor.rotation).toBe(45)
    expect(fg.buildings[0].floors[0].offset).toEqual({ x: 10, y: 20 })
  })
})
