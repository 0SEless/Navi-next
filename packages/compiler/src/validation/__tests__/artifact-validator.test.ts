import { describe, expect, it } from 'vitest'
import { CampusCompiler } from '../../pipeline/campus-compiler'
import type { CampusDocument } from '@navi/core'
import { validateNavigationArtifacts } from '../artifact-validator'

type ArtifactFixture = Record<string, unknown>

function node(id: string, position = { lat: 14, lng: 121 }) {
  return {
    id,
    label: id,
    type: 'space',
    position,
    floor: 0,
    buildingId: 'building-1',
    properties: {},
  }
}

function edge(
  id: string,
  from = 'node-1',
  to = 'node-2',
  weight = 10,
  distance = 10,
) {
  return { id, from, to, type: 'walk', distance, weight }
}

function graph(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    campusId: 'phase8b-campus',
    createdAt: '2026-09-06T00:00:00.000Z',
    checksum: 'checksum',
    nodes: [node('node-1'), node('node-2', { lat: 14.0001, lng: 121.0001 })],
    edges: [edge('edge-1')],
    metadata: {
      nodeCount: 2,
      edgeCount: 1,
      buildings: 1,
      floors: 1,
      boundingBox: { minLng: 121, maxLng: 121.0001, minLat: 14, maxLat: 14.0001 },
    },
    ...overrides,
  }
}

function artifact(overrides: Record<string, unknown> = {}): ArtifactFixture {
  return {
    graph: graph(),
    searchIndex: { version: '1.0.0', entries: [] },
    spatialIndex: { version: '1.0.0', cells: {}, cellSize: 10 },
    buildingIndex: {
      version: '1.0.0',
      buildings: [{
        id: 'building-1',
        name: 'Building 1',
        code: 'B1',
        category: 'academic',
        position: { lat: 14, lng: 121 },
        floors: [{ level: 0, label: 'Ground', elevation: 0, rooms: [] }],
        entrances: [],
        nodeId: 'node-1',
      }],
    },
    poiIndex: { version: '1.0.0', points: [] },
    components: [{
      id: 'room-1',
      type: 'room',
      buildingId: 'building-1',
      floor: 0,
      position: { lat: 14, lng: 121 },
    }],
    doors: [{
      id: 'door-1',
      roomId: 'room-1',
      buildingId: 'building-1',
      floor: 0,
      position: { lat: 14, lng: 121 },
    }],
    metadata: {
      campusId: 'phase8b-campus',
      connectivitySemanticsVersion: '6.0.0',
      compilerVersion: '1.0.0',
      revision: '8',
      sourceDocumentVersion: '8',
      compiledAt: '2026-09-06T00:00:00.000Z',
    },
    extensions: {},
    ...overrides,
  }
}

function codes(result: ReturnType<typeof validateNavigationArtifacts>) {
  return result.errors.map(error => error.code)
}

function realCompilerCampus(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      campusId: 'phase8b-real-campus',
      name: 'Phase 8B Real Campus',
      description: 'Validator integration fixture',
      lastModified: '',
      editorVersion: 'test',
    },
    buildings: [{
      id: 'building-1',
      name: 'Building 1',
      code: 'B1',
      category: 'academic',
      description: '',
      footprint: {
        points: [
          { lat: 14, lng: 121 },
          { lat: 14.001, lng: 121 },
          { lat: 14.001, lng: 121.001 },
          { lat: 14, lng: 121.001 },
        ],
      },
      baseElevation: 0,
      height: 10,
      floors: [{
        id: 'floor-1',
        level: 1,
        label: 'Ground',
        elevation: 0,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [{
          id: 'entrance-1',
          label: 'Main Entrance',
          position: { lat: 14.0005, lng: 121.0005 },
          level: 1,
          type: 'main',
          hasQR: false,
          hasPanorama: false,
        }],
        connectorStops: [],
        metadata: {},
      }],
      verticalConnectors: [],
      aliases: [],
      color: '#ff0000',
      metadata: {},
    }],
    roads: [{
      id: 'road-1',
      name: 'Campus Road',
      polyline: {
        points: [
          { lat: 14, lng: 121 },
          { lat: 14.001, lng: 121.001 },
        ],
      },
      width: 8,
      surface: 'paved',
      type: 'arterial',
      metadata: {},
    }],
    panoramas: [],
    qrCheckpoints: [],
    roadJunctions: [],
    separatedCrossings: [],
  }
}

describe('validateNavigationArtifacts', () => {
  it('passes NavigationArtifacts emitted by Compiler V2', () => {
    const compiled = new CampusCompiler({ nodeInterval: 10 }).compileV2(realCompilerCampus())

    expect(compiled.artifacts).toBeDefined()

    const result = validateNavigationArtifacts(compiled.artifacts)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('passes a valid Phase 7 same-document artifact', () => {
    const result = validateNavigationArtifacts(artifact())

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it.each([
    ['NaN latitude', { lat: Number.NaN, lng: 121 }],
    ['infinite longitude', { lat: 14, lng: Number.POSITIVE_INFINITY }],
  ])('rejects %s node coordinates', (_label, position) => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ nodes: [node('node-1', position), node('node-2')] }),
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_INVALID_NODE_POSITION')
  })

  it.each([
    ['NaN weight', Number.NaN],
    ['infinite weight', Number.POSITIVE_INFINITY],
    ['negative weight', -1],
  ])('rejects %s', (_label, weight) => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ edges: [edge('edge-1', 'node-1', 'node-2', weight)] }),
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_INVALID_EDGE_WEIGHT')
  })

  it('allows a legitimate zero-weight edge', () => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ edges: [edge('edge-1', 'node-1', 'node-2', 0, 0)] }),
    }))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it.each([
    ['source', edge('edge-1', 'missing-node', 'node-2')],
    ['target', edge('edge-1', 'node-1', 'missing-node')],
  ])('rejects a dangling edge %s', (_label, danglingEdge) => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ edges: [danglingEdge] }),
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_DANGLING_EDGE')
  })

  it('rejects duplicate node IDs', () => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ nodes: [node('node-1'), node('node-1')] }),
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_DUPLICATE_NODE_ID')
  })

  it('rejects graph campus identity that differs from metadata', () => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ campusId: 'different-campus' }),
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_CAMPUS_ID_MISMATCH')
  })

  it('rejects metadata revision mismatch', () => {
    const result = validateNavigationArtifacts(artifact({
      metadata: {
        ...(artifact().metadata as Record<string, unknown>),
        sourceDocumentVersion: '9',
      },
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_REVISION_MISMATCH')
  })

  it('rejects a component with an unknown building or floor', () => {
    const result = validateNavigationArtifacts(artifact({
      components: [{
        id: 'room-1',
        type: 'room',
        buildingId: 'missing-building',
        floor: 99,
        position: { lat: 14, lng: 121 },
      }],
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_INVALID_COMPONENT_REFERENCE')
  })

  it('rejects a room-owned door with an unknown room', () => {
    const result = validateNavigationArtifacts(artifact({
      doors: [{
        id: 'door-1',
        roomId: 'missing-room',
        buildingId: 'building-1',
        floor: 0,
        position: { lat: 14, lng: 121 },
      }],
    }))

    expect(result.valid).toBe(false)
    expect(codes(result)).toContain('ARTIFACT_INVALID_DOOR_REFERENCE')
  })

  it('allows an exterior door without a room relationship', () => {
    const result = validateNavigationArtifacts(artifact({
      doors: [{
        id: 'exterior-door',
        buildingId: 'building-1',
        floor: 0,
        isExterior: true,
        position: { lat: 14, lng: 121 },
      }],
    }))

    expect(result.valid).toBe(true)
  })

  it('treats an empty graph as intrinsically valid and warns', () => {
    const result = validateNavigationArtifacts(artifact({
      graph: graph({ nodes: [], edges: [] }),
      components: [],
      doors: [],
    }))

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.map(warning => warning.code)).toContain('ARTIFACT_EMPTY_GRAPH')
  })
})
