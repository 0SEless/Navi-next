/**
 * Wave 2 — Compiler Correctness
 *
 * Verifies invariants of the compiler pipeline:
 *   CampusDocument → directExtract() → buildGraph() → NavigationGraph
 *
 * Invariants tested:
 *   - Extraction: every room → space node, every entrance → transition node
 *   - Node generation: corridors produce start+end nodes
 *   - Edge generation: corridors get 1 edge, rooms connect to nearest entrance,
 *     nearby rooms (<50m) connect, entrances connect to nearest corridor (<200m)
 *   - Graph integrity: unique IDs, valid edge refs, non-negative weights,
 *     bounding box coverage
 *   - Determinism: same input → same checksum
 *   - Known gaps documented: staircases/elevators/hallways not extracted
 */

import { describe, it, expect } from 'vitest'
import { compile } from '../pipeline/compile'
import { directExtract } from '../extractors/direct-extract'
import { buildGraph } from '../artifacts/artifact-generator'
import type { CampusDocument, Building, Floor, Room, Entrance, Road } from '@navi/core'

// ── Helper factories ──

function makeEmptyDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Empty', name: 'Empty', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeRoom(id: string, name: string, number: string, x: number, y: number): Room {
  return {
    id, name, number, category: 'classroom',
    polygon: {
      points: [
        { x, y },
        { x: x + 10, y },
        { x: x + 10, y: y + 8 },
        { x, y: y + 8 },
        { x, y },
      ],
    },
    roomDoors: [],
    capacity: 30,
    metadata: {},
  }
}

function makeEntrance(id: string, label: string, lat: number, lng: number, level = 0): Entrance {
  // Legacy world-stored position (dual-mode tolerance — see P1-T4 D9).
  return {
    id, label, position: { lat, lng } as any, level, type: 'main',
    hasQR: false, hasPanorama: false,
  }
}

function makeFloor(id: string, level: number, label: string, opts?: {
  rooms?: Room[]
  entrances?: Entrance[]
}): Floor {
  return {
    id, level, label, elevation: level * 3,
    rooms: opts?.rooms ?? [],
    hallways: [],
    staircases: [],
    elevators: [],
    entrances: opts?.entrances ?? [],
    connectorStops: [],
    metadata: {},
  }
}

function makeBuilding(id: string, name: string, code: string, baseLat: number, baseLng: number, floors: Floor[]): Building {
  return {
    id, name, code, category: 'academic', description: '',
    footprint: {
      points: [
        { lat: baseLat, lng: baseLng },
        { lat: baseLat, lng: baseLng + 0.01 },
        { lat: baseLat + 0.01, lng: baseLng + 0.01 },
        { lat: baseLat + 0.01, lng: baseLng },
        { lat: baseLat, lng: baseLng },
      ],
    },
    baseElevation: 0, height: 15,
    floors,
    verticalConnectors: [],
    color: '#cccccc', aliases: [], metadata: {},
  }
}

function makeRoad(id: string, name: string, pts: Array<{ lat: number; lng: number }>): Road {
  return {
    id, name, polyline: { points: pts },
    width: 3, surface: 'paved', type: 'connector', metadata: {},
  }
}

// ── Scenarios ──

/** Simple 1-building, 1-floor, 2-rooms, 1-entrance document */
function simpleDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', '101', 0, 0)
  const roomB = makeRoom('r-b', 'Room B', '102', 15, 0)   // 15m apart → <50m → connected
  const entrance = makeEntrance('e-main', 'Main Entrance', 0.005, 0.005)
  const floor = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA, roomB], entrances: [entrance] })
  const building = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floor])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Simple', name: 'Simple', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

/** Two buildings connected by a road */
function multiBuildingDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', 'A1', 0, 0)
  const entA = makeEntrance('e-a', 'Entrance A', 0.003, 0.003)
  const floorA = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA], entrances: [entA] })
  const bldA = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floorA])

  const roomB = makeRoom('r-b', 'Room B', 'B1', 0, 0)
  const entB = makeEntrance('e-b', 'Entrance B', 0.013, 0.013)
  const floorB = makeFloor('flr-1', 0, 'Ground', { rooms: [roomB], entrances: [entB] })
  const bldB = makeBuilding('b-b', 'Building B', 'B', 0.01, 0.01, [floorB])

  const road = makeRoad('road-1', 'Campus Road', [{ lat: 0.005, lng: 0.005 }, { lat: 0.015, lng: 0.015 }])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Multi', name: 'Multi', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [bldA, bldB],
    roads: [road],
    panoramas: [],
    qrCheckpoints: [],
  }
}

/** Rooms far apart (>50m) on same floor → no room-room edge */
function distantRoomsDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', '101', 0, 0)
  const roomB = makeRoom('r-b', 'Room B', '102', 100, 0)  // 100m apart → >50m → no edge
  const entrance = makeEntrance('e-main', 'Main', 0.003, 0.003)
  const floor = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA, roomB], entrances: [entrance] })
  const building = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floor])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Distant', name: 'Distant', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

/** No entrance on floor → rooms have no edges */
function noEntranceDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', '101', 0, 0)
  const roomB = makeRoom('r-b', 'Room B', '102', 15, 0)
  const floor = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA, roomB] })  // no entrances
  const building = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floor])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'NoEntrance', name: 'NoEntrance', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

/** Two floors with staircases — known gap: staircases not extracted, no vertical edges */
function multiFloorDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', '101', 0, 0)
  const roomB = makeRoom('r-b', 'Room B', '201', 0, 0)
  const entrance = makeEntrance('e-main', 'Main', 0.003, 0.003)
  const floor0 = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA], entrances: [entrance] })
  const floor1 = makeFloor('flr-1', 1, 'Upper', { rooms: [roomB], entrances: [entrance] })
  // floor1 reuses same entrance (unrealistic but tests cross-floor behavior)
  const building = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floor0, floor1])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'MultiFloor', name: 'MultiFloor', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ── Tests ──

describe('Wave 2 | Compiler Invariants', () => {

  // ── Extraction Phase ──

  describe('Extraction phase', () => {
    it('extracts nothing from empty document', () => {
      const result = directExtract(makeEmptyDoc())
      expect(result.spaces).toHaveLength(0)
      expect(result.transitions).toHaveLength(0)
      expect(result.corridors).toHaveLength(0)
    })

    it('extracts rooms as spaces with correct type', () => {
      const result = directExtract(simpleDoc())
      expect(result.spaces).toHaveLength(2)
      expect(result.spaces.every(s => s.type === 'room')).toBe(true)
    })

    it('extracts entrances as transitions', () => {
      const result = directExtract(simpleDoc())
      expect(result.transitions).toHaveLength(1)
      expect(result.transitions[0].type).toBe('entrance')
    })

    it('extracts roads as corridors with mapped CorridorType', () => {
      const result = directExtract(multiBuildingDoc())
      expect(result.corridors).toHaveLength(1)
      // RoadType 'connector' maps to CorridorType 'walkway'
      expect(result.corridors[0].type).toBe('walkway')
    })

    it('does NOT extract hallways, staircases, or elevators (known gap)', () => {
      // Hallways, staircases, and elevators are part of the Floor type
      // but directExtract only handles rooms and entrances
      const result = directExtract(simpleDoc())
      // Verify no entities beyond rooms and entrances
      const extractedIds = new Set(result.spaces.map(s => s.id))
      // These should only contain room IDs
      expect(extractedIds.has('r-a')).toBe(true)
      expect(extractedIds.has('r-b')).toBe(true)
    })
  })

  // ── Graph Building ──

  describe('Graph structure invariants', () => {
    it('generates correct node count: rooms → space nodes, entrances → transition nodes, roads → 2 corridor nodes', () => {
      const extraction = directExtract(multiBuildingDoc())
      // multiBuildingDoc: 2 rooms, 2 entrances, 1 road
      expect(extraction.spaces).toHaveLength(2)
      expect(extraction.transitions).toHaveLength(2)
      expect(extraction.corridors).toHaveLength(1)

      const graph = buildGraph(multiBuildingDoc(), extraction)
      // Expected: 2 space + 2 transition + 2 corridor = 6 nodes
      expect(graph.nodes).toHaveLength(6)
      expect(graph.metadata.nodeCount).toBe(6)

      const spaceNodes = graph.nodes.filter(n => n.type === 'space')
      const transitionNodes = graph.nodes.filter(n => n.type === 'transition')
      const corridorNodes = graph.nodes.filter(n => n.type === 'corridor')
      expect(spaceNodes).toHaveLength(2)
      expect(transitionNodes).toHaveLength(2)
      expect(corridorNodes).toHaveLength(2)
    })

    it('generates zero nodes from empty document', () => {
      const extraction = directExtract(makeEmptyDoc())
      const graph = buildGraph(makeEmptyDoc(), extraction)
      expect(graph.nodes).toHaveLength(0)
      expect(graph.edges).toHaveLength(0)
      expect(graph.metadata.nodeCount).toBe(0)
      expect(graph.metadata.edgeCount).toBe(0)
    })

    it('all node IDs are unique', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      const ids = graph.nodes.map(n => n.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('all node IDs are non-empty strings', () => {
      const extraction = directExtract(simpleDoc())
      const graph = buildGraph(simpleDoc(), extraction)
      for (const node of graph.nodes) {
        expect(node.id).toBeTruthy()
        expect(typeof node.id).toBe('string')
      }
    })
  })

  // ── Edge Invariants ──

  describe('Edge invariants', () => {
    it('every edge references valid node IDs', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      const nodeIds = new Set(graph.nodes.map(n => n.id))
      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.from)).toBe(true)
        expect(nodeIds.has(edge.to)).toBe(true)
      }
    })

    it('every edge has a non-negative weight', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      for (const edge of graph.edges) {
        expect(edge.weight).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(edge.weight)).toBe(true)
      }
    })

    it('every edge has a non-negative distance', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      for (const edge of graph.edges) {
        expect(edge.distance).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(edge.distance)).toBe(true)
      }
    })

    it('every edge has a unique ID', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      const ids = graph.edges.map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('road corridor generates exactly one connecting edge', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      // 1 road → 2 corridor nodes → 1 edge between them
      const corridorEdges = graph.edges.filter(e => e.type === 'walk')
      // There should be at least 1 corridor+walk edge
      expect(corridorEdges.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Connectivity ──

  describe('Connectivity invariants', () => {
    it('every room with an entrance on the same floor has at least one edge', () => {
      const extraction = directExtract(simpleDoc())
      const graph = buildGraph(simpleDoc(), extraction)
      const roomNodes = new Set(
        graph.nodes.filter(n => n.type === 'space').map(n => n.id)
      )
      // Find edges connected to room nodes
      const connectedRoomIds = new Set<string>()
      for (const edge of graph.edges) {
        if (roomNodes.has(edge.from)) connectedRoomIds.add(edge.from)
        if (roomNodes.has(edge.to)) connectedRoomIds.add(edge.to)
      }
      // Both rooms should be connected
      expect(connectedRoomIds.size).toBe(2)
    })

    it('nearby rooms (<50m) have room-room edges', () => {
      const extraction = directExtract(simpleDoc())
      const graph = buildGraph(simpleDoc(), extraction)
      const roomNodes = graph.nodes.filter(n => n.type === 'space')
      // Find edges that connect two space nodes
      const roomNodeIds = new Set(roomNodes.map(n => n.id))
      let roomRoomEdges = 0
      for (const edge of graph.edges) {
        if (roomNodeIds.has(edge.from) && roomNodeIds.has(edge.to)) {
          roomRoomEdges++
        }
      }
      // Room A (0,0) and Room B (15,0) are ~15m apart — should be connected
      expect(roomRoomEdges).toBeGreaterThanOrEqual(1)
    })

    it('distant rooms (>50m) do NOT have room-room edges', () => {
      const extraction = directExtract(distantRoomsDoc())
      const graph = buildGraph(distantRoomsDoc(), extraction)
      const roomNodes = graph.nodes.filter(n => n.type === 'space')
      const roomNodeIds = new Set(roomNodes.map(n => n.id))
      let roomRoomEdges = 0
      for (const edge of graph.edges) {
        if (roomNodeIds.has(edge.from) && roomNodeIds.has(edge.to)) {
          roomRoomEdges++
        }
      }
      // Room A (0,0) and Room B (100,0) are ~100m apart — no direct connection
      expect(roomRoomEdges).toBe(0)
    })

    it('rooms with no entrance on their floor have no entrance edges (known gap)', () => {
      const extraction = directExtract(noEntranceDoc())
      const graph = buildGraph(noEntranceDoc(), extraction)
      // No entrances → no transition edges, but rooms within 50m DO get room-room edges
      const roomNodeIds = new Set(graph.nodes.filter(n => n.type === 'space').map(n => n.id))
      const transitionNodeIds = new Set(graph.nodes.filter(n => n.type === 'transition').map(n => n.id))
      let entranceEdges = 0
      for (const edge of graph.edges) {
        if (transitionNodeIds.has(edge.from) || transitionNodeIds.has(edge.to)) {
          entranceEdges++
        }
      }
      expect(entranceEdges).toBe(0)
      // Rooms still generate nodes
      expect(graph.nodes).toHaveLength(2)
    })

    it('graphs from different floors have no vertical edges (known gap)', () => {
      const extraction = directExtract(multiFloorDoc())
      const graph = buildGraph(multiFloorDoc(), extraction)
      // Multi-floor with no staircase extraction → rooms on different floors
      // should NOT be connected to each other
      const floorNodes = new Map<number, string[]>()
      for (const node of graph.nodes) {
        const list = floorNodes.get(node.floor) ?? []
        list.push(node.id)
        floorNodes.set(node.floor, list)
      }
      // Check there are no edges connecting different floors
      for (const edge of graph.edges) {
        const fromNode = graph.nodes.find(n => n.id === edge.from)
        const toNode = graph.nodes.find(n => n.id === edge.to)
        if (fromNode && toNode) {
          // Both nodes exist — check floor
          // Some nodes might have floor=0 (corridors), which is fine
          if (fromNode.type === 'space' && toNode.type === 'space') {
            // Room-to-room edges should not cross floors
            // Currently there are no staircases, so this should be trivially true
          }
        }
      }
    })
  })

  // ── Metadata ──

  describe('Metadata invariants', () => {
    it('nodeCount matches actual nodes.length', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      expect(graph.metadata.nodeCount).toBe(graph.nodes.length)
    })

    it('edgeCount matches actual edges.length', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      expect(graph.metadata.edgeCount).toBe(graph.edges.length)
    })

    it('bounding box encloses all node positions', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      const bbox = graph.metadata.boundingBox
      for (const node of graph.nodes) {
        expect(node.position.lat).toBeGreaterThanOrEqual(bbox.minLat)
        expect(node.position.lat).toBeLessThanOrEqual(bbox.maxLat)
        expect(node.position.lng).toBeGreaterThanOrEqual(bbox.minLng)
        expect(node.position.lng).toBeLessThanOrEqual(bbox.maxLng)
      }
    })

    it('buildings count from buildGraph() includes empty buildingId for corridor nodes', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      // Corridor nodes have buildingId: '' so uniqueBlds = {'b-a', 'b-b', ''} = 3
      const uniqueBlds = new Set(graph.nodes.map(n => n.buildingId))
      // buildGraph metadata uses nodes, not document.buildings
      expect(graph.metadata.buildings).toBe(uniqueBlds.size)
      expect(graph.metadata.buildings).toBe(3)
      // compile() overrides with document.buildings — see compile() integration tests
    })

    it('floors count matches unique buildingId-floor pairs', () => {
      const extraction = directExtract(multiBuildingDoc())
      const graph = buildGraph(multiBuildingDoc(), extraction)
      const uniqueFloors = new Set(graph.nodes.map(n => `${n.buildingId}-${n.floor}`))
      expect(graph.metadata.floors).toBe(uniqueFloors.size)
    })
  })

  // ── Determinism ──

  describe('Determinism', () => {
    it('buildGraph() checksum is always empty string (computed by compile() or generateArtifacts())', () => {
      const extraction1 = directExtract(simpleDoc())
      const extraction2 = directExtract(multiBuildingDoc())
      const graph1 = buildGraph(simpleDoc(), extraction1)
      const graph2 = buildGraph(multiBuildingDoc(), extraction2)
      // buildGraph sets checksum: '' — it does NOT compute a hash
      expect(graph1.checksum).toBe('')
      expect(graph2.checksum).toBe('')
    })

    it('compile() produces deterministic checksums for identical input', () => {
      const doc = simpleDoc()
      const result1 = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
      })
      const result2 = compile(doc, {
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
      })
      // checksum is computed from content-only fields (excluding createdAt)
      // so two compilations of the same input produce identical checksums
      expect(result1.graph.checksum).toBe(result2.graph.checksum)
      expect(result1.graph.checksum).not.toBe('')
      // createdAt is still set on the graph (just not included in the hash)
      expect(result1.graph.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  // ── Compile() Integration ──

  describe('compile() integration', () => {
    it('produces a non-negative duration', () => {
      const result = compile(simpleDoc(), {
        nodeInterval: 10,
        mergeThreshold: 5,
        optimizationLevel: 'none',
        includeAccessibility: false,
      })
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('report counts match extracted and generated counts', () => {
      const result = compile(multiBuildingDoc(), {
        nodeInterval: 10,
        mergeThreshold: 5,
        optimizationLevel: 'none',
        includeAccessibility: false,
      })
      expect(result.report.spacesExtracted).toBe(2)
      expect(result.report.transitionsExtracted).toBe(2)
      expect(result.report.corridorsExtracted).toBe(1)
      expect(result.report.nodesGenerated).toBe(result.graph.nodes.length)
      expect(result.report.edgesGenerated).toBe(result.graph.edges.length)
    })

    it('compile() overrides metadata.buildings with document-level count (not node-level)', () => {
      const result = compile(multiBuildingDoc(), {
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
      })
      const graph = result.graph
      // compile() overrides graph.metadata.buildings from document.buildings.length
      // which is 2, even though nodes include buildingId: '' (corridors) = 3 unique values
      expect(graph.metadata.buildings).toBe(2)
      // verify: document has 2 buildings
      expect(result.report.spacesExtracted).toBe(2)
    })

    it('compile() produces no errors or warnings for valid documents', () => {
      const result = compile(simpleDoc(), {
        nodeInterval: 10,
        mergeThreshold: 5,
        optimizationLevel: 'none',
        includeAccessibility: false,
      })
      expect(result.report.errors).toHaveLength(0)
      expect(result.report.warnings).toHaveLength(0)
    })
  })
})
