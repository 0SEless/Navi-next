# NAVI Studio Map System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing map editor into NAVI Studio with a trace-first workflow, polygon-based rooms, and a unified navigation graph.

**Architecture:** Extend the existing framework-agnostic engine layer (trace-compiler, intersection-engine), refactor component-compiler to emit polygons, build NAVI Studio components alongside the old map-editor, then migrate the route. All new engine modules are pure TypeScript with Vitest unit tests.

**Tech Stack:** TypeScript, Next.js 16, MapLibre GL JS 5.24, Zustand 5, Vitest 4

## Global Constraints

- Framework-agnostic engine must have no React/Next.js imports
- All geographic positions stored as `LatLng` (never x/y pixels)
- A* operates on read-only snapshot of the graph
- Edges are auto-generated from traces — manual edge creation is an advanced feature only
- Rooms are polygon-based internally; presets (rectangle, L-shape) convert to polygon immediately
- No terrain, 2.5D, mobile mapper, GPX, GeoJSON, or AI-assisted tracing in V1
- Test commands: `npm test` (vitest run), `npm run lint`

---
### Task 1: Extend Type Definitions

**Files:**
- Modify: `src/types/nav-types.ts`
- Create: `src/types/studio-types.ts`
- Test: `src/types/__tests__/types.test.ts`

**Interfaces:**
- Consumes: existing NavNode, NavEdge, Component, LatLng types
- Produces: `TracePath`, `FloorPlan`, `EdgeTypeExtended` (union), `StudioTool`, `EditorMode`, `LayerType`, extended `Component` with polygon, extended `CompileResult` with polygon

- [ ] **Step 1: Write failing type tests**

```typescript
// src/types/__tests__/types.test.ts
import { describe, it, expect } from 'vitest'
import type { TracePath, FloorPlan } from '../nav-types'
import type { StudioTool, EditorMode, LayerType } from '../studio-types'

describe('TracePath', () => {
  it('accepts valid trace path data', () => {
    const trace: TracePath = {
      id: 'T001',
      buildingId: 'BLD01',
      floor: 1,
      points: [{ lat: 11.8195, lng: 122.0922 }, { lat: 11.8196, lng: 122.0923 }],
      type: 'hallway',
    }
    expect(trace.id).toBe('T001')
    expect(trace.points.length).toBe(2)
  })
})

describe('FloorPlan', () => {
  it('accepts valid floor plan data', () => {
    const fp: FloorPlan = {
      buildingId: 'BLD01',
      floor: 1,
      imageUrl: 'https://example.com/floor1.png',
      uploadedAt: '2026-06-21T00:00:00Z',
    }
    expect(fp.imageUrl).toContain('example.com')
  })
})

describe('StudioTool', () => {
  it('accepts all tool values', () => {
    const tools: StudioTool[] = ['select', 'move', 'trace', 'room', 'asset', 'qr', 'pano', 'route_test']
    expect(tools).toHaveLength(8)
  })
})

describe('EditorMode', () => {
  it('accepts all mode values', () => {
    const modes: EditorMode[] = ['campus', 'building', 'floor']
    expect(modes).toHaveLength(3)
  })
})

describe('LayerType', () => {
  it('accepts all layer values', () => {
    const layers: LayerType[] = ['osm', 'satellite', 'floor_plan', 'buildings', 'rooms', 'hallways', 'assets', 'nodes', 'edges', 'labels']
    expect(layers).toHaveLength(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `TracePath`, `FloorPlan`, `StudioTool`, `EditorMode`, `LayerType` not defined

- [ ] **Step 3: Add new types to `nav-types.ts`**

Add after existing imports:

```typescript
// ---- Trace Path ----

export interface TracePath {
  id: string
  name?: string
  buildingId?: string
  campusId?: string
  floor: number
  points: LatLng[]
  type: 'hallway' | 'path'
  metadata?: Record<string, unknown>
}

// ---- Floor Plan ----

export interface FloorPlan {
  buildingId: string
  floor: number
  imageUrl: string
  uploadedAt: string
}
```

Extend the `EdgeType` union to include the new values:

```typescript
export type EdgeType =
  | 'walk'          // NEW: hallways, corridors, outdoor paths (V1 default)
  | 'transition'    // NEW: outdoor→entrance, entrance→hallway, floor-to-floor
  | 'restricted'    // NEW: faculty/admin-only zones
  | 'walkway'       // existing (kept for backward compat)
  | 'stairs'
  | 'corridor'
  | 'elevator'
  | 'ramp'
  | 'wall'
```

Add `polygon` field to `Component`:

```typescript
export interface Component {
  id: string
  type: ComponentType
  name: string
  buildingId: string
  floor: number
  position: LatLng
  polygon?: LatLng[]    // NEW: polygon vertices (for room/restroom types)
  dimensions?: {
    width: number
    height: number
    rotation?: number
  }
  connections?: string[]
  metadata?: Record<string, unknown>
}
```

Extend `CompileResult` (in component-compiler.ts - we'll import it from nav-types or keep it local):

Actually, `CompileResult` is in `component-compiler.ts`, not in nav-types. Let's keep it there and just add `polygon`:

In `src/engine/component-compiler.ts`, add to the interface:

```typescript
export interface CompileResult {
  nodes: NavNode[]
  edges: NavEdge[]
  polygon?: LatLng[]   // NEW: for room types — the room outline
}
```

- [ ] **Step 4: Create `src/types/studio-types.ts`**

```typescript
// ---- Studio UI Types ----

export type StudioTool =
  | 'select'
  | 'move'
  | 'trace'
  | 'room'
  | 'asset'
  | 'qr'
  | 'pano'
  | 'route_test'

export type EditorMode = 'campus' | 'building' | 'floor'

export type LayerType =
  | 'osm'
  | 'satellite'
  | 'floor_plan'
  | 'buildings'
  | 'rooms'
  | 'hallways'
  | 'assets'
  | 'nodes'
  | 'edges'
  | 'labels'

export type TraceMode = 'hallway' | 'path'

export type RoomPreset = 'rectangle' | 'lshape' | 'freeform'

export interface StudioViewState {
  center: { lat: number; lng: number }
  zoom: number
  activeFloor: number
  activeBuildingId: string | null
}

export interface LayerVisibility {
  osm: boolean
  satellite: boolean
  floor_plan: boolean
  buildings: boolean
  rooms: boolean
  hallways: boolean
  assets: boolean
  nodes: boolean
  edges: boolean
  labels: boolean
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 4 test suites pass

- [ ] **Step 6: Commit**

```bash
git add src/types/nav-types.ts src/types/studio-types.ts src/types/__tests__/types.test.ts src/engine/component-compiler.ts
git commit -m "feat: extend types for NAVI Studio (TracePath, FloorPlan, new edge types, polygon rooms)"
```

---
### Task 2: Build Intersection Engine Module

**Files:**
- Create: `src/engine/intersection-engine.ts`
- Test: `src/engine/__tests__/intersection-engine.test.ts`

**Interfaces:**
- Consumes: `LatLng`, `TracePath` (from nav-types)
- Produces: `IntersectionPoint[]`, functions: `findLineIntersections()`, `findEndpointNodes()`, `findProximityConnections()`

- [ ] **Step 1: Write failing intersection engine tests**

```typescript
// src/engine/__tests__/intersection-engine.test.ts
import { describe, it, expect } from 'vitest'
import type { LatLng, TracePath } from '@/types/nav-types'
import {
  findLineIntersections,
  findEndpointNodes,
  findProximityConnections,
  type IntersectionPoint,
} from '../intersection-engine'

describe('findLineIntersections', () => {
  it('detects crossing lines', () => {
    // Two line segments forming a cross
    const a: LatLng[] = [{ lat: 0, lng: -1 }, { lat: 0, lng: 1 }]
    const b: LatLng[] = [{ lat: -1, lng: 0 }, { lat: 1, lng: 0 }]
    const result = findLineIntersections(a, b)
    expect(result).toHaveLength(1)
    expect(result[0].lat).toBeCloseTo(0, 1)
    expect(result[0].lng).toBeCloseTo(0, 1)
  })

  it('returns empty for parallel lines', () => {
    const a: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }]
    const b: LatLng[] = [{ lat: 1, lng: 0 }, { lat: 1, lng: 2 }]
    expect(findLineIntersections(a, b)).toHaveLength(0)
  })

  it('detects T-junction', () => {
    const vertical: LatLng[] = [{ lat: -1, lng: 0 }, { lat: 1, lng: 0 }]
    const horizontal: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }]
    const result = findLineIntersections(vertical, horizontal)
    expect(result).toHaveLength(1)
  })

  it('returns empty for disjoint lines', () => {
    const a: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const b: LatLng[] = [{ lat: 2, lng: 0 }, { lat: 2, lng: 1 }]
    expect(findLineIntersections(a, b)).toHaveLength(0)
  })
})

describe('findEndpointNodes', () => {
  it('returns first and last point of trace', () => {
    const trace: TracePath = {
      id: 'T001',
      floor: 0,
      points: [
        { lat: 11.8195, lng: 122.0922 },
        { lat: 11.8196, lng: 122.0923 },
        { lat: 11.8197, lng: 122.0924 },
      ],
      type: 'hallway',
    }
    const endpoints = findEndpointNodes(trace)
    expect(endpoints).toHaveLength(2)
    expect(endpoints[0]).toEqual({ lat: 11.8195, lng: 122.0922 })
    expect(endpoints[1]).toEqual({ lat: 11.8197, lng: 122.0924 })
  })
})

describe('findProximityConnections', () => {
  it('finds nearby room entrances', () => {
    const roomPositions: LatLng[] = [
      { lat: 11.8195, lng: 122.0922 },
      { lat: 11.8198, lng: 122.0925 },
    ]
    const tracePoint = { lat: 11.81955, lng: 122.09225 }
    const result = findProximityConnections(tracePoint, roomPositions, 50)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ lat: 11.8195, lng: 122.0922 })
  })

  it('returns empty when nothing is close enough', () => {
    const roomPositions: LatLng[] = [{ lat: 12.0, lng: 122.0 }]
    const tracePoint = { lat: 11.8195, lng: 122.0922 }
    const result = findProximityConnections(tracePoint, roomPositions, 50)
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `findLineIntersections`, `findEndpointNodes`, `findProximityConnections`, `IntersectionPoint` not defined

- [ ] **Step 3: Write `src/engine/intersection-engine.ts`**

```typescript
import type { LatLng, TracePath } from '../types/nav-types'

export interface IntersectionPoint {
  lat: number
  lng: number
  traceAIndex: number   // segment index in trace A
  traceBIndex: number   // segment index in trace B
}

function crossProduct(o: LatLng, a: LatLng, b: LatLng): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
}

function onSegment(p: LatLng, q: LatLng, r: LatLng): boolean {
  return (
    q.lat <= Math.max(p.lat, r.lat) &&
    q.lat >= Math.min(p.lat, r.lat) &&
    q.lng <= Math.max(p.lng, r.lng) &&
    q.lng >= Math.min(p.lng, r.lng)
  )
}

function segmentsIntersect(p1: LatLng, q1: LatLng, p2: LatLng, q2: LatLng): LatLng | null {
  const o1 = crossProduct(p1, q1, p2)
  const o2 = crossProduct(p1, q1, q2)
  const o3 = crossProduct(p2, q2, p1)
  const o4 = crossProduct(p2, q2, q1)

  if (o1 === 0 && onSegment(p1, p2, q1)) return p2
  if (o2 === 0 && onSegment(p1, q2, q1)) return q2
  if (o3 === 0 && onSegment(p2, p1, q2)) return p1
  if (o4 === 0 && onSegment(p2, q1, q2)) return q1

  if (
    (o1 > 0) !== (o2 > 0) &&
    (o3 > 0) !== (o4 > 0)
  ) {
    const d1x = q1.lng - p1.lng
    const d1y = q1.lat - p1.lat
    const d2x = q2.lng - p2.lng
    const d2y = q2.lat - p2.lat
    const denom = d1x * d2y - d1y * d2x
    if (denom === 0) return null
    const t = ((p2.lng - p1.lng) * d2y - (p2.lat - p1.lat) * d2x) / denom
    return {
      lat: p1.lat + t * d1y,
      lng: p1.lng + t * d1x,
    }
  }

  return null
}

export function findLineIntersections(
  traceA: LatLng[],
  traceB: LatLng[]
): IntersectionPoint[] {
  const results: IntersectionPoint[] = []
  for (let i = 0; i < traceA.length - 1; i++) {
    for (let j = 0; j < traceB.length - 1; j++) {
      const pt = segmentsIntersect(traceA[i], traceA[i + 1], traceB[j], traceB[j + 1])
      if (pt) {
        results.push({
          lat: pt.lat,
          lng: pt.lng,
          traceAIndex: i,
          traceBIndex: j,
        })
      }
    }
  }
  return results
}

export function findEndpointNodes(trace: TracePath): LatLng[] {
  if (trace.points.length === 0) return []
  if (trace.points.length === 1) return [trace.points[0]]
  return [trace.points[0], trace.points[trace.points.length - 1]]
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const aVal =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal))
}

export function findProximityConnections(
  point: LatLng,
  candidates: LatLng[],
  maxDistance: number
): LatLng[] {
  return candidates.filter((c) => haversine(point, c) <= maxDistance)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/intersection-engine.ts src/engine/__tests__/intersection-engine.test.ts
git commit -m "feat: add intersection engine for trace auto-node generation"
```

---
### Task 3: Build Trace Compiler Engine Module

**Files:**
- Create: `src/engine/trace-compiler.ts`
- Test: `src/engine/__tests__/trace-compiler.test.ts`

**Interfaces:**
- Consumes: `TracePath`, `NavNode`, `NavEdge`, `LatLng`, `IntersectionPoint`, `findLineIntersections`, `findEndpointNodes` from intersection-engine
- Produces: `CompileTraceResult { nodes: NavNode[], edges: NavEdge[] }`, function: `compileTrace()`

- [ ] **Step 1: Write failing trace compiler tests**

```typescript
// src/engine/__tests__/trace-compiler.test.ts
import { describe, it, expect } from 'vitest'
import type { TracePath, NavNode, NavEdge } from '@/types/nav-types'
import { compileTrace, type CompileTraceResult } from '../trace-compiler'

describe('compileTrace', () => {
  const hallway: TracePath = {
    id: 'T001',
    name: 'Main Hallway',
    buildingId: 'BLD01',
    floor: 1,
    points: [
      { lat: 11.8195, lng: 122.0922 },
      { lat: 11.8196, lng: 122.0923 },
      { lat: 11.8197, lng: 122.0924 },
    ],
    type: 'hallway',
  }

  it('generates endpoint nodes for a simple trace', () => {
    const result = compileTrace(hallway, [], [], [])
    expect(result.nodes.length).toBeGreaterThanOrEqual(2)
    // First node should be near first point
    const firstNode = result.nodes[0]
    expect(firstNode.type).toBe('intersection')
    expect(firstNode.floor).toBe(1)
    expect(firstNode.buildingId).toBe('BLD01')
  })

  it('generates edges between consecutive nodes', () => {
    const result = compileTrace(hallway, [], [], [])
    expect(result.edges.length).toBeGreaterThanOrEqual(1)
    // All edges should be type 'walk'
    for (const edge of result.edges) {
      expect(edge.type).toBe('walk')
    }
  })

  it('generates nodes at intersection points', () => {
    const existingTrace: TracePath = {
      id: 'T002',
      floor: 1,
      points: [
        { lat: 11.8190, lng: 122.0923 },
        { lat: 11.8200, lng: 122.0923 },
      ],
      type: 'hallway',
    }
    const result = compileTrace(hallway, [existingTrace], [], [])
    // Should have node at the intersection point near (11.8196, 122.0923)
    const intersectionNodes = result.nodes.filter(
      (n) => n.metadata?.source === 'intersection'
    )
    expect(intersectionNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('generates edges to existing room entrance nodes within proximity', () => {
    const roomNode: NavNode = {
      id: 'N010', name: 'Room 101', type: 'room',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.81955, lng: 122.09225 },
    }
    const result = compileTrace(hallway, [], [roomNode], [])
    const hasRoomConnection = result.edges.some(
      (e) => e.to === 'N010' || e.from === 'N010'
    )
    expect(hasRoomConnection).toBe(true)
  })

  it('does not duplicate existing edges', () => {
    const firstResult = compileTrace(hallway, [], [], [])
    const firstEdge = firstResult.edges[0]
    const existingEdges: NavEdge[] = [firstEdge]
    const secondResult = compileTrace(hallway, [], [], existingEdges)
    // Should not create same edge again
    const duplicateCount = secondResult.edges.filter(
      (e) => e.from === firstEdge.from && e.to === firstEdge.to
    ).length
    expect(duplicateCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `compileTrace` not defined

- [ ] **Step 3: Write `src/engine/trace-compiler.ts`**

```typescript
import type { TracePath, NavNode, NavEdge, LatLng } from '../types/nav-types'
import { findLineIntersections, findEndpointNodes, findProximityConnections } from './intersection-engine'

export interface CompileTraceResult {
  nodes: NavNode[]
  edges: NavEdge[]
}

let _idCounter = 0
function genId(prefix: string): string {
  _idCounter++
  return `${prefix}${String(_idCounter).padStart(4, '0')}`
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const aVal =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal))
}

function pointToLatLng(pt: LatLng): string {
  return `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`
}

export function compileTrace(
  trace: TracePath,
  existingTraces: TracePath[],
  existingNodes: NavNode[],
  existingEdges: NavEdge[],
  roomNodes?: NavNode[]
): CompileTraceResult {
  const nodes: NavNode[] = []
  const edges: NavEdge[] = []
  const generatedNodePositions = new Set<string>()

  // 1. Find all node positions
  const nodePositions: LatLng[] = []

  // Endpoints of this trace
  const endpoints = findEndpointNodes(trace)
  for (const ep of endpoints) {
    const key = pointToLatLng(ep)
    if (!generatedNodePositions.has(key)) {
      nodePositions.push(ep)
      generatedNodePositions.add(key)
    }
  }

  // All trace points
  for (const pt of trace.points) {
    const key = pointToLatLng(pt)
    if (!generatedNodePositions.has(key)) {
      nodePositions.push(pt)
      generatedNodePositions.add(key)
    }
  }

  // Intersections with other traces
  for (const other of existingTraces) {
    const intersections = findLineIntersections(trace.points, other.points)
    for (const inter of intersections) {
      const key = pointToLatLng(inter)
      if (!generatedNodePositions.has(key)) {
        nodePositions.push({ lat: inter.lat, lng: inter.lng })
        generatedNodePositions.add(key)
      }
    }
  }

  // 2. Create nodes
  const nodeMap = new Map<string, NavNode>()
  for (const pos of nodePositions) {
    const id = genId('N')
    const node: NavNode = {
      id,
      name: `${trace.name ?? 'Path'} Node`,
      type: 'intersection',
      buildingId: trace.buildingId,
      floor: trace.floor,
      position: pos,
    }
    nodeMap.set(pointToLatLng(pos), node)
    nodes.push(node)
  }

  // 3. Create edges between consecutive trace points
  for (let i = 0; i < trace.points.length - 1; i++) {
    const fromKey = pointToLatLng(trace.points[i])
    const toKey = pointToLatLng(trace.points[i + 1])
    const fromNode = nodeMap.get(fromKey)
    const toNode = nodeMap.get(toKey)
    if (fromNode && toNode) {
      const edgeExists = existingEdges.some(
        (e) => (e.from === fromNode.id && e.to === toNode.id) ||
               (e.from === toNode.id && e.to === fromNode.id)
      )
      if (!edgeExists && fromNode.id !== toNode.id) {
        edges.push({
          id: genId('E'),
          from: fromNode.id,
          to: toNode.id,
          type: 'walk',
          distance: haversine(fromNode.position, toNode.position),
        })
      }
    }
  }

  // 4. Connect to nearby room nodes
  const allRoomNodes = [...(roomNodes ?? []), ...existingNodes.filter(n => n.type === 'room')]
  for (const node of nodes) {
    const nearbyRooms = findProximityConnections(node.position, allRoomNodes.map(n => n.position), 10)
    for (const roomPos of nearbyRooms) {
      const roomNode = allRoomNodes.find(
        (n) => n.position.lat === roomPos.lat && n.position.lng === roomPos.lng
      )
      if (roomNode) {
        const edgeExists = existingEdges.some(
          (e) => (e.from === node.id && e.to === roomNode.id) ||
                 (e.from === roomNode.id && e.to === node.id)
        )
        if (!edgeExists) {
          edges.push({
            id: genId('E'),
            from: node.id,
            to: roomNode.id,
            type: 'transition',
            distance: haversine(node.position, roomNode.position),
          })
        }
      }
    }
  }

  return { nodes, edges }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/trace-compiler.ts src/engine/__tests__/trace-compiler.test.ts
git commit -m "feat: add trace compiler for polyline-to-graph conversion"
```

---
### Task 4: Refactor Component Compiler for Polygon Output

**Files:**
- Modify: `src/engine/component-compiler.ts`
- Test: `src/engine/__tests__/component-compiler.test.ts`

**Interfaces:**
- Consumes: existing Component, CompileContext types
- Produces: updated `CompileResult` with `polygon?: LatLng[]`, room compiler generates polygon from rectangle preset

- [ ] **Step 1: Write failing polygon output test**

```typescript
// src/engine/__tests__/component-compiler.test.ts
import { describe, it, expect } from 'vitest'
import { compileComponent } from '../component-compiler'
import type { Component, Building } from '@/types/nav-types'

describe('compileComponent polygon output', () => {
  const building: Building = {
    id: 'BLD01', name: 'Test', description: '',
    center: { lat: 11.8195, lng: 122.0922 }, floors: 3,
  }
  const buildings = new Map<string, Building>([['BLD01', building]])

  it('compileRoom returns polygon with 4 vertices', () => {
    const room: Component = {
      id: 'C001', type: 'room', name: 'Room 101',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8195, lng: 122.0922 },
      dimensions: { width: 6, height: 8 },
    }
    const result = compileComponent(room, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C001',
    })
    expect(result.polygon).toBeDefined()
    expect(result.polygon!.length).toBe(4)
    // Polygon should form a closed rectangle around the center
    const poly = result.polygon!
    expect(poly[0].lat).toBeLessThan(room.position.lat) // SW
    expect(poly[2].lat).toBeGreaterThan(room.position.lat) // NE
  })

  it('compileRoom outputs center node + 4 wall edges', () => {
    const room: Component = {
      id: 'C002', type: 'room', name: 'Lab 1',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8195, lng: 122.0922 },
      dimensions: { width: 4, height: 5 },
    }
    const result = compileComponent(room, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C002',
    })
    expect(result.nodes.length).toBe(5) // 4 corners + 1 center
    expect(result.nodes.filter(n => n.type === 'room')).toHaveLength(1)
    expect(result.nodes.filter(n => n.type === 'corner')).toHaveLength(4)
    // Wall edges
    const wallEdges = result.edges.filter(e => e.type === 'wall')
    expect(wallEdges).toHaveLength(4)
  })

  it('compileRestroom also returns polygon', () => {
    const restroom: Component = {
      id: 'C003', type: 'restroom', name: 'CR 1',
      buildingId: 'BLD01', floor: 1,
      position: { lat: 11.8195, lng: 122.0922 },
      dimensions: { width: 3, height: 3 },
    }
    const result = compileComponent(restroom, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C003',
    })
    expect(result.polygon).toBeDefined()
    expect(result.polygon!.length).toBe(4)
  })

  it('compileStair does not return polygon', () => {
    const stair: Component = {
      id: 'C004', type: 'stair', name: 'Stair A',
      buildingId: 'BLD01', floor: 0,
      position: { lat: 11.8195, lng: 122.0922 },
    }
    const result = compileComponent(stair, {
      buildings,
      existingNodes: [],
      existingEdges: [],
      componentId: 'C004',
    })
    expect(result.polygon).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — polygon property missing from CompileResult

- [ ] **Step 3: Modify `compileRoom` in `component-compiler.ts` to emit polygon**

In `compileRoom`, after creating corner nodes, compute the polygon:

```typescript
function compileRoom(component: Component, context: CompileContext): CompileResult {
  const { buildings, existingNodes, existingEdges } = context
  const w = (component.dimensions?.width ?? 4) / 2
  const h = (component.dimensions?.height ?? 5) / 2
  const metersPerLat = 111320
  const metersPerLng = 111320 * Math.cos((component.position.lat * Math.PI) / 180)
  const dLat = h / metersPerLat
  const dLng = w / metersPerLng

  const building = buildings.get(component.buildingId)
  const roomLabel = component.name

  // Polygon: [SW, SE, NE, NW]
  const polygon: LatLng[] = [
    { lat: component.position.lat - dLat, lng: component.position.lng - dLng }, // SW
    { lat: component.position.lat - dLat, lng: component.position.lng + dLng }, // SE
    { lat: component.position.lat + dLat, lng: component.position.lng + dLng }, // NE
    { lat: component.position.lat + dLat, lng: component.position.lng - dLng }, // NW
  ]

  // 4 corners (type: corner, non-navigable)
  const corners: NavNode[] = polygon.map((pos, i) => ({
    id: genId('N'),
    name: `${roomLabel} ${['SW', 'SE', 'NE', 'NW'][i]}`,
    type: 'corner' as const,
    buildingId: component.buildingId,
    floor: component.floor,
    position: pos,
  }))

  // 1 center node
  const centerNode: NavNode = {
    id: genId('N'),
    name: roomLabel,
    type: 'room',
    buildingId: component.buildingId,
    floor: component.floor,
    position: component.position,
  }

  // 4 wall edges
  const wallEdges: NavEdge[] = [
    { id: genId('E'), from: corners[0].id, to: corners[1].id, type: 'wall', distance: w * 2 },
    { id: genId('E'), from: corners[1].id, to: corners[2].id, type: 'wall', distance: h * 2 },
    { id: genId('E'), from: corners[2].id, to: corners[3].id, type: 'wall', distance: w * 2 },
    { id: genId('E'), from: corners[3].id, to: corners[0].id, type: 'wall', distance: h * 2 },
  ]

  const nearestCorner = findNearestNode(component.position, corners)
  const edges: NavEdge[] = [...wallEdges]
  if (nearestCorner) {
    edges.push({
      id: genId('E'),
      from: centerNode.id,
      to: nearestCorner.id,
      type: 'corridor',
      distance: haversine(component.position, nearestCorner.position),
    })
  }

  // Connect center to nearest hallway/intersection
  const outdoorConnection = findNearestNode(
    component.position,
    [...existingNodes, ...corners, centerNode].filter((n) =>
      n.type === 'intersection' || n.type === 'building_entrance'
    )
  )
  if (outdoorConnection && outdoorConnection.id !== centerNode.id) {
    const alreadyConnected = existingEdges.some(
      (e) =>
        (e.from === centerNode.id && e.to === outdoorConnection.id) ||
        (e.to === centerNode.id && e.from === outdoorConnection.id)
    )
    if (!alreadyConnected) {
      edges.push({
        id: genId('E'),
        from: centerNode.id,
        to: outdoorConnection.id,
        type: 'transition',
        distance: haversine(component.position, outdoorConnection.position),
      })
    }
  }

  // Also add transition edges from corners to nearest hallway
  for (const corner of corners) {
    const hallwayNode = findNearestNode(corner.position, existingNodes)
    if (hallwayNode) {
      const alreadyConnected = edges.some(
        (e) => (e.from === corner.id && e.to === hallwayNode.id) ||
               (e.to === corner.id && e.from === hallwayNode.id)
      )
      if (!alreadyConnected) {
        edges.push({
          id: genId('E'),
          from: corner.id,
          to: hallwayNode.id,
          type: 'transition',
          distance: haversine(corner.position, hallwayNode.position),
        })
      }
    }
  }

  return { nodes: [...corners, centerNode], edges, polygon }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/component-compiler.ts src/engine/__tests__/component-compiler.test.ts
git commit -m "feat: component compiler emits polygon geometry for rooms"
```

---
### Task 5: Extend Graph Class with Trace Operations

**Files:**
- Modify: `src/engine/graph.ts`
- Test: `src/engine/__tests__/graph.test.ts`

**Interfaces:**
- Consumes: existing Graph class, TracePath, EdgeType
- Produces: Graph with trace CRUD, `addTraceWithCompile()`, `getNodesByFloor()`, `setEdges()`, `getTraces()`

- [ ] **Step 1: Write failing graph extension tests**

```typescript
// Add these tests to the existing graph.test.ts
import type { TracePath } from '@/types/nav-types'

describe('Graph trace operations', () => {
  let graph: Graph

  beforeEach(() => {
    graph = new Graph()
  })

  it('adds and retrieves traces', () => {
    const trace: TracePath = {
      id: 'T001', floor: 0,
      points: [{ lat: 11.8195, lng: 122.0922 }, { lat: 11.8196, lng: 122.0923 }],
      type: 'hallway',
    }
    graph.addTrace(trace)
    expect(graph.traces).toHaveLength(1)
    expect(graph.getTrace('T001')?.id).toBe('T001')
  })

  it('removes trace and its generated nodes/edges', () => {
    const trace: TracePath = {
      id: 'T001', floor: 0,
      points: [{ lat: 11.8195, lng: 122.0922 }, { lat: 11.8196, lng: 122.0923 }],
      type: 'hallway',
    }
    graph.addTraceWithCompile(trace, [])
    expect(graph.traces).toHaveLength(1)
    const nodeCount = graph.nodes.length
    graph.removeTrace('T001')
    expect(graph.traces).toHaveLength(0)
    // Nodes generated from this trace should also be removed
    expect(graph.nodes.length).toBeLessThan(nodeCount)
  })

  it('sets edges with new edge types', () => {
    graph.addNode({ id: 'N001', name: 'A', type: 'intersection', floor: 0, position: { lat: 0, lng: 0 } })
    graph.addNode({ id: 'N002', name: 'B', type: 'intersection', floor: 0, position: { lat: 0, lng: 1 } })
    graph.addEdge({ id: 'E001', from: 'N001', to: 'N002', type: 'walk', distance: 100 })
    const edge = graph.getEdge('E001')
    expect(edge?.type).toBe('walk')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — trace operations not defined on Graph

- [ ] **Step 3: Add trace operations to `Graph` class in `graph.ts`**

Add to the class declaration:

```typescript
import type { TracePath } from '../types/nav-types'
import { compileTrace } from './trace-compiler'

export class Graph {
  private _nodes: Map<string, NavNode> = new Map()
  private _edges: Map<string, NavEdge> = new Map()
  private _buildings: Map<string, Building> = new Map()
  private _components: Map<string, Component> = new Map()
  private _traces: Map<string, TracePath> = new Map()  // NEW

  // ---- Trace Operations (NEW) ----

  get traces(): TracePath[] {
    return Array.from(this._traces.values())
  }

  getTrace(id: string): TracePath | undefined {
    return this._traces.get(id)
  }

  addTrace(trace: TracePath): void {
    this._traces.set(trace.id, trace)
  }

  removeTrace(id: string): void {
    this._traces.delete(id)
    for (const node of this.nodes) {
      if (node.metadata?.traceId === id) {
        this._nodes.delete(node.id)
      }
    }
    for (const [eid, edge] of this._edges) {
      if (!this._nodes.has(edge.from) || !this._nodes.has(edge.to)) {
        this._edges.delete(eid)
      }
    }
  }

  addTraceWithCompile(
    trace: TracePath,
    roomNodes: NavNode[]
  ): void {
    const existingTraces = this.traces
    const result = compileTrace(
      trace,
      existingTraces,
      this.nodes,
      this.edges,
      roomNodes
    )
    this.addTrace(trace)
    for (const node of result.nodes) {
      node.metadata = { ...node.metadata, traceId: trace.id }
      this.addNode(node)
    }
    for (const edge of result.edges) {
      this.addEdge(edge)
    }
  }

  setTraces(traces: TracePath[]): void {
    this._traces.clear()
    for (const t of traces) this._traces.set(t.id, t)
  }
}
```

Also add `TracePath` to the import in `GraphSnapshot` and update `toJSON`/`fromJSON`:

```typescript
export interface GraphSnapshot {
  version: string
  campusId: string
  buildings: Building[]
  nodes: NavNode[]
  edges: NavEdge[]
  components: Component[]
  traces?: TracePath[]   // NEW: optional for backward compat
  exportedAt: string
}
```

And update toJSON/fromJSON:

```typescript
toJSON(): GraphSnapshot {
  return {
    version: '1.0.0',
    campusId: 'asu-ibajay',
    buildings: this.buildings,
    nodes: this.nodes,
    edges: this.edges,
    components: this.components,
    traces: this.traces,
    exportedAt: new Date().toISOString(),
  }
}

static fromJSON(snapshot: GraphSnapshot): Graph {
  const graph = new Graph()
  graph.setBuildings(snapshot.buildings)
  graph.setNodes(snapshot.nodes)
  graph.setEdges(snapshot.edges)
  graph.setComponents(snapshot.components ?? [])
  graph.setTraces(snapshot.traces ?? [])
  return graph
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/graph.ts src/engine/__tests__/graph.test.ts src/types/nav-types.ts
git commit -m "feat: extend Graph with trace operations and new edge types"
```

---
### Task 6: Extend Graph Store for Studio Operations

**Files:**
- Modify: `src/store/graph-store.ts`
- Test: Verify existing tests still pass

**Interfaces:**
- Consumes: existing GraphStore, TracePath, compileTrace
- Produces: New store actions: `addTrace()`, `removeTrace()`, `addComponentWithPolygon()`, updated `addComponent()` stores polygon

- [ ] **Step 1: Add trace and polygon room actions to `graph-store.ts`**

Update the `GraphState` interface and store implementation:

```typescript
// Add to GraphState interface
addTrace: (trace: TracePath) => void
removeTrace: (id: string) => void
addComponentWithPolygon: (component: Component) => void

// Update existing addComponent to preserve polygon from compile result
// In the store object, replace the addComponent function:
addComponent: (component) => {
  const graph = get().graph
  const buildingsMap = new Map(graph.buildings.map((b) => [b.id, b]))
  const result = compileComponent(component, {
    buildings: buildingsMap,
    existingNodes: graph.nodes,
    existingEdges: graph.edges,
    componentId: component.id,
  })
  // Store the component with polygon from compile result (or pre-computed polygon)
  graph.addComponent({ ...component, polygon: result.polygon ?? component.polygon })
  for (const node of result.nodes) {
    graph.addNode(node)
  }
  for (const edge of result.edges) {
    graph.addEdge(edge)
  }
  set({})
},

// Add new store methods:
addTrace: (trace) => {
  const roomNodes = get().graph.nodes.filter(n => n.type === 'room')
  get().graph.addTraceWithCompile(trace, roomNodes)
  set({})
},

removeTrace: (id) => {
  get().graph.removeTrace(id)
  set({})
},

addComponentWithPolygon: (component) => {
  const graph = get().graph
  const buildingsMap = new Map(graph.buildings.map((b) => [b.id, b]))
  const result = compileComponent(component, {
    buildings: buildingsMap,
    existingNodes: graph.nodes,
    existingEdges: graph.edges,
    componentId: component.id,
  })
  graph.addComponent({ ...component, polygon: result.polygon ?? component.polygon })
  for (const node of result.nodes) {
    graph.addNode(node)
  }
  for (const edge of result.edges) {
    graph.addEdge(edge)
  }
  set({})
},
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/graph-store.ts
git commit -m "feat: extend graph store with trace and polygon room operations"
```

---
### Task 7: Build Studio Store

**Files:**
- Modify: `src/store/ui-store.ts`
- Create: `src/store/studio-store.ts`
- Test: `src/store/__tests__/studio-store.test.ts`

**Interfaces:**
- Consumes: StudioTool, EditorMode, LayerVisibility, StudioViewState from studio-types
- Produces: Zustand store with studio state

- [ ] **Step 1: Write failing studio store tests**

```typescript
// src/store/__tests__/studio-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStudioStore } from '../studio-store'

describe('useStudioStore', () => {
  beforeEach(() => {
    useStudioStore.setState({
      tool: 'select',
      editorMode: 'campus',
      activeBuildingId: null,
      activeFloor: 0,
      layers: {
        osm: true, satellite: false, floor_plan: false,
        buildings: true, rooms: true, hallways: true,
        assets: true, nodes: false, edges: false, labels: true,
      },
    })
  })

  it('sets tool', () => {
    useStudioStore.getState().setTool('trace')
    expect(useStudioStore.getState().tool).toBe('trace')
  })

  it('sets editor mode', () => {
    useStudioStore.getState().setEditorMode('building')
    expect(useStudioStore.getState().editorMode).toBe('building')
  })

  it('sets active building', () => {
    useStudioStore.getState().setActiveBuilding('BLD01')
    expect(useStudioStore.getState().activeBuildingId).toBe('BLD01')
  })

  it('sets active floor', () => {
    useStudioStore.getState().setActiveFloor(2)
    expect(useStudioStore.getState().activeFloor).toBe(2)
  })

  it('toggles layer visibility', () => {
    useStudioStore.getState().toggleLayer('nodes')
    expect(useStudioStore.getState().layers.nodes).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `useStudioStore` not defined

- [ ] **Step 3: Create `src/store/studio-store.ts`**

```typescript
import { create } from 'zustand'
import type { StudioTool, EditorMode, LayerVisibility } from '../types/studio-types'

interface StudioState {
  tool: StudioTool
  editorMode: EditorMode
  activeBuildingId: string | null
  activeFloor: number
  layers: LayerVisibility
  isTraceActive: boolean
  traceMode: 'hallway' | 'path'

  setTool: (tool: StudioTool) => void
  setEditorMode: (mode: EditorMode) => void
  setActiveBuilding: (id: string | null) => void
  setActiveFloor: (floor: number) => void
  toggleLayer: (layer: keyof LayerVisibility) => void
  setLayers: (layers: Partial<LayerVisibility>) => void
  setTraceActive: (active: boolean) => void
  setTraceMode: (mode: 'hallway' | 'path') => void

  // Tracing state
  tracePoints: { lat: number; lng: number }[]
  addTracePoint: (point: { lat: number; lng: number }) => void
  clearTracePoints: () => void
  undoLastTracePoint: () => void
}

const defaultLayers: LayerVisibility = {
  osm: true,
  satellite: false,
  floor_plan: false,
  buildings: true,
  rooms: true,
  hallways: true,
  assets: true,
  nodes: false,
  edges: false,
  labels: true,
}

export const useStudioStore = create<StudioState>((set) => ({
  tool: 'select',
  editorMode: 'campus',
  activeBuildingId: null,
  activeFloor: 0,
  layers: { ...defaultLayers },
  isTraceActive: false,
  traceMode: 'hallway',
  tracePoints: [],

  setTool: (tool) => set({ tool }),
  setEditorMode: (mode) => set({ editorMode: mode }),
  setActiveBuilding: (id) => set({ activeBuildingId: id, activeFloor: 0 }),
  setActiveFloor: (floor) => set({ activeFloor: floor }),
  toggleLayer: (layer) => set((s) => ({
    layers: { ...s.layers, [layer]: !s.layers[layer] },
  })),
  setLayers: (layers) => set((s) => ({
    layers: { ...s.layers, ...layers },
  })),
  setTraceActive: (active) => set({
    isTraceActive: active,
    tracePoints: active ? [] : [],
  }),
  setTraceMode: (mode) => set({ traceMode: mode }),

  addTracePoint: (point) => set((s) => ({
    tracePoints: [...s.tracePoints, point],
  })),
  clearTracePoints: () => set({ tracePoints: [] }),
  undoLastTracePoint: () => set((s) => ({
    tracePoints: s.tracePoints.slice(0, -1),
  })),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/studio-store.ts src/store/__tests__/studio-store.test.ts
git commit -m "feat: add studio Zustand store for NAVI Studio state"
```

---
### Task 8: Build Studio Workspace Layout + Canvas

**Files:**
- Create: `src/components/studio/StudioWorkspace.tsx`
- Create: `src/components/studio/StudioCanvas.tsx`
- Create: `src/components/studio/StudioToolbar.tsx`

**Interfaces:**
- Consumes: useStudioStore, useGraphStore, MapLibre GL
- Produces: Main 3-panel layout (LayersPanel | StudioCanvas | PropertiesPanel) with toolbar

- [ ] **Step 1: Write `StudioWorkspace.tsx`**

```typescript
'use client'

import { StudioCanvas } from './StudioCanvas'
import { StudioToolbar } from './StudioToolbar'
import { LayersPanel } from './LayersPanel'
import { PropertiesPanel } from './PropertiesPanel'

export function StudioWorkspace() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0A0F1E' }}>
      <StudioToolbar />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <LayersPanel />
        <StudioCanvas />
        <PropertiesPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `StudioCanvas.tsx`**

Adapt the existing `RealMapView.tsx` for the NAVI Studio workflow. Key changes:
- Use `useStudioStore` instead of `useUiStore`
- Remove add_node/add_edge/building_box tools
- Add trace interaction, room creation interaction
- Keep MapLibre GL rendering, buildings/nodes/edges layers

```typescript
'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGraphStore } from '@/store/graph-store'
import { useStudioStore } from '@/store/studio-store'
import type { NavNode, NavEdge, LatLng } from '@/types/nav-types'
import { calcDistance, generateId, NODE_COLORS } from '@/components/map-editor/mockData'

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}

const SRC = {
  BUILDINGS: 'studio-buildings',
  NODES: 'studio-nodes',
  EDGES: 'studio-edges',
  DRAWING: 'studio-drawing',
  TRACE: 'studio-trace',
  ROOMS: 'studio-rooms',
}

const LYR = {
  BUILDINGS_FILL: 'studio-buildings-fill',
  BUILDINGS_OUTLINE: 'studio-buildings-outline',
  EDGES: 'studio-edges',
  NODES: 'studio-nodes',
  NODES_INNER: 'studio-nodes-inner',
  NODES_LABEL: 'studio-nodes-label',
  DRAWING_LINE: 'studio-drawing-line',
  DRAWING_POINTS: 'studio-drawing-points',
  TRACE_LINE: 'studio-trace-line',
  TRACE_POINTS: 'studio-trace-points',
  ROOMS_FILL: 'studio-rooms-fill',
  ROOMS_OUTLINE: 'studio-rooms-outline',
}

export function StudioCanvas() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const handlersSetupRef = useRef(false)

  const graph = useGraphStore((s) => s.graph)
  const addTrace = useGraphStore((s) => s.addTrace)
  const addComponent = useGraphStore((s) => s.addComponent)
  const addComponentWithPolygon = useGraphStore((s) => s.addComponentWithPolygon)
  const tool = useStudioStore((s) => s.tool)
  const activeFloor = useStudioStore((s) => s.activeFloor)
  const editorMode = useStudioStore((s) => s.editorMode)
  const activeBuildingId = useStudioStore((s) => s.activeBuildingId)
  const layers = useStudioStore((s) => s.layers)
  const tracePoints = useStudioStore((s) => s.tracePoints)
  const addTracePoint = useStudioStore((s) => s.addTracePoint)
  const clearTracePoints = useStudioStore((s) => s.clearTracePoints)

  const [cursorLL, setCursorLL] = useState<LatLng | null>(null)
  const [roomDrag, setRoomDrag] = useState<{ start: LatLng; current: LatLng } | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  // Refs for stale closure avoidance
  const toolRef = useRef(tool)
  const tracePointsRef = useRef(tracePoints)
  const graphRef = useRef(graph)
  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { tracePointsRef.current = tracePoints }, [tracePoints])
  useEffect(() => { graphRef.current = graph }, [graph])

  // MapLibre initialization (identical to RealMapView.tsx lines 287-305)
  useEffect(() => {
    if (mapRef.current) return
    let mounted = true
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: OSM_STYLE,
      center: [122.0922, 11.8195],
      zoom: 17,
    })
    map.on('load', () => {
      if (!mounted) return
      // Add sources + layers (same as RealMapView lines 101-193)
      readyRef.current = true
    })
    mapRef.current = map
    return () => { mounted = false; map.remove(); mapRef.current = null; readyRef.current = false }
  }, [])

  // Event handlers (adapted from RealMapView for StudioTool set)
  useEffect(() => {
    const map = mapRef.current
    if (!map || handlersSetupRef.current) return
    handlersSetupRef.current = true

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const curTool = toolRef.current
      const pos = { lat: e.lngLat.lat, lng: e.lngLat.lng }

      if (curTool === 'trace') {
        addTracePoint(pos)
        return
      }

      if (curTool === 'asset') {
        // Place asset at click position
        addComponent({
          id: `comp-${Date.now()}`,
          type: 'stair', // or 'elevator' / 'entrance' — selected via sub-tool
          name: 'Asset',
          buildingId: activeBuildingId ?? '',
          floor: activeFloor,
          position: pos,
        })
        return
      }

      if (curTool === 'select') {
        // Check hit on node/edge/building (same as RealMapView lines 331-337)
        const features = map.queryRenderedFeatures(e.point)
        const hitNode = features.find((f) => f.layer.id === LYR.NODES)
        setSelectedNode(hitNode?.properties?.id ?? null)
        return
      }
    }

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      const curTool = toolRef.current
      if (curTool === 'trace' && tracePointsRef.current.length >= 2) {
        // Finalize trace: create TracePath and compile
        const trace = {
          id: `T${Date.now()}`,
          floor: useStudioStore.getState().activeFloor,
          points: tracePointsRef.current,
          type: useStudioStore.getState().traceMode,
        }
        addTrace(trace)
        clearTracePoints()
      }
    }

    let dragStart: LatLng | null = null

    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return
      if (toolRef.current === 'room') {
        dragStart = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        setRoomDrag({ start: dragStart, current: dragStart })
      }
    }

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      setCursorLL({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      if (dragStart && toolRef.current === 'room') {
        setRoomDrag({ start: dragStart, current: { lat: e.lngLat.lat, lng: e.lngLat.lng } })
        return
      }
    }

    const handleMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (dragStart && toolRef.current === 'room') {
        const start = dragStart
        const end = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        // Rectangle → polygon: [SW, SE, NE, NW]
        const polygon = [
          { lat: Math.min(start.lat, end.lat), lng: Math.min(start.lng, end.lng) },
          { lat: Math.min(start.lat, end.lat), lng: Math.max(start.lng, end.lng) },
          { lat: Math.max(start.lat, end.lat), lng: Math.max(start.lng, end.lng) },
          { lat: Math.max(start.lat, end.lat), lng: Math.min(start.lng, end.lng) },
        ]
        const center = {
          lat: (start.lat + end.lat) / 2,
          lng: (start.lng + end.lng) / 2,
        }
        addComponentWithPolygon({
          id: `comp-${Date.now()}`,
          type: 'room',
          name: 'Room',
          buildingId: activeBuildingId ?? '',
          floor: activeFloor,
          position: center,
          polygon,
        })
        dragStart = null
        setRoomDrag(null)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearTracePoints()
        setRoomDrag(null)
      }
      // Delete key: remove selected node
      if (e.key === 'Delete' && selectedNode) {
        graphRef.current.removeNode(selectedNode)
        setSelectedNode(null)
      }
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDblClick)
    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      map.off('click', handleClick)
      map.off('dblclick', handleDblClick)
      map.off('mousedown', handleMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeBuildingId, activeFloor, addTrace, addComponent, addTracePoint, clearTracePoints, selectedNode])

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    // Toggle layer visibility based on layers state
    // Implementation mirrors RealMapView syncAllData but checks layers state
  }, [layers, graph, activeFloor, tool])

  // Cursor style based on tool
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvas()
    if (tool === 'trace' || tool === 'room' || tool === 'asset') {
      canvas.style.cursor = 'crosshair'
    } else if (tool === 'select') {
      canvas.style.cursor = 'pointer'
    } else {
      canvas.style.cursor = ''
    }
    if (tool === 'trace' || tool === 'room') {
      map.dragPan.disable()
    } else {
      map.dragPan.enable()
    }
  }, [tool])

  // Drawing preview overlay (same pattern as RealMapView lines 508-595)
  useEffect(() => {
    const m = mapRef.current
    if (!m || !readyRef.current) return
    const drawFeatures: GeoJSON.Feature[] = []

    // Trace points preview
    if (tracePoints.length > 0 && tool === 'trace') {
      const coords = tracePoints.map((p) => [p.lng, p.lat])
      drawFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      })
      for (const p of tracePoints) {
        drawFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: {},
        })
      }
    }

    // Room drag preview
    if (roomDrag && tool === 'room') {
      const s = roomDrag.start
      const c = roomDrag.current
      drawFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [s.lng, s.lat], [c.lng, s.lat], [c.lng, c.lat], [s.lng, c.lat], [s.lng, s.lat],
          ]],
        },
        properties: {},
      })
    }

    try {
      const src = m.getSource(SRC.DRAWING) as maplibregl.GeoJSONSource
      if (src) src.setData({ type: 'FeatureCollection', features: drawFeatures })
    } catch { /* source not ready */ }
  }, [tracePoints, roomDrag, tool])

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
}

*The MapLibre source/layer setup (`addSourcesAndLayers`), GeoJSON builders (`buildBuildingGeo`, `buildNodeGeo`, `buildEdgeGeo`), and data sync (`syncAllData`) functions are identical to `RealMapView.tsx` (lines 39-193 and 270-285). The implementer should copy those verbatim.*

- [ ] **Step 3: Write `StudioToolbar.tsx`**

```typescript
'use client'

import {
  MousePointer2, Move, Pencil, Square, Package, QrCode, Camera, Route,
  Layers, Building2, ChevronDown,
} from 'lucide-react'
import { useStudioStore } from '@/store/studio-store'
import type { StudioTool } from '@/types/studio-types'

const TOOL_CONFIG: { tool: StudioTool; icon: typeof MousePointer2; label: string; color: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', color: '#1C6BEB' },
  { tool: 'move', icon: Move, label: 'Move', color: '#64748B' },
  { tool: 'trace', icon: Pencil, label: 'Trace', color: '#F59E0B' },
  { tool: 'room', icon: Square, label: 'Room', color: '#10B981' },
  { tool: 'asset', icon: Package, label: 'Asset', color: '#8B5CF6' },
  { tool: 'qr', icon: QrCode, label: 'QR', color: '#F59E0B' },
  { tool: 'pano', icon: Camera, label: '360', color: '#8B5CF6' },
  { tool: 'route_test', icon: Route, label: 'Route', color: '#06B6D4' },
]

const FLOORS = [
  { value: 0, label: 'GF' },
  { value: 1, label: '1F' },
  { value: 2, label: '2F' },
  { value: 3, label: '3F' },
]

export function StudioToolbar() {
  const tool = useStudioStore((s) => s.tool)
  const setTool = useStudioStore((s) => s.setTool)
  const editorMode = useStudioStore((s) => s.editorMode)
  const setEditorMode = useStudioStore((s) => s.setEditorMode)
  const activeFloor = useStudioStore((s) => s.activeFloor)
  const setActiveFloor = useStudioStore((s) => s.setActiveFloor)

  return (
    <div style={{
      background: '#0D1526',
      borderBottom: '1px solid #1E3A5F',
      padding: '6px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0,
      flexWrap: 'wrap',
    }}>
      {/* NAVI Studio branding */}
      <span style={{ color: '#06B6D4', fontSize: 12, fontWeight: 800, marginRight: 12, letterSpacing: '0.05em' }}>
        NAVI STUDIO
      </span>

      {/* Editor mode */}
      <div style={{ display: 'flex', gap: 2, background: '#080E1C', borderRadius: 6, padding: 2, marginRight: 8 }}>
        {(['campus', 'building', 'floor'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setEditorMode(m)}
            style={{
              padding: '4px 10px', borderRadius: 4, border: 'none',
              background: editorMode === m ? '#1C6BEB' : 'transparent',
              color: editorMode === m ? 'white' : '#64748B',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {m === 'campus' ? '🗺 Campus' : m === 'building' ? '🏛 Building' : '📐 Floor'}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 22, background: '#1E3A5F', margin: '0 4px' }} />

      {/* Tools */}
      {TOOL_CONFIG.map(({ tool: t, icon: Icon, label, color }) => (
        <button
          key={t}
          title={label}
          onClick={() => setTool(t)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 5,
            border: `1px solid ${tool === t ? color : '#1E293B'}`,
            background: tool === t ? `${color}20` : 'transparent',
            color: tool === t ? color : '#94A3B8',
            cursor: 'pointer', fontSize: 11,
            fontWeight: tool === t ? 600 : 400,
          }}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      {/* Floor selector */}
      <span style={{ color: '#64748B', fontSize: 10, fontWeight: 600 }}>FLOOR:</span>
      {FLOORS.map((f) => (
        <button
          key={f.value}
          onClick={() => setActiveFloor(f.value)}
          style={{
            width: 32, height: 24, borderRadius: 4,
            border: `1px solid ${activeFloor === f.value ? '#1C6BEB' : '#1E293B'}`,
            background: activeFloor === f.value ? '#1C6BEB' : 'transparent',
            color: activeFloor === f.value ? 'white' : '#64748B',
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/
git commit -m "feat: add NAVI Studio workspace layout, canvas, and toolbar"
```

---
### Task 9: Build Studio Panels (Layers + Properties)

**Files:**
- Create: `src/components/studio/LayersPanel.tsx`
- Create: `src/components/studio/PropertiesPanel.tsx`

- [ ] **Step 1: Write `LayersPanel.tsx`**

```typescript
'use client'

import { Layers, Eye, EyeOff, Building2, Map, Route, Grid3X3, Camera, QrCode, Package } from 'lucide-react'
import { useStudioStore } from '@/store/studio-store'
import { useGraphStore } from '@/store/graph-store'
import type { LayerType, LayerVisibility } from '@/types/studio-types'

const LAYER_CONFIG: { key: keyof LayerVisibility; label: string; icon: typeof Layers }[] = [
  { key: 'osm', label: 'OSM Base', icon: Map },
  { key: 'satellite', label: 'Satellite', icon: Map },
  { key: 'floor_plan', label: 'Floor Plan', icon: Grid3X3 },
  { key: 'buildings', label: 'Buildings', icon: Building2 },
  { key: 'rooms', label: 'Rooms', icon: Grid3X3 },
  { key: 'hallways', label: 'Hallways', icon: Route },
  { key: 'assets', label: 'Assets', icon: Package },
  { key: 'nodes', label: 'Nodes', icon: Route },
  { key: 'edges', label: 'Edges', icon: Route },
  { key: 'labels', label: 'Labels', icon: Layers },
]

export function LayersPanel() {
  const layers = useStudioStore((s) => s.layers)
  const toggleLayer = useStudioStore((s) => s.toggleLayer)
  const editorMode = useStudioStore((s) => s.editorMode)
  const setEditorMode = useStudioStore((s) => s.setEditorMode)

  return (
    <div style={{
      width: 220, background: '#0D1526',
      borderRight: '1px solid #1E3A5F',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Layers size={13} color="#06B6D4" />
        <span style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600 }}>LAYERS</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {LAYER_CONFIG.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            onClick={() => toggleLayer(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 14px', cursor: 'pointer',
              color: layers[key] ? '#E2E8F0' : '#475569',
              fontSize: 11,
            }}
          >
            <Icon size={12} color={layers[key] ? '#1C6BEB' : '#334155'} />
            <span style={{ flex: 1 }}>{label}</span>
            {layers[key] ? <Eye size={12} color="#1C6BEB" /> : <EyeOff size={12} />}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `PropertiesPanel.tsx`**

This is a context-sensitive panel that shows properties based on selection. For V1, it mirrors the existing right panel from `MapEditor.tsx` but simplified.

```typescript
'use client'

import { useState } from 'react'
import { Info, Building2, MapPin, Route, Trash2, Upload, Layers } from 'lucide-react'
import { useStudioStore } from '@/store/studio-store'
import { useGraphStore } from '@/store/graph-store'
import type { NodeType, EdgeType } from '@/types/nav-types'

export function PropertiesPanel() {
  const graph = useGraphStore((s) => s.graph)
  const addTrace = useGraphStore((s) => s.graph.addTrace.bind(s.graph))
  const tool = useStudioStore((s) => s.tool)
  const editorMode = useStudioStore((s) => s.editorMode)
  const activeBuildingId = useStudioStore((s) => s.activeBuildingId)

  const selectedBuilding = activeBuildingId ? graph.getBuilding(activeBuildingId) : null

  return (
    <div style={{
      width: 280, background: '#0D1526',
      borderLeft: '1px solid #1E3A5F',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Info size={13} color="#06B6D4" />
        <span style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600 }}>
          {selectedBuilding ? 'Building Properties' : 'Properties'}
        </span>
      </div>

      {selectedBuilding ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
          {/* Building metadata fields */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ color: '#475569', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', display: 'block', marginBottom: 3 }}>NAME</label>
            <input value={selectedBuilding.name} readOnly
              style={{ width: '100%', background: '#111827', border: '1px solid #1E3A5F', borderRadius: 5, padding: '6px 8px', color: '#E2E8F0', fontSize: 11 }} />
          </div>
          {/* Floor status indicators */}
          <div style={{ border: '1px solid #1E293B', borderRadius: 6, marginBottom: 10 }}>
            <div style={{ padding: '6px 10px', background: '#111827', borderBottom: '1px solid #1E293B' }}>
              <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600 }}>FLOORS</span>
            </div>
            <div style={{ padding: 10 }}>
              {Array.from({ length: selectedBuilding.floors ?? 1 }, (_, i) => i).reverse().map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ color: '#E2E8F0', fontSize: 11, fontWeight: 600, width: 24 }}>
                    {f === 0 ? 'GF' : `${f}F`}
                  </span>
                  <span style={{ color: '#475569', fontSize: 9 }}>✗ Missing</span>
                  <button style={{ marginLeft: 'auto', padding: '2px 6px', background: '#1E293B', border: 'none', borderRadius: 3, color: '#94A3B8', fontSize: 9, cursor: 'pointer' }}>
                    Upload
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 11 }}>
          Select an item on the map
        </div>
      )}

      {/* Stats */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid #1E293B', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {[
          { label: 'Buildings', value: graph.buildings.length },
          { label: 'Nodes', value: graph.nodes.length },
          { label: 'Edges', value: graph.edges.length },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#111827', borderRadius: 4, padding: '5px 6px', textAlign: 'center' }}>
            <div style={{ color: '#60A5FA', fontSize: 13, fontWeight: 700 }}>{value}</div>
            <div style={{ color: '#475569', fontSize: 9 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/studio/LayersPanel.tsx src/components/studio/PropertiesPanel.tsx
git commit -m "feat: add NAVI Studio layers panel and properties panel"
```

---
### Task 10: Create Studio Route

**Files:**
- Create: `src/app/(admin)/studio/page.tsx`
- Modify: `src/app/(admin)/layout.tsx` — add studio link to admin nav

**Interfaces:**
- Consumes: StudioWorkspace component
- Produces: `/studio` admin route

- [ ] **Step 1: Create `src/app/(admin)/studio/page.tsx`**

```typescript
'use client'

import { useEffect } from 'react'
import { StudioWorkspace } from '@/components/studio/StudioWorkspace'
import { useGraphStore } from '@/store/graph-store'

export default function StudioPage() {
  const load = useGraphStore((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  return <StudioWorkspace />
}
```

- [ ] **Step 2: Update admin layout to add Studio link**

In `src/app/(admin)/layout.tsx`, add a nav link for NAVI Studio:

```
// Add to the admin sidebar/navigation
{ label: 'NAVI Studio', href: '/studio', icon: Building2 }
```

- [ ] **Step 3: Verify it renders**

Run: `npm run dev`
Visit: `/studio`
Expected: NAVI Studio workspace with toolbar, 3-panel layout, and MapLibre canvas loading

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/studio/page.tsx
git commit -m "feat: add NAVI Studio route under admin"
```

---
### Task 11: Build Public Map View

**Files:**
- Modify: `src/app/(public)/map/page.tsx` — replace placeholder with functional map
- Create: `src/components/map/PublicMap.tsx`

**Interfaces:**
- Consumes: Graph (via graph-store), MapLibre GL, A* pathfinding
- Produces: Interactive public map with routing, building info, search

- [ ] **Step 1: Create `src/components/map/PublicMap.tsx`**

```typescript
'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGraphStore } from '@/store/graph-store'
import type { LatLng, PathResult } from '@/types/nav-types'

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' as const }],
}

export function PublicMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const graph = useGraphStore((s) => s.graph)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [path, setPath] = useState<PathResult | null>(null)

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: OSM_STYLE,
      center: [122.0922, 11.8195],
      zoom: 17,
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Render buildings and route when graph/path changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    // Buildings layer
    const buildingFeatures = graph.buildings.map((b) => ({
      type: 'Feature' as const,
      id: b.id,
      properties: { name: b.name, code: b.code },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [b.outline?.map((p) => [p.lng, p.lat]) ?? []],
      },
    }))

    const routeFeatures = path
      ? [{
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: path.path.map((nid) => {
              const node = graph.getNode(nid)
              return node ? [node.position.lng, node.position.lat] : null
            }).filter(Boolean),
          },
        }]
      : []

    // Update GeoJSON sources
    // (same pattern as RealMapView — addSources and setData)
  }, [graph, path])

  const handleRoute = useCallback(() => {
    if (!from || !to) return
    const result = graph.findPath(from, to)
    setPath(result)
  }, [graph, from, to])

  const nodeOptions = graph.nodes
    .filter((n) => n.type !== 'corner' && n.type !== 'wall')
    .map((n) => ({ id: n.id, name: n.name, type: n.type }))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Search / route panel */}
      <div style={{ padding: 12, background: '#0D1526', borderBottom: '1px solid #1E3A5F', display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={from} onChange={(e) => setFrom(e.target.value)}
          style={{ background: '#111827', border: '1px solid #1E3A5F', borderRadius: 5, padding: '6px 8px', color: '#E2E8F0', fontSize: 11 }}>
          <option value="">From...</option>
          {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <select value={to} onChange={(e) => setTo(e.target.value)}
          style={{ background: '#111827', border: '1px solid #1E3A5F', borderRadius: 5, padding: '6px 8px', color: '#E2E8F0', fontSize: 11 }}>
          <option value="">To...</option>
          {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <button onClick={handleRoute}
          style={{ padding: '6px 14px', background: '#1C6BEB', border: 'none', borderRadius: 5, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Route
        </button>
      </div>

      {/* Map */}
      <div ref={mapContainerRef} style={{ flex: 1 }} />

      {/* Route steps */}
      {path && (
        <div style={{ padding: 12, background: '#0D1526', borderTop: '1px solid #1E3A5F', maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, marginBottom: 6 }}>ROUTE ({Math.round(path.cost)}m)</div>
          {path.steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11, color: '#E2E8F0' }}>
              <span style={{ color: '#475569', minWidth: 16 }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>{step.instruction}</span>
              {step.distance > 0 && <span style={{ color: '#475569' }}>{Math.round(step.distance)}m</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `src/app/(public)/map/page.tsx`**

```typescript
import { PublicMap } from '@/components/map/PublicMap'

export default function MapPage() {
  return <PublicMap />
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(public\)/map/page.tsx src/components/map/PublicMap.tsx
git commit -m "feat: add public map view with routing"
```

---
### Task 12: Add Floor Plan Upload API

**Files:**
- Create: `src/app/api/floor-plans/route.ts`

**Interfaces:**
- Consumes: multipart form upload with image file
- Produces: `POST /api/floor-plans` → `{ url: string, buildingId: string, floor: number }`

- [ ] **Step 1: Write `src/app/api/floor-plans/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'

// V1: Local file storage fallback
// In production, this would upload to Cloudinary or Supabase Storage
// For V1, we store as base64 or use a local path

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const buildingId = formData.get('buildingId') as string | null
    const floorStr = formData.get('floor') as string | null

    if (!file || !buildingId || !floorStr) {
      return NextResponse.json(
        { error: 'Missing required fields: file, buildingId, floor' },
        { status: 400 }
      )
    }

    const floor = parseInt(floorStr, 10)
    if (isNaN(floor)) {
      return NextResponse.json({ error: 'Floor must be a number' }, { status: 400 })
    }

    // V1: Convert to base64 data URL (for local dev / demo)
    // Replace with Cloudinary/Supabase upload in production
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = file.type || 'image/png'
    const dataUrl = `data:${mimeType};base64,${base64}`

    return NextResponse.json({
      url: dataUrl,
      buildingId,
      floor,
      fileName: file.name,
      size: file.size,
    })
  } catch (error) {
    console.error('Floor plan upload failed:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/floor-plans/route.ts
git commit -m "feat: add floor plan upload API endpoint"
```

---
### Task 13: Full Integration & Cleanup

**Files:**
- Modify: various — clean up deprecated files

**Steps:**
- [ ] Remove the old `map-editor` tool components (add_node, add_edge, building_box) from the toolbar if they still exist
- [ ] Add a redirect from `/map-editor` to `/studio`
- [ ] Run full test suite
- [ ] Run lint
- [ ] Verify the app builds

- [ ] **Step 1: Run tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: integrate NAVI Studio, cleanup deprecated map-editor"
```
