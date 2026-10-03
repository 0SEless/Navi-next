import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { compile } from '@navi/compiler'
import { publish } from '@navi/compiler/publisher'
import type { CampusDocument } from '@navi/core'

const DEMO_DIR = join(__dirname, '..', 'demo-output')

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`)
}

async function main() {
  const campusPath = process.argv[2] || 'campus-output/asu-ibajay.json'

  console.log()
  console.log('='.repeat(70))
  console.log('  NAVI End-to-End Demonstration')
  console.log('='.repeat(70))

  // ── Stage 1: Load Campus ──
  log('1/7', `Loading campus: ${campusPath}`)
  const json = readFileSync(resolve(campusPath), 'utf-8')
  const campus: CampusDocument = JSON.parse(json)
  const roomCount = campus.buildings.reduce((s, b) => s + b.floors.reduce((s2, f) => s2 + f.rooms.length, 0), 0)
  log('1/7', `${campus.buildings.length} buildings, ${roomCount} rooms, ${campus.roads.length} roads`)

  // ── Stage 2: Compile ──
  log('2/7', 'Compiling navigation graph...')
  const config = { nodeInterval: 5, mergeThreshold: 3, optimizationLevel: 'moderate' as const, includeAccessibility: true }
  const result = compile(campus, config)
  log('2/7', `Done in ${result.duration.toFixed(2)}ms — ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges`)

  // ── Stage 3: Publish ──
  log('3/7', 'Publishing artifacts...')
  if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true })
  const manifest = publish(campus, result, { outDir: DEMO_DIR })
  log('3/7', `Published to ${DEMO_DIR}/`)
  for (const [key, art] of Object.entries(manifest.artifacts)) {
    log('3/7', `  ${art.path} (${art.size} bytes)`)
  }

  // ── Stage 4: Load Runtime ──
  log('4/7', 'Loading runtime engine...')
  const { load, RuntimeEngine } = await import('@navi/runtime')

  const loadResult = await load(DEMO_DIR)
  if (!loadResult.success) { log('4/7', `Load failed: ${loadResult.message}`); process.exit(1) }
  const engine = new RuntimeEngine(loadResult.package)

  const campusId = engine.data.getCampusId()
  const buildings = engine.data.getBuildings().buildings
  const bbox = engine.data.getBoundingBox()
  log('4/7', `Campus: ${campusId}, ${buildings.length} buildings`)
  log('4/7', `Bounds: ${bbox.minLat.toFixed(4)},${bbox.minLng.toFixed(4)} — ${bbox.maxLat.toFixed(4)},${bbox.maxLng.toFixed(4)}`)

  // ── Stage 5: Search ──
  log('5/7', 'Searching for destinations...')
  const searchTerms = ['Room', 'Lobby', 'Entrance']
  for (const term of searchTerms) {
    const results = engine.search.query(term, { maxResults: 5 })
    log('5/7', `  "${term}": ${results.length} results`)
    for (const r of results.slice(0, 3)) {
      log('5/7', `    → ${r.entry.label} (score: ${r.score.toFixed(1)})`)
    }
  }

  // ── Stage 6: Route ──
  log('6/7', 'Computing routes...')
  const nodes = engine.data.getGraph().nodes
  if (nodes.length >= 2) {
    const fromId = nodes[0].id
    const toId = nodes[nodes.length - 1].id
    log('6/7', `  From: ${nodes[0].label} (${fromId})`)
    log('6/7', `  To:   ${nodes[nodes.length - 1].label} (${toId})`)

    const route = engine.routing.findRoute(fromId, toId)
    if (route) {
      log('6/7', `  Distance: ${Math.round(route.totalDistance)}m, ETA: ${Math.round(route.totalDuration / 60)} min`)
      log('6/7', `  Path: ${route.path.length} steps, ${route.instructions.length} instructions`)
      for (const inst of route.instructions) {
        const dist = inst.distance > 0 ? ` (${Math.round(inst.distance)}m)` : ''
        log('6/7', `    ${inst.type.padEnd(12)} ${inst.text}${dist}`)
      }
    } else {
      log('6/7', '  No route found')
    }
  } else {
    log('6/7', '  Not enough nodes for routing')
  }

  // ── Stage 7: GPS + Position ──
  log('7/7', 'Simulating GPS positioning...')
  const campusNodes = engine.data.getGraph().nodes
  if (campusNodes.length > 0) {
    const pos = campusNodes[Math.floor(campusNodes.length / 2)].position
    engine.position.updateGps(pos)
    const currentPos = engine.position.getCurrentPosition()
    if (currentPos) {
      log('7/7', `  Position: ${currentPos.latlng.lat.toFixed(5)}, ${currentPos.latlng.lng.toFixed(5)}`)
      log('7/7', `  Snapped to: ${currentPos.nodeId} (floor ${currentPos.floor})`)
      log('7/7', `  Building: ${currentPos.buildingId}`)
    }
  }

  console.log()
  console.log('='.repeat(70))
  console.log('  Demonstration Complete')
  console.log('='.repeat(70))
  console.log()
}

main().catch(console.error)
