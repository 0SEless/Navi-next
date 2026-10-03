import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const mapId = 'asu-ibajay'
const STUDIO_URL = `http://localhost:3000/studio/${mapId}/edit`
const DEMO = join(process.cwd(), 'demo-output')

const seedGraph = {
  id: mapId, campusId: mapId, name: 'Test Campus',
  version: '1.0.0', updatedAt: new Date().toISOString(),
  center: { lat: 11.0008, lng: 125.0015 }, zoom: 16,
  buildings: [{
    id: 'b1', name: 'Building One', code: 'B1', color: '#1C6BEB', height: 30,
    floors: [{ id: 'flr-0', level: 0, label: 'Ground Floor', elevation: 0 }],
    footprint: [{ lat: 11.0009, lng: 125.0016 }, { lat: 11.0012, lng: 125.0016 }, { lat: 11.0012, lng: 125.0020 }, { lat: 11.0009, lng: 125.0020 }],
    entrances: [{ id: 'e1', name: 'Main Entrance', position: { lat: 11.00105, lng: 125.0018 }, floor: 0 }],
  }],
  nodes: [], edges: [], components: [
    {
      id: 'room-r101', type: 'room', name: 'Room 101', buildingId: 'b1', floor: 0,
      polygon: [{ lat: 11.00092, lng: 125.00165 }, { lat: 11.00100, lng: 125.00165 }, { lat: 11.00100, lng: 125.00175 }, { lat: 11.00092, lng: 125.00175 }],
      width: 8, height: 6, category: 'classroom',
    },
    {
      id: 'room-r102', type: 'room', name: 'Room 102', buildingId: 'b1', floor: 0,
      polygon: [{ lat: 11.00108, lng: 125.00185 }, { lat: 11.00116, lng: 125.00185 }, { lat: 11.00116, lng: 125.00195 }, { lat: 11.00108, lng: 125.00195 }],
      width: 8, height: 6, category: 'classroom',
    },
    {
      id: 'hallway-h1', type: 'hallway', name: 'Main Hallway', buildingId: 'b1', floor: 0,
      polygon: [{ lat: 11.00096, lng: 125.00162 }, { lat: 11.00096, lng: 125.00178 }, { lat: 11.00112, lng: 125.00178 }, { lat: 11.00112, lng: 125.00162 }],
      width: 3,
    },
    {
      id: 'e1', type: 'entrance', name: 'Main Entrance', buildingId: 'b1', floor: 0,
      position: { lat: 11.00105, lng: 125.0018 },
    },
  ],
  traces: [],
}

function stage(label, ok, detail) {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` (${detail})` : ''}`)
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))

  // Mock API routes to return our seeded data (essential to bypass DB fetch clobbering)
  await page.route('**/api/graph', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedGraph) }))
  await page.route('**/api/campus-maps', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ maps: [{
      id: mapId, name: 'Test Campus', schoolName: 'Test University',
      boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
      center: { lat: 11.0008, lng: 125.0015 },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      stats: { buildings: 1, nodes: 0, edges: 0 },
    }] }) }))

  // Seed the graph + campus data (only if absent)
  await context.addInitScript((args) => {
    const { mapId, seedGraph } = args
    const graphKey = `navi-graph-${mapId}`
    const campusKey = 'navi-campus-maps'
    const now = new Date().toISOString()
    localStorage.setItem(graphKey, JSON.stringify(seedGraph))
    localStorage.setItem(campusKey, JSON.stringify({
      maps: [{
        id: mapId, name: 'Test Campus', schoolName: 'Test University',
        boundary: [{ lat: 11.000, lng: 125.000 }, { lat: 11.002, lng: 125.004 }],
        center: { lat: 11.0008, lng: 125.0015 },
        createdAt: now, updatedAt: now,
        stats: { buildings: 1, nodes: 0, edges: 0 },
      }],
      landmarkTypes: [],
      landmarkInstances: [],
    }))
  }, { mapId, seedGraph })

  console.log('\n=== GATE 4B — STUDIO PUBLISH WORKFLOW ===\n')

  // 1. Navigate to studio edit page
  console.log('1. Loading studio editor...')
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(2000)

  // If redirected to login page, use mock auth
  if (page.url().includes('/login')) {
    console.log('  Redirected to login. Performing mock login...')
    await page.click('text=Dr. Admin')
    await page.waitForTimeout(3000)
    console.log('  Logged in, loading editor...')
    await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(2000)
  }

  // Wait for the editor context to initialize (StoreInitializer loads from localStorage in useEffect)
  console.log('  Waiting for editor context...')
  let editorReady = false
  for (let i = 0; i < 40; i++) {
    const attr = await page.evaluate(() => !!document.querySelector('[data-editor-ready]'))
    if (attr) { editorReady = true; break }
    await page.waitForTimeout(500)
  }
  stage('Editor initialized', editorReady)

  // 2. Click Publish
  console.log('\n2. Publishing...')
  const publishBtn = page.locator('button', { hasText: 'Publish' })
  const publishCount = await publishBtn.count()
  stage('Publish button visible', publishCount > 0, `${publishCount} found`)

  if (publishCount > 0) {
    await publishBtn.first().click()
    await page.waitForTimeout(3000)

    // Check if we hit validation_errors
    const publishAnywayBtn = page.locator('button', { hasText: 'Publish Anyway' })
    const paCount = await publishAnywayBtn.count()
    if (paCount > 0) {
      console.log('\n  Validation errors detected — clicking "Publish Anyway"...')
      await publishAnywayBtn.first().click()
      await page.waitForTimeout(3000)
      stage('Publish Anyway clicked', true)
    }
  }

  // 3. Verify success dialog
  console.log('\n3. Checking publish result...')
  const successDialog = page.locator('h2', { hasText: 'Publish Successful' })
  const dialogVisible = await successDialog.count()
  stage('Publish success dialog appears', dialogVisible > 0)

  if (dialogVisible > 0) {
    const dialogContent = await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50')
      if (!modal) return null
      const text = modal.textContent || ''
      const revision = text.match(/Revision:\s*(\d+)/)?.[1]
      const nodes = text.match(/Nodes:\s*(\d+)/)?.[1]
      const edges = text.match(/Edges:\s*(\d+)/)?.[1]
      const compileTime = text.match(/Compile time:\s*([\d.]+)s/)?.[1]
      const artifacts = text.match(/Artifacts:\s*(\d+)/)?.[1]
      const location = text.match(/Location:\s*(.+)/)?.[1]
      return { revision, nodes, edges, compileTime, artifacts, location }
    })
    stage('Revision shown', !!dialogContent?.revision, dialogContent?.revision ?? 'N/A')
    stage('Node count shown', !!dialogContent?.nodes, dialogContent?.nodes ?? 'N/A')
    stage('Edge count shown', !!dialogContent?.edges, dialogContent?.edges ?? 'N/A')
    stage('Compile time shown', !!dialogContent?.compileTime, dialogContent?.compileTime ? `${dialogContent.compileTime}s` : 'N/A')
    stage('Artifact count shown', !!dialogContent?.artifacts, dialogContent?.artifacts ?? 'N/A')
    stage('Location shown', dialogContent?.location?.includes('demo-output') ?? false, dialogContent?.location ?? 'N/A')

    const closeBtn = page.locator('button', { hasText: 'Close' })
    if (await closeBtn.count() > 0) await closeBtn.first().click()
    await page.waitForTimeout(500)
  }

  // 4. Verify published artifacts on disk
  console.log('\n4. Verifying published artifacts...')
  const artifactFiles = ['navigation.graph.json', 'search.index.json', 'poi.json', 'building-index.json', 'manifest.json']
  const artifactResults = {}
  for (const f of artifactFiles) {
    const exists = existsSync(join(DEMO, f))
    artifactResults[f] = exists
    stage(`Artifact: ${f}`, exists)
  }

  // 5. Runtime verification — load artifacts and test search + routing
  console.log('\n5. Runtime verification...')
  let runtimeOk = false
  let searchOk = false
  let routeOk = false

  try {
    const { load, RuntimeEngine } = await import('@navi/runtime')
    const loadResult = await load(DEMO)
    if (loadResult.success) {
      const engine = new RuntimeEngine(loadResult.package)
      runtimeOk = true
      stage('RuntimeEngine loaded', true)

      const searchResults = engine.search.query('Building', { maxResults: 5 })
      searchOk = searchResults.length > 0
      stage('Search finds results', searchOk, `${searchResults.length} results`)

      const graph = engine.data.getGraph()
      const nodes = graph.nodes || []
      if (nodes.length >= 2) {
        const fromId = nodes[0].id
        const toId = nodes[nodes.length - 1].id
        const route = engine.routing.findRoute(fromId, toId)
        routeOk = !!(route && route.path && route.path.length > 0)
        stage('Route computes', routeOk, route ? `${route.path.length} steps, ${Math.round(route.totalDistance)}m` : '')
      } else {
        stage('Route: insufficient nodes', false, `${nodes.length} nodes`)
      }
    } else {
      stage('RuntimeEngine load failed', false, loadResult.message)
    }
  } catch (err) {
    stage('Runtime verification error', false, err.message)
  }

  // 6. Report
  console.log('\n' + '='.repeat(70))
  console.log('  GATE 4B — VERIFICATION MATRIX')
  console.log('='.repeat(70))

  const checks = [
    ['Editor initialized', editorReady],
    ['Publish button clickable', publishCount > 0],
    ['Publish success dialog', dialogVisible > 0],
    ['Artifact: navigation.graph.json', artifactResults['navigation.graph.json']],
    ['Artifact: search.index.json', artifactResults['search.index.json']],
    ['Artifact: poi.json', artifactResults['poi.json']],
    ['Artifact: building-index.json', artifactResults['building-index.json']],
    ['Artifact: manifest.json', artifactResults['manifest.json']],
    ['Runtime loads published bundle', runtimeOk],
    ['Search finds results', searchOk],
    ['Route computes', routeOk],
    ['Zero page errors', pageErrors.length === 0],
  ]

  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}`)
  }
  console.log()

  if (pageErrors.length > 0) {
    console.log('  Page errors:', pageErrors.join(', '))
    console.log()
  }

  const allPass = checks.every(([_, ok]) => ok)
  console.log(`  GATE 4B ${allPass ? 'PASS' : 'FAIL'}\n`)

  await page.screenshot({ path: 'e2e-p1.1-gate4b.png' })
  await browser.close()
  process.exit(allPass ? 0 : 1)
}

run().catch(e => { console.error(e); process.exit(1) })
