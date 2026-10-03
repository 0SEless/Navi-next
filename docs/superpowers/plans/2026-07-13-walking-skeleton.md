# Walking Skeleton (Milestone A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove NAVI's complete pipeline end-to-end: create a campus in the editor → compile → publish → load into runtime → route from A to B.

**Architecture:** 6 tasks building on existing infrastructure. Start with a Golden Campus factory used by the E2E script and integration test. Wire the compiler adapter in the app layer. Add a publish button. Build a runtime verification page. Each task produces independently testable output.

**Tech Stack:** TypeScript, Next.js, @navi/core, @navi/compiler, @navi/runtime, @navi/editor

**Golden Campus Dataset (used by Tasks 1, 2, 6):**
```
Campus: "Demo Campus"

Building A (id: "bldg-a")
├── Floor 1 (level: 1, label: "Floor 1", elevation: 0)
│   ├── Hallway H1 (id: "hallway-h1", polyline [{x:0,y:0}, {x:20,y:0}], width: 3)
│   ├── Room 101 (id: "room-101", polygon [{x:-5,y:-5}, {x:3,y:-5}, {x:3,y:1}, {x:-5,y:1}])
│   ├── Room 102 (id: "room-102", polygon [{x:17,y:-5}, {x:25,y:-5}, {x:25,y:1}, {x:17,y:1}])
│   └── Entrance E1 (id: "entrance-e1", lat/lng at building front, level: 1)
```

Building footprint: world polygon near a known lat/lng (e.g., ASU Ibajay area: 12.345, 121.234).
All room/hallway coordinates are building-local (x,y meters). Building centroid at (12.345, 121.234).
Room 101 entrance hovers at `{x:3, y:-2}`, Room 102 entrance hovers at `{x:17, y:-2}`.

## Global Constraints

- No new editor systems, compiler stages, runtime services, or platform abstractions
- CompilerAdapter must lazy-import @navi/compiler (avoids Node crypto in browser bundles)
- The Publish action consumes only CampusDocument and compiler interfaces — no UI/selection/React state
- Runtime Verification Page is NOT the final navigation UI — text-only route display
- All architecture decisions from M3.5 Constitution remain in effect

---

### Task 1: Golden Campus Factory

**Files:**
- Create: `navi-next/packages/editor/src/demo/golden-campus.ts`
- Test: `navi-next/packages/editor/src/demo/__tests__/golden-campus.test.ts`

**Interfaces:**
- Produces: `function createGoldenCampus(): CampusDocument` — returns the Golden Campus as a fully-formed CampusDocument with version 1

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { createGoldenCampus } from '../golden-campus'

describe('Golden Campus', () => {
  it('creates a campus with 1 building', () => {
    const campus = createGoldenCampus()
    expect(campus.buildings).toHaveLength(1)
  })

  it('has building named "Building A"', () => {
    const campus = createGoldenCampus()
    expect(campus.buildings[0].name).toBe('Building A')
  })

  it('has 1 floor', () => {
    const campus = createGoldenCampus()
    expect(campus.buildings[0].floors).toHaveLength(1)
  })

  it('has 2 rooms (101, 102)', () => {
    const campus = createGoldenCampus()
    const rooms = campus.buildings[0].floors[0].rooms
    expect(rooms).toHaveLength(2)
    expect(rooms.map(r => r.name)).toContain('Room 101')
    expect(rooms.map(r => r.name)).toContain('Room 102')
  })

  it('has 1 hallway', () => {
    const campus = createGoldenCampus()
    const hallways = campus.buildings[0].floors[0].hallways
    expect(hallways).toHaveLength(1)
  })

  it('has 1 entrance', () => {
    const campus = createGoldenCampus()
    const entrances = campus.buildings[0].floors[0].entrances
    expect(entrances).toHaveLength(1)
  })

  it('has valid schemaVersion', () => {
    const campus = createGoldenCampus()
    expect(campus.schemaVersion).toBe(1)
  })
})
```

Run: `npx vitest run packages/editor/src/demo/__tests__/golden-campus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Create the factory**

```typescript
import { CampusDocument, Building, Floor, Room, Hallway, Entrance, WorldPolygon, LocalPolygon, LocalPolyline } from '@navi/core'
import { v4 as uuid } from 'uuid'

const BUILDING_CENTROID = { lat: 12.345, lng: 121.234 }

function localToWorld(local: { x: number; y: number }, origin: { lat: number; lng: number }): { lat: number; lng: number } {
  // Approximate: 1 degree lat ≈ 111320m, 1 degree lng ≈ 111320*cos(lat) m
  const latPerMeter = 1 / 111320
  const lngPerMeter = 1 / (111320 * Math.cos(origin.lat * Math.PI / 180))
  return {
    lat: origin.lat + local.y * latPerMeter,
    lng: origin.lng + local.x * lngPerMeter,
  }
}

export function createGoldenCampus(): CampusDocument {
  const buildingId = 'bldg-a'
  const floorLevel = 1
  const floorId = 'fl-1'

  // Convert building-local polygon to world coords by offsetting from building centroid
  const toWorld = (p: { x: number; y: number }) => localToWorld(p, BUILDING_CENTROID)

  const room101: Room = {
    id: 'room-101',
    name: 'Room 101',
    number: '101',
    category: 'classroom',
    polygon: [{ x: -5, y: -5 }, { x: 3, y: -5 }, { x: 3, y: 1 }, { x: -5, y: 1 }],
    entrancePosition: { x: 3, y: -2 },
    capacity: 30,
  }

  const room102: Room = {
    id: 'room-102',
    name: 'Room 102',
    number: '102',
    category: 'classroom',
    polygon: [{ x: 17, y: -5 }, { x: 25, y: -5 }, { x: 25, y: 1 }, { x: 17, y: 1 }],
    entrancePosition: { x: 17, y: -2 },
    capacity: 30,
  }

  const hallway: Hallway = {
    id: 'hallway-h1',
    name: 'Main Hallway',
    polyline: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    width: 3,
  }

  const entrance: Entrance = {
    id: 'entrance-e1',
    name: 'Main Entrance',
    position: toWorld({ x: 10, y: 5 }),
    level: floorLevel,
    type: 'building',
  }

  const floor: Floor = {
    id: floorId,
    level: floorLevel,
    label: 'Floor 1',
    elevation: 0,
    rooms: [room101, room102],
    hallways: [hallway],
    staircases: [],
    elevators: [],
    entrances: [entrance],
  }

  const building: Building = {
    id: buildingId,
    name: 'Building A',
    code: 'BLA',
    category: 'academic',
    footprint: {
      points: [
        toWorld({ x: -8, y: -8 }),
        toWorld({ x: 28, y: -8 }),
        toWorld({ x: 28, y: 8 }),
        toWorld({ x: -8, y: 8 }),
      ],
    },
    baseElevation: 0,
    height: 10,
    floors: [floor],
    aliases: ['Building Alpha'],
  }

  return {
    schemaVersion: 1,
    version: 1,
    metadata: {
      name: 'Demo Campus',
      description: 'Golden Campus for walking skeleton E2E testing',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}
```

Run: `npx vitest run packages/editor/src/demo/__tests__/golden-campus.test.ts`
Expected: PASS

- [ ] **Step 3: Register the demo directory in editor's test configuration**

The tests are under `packages/editor/src/demo/`. If vitest discovers them automatically (it should via `**/*.test.ts` glob), no change needed. Verify by running the full test suite.

Run: `npx vitest run packages/editor/src/demo/`
Expected: All 7 golden campus tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/demo/golden-campus.ts packages/editor/src/demo/__tests__/golden-campus.test.ts
git commit -m "feat(editor): add Golden Campus factory for E2E testing"
```

---

### Task 2: E2E Verification Script (D1)

**Files:**
- Create: `navi-next/scripts/demo-e2e.ts`

**Interfaces:**
- Consumes: `createGoldenCampus()` from Task 1, `CampusCompiler` from `@navi/compiler`, `buildSearchIndex`/`buildPOIData`/`buildBuildingIndex`/`generateManifest` from `@navi/compiler/artifacts`, `ArtifactLoader`/`RuntimeEngine` from `@navi/runtime`
- Produces: Stage-level console output, artifacts in `demo-output/`

- [ ] **Step 1: Create the E2E script**

```typescript
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { CampusCompiler } from '@navi/compiler'
import { buildSearchIndex, buildPOIData, buildBuildingIndex, generateManifest } from '@navi/compiler'
import { ArtifactLoader, RuntimeEngine } from '@navi/runtime'
import { createGoldenCampus } from '../packages/editor/src/demo/golden-campus'

const DEMO_DIR = join(__dirname, '..', 'demo-output')

function stage(label: string, ok: boolean, detail?: string) {
  const icon = ok ? '✓' : '✗'
  console.log(`  ${icon} ${label}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  console.log()
  console.log('='.repeat(70))
  console.log('  NAVI Walking Skeleton — End-to-End Verification')
  console.log('='.repeat(70))

  // ── Stage 1: Create CampusDocument ──
  console.log('\n  📋 CampusDocument')
  const campus = createGoldenCampus()
  const building = campus.buildings[0]
  const floor = building.floors[0]
  stage('Created', true, `${building.name}, ${floor.rooms.length} rooms, ${floor.hallways.length} hallway`)

  // ── Stage 2: Compile with CampusCompiler ──
  console.log('\n  🔧 Compiler')
  const compiler = new CampusCompiler({
    nodeInterval: 5,
    mergeThreshold: 3,
    optimizationLevel: 'moderate',
    includeAccessibility: false,
  })
  const result = compiler.compile(campus)
  if (!result.success || !result.graph) {
    stage('Compile failed', false, result.errors.map(e => e.message).join('; '))
    process.exit(1)
  }
  const graph = result.graph
  stage('Graph created', true, `${graph.nodes.length} nodes, ${graph.edges.length} edges`)

  // ── Stage 3: Publish Artifacts ──
  console.log('\n  📦 Publish')
  if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true })

  // Build remaining artifacts from graph
  const searchIndex = buildSearchIndex(campus, graph)
  const poiData = buildPOIData(graph)
  const buildingIndex = buildBuildingIndex(campus, graph)

  const files: Record<string, string> = {
    'navigation.graph.json': JSON.stringify(graph, null, 2),
    'search.index.json': JSON.stringify(searchIndex, null, 2),
    'poi.json': JSON.stringify(poiData, null, 2),
    'building-index.json': JSON.stringify(buildingIndex, null, 2),
  }

  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(DEMO_DIR, filename), content)
  }

  const manifest = generateManifest(campus.metadata.name, { navigationGraph: graph, searchIndex, poiData, buildingIndex })
  writeFileSync(join(DEMO_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  stage('Artifacts written', true, `5 files to ${DEMO_DIR}`)
  for (const f of Object.keys(files).concat('manifest.json')) {
    const fullPath = join(DEMO_DIR, f)
    const size = existsSync(fullPath) ? readFileSync(fullPath).length : 0
    stage(`  ${f}`, true, `${size} bytes`)
  }

  // ── Stage 4: Load Runtime ──
  console.log('\n  🏃 Runtime')
  const fileFetch = (_url: string) => {
    const filename = _url.split('/').pop()!
    const filePath = join(DEMO_DIR, filename)
    try {
      const body = readFileSync(filePath, 'utf-8')
      return Promise.resolve(new Response(body, { status: 200 }))
    } catch {
      return Promise.resolve(new Response('Not found', { status: 404 }))
    }
  }
  const loader = new ArtifactLoader({ baseUrl: 'file:///demo', fetch: fileFetch })
  const engine = await RuntimeEngine.create(loader)
  const stats = engine.data.getGraph().metadata
  stage('Engine loaded', true, `${stats.nodeCount} nodes, ${stats.edgeCount} edges`)

  // ── Stage 5: Search ──
  console.log('\n  🔍 Search')
  const results101 = engine.search.query('101', { maxResults: 5 })
  stage('Search "101"', results101.length > 0, results101.length > 0 ? `found "${results101[0].entry.label}"` : 'no results')

  const results102 = engine.search.query('102', { maxResults: 5 })
  stage('Search "102"', results102.length > 0, results102.length > 0 ? `found "${results102[0].entry.label}"` : 'no results')

  // ── Stage 6: Route ──
  console.log('\n  🗺️  Route')
  const nodes = engine.data.getGraph().nodes
  const room101node = nodes.find(n => n.label === 'Room 101')
  const room102node = nodes.find(n => n.label === 'Room 102')

  if (!room101node || !room102node) {
    stage('Route', false, 'Could not find Room 101 or Room 102 nodes')
    process.exit(1)
  }

  const route = engine.routing.findRoute(room101node.id, room102node.id)
  if (!route) {
    stage('Route', false, 'No route found between rooms')
    process.exit(1)
  }

  stage('Route exists', true)
  stage(`  Distance`, true, `${Math.round(route.totalDistance)}m`)
  stage(`  Duration`, true, `${Math.round(route.totalDuration / 60)} min`)
  stage(`  Steps`, true, `${route.path.length}`)
  stage(`  Instructions`, true, `${route.instructions.length}`)

  const walkInstructions = route.instructions.filter(i => i.type === 'walk')
  stage(`  Walk instructions`, walkInstructions.length > 0, `${walkInstructions.length}`)

  const arrivalInstruction = route.instructions.find(i => i.type === 'arrive')
  stage(`  Arrival instruction`, !!arrivalInstruction, arrivalInstruction?.text)

  // Print full route
  console.log('\n  📍 Route Details')
  for (const inst of route.instructions) {
    const dist = inst.distance > 0 ? ` (${Math.round(inst.distance)}m)` : ''
    console.log(`    ${inst.type.padEnd(12)} ${inst.text}${dist}`)
  }

  console.log()
  console.log('='.repeat(70))
  console.log('  ✅ Walking Skeleton Verified — Pipeline Complete')
  console.log('='.repeat(70))
  console.log()
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Add npm script to package.json**

Read `navi-next/package.json` and add `"demo:e2e": "npx tsx scripts/demo-e2e.ts"` to the scripts section.

- [ ] **Step 3: Run the E2E script**

Run: `npm run demo:e2e`
Expected: All 6 stages pass with ✓ indicators, route printed with instructions, exit code 0

If `buildSearchIndex`/`buildPOIData`/`buildBuildingIndex`/`generateManifest` are not exported from `@navi/compiler`'s index, import them directly from `@navi/compiler` (they are exported from `artifact-generator.ts` which is re-exported via `artifacts/index.ts`). Check exports first.

Run: `npx tsx scripts/demo-e2e.ts`
Expected: Exit code 0, all stages pass

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-e2e.ts
git commit -m "feat(scripts): add E2E walking skeleton verification script"
```

---

### Task 3: Concrete CompilerAdapter (D2)

**Files:**
- Create: `navi-next/src/services/compiler-adapter.ts`
- Create: `navi-next/src/services/__tests__/compiler-adapter.test.ts`

**Interfaces:**
- Produces: `class CampusCompilerAdapter implements CompilerAdapter` with `compile(document: CampusDocument): Promise<CompileResult>`
- Consumes: `CompilerAdapter` from `@navi/editor/services/navigation-compiler`, `CampusCompiler` from `@navi/compiler`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { CampusCompilerAdapter } from '../compiler-adapter'
import { createGoldenCampus } from '../../packages/editor/src/demo/golden-campus'

describe('CampusCompilerAdapter', () => {
  it('compiles a valid campus document', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = createGoldenCampus()
    const result = await adapter.compile(doc)
    expect(result.status).toBe('success')
  })

  it('returns artifacts with navigationGraph', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = createGoldenCampus()
    const result = await adapter.compile(doc)
    expect(result.artifacts?.navigationGraph).toBeDefined()
    expect(result.artifacts?.searchIndex).toBeDefined()
    expect(result.artifacts?.poiData).toBeDefined()
    expect(result.artifacts?.buildingIndex).toBeDefined()
  })

  it('returns node count > 0', async () => {
    const adapter = new CampusCompilerAdapter()
    const doc = createGoldenCampus()
    const result = await adapter.compile(doc)
    const graph = result.artifacts?.navigationGraph as any
    expect(graph.nodes.length).toBeGreaterThan(0)
  })

  it('fails gracefully with null doc', async () => {
    const adapter = new CampusCompilerAdapter()
    const result = await adapter.compile(null as any)
    expect(result.status).toBe('error')
    expect(result.message).toBeDefined()
  })
})
```

Run: `npx vitest run src/services/__tests__/compiler-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Create the adapter**

```typescript
import { CampusCompiler } from '@navi/compiler'
import { buildSearchIndex, buildPOIData, buildBuildingIndex } from '@navi/compiler'
import type { CampusDocument } from '@navi/core'
import type { CompilerAdapter, CompileResult } from '@navi/editor/services/navigation-compiler'

export class CampusCompilerAdapter implements CompilerAdapter {
  async compile(document: CampusDocument): Promise<CompileResult> {
    try {
      const compiler = new CampusCompiler({
        nodeInterval: 5,
        mergeThreshold: 3,
        optimizationLevel: 'moderate',
        includeAccessibility: false,
      })

      const result = compiler.compile(document)

      if (!result.success || !result.graph) {
        return {
          status: 'error',
          message: result.errors.map(e => e.message).join('; '),
          timestamp: Date.now(),
        }
      }

      const graph = result.graph
      const searchIndex = buildSearchIndex(document, graph)
      const poiData = buildPOIData(graph)
      const buildingIndex = buildBuildingIndex(document, graph)

      return {
        status: 'success',
        timestamp: Date.now(),
        artifacts: {
          navigationGraph: graph,
          searchIndex,
          poiData,
          buildingIndex,
        },
      }
    } catch (err) {
      return {
        status: 'error',
        message: (err as Error).message,
        timestamp: Date.now(),
      }
    }
  }
}
```

Run: `npx vitest run src/services/__tests__/compiler-adapter.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/compiler-adapter.ts src/services/__tests__/compiler-adapter.test.ts
git commit -m "feat(editor): add CampusCompilerAdapter for editor→compiler bridge"
```

---

### Task 4: Editor Publish Flow (D2)

**Files:**
- Modify: `navi-next/src/app/(studio)/layout.tsx` or `navi-next/src/components/studio/EditorBridge.tsx` — where editor services are bootstrapped
- Create: `navi-next/src/actions/publish.ts` (if using Next.js server action)

**Interfaces:**
- Consumes: `CampusCompilerAdapter` from Task 3, existing `NavigationCompiler` + `PublishService` + `PersistenceService` from `@navi/editor`

- [ ] **Step 1: Explore the current service bootstrap**

Read the EditorBridge or studio layout to find where services are created and registered. Determine where the CompilerAdapter should be injected into NavigationCompiler.

- [ ] **Step 2: Wire the adapter**

In the editor bootstrap code, create a `CampusCompilerAdapter` instance and pass it to `NavigationCompiler`:

```typescript
import { CampusCompilerAdapter } from '@/services/compiler-adapter'

// In the editor context creation:
const compilerAdapter = new CampusCompilerAdapter()
const navigationCompiler = new NavigationCompiler(compilerAdapter)
```

This makes the existing `PublishService` work end-to-end (validate → compile → publish).

- [ ] **Step 3: Add Publish button to editor toolbar or menu**

Locate the StudioToolbar or equivalent. Add a "Publish" button that calls `services.get('publish').publish()`. Show publish state (idle/validating/compiling/uploading/success/error).

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All existing tests still pass (zero regressions)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(editor): wire CampusCompilerAdapter and add Publish action"
```

---

### Task 5: Runtime Verification Page (D3)

**Files:**
- Create: `navi-next/src/app/demo/navigate/page.tsx`
- Create: `navi-next/src/app/api/demo/artifacts/route.ts` (API route to serve artifacts from demo-output/)

- [ ] **Step 1: Create API route to serve artifacts**

```typescript
// src/app/api/demo/artifacts/route.ts
import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ARTIFACTS_DIR = join(process.cwd(), 'demo-output')

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file') || 'manifest.json'

  const filePath = join(ARTIFACTS_DIR, file)
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const content = readFileSync(filePath, 'utf-8')
  return new NextResponse(content, {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: Create the verification page**

```typescript
// src/app/demo/navigate/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { ArtifactLoader, RuntimeEngine } from '@navi/runtime'
import type { Route } from '@navi/runtime'

export default function NavigatePage() {
  const [engine, setEngine] = useState<RuntimeEngine | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [route, setRoute] = useState<Route | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const loader = new ArtifactLoader({ baseUrl: '/api/demo/artifacts?file=' })
        const rt = await RuntimeEngine.create(loader)
        setEngine(rt)
      } catch (err) {
        setError((err as Error).message)
      }
    }
    load()
  }, [])

  const handleSearch = () => {
    if (!engine || !searchQuery.trim()) return
    const r = engine.search.query(searchQuery.trim(), { maxResults: 10 })
    setResults(r)
  }

  const handleRoute = () => {
    if (!engine || !fromId || !toId) return
    const r = engine.routing.findRoute(fromId, toId)
    setRoute(r)
  }

  if (error) {
    return <div className="p-8 text-red-500">Error: {error}</div>
  }

  if (!engine) {
    return <div className="p-8">Loading runtime engine...</div>
  }

  const graph = engine.data.getGraph()
  const buildings = engine.data.getBuildings()

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">NAVI Runtime — Verification Page</h1>

      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h2 className="font-semibold mb-2">Loaded Dataset</h2>
        <p>Campus: {graph.metadata.nodeCount} nodes, {graph.metadata.edgeCount} edges</p>
        <p>Buildings: {buildings.buildings.length}</p>
      </div>

      <div className="mb-6">
        <h2 className="font-semibold mb-2">Search</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search for a room (e.g., 101)"
            className="border rounded px-3 py-2 flex-1"
          />
          <button onClick={handleSearch} className="bg-blue-500 text-white px-4 py-2 rounded">
            Search
          </button>
        </div>

        {results.length > 0 && (
          <ul className="mt-2 border rounded divide-y">
            {results.map((r, i) => (
              <li key={i} className="px-3 py-2 flex justify-between items-center">
                <span>{r.entry.label} ({r.entry.type}) — score {r.score.toFixed(1)}</span>
                <button
                  onClick={() => setFromId(r.entry.nodeId)}
                  className="text-xs bg-gray-200 px-2 py-1 rounded mr-1"
                >
                  From
                </button>
                <button
                  onClick={() => setToId(r.entry.nodeId)}
                  className="text-xs bg-gray-200 px-2 py-1 rounded"
                >
                  To
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-6">
        <h2 className="font-semibold mb-2">Route</h2>
        <div className="flex gap-2 items-center">
          <span className="text-sm">From: {fromId ? graph.nodes.find(n => n.id === fromId)?.label || fromId : '(none)'}</span>
          <span>→</span>
          <span className="text-sm">To: {toId ? graph.nodes.find(n => n.id === toId)?.label || toId : '(none)'}</span>
          <button onClick={handleRoute} disabled={!fromId || !toId} className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50">
            Go
          </button>
        </div>

        {route && (
          <div className="mt-2 border rounded p-4">
            <p className="font-semibold">
              {route.fromLabel} → {route.toLabel}
            </p>
            <p className="text-sm text-gray-600">
              {Math.round(route.totalDistance)}m · ~{Math.round(route.totalDuration / 60)} min · {route.path.length} steps
            </p>
            <ol className="mt-2 space-y-1">
              {route.instructions.map((inst, i) => (
                <li key={i} className="text-sm">
                  <span className="font-mono text-xs text-gray-400">{inst.type.padEnd(10)}</span>
                  {inst.text}
                  {inst.distance > 0 && <span className="text-gray-400 ml-1">({Math.round(inst.distance)}m)</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="mt-8 p-4 bg-gray-50 rounded text-xs text-gray-500">
        <p><strong>Note:</strong> This is a verification page, not the final navigation UI. Its purpose is to prove the runtime can consume published artifacts.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run the Next.js dev server and verify the page loads**

Run: `npx tsx scripts/demo-e2e.ts` (first ensure artifacts exist)
Then: `npm run dev`
Visit: `http://localhost:3000/demo/navigate`
Verify: Page loads, search works, route displays correctly

- [ ] **Step 4: Commit**

```bash
git add src/app/demo/
git commit -m "feat(web): add Runtime Verification Page at /demo/navigate"
```

---

### Task 6: Integration Test (D4)

**Files:**
- Create: `navi-next/__tests__/walking-skeleton.test.ts`

- [ ] **Step 1: Write the integration test with stage-level assertions**

```typescript
import { describe, it, expect } from 'vitest'
import { CampusCompiler } from '@navi/compiler'
import { buildSearchIndex, buildPOIData, buildBuildingIndex } from '@navi/compiler'
import { RuntimeEngine } from '@navi/runtime'
import { ArtifactLoader } from '@navi/runtime'
import { createGoldenCampus } from '../packages/editor/src/demo/golden-campus'

describe('Walking Skeleton — End-to-End Pipeline', () => {
  // ── Stage 1: CampusDocument ──
  describe('CampusDocument', () => {
    it('is valid', () => {
      const campus = createGoldenCampus()
      expect(campus.schemaVersion).toBe(1)
      expect(campus.buildings).toHaveLength(1)
      expect(campus.buildings[0].floors).toHaveLength(1)
      expect(campus.buildings[0].floors[0].rooms).toHaveLength(2)
      expect(campus.buildings[0].floors[0].hallways).toHaveLength(1)
      expect(campus.buildings[0].floors[0].entrances).toHaveLength(1)
    })
  })

  // ── Stage 2: Compiler ──
  describe('Compiler', () => {
    it('creates graph with ≥4 nodes and ≥3 edges', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({
        nodeInterval: 5, mergeThreshold: 3,
        optimizationLevel: 'moderate', includeAccessibility: false,
      })
      const result = compiler.compile(campus)
      expect(result.success).toBe(true)
      expect(result.graph).not.toBeNull()
      const graph = result.graph!
      expect(graph.nodes.length).toBeGreaterThanOrEqual(4)
      expect(graph.edges.length).toBeGreaterThanOrEqual(3)
    })

    it('produces non-empty checksum', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({
        nodeInterval: 5, mergeThreshold: 3,
        optimizationLevel: 'moderate', includeAccessibility: false,
      })
      const result = compiler.compile(campus)
      expect(result.graph!.checksum).toBeTruthy()
    })

    it('produces deterministic output', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({
        nodeInterval: 5, mergeThreshold: 3,
        optimizationLevel: 'moderate', includeAccessibility: false,
      })
      const r1 = compiler.compile(campus)
      const r2 = compiler.compile(campus)
      // createdAt will differ so just compare nodes/edges
      expect(r1.graph!.nodes).toEqual(r2.graph!.nodes)
      expect(r1.graph!.edges).toEqual(r2.graph!.edges)
    })
  })

  // ── Stage 3: Artifacts ──
  describe('Artifacts', () => {
    it('buildSearchIndex produces entries', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const index = buildSearchIndex(campus, result.graph!)
      expect(index.entries.length).toBeGreaterThan(0)
    })

    it('buildPOIData produces points', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const poi = buildPOIData(result.graph!)
      expect(poi.points.length).toBeGreaterThan(0)
    })

    it('buildBuildingIndex produces one building', () => {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const bIndex = buildBuildingIndex(campus, result.graph!)
      expect(bIndex.buildings).toHaveLength(1)
    })
  })

  // ── Stage 4: Runtime ──
  describe('Runtime', () => {
    async function createTestRuntime() {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const graph = result.graph!
      const searchIndex = buildSearchIndex(campus, graph)
      const poiData = buildPOIData(graph)
      const buildingIndex = buildBuildingIndex(campus, graph)

      // In-memory artifact loading
      const artifacts: Record<string, string> = {
        'manifest.json': JSON.stringify({ campusId: 'Demo Campus', artifacts: {} }),
        'navigation.graph.json': JSON.stringify(graph),
        'search.index.json': JSON.stringify(searchIndex),
        'poi.json': JSON.stringify(poiData),
        'building-index.json': JSON.stringify(buildingIndex),
      }

      const fetch = (url: string) => {
        const file = url.split('=').pop() || 'manifest.json'
        const body = artifacts[file]
        return body
          ? Promise.resolve(new Response(body, { status: 200 }))
          : Promise.resolve(new Response('Not found', { status: 404 }))
      }

      const loader = new ArtifactLoader({ baseUrl: 'http://test/', fetch })
      return await RuntimeEngine.create(loader)
    }

    it('loads without error', async () => {
      const engine = await createTestRuntime()
      expect(engine).toBeDefined()
    })

    it('has correct node/edge count', async () => {
      const engine = await createTestRuntime()
      const graph = engine.data.getGraph()
      expect(graph.metadata.nodeCount).toBeGreaterThanOrEqual(4)
      expect(graph.metadata.edgeCount).toBeGreaterThanOrEqual(3)
    })
  })

  // ── Stage 5: Search ──
  describe('Search', () => {
    async function createEngine() {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const graph = result.graph!
      const artifacts: Record<string, string> = {
        'manifest.json': JSON.stringify({ campusId: 'Demo Campus', artifacts: {} }),
        'navigation.graph.json': JSON.stringify(graph),
        'search.index.json': JSON.stringify(buildSearchIndex(campus, graph)),
        'poi.json': JSON.stringify(buildPOIData(graph)),
        'building-index.json': JSON.stringify(buildBuildingIndex(campus, graph)),
      }
      const fetch = (url: string) => {
        const file = url.split('=').pop() || 'manifest.json'
        return artifacts[file]
          ? Promise.resolve(new Response(artifacts[file], { status: 200 }))
          : Promise.resolve(new Response('Not found', { status: 404 }))
      }
      return await RuntimeEngine.create(new ArtifactLoader({ baseUrl: 'http://test/', fetch }))
    }

    it('finds Room 101 by searching "101"', async () => {
      const engine = await createEngine()
      const results = engine.search.query('101', { maxResults: 5 })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.entry.label === 'Room 101')).toBe(true)
    })

    it('returns empty for nonexistent query', async () => {
      const engine = await createEngine()
      const results = engine.search.query('ZZZ_NONEXISTENT', { maxResults: 5 })
      expect(results).toHaveLength(0)
    })
  })

  // ── Stage 6: Route ──
  describe('Route', () => {
    async function createEngine() {
      const campus = createGoldenCampus()
      const compiler = new CampusCompiler({ nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: false })
      const result = compiler.compile(campus)
      const graph = result.graph!
      const artifacts: Record<string, string> = {
        'manifest.json': JSON.stringify({ campusId: 'Demo Campus', artifacts: {} }),
        'navigation.graph.json': JSON.stringify(graph),
        'search.index.json': JSON.stringify(buildSearchIndex(campus, graph)),
        'poi.json': JSON.stringify(buildPOIData(graph)),
        'building-index.json': JSON.stringify(buildBuildingIndex(campus, graph)),
      }
      const fetch = (url: string) => {
        const file = url.split('=').pop() || 'manifest.json'
        return artifacts[file]
          ? Promise.resolve(new Response(artifacts[file], { status: 200 }))
          : Promise.resolve(new Response('Not found', { status: 404 }))
      }
      return await RuntimeEngine.create(new ArtifactLoader({ baseUrl: 'http://test/', fetch }))
    }

    it('finds a path from Room 101 to Room 102', async () => {
      const engine = await createEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      expect(fromNode).toBeDefined()
      expect(toNode).toBeDefined()

      const route = engine.routing.findRoute(fromNode!.id, toNode!.id)
      expect(route).not.toBeNull()
    })

    it('path has ≥3 steps', async () => {
      const engine = await createEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.routing.findRoute(fromNode!.id, toNode!.id)!
      expect(route.path.length).toBeGreaterThanOrEqual(3)
    })

    it('instructions contain "walk" type', async () => {
      const engine = await createEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.routing.findRoute(fromNode!.id, toNode!.id)!
      const walkTypes = route.instructions.filter(i => i.type === 'walk')
      expect(walkTypes.length).toBeGreaterThan(0)
    })

    it('totalDistance > 0', async () => {
      const engine = await createEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.routing.findRoute(fromNode!.id, toNode!.id)!
      expect(route.totalDistance).toBeGreaterThan(0)
    })

    it('arrival instruction present', async () => {
      const engine = await createEngine()
      const nodes = engine.data.getGraph().nodes
      const fromNode = nodes.find(n => n.label === 'Room 101')
      const toNode = nodes.find(n => n.label === 'Room 102')
      const route = engine.routing.findRoute(fromNode!.id, toNode!.id)!
      const arrive = route.instructions.find(i => i.type === 'arrive')
      expect(arrive).toBeDefined()
      expect(arrive!.text).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run __tests__/walking-skeleton.test.ts`
Expected: All 13 tests pass (1 CampusDocument, 3 Compiler, 3 Artifacts, 2 Runtime, 2 Search, 5 Route)

- [ ] **Step 3: Verify full test suite still passes**

Run: `npx vitest run`
Expected: All tests pass, zero regressions

- [ ] **Step 4: Commit**

```bash
git add __tests__/walking-skeleton.test.ts
git commit -m "test(e2e): add walking skeleton integration test with stage-level assertions"
```

---

### Plan Self-Review

- **Spec coverage**: D1 (Task 2), D2 (Tasks 3-4), D3 (Task 5), D4 (Task 6), Golden Campus (Task 1). All deliverables covered.
- **No placeholders**: All steps have complete code, exact paths, and commands.
- **Type consistency**: CompileResultV2 → CompileResult mapping in Task 3 matches both interfaces. buildSearchIndex/buildPOIData/buildBuildingIndex signatures match @navi/compiler exports.
