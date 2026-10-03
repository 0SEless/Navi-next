import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '../pipeline/campus-compiler'
import { ROUTE_NETWORK_THRESHOLDS } from '@navi/core'
import type { CampusDocument } from '@navi/core'
import type { CompileResultV2 } from '../types'

function demoCampus(overrides?: Partial<CampusDocument>): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'demo-univ', name: 'demo-univ', description: 'Demo campus', lastModified: '', editorVersion: '1.0' },
    buildings: [
      {
        id: 'bld-a',
        name: 'Building A',
        code: 'BLA',
        category: 'academic',
        description: 'Main academic building',
        footprint: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.001, lng: 121.0 }, { lat: 14.001, lng: 121.001 }, { lat: 14.0, lng: 121.001 }] },
        baseElevation: 10,
        height: 20,
        floors: [
          {
            id: 'bld-a-f1',
            level: 1,
            label: 'First Floor',
            elevation: 0,
            rooms: [
              {
                id: 'a101',
                name: 'Room 101',
                number: '101',
                category: 'classroom',
                polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
                roomDoors: [
                  { id: 'a101-d1', roomId: 'a101', connectedToId: 'hw-a1', connectedToType: 'hallway', doorType: 'standard', position: { x: 5, y: 10 }, width: 1.5, metadata: {} },
                ],
                metadata: {},
              },
              {
                id: 'a102',
                name: 'Room 102',
                number: '102',
                category: 'lab',
                polygon: { points: [{ x: 12, y: 0 }, { x: 22, y: 0 }, { x: 22, y: 10 }, { x: 12, y: 10 }] },
                roomDoors: [],
                metadata: {},
              },
            ],
            hallways: [
              { id: 'hw-a1', name: 'Main Hallway A', polyline: { points: [{ x: 0, y: 5 }, { x: 25, y: 5 }] }, width: 3 },
            ],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'a-ent-1', label: 'Main Entrance A', position: { lat: 14.0, lng: 121.0 } as any, level: 1, type: 'main', hasQR: false, hasPanorama: false },
            ],
            connectorStops: [
              { id: 'stop-a-stair-1', connectorId: 'conn-stair-a', label: 'Stair Landing', position: { x: 25, y: 5 }, rotation: 0, accessible: true, anchors: [], metadata: {} },
            ],
            metadata: {},
          },
          {
            id: 'bld-a-f2',
            level: 2,
            label: 'Second Floor',
            elevation: 4,
            rooms: [
              {
                id: 'a201',
                name: 'Room 201',
                number: '201',
                category: 'office',
                polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
                roomDoors: [
                  { id: 'a201-d1', roomId: 'a201', connectedToId: 'hw-a2', connectedToType: 'hallway', doorType: 'standard', position: { x: 5, y: 10 }, width: 1.5, metadata: {} },
                ],
                metadata: {},
              },
            ],
            hallways: [
              { id: 'hw-a2', name: 'Upper Hallway A', polyline: { points: [{ x: 0, y: 5 }, { x: 25, y: 5 }] }, width: 3 },
            ],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [
              { id: 'stop-a-stair-2', connectorId: 'conn-stair-a', label: 'Stair Landing 2', position: { x: 25, y: 5 }, rotation: 0, accessible: true, anchors: [], metadata: {} },
            ],
            metadata: {},
          },
        ],
        verticalConnectors: [
          { id: 'conn-stair-a', type: 'staircase', name: 'Stairwell A', stopIds: ['stop-a-stair-1', 'stop-a-stair-2'], accessible: true, metadata: {} },
        ],
        aliases: [],
        color: '#ff0000',
        metadata: {},
      },
      {
        id: 'bld-b',
        name: 'Building B',
        code: 'BLB',
        category: 'library',
        description: 'Library building',
        footprint: { points: [{ lat: 14.005, lng: 121.005 }, { lat: 14.006, lng: 121.005 }, { lat: 14.006, lng: 121.006 }, { lat: 14.005, lng: 121.006 }] },
        baseElevation: 12,
        height: 15,
        floors: [
          {
            id: 'bld-b-f1',
            level: 1,
            label: 'Ground Floor',
            elevation: 0,
            rooms: [
              {
                id: 'b001',
                name: 'Reading Room',
                number: '001',
                category: 'other',
                polygon: { points: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 12 }, { x: 0, y: 12 }] },
                roomDoors: [
                  { id: 'b001-d1', roomId: 'b001', connectedToId: 'hw-b1', connectedToType: 'hallway', doorType: 'double', position: { x: 7.5, y: 12 }, width: 2, metadata: {} },
                ],
                metadata: {},
              },
            ],
            hallways: [
              { id: 'hw-b1', name: 'Library Hallway', polyline: { points: [{ x: 0, y: 6 }, { x: 20, y: 6 }] }, width: 4 },
            ],
            staircases: [],
            elevators: [],
            entrances: [
              { id: 'b-ent-1', label: 'Library Entrance', position: { lat: 14.005, lng: 121.005 } as any, level: 1, type: 'main', hasQR: true, hasPanorama: false },
            ],
            connectorStops: [
              { id: 'stop-b-elev-1', connectorId: 'conn-elev-b', label: 'Elevator Lobby', position: { x: 20, y: 6 }, rotation: 0, accessible: true, anchors: [
                { id: 'b-elev-pano', label: 'Elevator Area', position: { x: 20, y: 7 }, heading: 90, imageAssetId: 'pano-elev-b', hotspots: [] },
              ], metadata: {} },
            ],
            metadata: {},
          },
          {
            id: 'bld-b-f2',
            level: 2,
            label: 'Upper Floor',
            elevation: 4,
            rooms: [
              {
                id: 'b002',
                name: 'Study Room',
                number: '002',
                category: 'other',
                polygon: { points: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 12 }, { x: 0, y: 12 }] },
                roomDoors: [
                  { id: 'b002-d1', roomId: 'b002', connectedToId: 'hw-b2', connectedToType: 'hallway', doorType: 'standard', position: { x: 7.5, y: 12 }, width: 1.5, metadata: {} },
                ],
                metadata: {},
              },
            ],
            hallways: [
              { id: 'hw-b2', name: 'Upper Library Hallway', polyline: { points: [{ x: 0, y: 6 }, { x: 20, y: 6 }] }, width: 4 },
            ],
            staircases: [],
            elevators: [],
            entrances: [],
            connectorStops: [
              { id: 'stop-b-elev-2', connectorId: 'conn-elev-b', label: 'Upper Elevator', position: { x: 20, y: 6 }, rotation: 0, accessible: true, anchors: [], metadata: {} },
            ],
            metadata: {},
          },
        ],
        verticalConnectors: [
          { id: 'conn-elev-b', type: 'elevator', name: 'Elevator B', stopIds: ['stop-b-elev-1', 'stop-b-elev-2'], accessible: true, metadata: {} },
        ],
        aliases: [],
        color: '#0000ff',
        metadata: {},
      },
    ],
    roads: [
      { id: 'road-1', name: 'Campus Path', polyline: { points: [{ lat: 14.0, lng: 121.0 }, { lat: 14.005, lng: 121.005 }] }, width: 5, surface: 'paved', type: 'connector', metadata: {} },
    ],
    panoramas: [],
    qrCheckpoints: [],
    ...overrides,
  }
}

describe('compileV2 integration', () => {
  it('completes the full pipeline and returns CompileResultV2 with all fields', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)
    expect(result.success).toBe(true)
    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.graph).not.toBeNull()
    expect(result.report).toBeDefined()
    expect(result.artifacts).toBeDefined()
    expect(result.stats).toBeDefined()
  })

  it('produces a non-empty navigation graph', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    expect(result.graph!.nodes.length).toBeGreaterThan(0)
    expect(result.graph!.edges.length).toBeGreaterThan(0)
  })

  it('produces NavigationArtifacts with all 5 fields and empty extensions', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    const arts = result.artifacts!
    expect(arts).toHaveProperty('graph')
    expect(arts).toHaveProperty('searchIndex')
    expect(arts).toHaveProperty('spatialIndex')
    expect(arts).toHaveProperty('buildingIndex')
    expect(arts).toHaveProperty('poiIndex')
    expect(arts.extensions).toEqual({})
  })

  it('populates report statistics with correct entity counts', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    const stats = result.report!.statistics
    expect(stats.rooms).toBeGreaterThan(0)
    expect(stats.waypoints).toBeGreaterThan(0)
    expect(stats.edges).toBeGreaterThan(0)
    expect(stats.primitives).toBeGreaterThan(0)
    expect(stats.compileTime).toBeGreaterThanOrEqual(0)
    expect(stats.diagnostics).toBeDefined()
  })

  it('includes all NavNode types (waypoint, poi, transition, outdoor, entrance)', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)
    const types = new Set(result.graph!.nodes.map(n => n.type))

    expect(types.has('waypoint')).toBe(true)
    expect(types.has('poi')).toBe(true)
    expect(types.has('transition')).toBe(true)
    expect(types.has('outdoor')).toBe(true)
    expect(types.has('entrance')).toBe(true)
  })

  it('includes all NavEdge types (walk, stairs, elevator, transition)', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)
    const types = new Set(result.graph!.edges.map(e => e.type))

    expect(types.has('walk')).toBe(true)
    expect(types.has('stairs')).toBe(true)
    expect(types.has('elevator')).toBe(true)
  })

  it('returns searchIndex entries for indexed nodes', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    expect(result.artifacts!.searchIndex.entries.length).toBeGreaterThan(0)
    expect(result.artifacts!.searchIndex.version).toBe('1.0.0')
  })

  it('returns spatialIndex with grid cells', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    expect(result.artifacts!.spatialIndex.cellSize).toBe(0.001)
    expect(Object.keys(result.artifacts!.spatialIndex.cells).length).toBeGreaterThan(0)
  })

  it('returns buildingIndex with building entries', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    const ids = result.artifacts!.buildingIndex.buildings.map(b => b.id)
    expect(ids).toContain('bld-a')
    expect(ids).toContain('bld-b')
  })

  it('returns poiIndex with POI points', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    expect(result.artifacts!.poiIndex.points.length).toBeGreaterThan(0)
    expect(result.artifacts!.poiIndex.version).toBe('1.0.0')
  })

  it('handles structural errors gracefully (no-footprint building)', () => {
    const doc = demoCampus()
    doc.buildings[0]!.footprint = { points: [] }
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    // Pipeline halts on structural errors â€” graph is null, errors reported
    expect(result.success).toBe(false)
    expect(result.graph).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some(e => e.code === 'BUILDING_NO_FOOTPRINT')).toBe(true)
  })

  it('compilesV2 returns stats with connectivity score', () => {
    const doc = demoCampus()
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)

    expect(result.stats.connectivityScore).toBeGreaterThan(0)
    expect(result.stats.totalNodes).toBe(result.graph!.nodes.length)
    expect(result.stats.totalEdges).toBe(result.graph!.edges.length)
  })
})

// â”€â”€ P1-T9 (R2.6/R8.4/D19): levels-based stair/elevator emission â”€â”€
// Features own cross-floor identity via levels; the compiler emits ONE node
// per ACCESS floor present in levels (absent floors simply absent, never
// zero-filled), at that floor's OWN placement, chained by vertical edges
// between CONSECUTIVE access floors.

describe('P1-T9: levels-based stair/elevator emission (R8.4)', () => {
  const ORIGIN = { lat: 14.0005, lng: 121.0005 } // demoCampus footprint centroid
  const MPD = 111320
  const localToLatLng = (x: number, y: number) => ({
    lat: ORIGIN.lat + y / MPD,
    lng: ORIGIN.lng + x / (MPD * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  })

  function levelsCampus(): CampusDocument {
    const doc = demoCampus()
    const bld = doc.buildings[0]
    // Levels on F0/F2 (NO F1) â€” access floors only; per-floor distinct positions
    ;(bld as { staircases?: unknown[] }).staircases = [
      {
        id: 'stair-a', buildingId: bld.id, name: 'Stair A', type: 'open', accessible: true,
        fromLevel: 0, toLevel: 2,
        levels: {
          0: { position: { x: 10, y: 20 }, rotation: 0 },
          2: { position: { x: 12, y: 22 }, rotation: 0 },
        },
      },
    ]
    ;(bld as { elevators?: unknown[] }).elevators = [
      {
        id: 'elev-a', buildingId: bld.id, name: 'Elev A', type: 'passenger', accessible: true,
        fromLevel: 0, toLevel: 1,
        levels: {
          0: { position: { x: 30, y: 20 }, rotation: 0 },
          1: { position: { x: 30, y: 21 }, rotation: 0 },
        },
      },
    ]
    return doc
  }

  it('emits one node per floor present in levels (F0/F2, no F1) at per-level positions', () => {
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(levelsCampus())
    expect(result.success).toBe(true)
    const graph = result.graph!
    const stairNodes = graph.nodes.filter(n => n.properties?.entityType === 'staircase' && n.properties?.entityId === 'stair-a')
    // Exactly TWO access-floor nodes â€” F1 is absent, never zero-filled
    expect(stairNodes).toHaveLength(2)
    const floors = stairNodes.map(n => n.floor).sort((a, b) => a - b)
    expect(floors).toEqual([0, 2])
    // Per-level placement honored: each node sits at its OWN floor's position
    const f0 = stairNodes.find(n => n.floor === 0)!
    const f2 = stairNodes.find(n => n.floor === 2)!
    // toBeCloseTo: the compiler derives the origin from the footprint centroid
    // (float rounding vs the literal ORIGIN above â€” 1e-13 noise).
    expect(f0.position.lat).toBeCloseTo(localToLatLng(10, 20).lat, 9)
    expect(f0.position.lng).toBeCloseTo(localToLatLng(10, 20).lng, 9)
    expect(f2.position.lat).toBeCloseTo(localToLatLng(12, 22).lat, 9)
    expect(f2.position.lng).toBeCloseTo(localToLatLng(12, 22).lng, 9)
    expect(f0.position).not.toEqual(f2.position)
  })

  it('chains vertical edges between CONSECUTIVE access floors (F0â†’F2, skipping F1)', () => {
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const graph = compiler.compileV2(levelsCampus()).graph!
    const stairNodes = graph.nodes.filter(n => n.properties?.entityType === 'staircase' && n.properties?.entityId === 'stair-a')
    const ids = new Set(stairNodes.map(n => n.id))
    const vertical = graph.edges.filter(e => e.type === 'stairs' && ids.has(e.from) && ids.has(e.to))
    // One edge chaining the two access floors directly
    expect(vertical).toHaveLength(1)
    const [f0, f2] = [...stairNodes].sort((a, b) => a.floor - b.floor)
    expect(vertical[0].from === f0.id && vertical[0].to === f2.id).toBe(true)
  })

  it('elevator levels emit per-floor nodes with per-level positions and a vertical edge', () => {
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const graph = compiler.compileV2(levelsCampus()).graph!
    const elevNodes = graph.nodes.filter(n => n.properties?.entityType === 'elevator' && n.properties?.entityId === 'elev-a')
    expect(elevNodes).toHaveLength(2)
    const f0 = elevNodes.find(n => n.floor === 0)!
    const f1 = elevNodes.find(n => n.floor === 1)!
    expect(f0.position.lat).toBeCloseTo(localToLatLng(30, 20).lat, 9)
    expect(f0.position.lng).toBeCloseTo(localToLatLng(30, 20).lng, 9)
    expect(f1.position.lat).toBeCloseTo(localToLatLng(30, 21).lat, 9)
    expect(f1.position.lng).toBeCloseTo(localToLatLng(30, 21).lng, 9)
    const ids = new Set(elevNodes.map(n => n.id))
    const vertical = graph.edges.filter(e => e.type === 'elevator' && ids.has(e.from) && ids.has(e.to))
    expect(vertical).toHaveLength(1)
  })
})

// ── P1-T17 (group-16 item 9): vertical edge DISTANCE semantics ──
// Chosen semantics: authored floor-elevation delta where both floors are
// known; else ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters. One helper,
// both compile paths (risk R7 — no divergent hardcoded defaults).

describe('P1-T17: vertical edge distance semantics', () => {
  it('uses the AUTHORED elevation delta for levels-based features on known floors', () => {
    const doc = demoCampus()
    const bld = doc.buildings[0]
    // Stair feature on doc floors 1/2; author f2's elevation to 7 m so the
    // distance PROVES it derives from authored data (old hardcode was 4).
    ;(bld.floors[1] as { elevation: number }).elevation = 7
    ;(bld as { staircases?: unknown[] }).staircases = [
      {
        id: 'stair-delta', buildingId: bld.id, name: 'Stair Delta', type: 'open', accessible: true,
        fromLevel: 1, toLevel: 2,
        levels: {
          1: { position: { x: 10, y: 20 }, rotation: 0 },
          2: { position: { x: 12, y: 22 }, rotation: 0 },
        },
      },
    ]
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const graph = compiler.compileV2(doc).graph!
    const stairNodes = graph.nodes.filter(n => n.properties?.entityType === 'staircase' && n.properties?.entityId === 'stair-delta')
    expect(stairNodes).toHaveLength(2)
    const ids = new Set(stairNodes.map(n => n.id))
    const vertical = graph.edges.filter(e => e.type === 'stairs' && ids.has(e.from) && ids.has(e.to))
    expect(vertical).toHaveLength(1)
    // 7 − 0 = the authored floor-elevation delta — NOT a hardcoded constant
    expect(vertical[0].distance).toBe(7)
  })

  it('falls back to the documented constant when a level is absent from doc floors', () => {
    // Stair feature on F0/F2 while doc floors are levels 1/2 — level 0 has
    // no authored elevation → fallback constant applies.
    const doc = demoCampus()
    const bld = doc.buildings[0]
    ;(bld as { staircases?: unknown[] }).staircases = [
      {
        id: 'stair-gap', buildingId: bld.id, name: 'Stair Gap', type: 'open', accessible: true,
        fromLevel: 0, toLevel: 2,
        levels: {
          0: { position: { x: 10, y: 20 }, rotation: 0 },
          2: { position: { x: 12, y: 22 }, rotation: 0 },
        },
      },
    ]
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const graph = compiler.compileV2(doc).graph!
    const stairNodes = graph.nodes.filter(n => n.properties?.entityType === 'staircase' && n.properties?.entityId === 'stair-gap')
    expect(stairNodes).toHaveLength(2)
    const ids = new Set(stairNodes.map(n => n.id))
    const vertical = graph.edges.filter(e => e.type === 'stairs' && ids.has(e.from) && ids.has(e.to))
    expect(vertical).toHaveLength(1)
    expect(vertical[0].distance).toBe(ROUTE_NETWORK_THRESHOLDS.verticalEdgeFallbackMeters)
  })

  it('legacy connector-stop path also uses the authored delta (levels 1/2 → 4 m)', () => {
    // demoCampus conn-stair-a stops on levels 1/2 with elevations 0/4 —
    // previously haversine(same position) ≈ 0; now the authored delta.
    // Legacy stops carry entityType 'connector_stop' (not the feature type).
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const graph = compiler.compileV2(demoCampus()).graph!
    const stopNodes = graph.nodes.filter(n => n.properties?.entityType === 'connector_stop')
    expect(stopNodes.length).toBeGreaterThanOrEqual(2) // conn-stair-a F1/F2 (+ single elev stop)
    const ids = new Set(stopNodes.map(n => n.id))
    const vertical = graph.edges.filter(e => (e.type === 'stairs' || e.type === 'elevator') && ids.has(e.from) && ids.has(e.to))
    expect(vertical.length).toBeGreaterThan(0)
    for (const e of vertical) {
      expect(e.distance).toBe(4) // authored delta 4 − 0
      expect(e.distance).toBeGreaterThan(0)
    }
  })
})

// â”€â”€ P1-T10 (R6.1/R6.3/R6.4/D15): floor-geometry.json artifact emission â”€â”€
// Per building, per floor: rooms (closed polygons), hallways (centerlines),
// stair/elevator per-floor entries matching levels, doors, POIs, QR â€” all
// building-local meters â€” plus the building world anchor (origin/rotation).

describe('P1-T10: floor-geometry artifact (R6.1/R6.3/R6.4)', () => {
  function geometryCampus(): CampusDocument {
    const doc = demoCampus()
    const bld = doc.buildings[0]
    // QR checkpoint on floor 1 (building-local position)
    ;(doc as { qrCheckpoints?: unknown[] }).qrCheckpoints = [
      { id: 'qr-1', label: 'Checkpoint A', position: { x: 8, y: 4 }, floor: 1, buildingId: bld.id, code: 'QR001', metadata: {} },
    ]
    // POIs + extracted doors on floor 1
    const f1 = bld.floors[0]
    ;(f1 as { pois?: unknown[] }).pois = [
      { id: 'poi-1', name: 'Cafeteria', category: 'food', position: { x: 20, y: 5 }, metadata: {} },
    ]
    ;(f1 as { doors?: unknown[] }).doors = [
      { id: 'door-1', roomId: 'a101', doorType: 'standard', position: { x: 5, y: 10 }, width: 1.5, metadata: {} },
    ]
    // Stair feature with per-floor polygons on levels 1/2 (demoCampus floors)
    ;(bld as { staircases?: unknown[] }).staircases = [
      {
        id: 'stair-a', buildingId: bld.id, name: 'Stair A', type: 'open', accessible: true,
        fromLevel: 1, toLevel: 2,
        levels: {
          1: { position: { x: 25, y: 5 }, rotation: 0, polygon: { points: [{ x: 24, y: 4 }, { x: 26, y: 4 }, { x: 26, y: 6 }, { x: 24, y: 6 }, { x: 24, y: 4 }] } },
          2: { position: { x: 25, y: 5 }, rotation: 0, polygon: { points: [{ x: 24, y: 4 }, { x: 26, y: 4 }, { x: 26, y: 6 }, { x: 24, y: 6 }, { x: 24, y: 4 }] } },
        },
      },
    ]
    ;(bld as { elevators?: unknown[] }).elevators = [
      {
        id: 'elev-a', buildingId: bld.id, name: 'Elev A', type: 'passenger', accessible: true,
        fromLevel: 1, toLevel: 2,
        levels: {
          1: { position: { x: 30, y: 5 }, rotation: 0 },
          2: { position: { x: 30, y: 5 }, rotation: 0 },
        },
      },
    ]
    return doc
  }

  function compileFixture(): CompileResultV2 {
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    return compiler.compileV2(geometryCampus())
  }

  it('emits a versioned floor-geometry artifact with the building world anchor (R6.1/R6.3)', () => {
    const result = compileFixture()
    expect(result.success).toBe(true)
    const fg = result.artifacts?.floorGeometry
    expect(fg).toBeDefined()
    expect(fg!.schemaVersion).toBe(1)
    expect(fg!.formatVersion).toBe(0)
    expect(fg!.campusId).toBe('demo-univ')
    const b = fg!.buildings[0]
    expect(b.id).toBe('bld-a')
    // Anchor = building origin (footprint centroid) + rotation, world derivation
    expect(b.anchor.origin.lat).toBeCloseTo(14.0005, 9)
    expect(b.anchor.origin.lng).toBeCloseTo(121.0005, 9)
    expect(b.anchor.rotation).toBe(0)
  })

  it('covers every room/hallway/door/POI/QR/stair/elevator for its building and floor (R6.1)', () => {
    const fg = compileFixture().artifacts!.floorGeometry!
    const f1 = fg.buildings[0].floors.find(f => f.level === 1)!
    expect(f1.rooms.map(r => r.id)).toEqual(expect.arrayContaining(['a101', 'a102']))
    expect(f1.hallways.map(h => h.id)).toContain('hw-a1')
    expect(f1.doors.map(d => d.id)).toContain('door-1')
    expect(f1.pois.map(p => p.id)).toContain('poi-1')
    expect(f1.qrCheckpoints.map(q => q.id)).toContain('qr-1')
    // Stair: per-floor entries MATCHING levels keys (levels 1/2 â€” R6.4)
    const fg1 = fg.buildings[0].floors.find(f => f.level === 1)!
    const fg2 = fg.buildings[0].floors.find(f => f.level === 2)!
    expect(fg1.staircases.map(s => s.id)).toContain('stair-a')
    expect(fg2.staircases.map(s => s.id)).toContain('stair-a')
    // Elevator feature levels also emit (levels 1/2)
    expect(fg1.elevators.map(e => e.id)).toContain('elev-a')
  })

  it('satisfies emission invariants: closed rings, per-level coverage, meter range, door-on-boundary (R6.4)', () => {
    const fg = compileFixture().artifacts!.floorGeometry!
    for (const b of fg.buildings) {
      for (const f of b.floors) {
        for (const room of f.rooms) {
          // Closed ring
          const pts = room.polygon.points
          expect(pts.length).toBeGreaterThanOrEqual(4)
          expect(pts[0]).toEqual(pts[pts.length - 1])
          for (const p of pts) {
            expect(Number.isFinite(p.x)).toBe(true)
            expect(Number.isFinite(p.y)).toBe(true)
            // Building-local meter range
            expect(Math.abs(p.x)).toBeLessThan(10000)
            expect(Math.abs(p.y)).toBeLessThan(10000)
          }
        }
        for (const h of f.hallways) {
          for (const p of h.polyline.points) {
            expect(Number.isFinite(p.x)).toBe(true)
            expect(Math.abs(p.x)).toBeLessThan(10000)
          }
        }
        // Door on room boundary: distance from door position to its room
        // polygon perimeter <= 0.5 m
        for (const d of f.doors) {
          const room = f.rooms.find(r => r.id === d.roomId)
          expect(room).toBeDefined()
          const pts = room!.polygon.points
          let minDist = Infinity
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = [pts[i].x, pts[i].y]
            const [bx, by] = [pts[i + 1].x, pts[i + 1].y]
            const dx = bx - ax
            const dy = by - ay
            const lenSq = dx * dx + dy * dy
            let t = lenSq === 0 ? 0 : ((d.position.x - ax) * dx + (d.position.y - ay) * dy) / lenSq
            t = Math.max(0, Math.min(1, t))
            const px = ax + t * dx
            const py = ay + t * dy
            minDist = Math.min(minDist, Math.hypot(d.position.x - px, d.position.y - py))
          }
          expect(minDist).toBeLessThanOrEqual(0.5)
        }
        // Per-floor stair/elevator coverage matches levels keys
        for (const s of f.staircases) expect(Number.isFinite(s.position.x)).toBe(true)
        for (const e of f.elevators) expect(Number.isFinite(e.position.x)).toBe(true)
      }
    }
  })

  it('a malformed room polygon fails with a clear error, not a corrupt artifact (R6.4)', () => {
    const doc = demoCampus()
    const room = doc.buildings[0].floors[0].rooms[0]
    room.polygon = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)
    expect(result.success).toBe(false)
    const message = result.errors.map(e => e.message).join(' ')
    expect(message).toMatch(/floor-geometry|polygon/i)
  })
})

// â”€â”€ P1-T13 (R10.2/D16): QR index artifact emission â”€â”€
// A QR index is published in the Campus Bundle mapping ID â†’
// { buildingId, floor, position: LocalCoord }; codes are opaque
// (navi.app/q/{id}) â€” the index is the ONLY way to resolve them.

describe('P1-T13: QR index artifact (R10.2)', () => {
  it('emits a versioned qrIndex mapping every checkpoint to its building/floor/position', () => {
    const doc = demoCampus()
    ;(doc as { qrCheckpoints?: unknown[] }).qrCheckpoints = [
      { id: 'qr-1', label: 'Checkpoint A', position: { x: 8, y: 4 }, floor: 1, buildingId: 'bld-a', code: '', metadata: {} },
      { id: 'qr-2', label: 'Checkpoint B', position: { x: 20, y: 6 }, floor: 2, buildingId: 'bld-a', code: '', metadata: {} },
    ]
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(doc)
    expect(result.success).toBe(true)
    const idx = result.artifacts!.qrIndex
    expect(idx).toBeDefined()
    expect(idx!.schemaVersion).toBe(1)
    expect(idx!.formatVersion).toBe(0)
    expect(idx!.campusId).toBe('demo-univ')
    expect(idx!.checkpoints).toHaveLength(2)
    const a = idx!.checkpoints.find(c => c.id === 'qr-1')!
    expect(a.buildingId).toBe('bld-a')
    expect(a.floor).toBe(1)
    expect(a.position).toEqual({ x: 8, y: 4 })
    // Opaque code â€” no coordinates in the payload (D16/Q5)
    expect(a.code).toBe('navi.app/q/qr-1')
  })

  it('emits an empty qrIndex when the document has no checkpoints', () => {
    const compiler = new CampusCompiler({ nodeInterval: 10, mergeThreshold: 0.5 } as any)
    const result = compiler.compileV2(demoCampus())
    expect(result.artifacts!.qrIndex).toBeDefined()
    expect(result.artifacts!.qrIndex!.checkpoints).toEqual([])
  })
})
