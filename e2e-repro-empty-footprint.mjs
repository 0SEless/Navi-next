import { requireSafeTestEnvironment } from './e2e/support/campus-guard.mjs'
requireSafeTestEnvironment()

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const MAP_ID = 'map-1783994563934-02fbn'
const user = { id: 'mock-super-admin', name: 'Dr. Admin', email: 'admin@asu.edu', role: 'super_admin', campus_id: null }
const encoded = Buffer.from(JSON.stringify(user)).toString('base64')

// A campus map entry so EditPage finds the map (useCampusMapStore reads localStorage 'navi-campus-maps')
const campusMaps = {
  maps: [
    {
      id: MAP_ID,
      name: 'ASU Ibajay',
      schoolName: 'Ateneo de Naga',
      campusName: 'Ibajay',
      center: { lat: 11.0008, lng: 125.0015 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: { buildings: 3, nodes: 0, edges: 0 },
    },
  ],
  landmarkTypes: [],
  landmarkInstances: [],
}

// A graph snapshot containing one building with an EMPTY footprint (footprint: [])
// This is the exact data shape that crashes document-adapters.ts line 14.
const graphSnapshot = {
  id: MAP_ID,
  campusId: 'asu-ibajay',
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  buildings: [
    {
      id: 'b-valid-1', name: 'Science Hall', campusId: 'asu-ibajay', floors: [0],
      footprint: [
        { lat: 11.0000, lng: 125.0000 },
        { lat: 11.0010, lng: 125.0000 },
        { lat: 11.0010, lng: 125.0010 },
        { lat: 11.0000, lng: 125.0010 },
      ],
      baseElevation: 0, height: 15, color: '#1C6BEB', aliases: [], metadata: {},
    },
    {
      id: 'b-empty', name: 'Broken Footprint Bldg', campusId: 'asu-ibajay', floors: [0],
      footprint: [], // <-- empty: causes b.footprint.points[0] === undefined
      baseElevation: 0, height: 15, color: '#ff0000', aliases: [], metadata: {},
    },
    {
      id: 'b-valid-2', name: 'Library', campusId: 'asu-ibajay', floors: [0],
      footprint: [
        { lat: 11.0020, lng: 125.0020 },
        { lat: 11.0030, lng: 125.0020 },
        { lat: 11.0030, lng: 125.0030 },
        { lat: 11.0020, lng: 125.0030 },
      ],
      baseElevation: 0, height: 15, color: '#1C6BEB', aliases: [], metadata: {},
    },
  ],
  components: [],
  nodes: [],
  edges: [],
  traces: [],
}

async function run() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'], slowMo: 200 })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies([{ name: 'navi-mock-session', value: encoded, url: BASE }])
  const page = await context.newPage()

  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

  // 1) Initial visit to establish origin + trigger store load()
  await page.goto(BASE + `/studio/${MAP_ID}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 2) Seed localStorage with the campus map + a graph that has an empty-footprint building
  await page.evaluate(({ campusMaps, graphSnapshot, MAP_ID }) => {
    localStorage.setItem('navi-campus-maps', JSON.stringify(campusMaps))
    localStorage.setItem(`navi-graph-${MAP_ID}`, JSON.stringify(graphSnapshot))
  }, { campusMaps, graphSnapshot, MAP_ID })

  // 3) Reload so EditPage/EditorBridge pick up seeded data
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(6000)

  // 4) Wait for the map canvas
  let mapOk = false
  try {
    await page.waitForSelector('.maplibregl-map canvas', { timeout: 12000 })
    mapOk = true
  } catch { mapOk = false }

  // 5) Capture evidence
  const state = await page.evaluate(() => ({
    canvas: document.querySelectorAll('canvas').length,
    mapDivs: document.querySelectorAll('.maplibregl-map').length,
    bodyHasExplorer: document.body.innerText.includes('EXPLORER') || document.body.innerText.includes('Explorer'),
    bodyHasBuilding: document.body.innerText.includes('Broken Footprint Bldg') || document.body.innerText.includes('Science Hall'),
  }))

  await page.screenshot({ path: 'e2e-shot-after-fix.png', fullPage: false })

  console.log('=== REPRO: empty-footprint building on edit page ===')
  console.log('Page errors:', pageErrors.length ? pageErrors : 'NONE')
  console.log('Console errors:', consoleErrors.length ? consoleErrors : 'NONE')
  console.log('Map canvas rendered:', mapOk)
  console.log('DOM:', JSON.stringify(state))
  console.log('Screenshot saved: e2e-shot-after-fix.png')
  const crashed = pageErrors.some((e) => e.includes("Cannot read properties of undefined (reading 'lng')"))
  console.log('REPRODUCED CRASH (reading lng):', crashed ? 'YES ❌' : 'NO ✅ (fixed)')

  await browser.close()
}

run().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(1) })
