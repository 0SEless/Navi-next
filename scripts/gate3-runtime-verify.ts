import { join } from 'path'
import { load, RuntimeEngine } from '@navi/runtime'
import { createGoldenCampus } from '../packages/editor/src/demo/golden-campus'

const DEMO_DIR = join(__dirname, '..', 'demo-output')
const BASE = 'http://localhost:3000'

function stage(label: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('  GATE 3 — Runtime loop (via real /api/compile + /api/publish)')
  console.log('='.repeat(70))

  const campus = createGoldenCampus()
  console.log('\n  \uD83D\uDCCB Campus')
  stage('Golden campus', true, `${campus.buildings[0].name}, ${campus.buildings[0].floors[0].rooms.length} rooms`)

  // Stage: compile through the real editor endpoint (same as studio)
  console.log('\n  \uD83D\uDD27 /api/compile')
  const compileRes = await fetch(`${BASE}/api/compile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: campus }),
  })
  if (!compileRes.ok) { stage('compile request', false, `HTTP ${compileRes.status}`); process.exit(1) }
  const resp = await compileRes.json()
  const artifacts = resp.artifacts
  const hasAll = artifacts && artifacts.navigationGraph && artifacts.searchIndex && artifacts.poiData && artifacts.buildingIndex
  stage('All 4 artifacts returned', !!hasAll)

  // Stage: publish through the real endpoint (same as EditorBridge.publish)
  console.log('\n  \uD83D\uDCE6 /api/publish')
  const pubRes = await fetch(`${BASE}/api/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifacts }),
  })
  const pub = await pubRes.json().catch(() => ({}))
  stage('publish success', pubRes.ok && pub.success === true, pub.version)

  // Stage: load published bundle into runtime
  console.log('\n  \uD83C\uDFC3 Runtime load')
  const loadResult = await load(DEMO_DIR)
  if (!loadResult.success) { stage('Engine load', false, loadResult.message); process.exit(1) }
  const engine = new RuntimeEngine(loadResult.package)
  const stats = engine.data.getGraph().metadata
  stage('Engine loaded', stats.nodeCount > 0, `${stats.nodeCount} nodes, ${stats.edgeCount} edges`)

  // Stage: search
  console.log('\n  \uD83D\uDD0D Search')
  const r101 = engine.search.query('101', { maxResults: 5 })
  stage('Search "101"', r101.length > 0, r101.length ? r101[0].entry.label : 'none')
  const r102 = engine.search.query('102', { maxResults: 5 })
  stage('Search "102"', r102.length > 0, r102.length ? r102[0].entry.label : 'none')

  // Stage: route
  console.log('\n  \uD83D\uDDFA\uFE0F  Route')
  const nodes = engine.data.getGraph().nodes
  const a = nodes.find(n => n.label === 'Room 101')
  const b = nodes.find(n => n.label === 'Room 102')
  if (!a || !b) { stage('Route', false, 'missing nodes'); process.exit(1) }
  const route = engine.routing.findRoute(a.id, b.id)
  stage('Route exists', !!route, route ? `${Math.round(route.totalDistance)}m, ${route.instructions.length} steps` : 'none')

  const ok = stats.nodeCount > 0 && r101.length > 0 && r102.length > 0 && !!route
  console.log('\n' + '='.repeat(70))
  console.log(`  ${ok ? '\u2705' : '\u2717'} Gate 3 runtime loop ${ok ? 'VERIFIED' : 'FAILED'}`)
  console.log('='.repeat(70) + '\n')
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
