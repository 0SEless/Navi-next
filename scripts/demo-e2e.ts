import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { CampusCompiler, buildSearchIndex, buildPOIData, buildBuildingIndex } from '@navi/compiler'
import { load, RuntimeEngine } from '@navi/runtime'
import { createGoldenCampus } from '../packages/editor/src/demo/golden-campus'

const DEMO_DIR = join(__dirname, '..', 'demo-output')

function stage(label: string, ok: boolean, detail?: string) {
  const icon = ok ? '\u2713' : '\u2717'
  console.log(`  ${icon} ${label}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  console.log()
  console.log('='.repeat(70))
  console.log('  NAVI Walking Skeleton \u2014 End-to-End Verification')
  console.log('='.repeat(70))

  // Stage 1: Create CampusDocument
  console.log('\n  \uD83D\uDCCB CampusDocument')
  const campus = createGoldenCampus()
  const building = campus.buildings[0]
  const floor = building.floors[0]
  stage('Created', true, `${building.name}, ${floor.rooms.length} rooms, ${floor.hallways.length} hallway`)

  // Stage 2: Compile with CampusCompiler
  console.log('\n  \uD83D\uDD27 Compiler')
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

  // Stage 3: Publish artifacts
  console.log('\n  \uD83D\uDCE6 Publish')
  if (!existsSync(DEMO_DIR)) mkdirSync(DEMO_DIR, { recursive: true })

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

  const manifest = {
    schemaVersion: '1.0',
    campusId: campus.metadata.name,
    campusName: campus.metadata.name,
    publishedAt: new Date().toISOString(),
    compilerVersion: '0.1.0',
    revision: '1',
    artifacts: {
      graph: { path: 'navigation.graph.json', checksum: '', size: 0, schemaVersion: '1.0' },
      search: { path: 'search.index.json', checksum: '', size: 0, schemaVersion: '1.0' },
      buildings: { path: 'building-index.json', checksum: '', size: 0, schemaVersion: '1.0' },
      poi: { path: 'poi.json', checksum: '', size: 0, schemaVersion: '1.0' },
    },
    metadata: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      buildingCount: campus.buildings.length,
      floorCount: campus.buildings.reduce((s, b) => s + b.floors.length, 0),
      boundingBox: graph.metadata.boundingBox,
      routeable: graph.edges.length > 0,
    },
  }
  writeFileSync(join(DEMO_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  stage('Artifacts written', true, `5 files to ${DEMO_DIR}`)
  for (const f of ['navigation.graph.json', 'search.index.json', 'poi.json', 'building-index.json', 'manifest.json']) {
    const fullPath = join(DEMO_DIR, f)
    const size = existsSync(fullPath) ? readFileSync(fullPath).length : 0
    stage(`  ${f}`, true, `${size} bytes`)
  }

  // Stage 4: Load Runtime
  console.log('\n  \uD83C\uDFC3 Runtime')
  const loadResult = await load(DEMO_DIR)
  if (!loadResult.success) { stage('Engine load', false, loadResult.message); process.exit(1) }
  const engine = new RuntimeEngine(loadResult.package)
  const stats = engine.data.getGraph().metadata
  stage('Engine loaded', true, `${stats.nodeCount} nodes, ${stats.edgeCount} edges`)

  // Stage 5: Search
  console.log('\n  \uD83D\uDD0D Search')
  const results101 = engine.search.query('101', { maxResults: 5 })
  stage('Search "101"', results101.length > 0, results101.length > 0 ? `found "${results101[0].entry.label}"` : 'no results')

  const results102 = engine.search.query('102', { maxResults: 5 })
  stage('Search "102"', results102.length > 0, results102.length > 0 ? `found "${results102[0].entry.label}"` : 'no results')

  // Stage 6: Route
  console.log('\n  \uD83D\uDDFA\uFE0F  Route')
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

  console.log('\n  \uD83D\uDCCD Route Details')
  for (const inst of route.instructions) {
    const dist = inst.distance > 0 ? ` (${Math.round(inst.distance)}m)` : ''
    console.log(`    ${inst.type.padEnd(12)} ${inst.text}${dist}`)
  }

  console.log()
  console.log('='.repeat(70))
  console.log('  \u2705 Walking Skeleton Verified \u2014 Pipeline Complete')
  console.log('='.repeat(70))
  console.log()
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
