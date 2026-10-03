import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const { performance } = require('perf_hooks')

const OUT = join(__dirname, '..', 'benchmark-output')

interface StressResult {
  scale: string
  buildings: number
  rooms: number
  floors: number
  compilerOk: boolean
  routingOk: boolean
  searchOk: boolean
  compilerMs: number
  routingMs: number
  searchMs: number
  errors: string[]
}

function makeGraph(buildings: number, roomsPerFloor: number, floors: number) {
  const totalRooms = buildings * roomsPerFloor * floors
  const nodes: any[] = []
  const edges: any[] = []
  const baseLat = 14.0
  const baseLng = 121.0
  let nodeIdx = 0

  for (let b = 0; b < buildings; b++) {
    for (let f = 0; f < floors; f++) {
      for (let r = 0; r < roomsPerFloor; r++) {
        const id = `n${nodeIdx}`
        nodes.push({
          id,
          label: `Room ${b}-${f}-${r}`,
          type: 'space',
          position: { lng: baseLng + b * 0.003 + r * 0.0003, lat: baseLat + b * 0.002 + f * 0.0005 },
          floor: f,
          buildingId: `bld-${b}`,
          properties: {},
        })
        if (nodeIdx > 0) {
          edges.push({
            id: `e${nodeIdx}`,
            from: `n${nodeIdx - 1}`,
            to: id,
            type: 'walk',
            distance: 5,
            weight: 5,
          })
        }
        nodeIdx++
      }
    }
  }

  return {
    nodes, edges,
    version: '1.0.0',
    campusId: 'stress-test',
    createdAt: new Date().toISOString(),
    checksum: '',
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      buildings,
      floors,
      boundingBox: { minLng: baseLng, maxLng: baseLng + 0.1, minLat: baseLat, maxLat: baseLat + 0.1 },
    },
  }
}

function makeSearchIndex(nodeCount: number) {
  const entries: any[] = []
  for (let i = 0; i < nodeCount; i++) {
    entries.push({
      id: `e${i}`,
      label: `Room ${i}`,
      type: 'room',
      nodeId: `n${i}`,
      tags: ['room', `tag-${i % 20}`],
    })
  }
  return { version: '1.0.0', entries }
}

async function runScale(label: string, buildings: number, roomsPerFloor: number, floors: number): Promise<StressResult> {
  const errors: string[] = []
  const totalRooms = buildings * roomsPerFloor * floors
  const totalNodes = totalRooms

  console.log(`\n  Scale: ${label} (${buildings} buildings, ${totalRooms} rooms, ${floors} floors)`)

  // Compiler — uses the actual compile function on a synthetic CampusDocument
  const doc = generateCampusDoc(buildings, roomsPerFloor, floors)
  const config = { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate' as const, includeAccessibility: true }

  let compilerMs = 0
  try {
    const { compile } = require('@navi/compiler')
    const start = performance.now()
    const result = compile(doc, config)
    compilerMs = performance.now() - start
    console.log(`    compiler: ${compilerMs.toFixed(2)}ms (${result.report.spacesExtracted} spaces extracted)`)
  } catch (e: any) {
    errors.push(`Compiler: ${e.message}`)
    console.log(`    compiler: FAIL — ${e.message}`)
  }

  // Runtime — generate in-memory graph + search index
  const graph = makeGraph(buildings, roomsPerFloor, floors)
  const idx = makeSearchIndex(totalNodes)

  let routingMs = 0
  let searchMs = 0

  const { AStar, SearchEngine } = await import('@navi/runtime')

  try {
    const astar = new AStar(graph)
    const from = `n0`
    const to = `n${totalNodes - 1}`

    const rtStart = performance.now()
    const route = astar.findPath(from, to)
    routingMs = performance.now() - rtStart

    if (!route) {
      errors.push(`A* returned null for ${from} → ${to}`)
      console.log(`    routing: FAIL — return null`)
    } else {
      console.log(`    routing: ${routingMs.toFixed(2)}ms (${route.path.length} nodes, ${route.distance.toFixed(0)}m)`)
    }
  } catch (e: any) {
    errors.push(`AStar: ${e.message}`)
    console.log(`    routing: FAIL — ${e.message}`)
  }

  try {
    const engine = new SearchEngine(idx)

    const srStart = performance.now()
    const results = engine.query('Room')
    searchMs = performance.now() - srStart

    console.log(`    search:  ${searchMs.toFixed(2)}ms (${results.length} results)`)
  } catch (e: any) {
    errors.push(`SearchEngine: ${e.message}`)
    console.log(`    search:  FAIL — ${e.message}`)
  }

  return {
    scale: label,
    buildings,
    rooms: totalRooms,
    floors,
    compilerOk: errors.length === 0 || errors.every(e => !e.includes('Compiler')),
    routingOk: errors.length === 0 || errors.every(e => !e.includes('AStar')),
    searchOk: errors.length === 0 || errors.every(e => !e.includes('SearchEngine')),
    compilerMs,
    routingMs,
    searchMs,
    errors,
  }
}

function generateCampusDoc(buildings: number, roomsPerFloor: number, floorsPerBuilding: number): any {
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
        staircases: f < floorsPerBuilding - 1 ? [{ id: `stair-b${b}-${f}`, name: 'Staircase', position: { x: 2, y: 2 }, fromLevel: f, toLevel: f + 1, type: 'open' }] : [],
        elevators: [],
        entrances: f === 0 ? [{ id: `ent-b${b}`, label: `Entrance ${b}`, position: { lat: baseLat, lng: baseLng - 0.001 }, level: 0, type: 'main', hasQR: true, hasPanorama: false }] : [],
      })
    }

    results.push({
      id: `bld-${b}`,
      name: `Building ${b}`,
      code: `B${b}`,
      category: 'academic',
      description: '',
      footprint: { points: [{ lat: baseLat - 0.002, lng: baseLng - 0.002 }, { lat: baseLat + 0.002, lng: baseLng - 0.002 }, { lat: baseLat + 0.002, lng: baseLng + 0.002 }, { lat: baseLat - 0.002, lng: baseLng + 0.002 }, { lat: baseLat - 0.002, lng: baseLng - 0.002 }] },
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
    metadata: { name: 'stress-test', description: '', lastModified: new Date().toISOString(), editorVersion: '0.1.0' },
    buildings: results,
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

async function main() {
  console.log()
  console.log('='.repeat(70))
  console.log('  NAVI Stress Tests')
  console.log('='.repeat(70))

  const scales = [
    { label: '50 buildings / 500 rooms / 2 floors', buildings: 50, roomsPerFloor: 5, floors: 2 },
    { label: '50 buildings / 1000 rooms / 2 floors', buildings: 50, roomsPerFloor: 10, floors: 2 },
    { label: '50 buildings / 5000 rooms / 2 floors', buildings: 50, roomsPerFloor: 50, floors: 2 },
  ]

  const results: StressResult[] = []
  for (const s of scales) {
    const r = await runScale(s.label, s.buildings, s.roomsPerFloor, s.floors)
    results.push(r)
    if (r.errors.length > 0) {
      console.log(`    ⚠ ${r.errors.length} error(s)`)
    }
  }

  // Summary
  console.log()
  console.log('─'.repeat(70))
  console.log('  Stress Test Summary')
  console.log('─'.repeat(70))
  console.log()

  for (const r of results) {
    const status = (r.compilerOk && r.routingOk && r.searchOk) ? '✓' : '✗'
    console.log(`  ${status} ${r.scale.padEnd(40)} ${r.buildings.toString().padStart(4)}b  ${r.rooms.toString().padStart(5)}r`)
    if (!r.compilerOk) console.log(`       compiler: FAIL`)
    if (!r.routingOk) console.log(`       routing:  FAIL`)
    if (!r.searchOk) console.log(`       search:   FAIL`)
  }

  console.log()
  const ok = results.filter(r => r.compilerOk && r.routingOk && r.searchOk).length
  console.log(`  ${ok}/${results.length} scales passed`)

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'stress-test-results.json'), JSON.stringify(results, null, 2))
}

main().catch(console.error)
