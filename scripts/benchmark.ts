import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const { performance } = require('perf_hooks')

const OUT = join(__dirname, '..', 'benchmark-output')

interface BenchmarkResult {
  name: string
  value: number
  unit: string
  scale: string
  status: 'PASS' | 'FAIL' | 'INFO'
  threshold?: number
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} μs` : `${ms.toFixed(2)} ms`
}

function makeGraph(nodeCount: number) {
  const nodes: any[] = []
  const edges: any[] = []
  const baseLat = 14.0
  const baseLng = 121.0

  for (let i = 0; i < nodeCount; i++) {
    const floor = Math.floor(i / (nodeCount / 3))
    const row = Math.floor(i / 10)
    const col = i % 10
    nodes.push({
      id: `n${i}`,
      label: `Node ${i}`,
      type: 'space',
      position: { lng: baseLng + col * 0.0005, lat: baseLat + row * 0.0003 },
      floor,
      buildingId: 'bench',
      properties: {},
    })
    if (i > 0) {
      edges.push({
        id: `e${i}`,
        from: `n${i - 1}`,
        to: `n${i}`,
        type: 'walk',
        distance: 5,
        weight: 5,
      })
    }
  }

  return { nodes, edges, version: '1.0.0', campusId: 'bench', createdAt: '', checksum: '', metadata: { nodeCount, edgeCount: edges.length, buildings: 1, floors: 3, boundingBox: { minLng: baseLng, maxLng: baseLng + 0.005, minLat: baseLat, maxLat: baseLat + 0.003 } } }
}

function makeSearchIndex(entryCount: number) {
  const entries: any[] = []
  for (let i = 0; i < entryCount; i++) {
    entries.push({ id: `e${i}`, label: `Room ${i}`, type: 'room', nodeId: `n${i}`, tags: ['room'] })
  }
  return { version: '1.0.0', entries }
}

// ─── Compiler benchmark ──────────────────────────────────────────────

function benchmarkCompiler(): BenchmarkResult[] {
  // Build synthetic CampusDocument at scale
  const { compile } = require('@navi/compiler')

  const scales = [
    { buildings: 1, roomsPerFloor: 10, floors: 2, label: '1 building, 20 rooms' },
    { buildings: 10, roomsPerFloor: 25, floors: 2, label: '10 buildings, 500 rooms' },
    { buildings: 50, roomsPerFloor: 20, floors: 2, label: '50 buildings, 2000 rooms' },
  ]

  const results: BenchmarkResult[] = []

  for (const s of scales) {
    const doc = generateCampus(s.buildings, s.roomsPerFloor, s.floors)
    const config = { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate', includeAccessibility: true }

    const runs = 3
    const times: number[] = []
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      compile(doc, config)
      times.push(performance.now() - start)
    }
    const avg = times.reduce((a, b) => a + b, 0) / runs
    const rooms = countRooms(doc)
    results.push({ name: `Compilation`, value: avg, unit: 'ms', scale: s.label, status: avg < 5000 ? 'PASS' : 'FAIL', threshold: 5000 })
    results.push({ name: `  rooms`, value: rooms, unit: '', scale: s.label, status: 'INFO' })
  }

  return results
}

function generateCampus(buildings: number, roomsPerFloor: number, floorsPerBuilding: number): any {
  const results: any[] = []
  let roomIdx = 0

  for (let b = 0; b < buildings; b++) {
    const baseLat = 14.0 + b * 0.005
    const baseLng = 121.0 + b * 0.005
    const floorList: any[] = []

    for (let f = 0; f < floorsPerBuilding; f++) {
      const rooms = []
      for (let r = 0; r < roomsPerFloor; r++) {
        roomIdx++
        rooms.push({
          id: `rm-${roomIdx}`,
          name: `Room ${roomIdx}`,
          number: String(roomIdx),
          category: 'classroom',
          polygon: { points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }, { x: 2, y: 2 }] },
          capacity: 30,
          metadata: {},
        })
      }

      floorList.push({
        id: `flr-b${b}-${f}`,
        level: f,
        label: f === 0 ? 'Ground Floor' : `Floor ${f + 1}`,
        elevation: f * 4,
        rooms,
        hallways: [{
          id: `hlw-b${b}-${f}`,
          name: 'Main Hallway',
          polyline: { points: [{ x: 5, y: 0 }, { x: 5, y: roomsPerFloor * 8 + 4 }] },
          width: 3,
        }],
        staircases: f < floorsPerBuilding - 1 ? [{
          id: `stair-b${b}-${f}`,
          name: 'Staircase',
          position: { x: 2, y: 2 },
          fromLevel: f,
          toLevel: f + 1,
          type: 'open',
        }] : [],
        elevators: [],
        entrances: f === 0 ? [{
          id: `ent-b${b}`,
          label: `Building ${b} Entrance`,
          position: { lat: baseLat, lng: baseLng - 0.001 },
          level: 0,
          type: 'main',
          hasQR: true,
          hasPanorama: false,
        }] : [],
      })
    }

    results.push({
      id: `bld-${b}`,
      name: `Building ${b}`,
      code: `B${b}`,
      category: 'academic',
      description: `Synthetic building ${b}`,
      footprint: {
        points: [
          { lat: baseLat - 0.002, lng: baseLng - 0.002 },
          { lat: baseLat + 0.002, lng: baseLng - 0.002 },
          { lat: baseLat + 0.002, lng: baseLng + 0.002 },
          { lat: baseLat - 0.002, lng: baseLng + 0.002 },
          { lat: baseLat - 0.002, lng: baseLng - 0.002 },
        ],
      },
      baseElevation: 10,
      height: floorsPerBuilding * 4,
      floors: floorList,
      color: '#3b82f6',
      aliases: [],
      metadata: {},
    })
  }

  return {
    schemaVersion: 1,
    metadata: {
      name: `synthetic-campus-${buildings}b-${roomsPerFloor}r`,
      description: `Synthetic campus: ${buildings} buildings, ${roomsPerFloor} rooms/floor, ${floorsPerBuilding} floors`,
      lastModified: new Date().toISOString(),
      editorVersion: '0.1.0',
    },
    buildings: results,
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function countRooms(doc: any): number {
  return doc.buildings.reduce((s: number, b: any) => s + b.floors.reduce((s2: number, f: any) => s2 + f.rooms.length, 0), 0)
}

// ─── Runtime benchmarks (in-memory, no fixtures needed) ──────────────

async function benchmarkRuntime(): Promise<BenchmarkResult[]> {
  const { AStar, SearchEngine } = await import('@navi/runtime')
  const results: BenchmarkResult[] = []

  // Routing: AStar at various graph sizes
  const graphSizes = [10, 100, 1000]
  for (const size of graphSizes) {
    const graph = makeGraph(size)
    const astar = new AStar(graph)
    const runs = 20

    // Warm up
    astar.findPath('n0', `n${size - 1}`)

    const start = performance.now()
    for (let i = 0; i < runs; i++) {
      astar.findPath('n0', `n${size - 1}`)
    }
    const avg = (performance.now() - start) / runs
    const threshold = size <= 100 ? 1 : size <= 1000 ? 50 : 200
    results.push({ name: `A* routing (${size} nodes)`, value: avg, unit: 'ms', scale: `${size} nodes`, status: avg < threshold ? 'PASS' : 'FAIL', threshold })
  }

  // Search: various index sizes
  const indexSizes = [10, 100, 1000]
  for (const size of indexSizes) {
    const idx = makeSearchIndex(size)
    const engine = new SearchEngine(idx)
    const runs = 100
    const start = performance.now()
    for (let i = 0; i < runs; i++) {
      engine.query('Room')
    }
    const avg = (performance.now() - start) / runs
    results.push({ name: `Search (${size} entries)`, value: avg, unit: 'ms', scale: `${size} entries`, status: avg < 1 ? 'PASS' : 'FAIL', threshold: 1 })
  }

  // Memory: large graph + search index
  const bigGraph = makeGraph(5000)
  const bigIdx = makeSearchIndex(5000)
  const gcStarted = globalThis.gc ? true : false

  if (gcStarted) globalThis.gc!()

  const memBefore = process.memoryUsage().heapUsed
  const bigAstar = new AStar(bigGraph)
  const bigSearch = new SearchEngine(bigIdx)
  bigAstar.findPath('n0', 'n4999')
  bigSearch.query('Room')
  const memAfter = process.memoryUsage().heapUsed

  results.push({ name: `Memory (5000 nodes + 5000 entries)`, value: memAfter - memBefore, unit: 'MB', scale: '5000', status: 'INFO' })

  return results
}

// ─── Startup benchmark (from fixtures) ───────────────────────────────

async function benchmarkStartup(): Promise<BenchmarkResult[]> {
  const { join } = await import('path')
  const FIXTURES = join(__dirname, '..', 'packages', 'runtime', 'test', 'fixtures')

  const { load, RuntimeEngine } = await import('@navi/runtime')

  const runs = 5
  const times: number[] = []

  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    const result = await load(FIXTURES)
    if (result.success) {
      new RuntimeEngine(result.package)
    }
    times.push(performance.now() - start)
  }

  const avg = times.reduce((a, b) => a + b, 0) / runs
  return [{ name: 'Runtime startup (fixtures)', value: avg, unit: 'ms', scale: '5 nodes, 1 entry', status: avg < 100 ? 'PASS' : 'FAIL', threshold: 100 }]
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const allResults: BenchmarkResult[] = []

  console.log()
  console.log('='.repeat(70))
  console.log('  NAVI Performance Benchmarks')
  console.log('='.repeat(70))

  // Memory baseline
  const mem = process.memoryUsage()
  allResults.push({ name: 'Baseline heap used', value: mem.heapUsed, unit: 'MB', scale: 'process', status: 'INFO' })

  // Compiler
  console.log('\n  [Compiler]')
  allResults.push(...benchmarkCompiler())

  // Runtime
  console.log('\n  [Runtime]')
  const runtimeResults = await benchmarkRuntime()
  allResults.push(...runtimeResults)

  // Startup
  console.log('\n  [Startup]')
  const startupResults = await benchmarkStartup()
  allResults.push(...startupResults)

  // Results table
  console.log()
  console.log('─'.repeat(70))
  console.log('  Summary')
  console.log('─'.repeat(70))

  for (const r of allResults) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '·'
    const val = r.unit === 'ms' ? formatMs(r.value) : r.unit === 'MB' ? formatBytes(r.value) : String(r.value)
    const thresholdStr = r.threshold ? ` (≤ ${r.threshold}${r.unit})` : ''
    console.log(`  ${icon} ${r.name.padEnd(32)} ${val.padStart(10)}  ${r.scale}${thresholdStr}`)
  }

  const pass = allResults.filter(r => r.status === 'PASS').length
  const fail = allResults.filter(r => r.status === 'FAIL').length
  console.log()
  console.log('─'.repeat(70))
  console.log(`  ${pass} passed, ${fail} failed, ${allResults.length - pass - fail} info`)
  console.log('='.repeat(70))
  console.log()

  // Save
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'benchmark-results.json'), JSON.stringify(allResults, null, 2))
}

main().catch(console.error)
